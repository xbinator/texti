/**
 * @file pty-runner.mts
 * @description 编排 PTY、Screen Snapshot、PromptDetector、Controller、事件和终止清理。
 */
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import type { ShellCommandRunRequest, ShellCommandRunResult, ShellCommandTermination, ShellRunEvent, ShellRunEventEnvelope } from './types.mjs';
import {
  createAutoDefaultController,
  DEFAULT_AUTO_OPTIONS,
  type AutoDefaultController,
  type AutoDefaultOptions
} from './interaction/auto-default-controller.mjs';
import { detectPrompt, type PromptDecision } from './interaction/prompt-detector.mjs';
import { createPromptRegion } from './interaction/prompt-region.mjs';
import { createNativePtyFactory, type PtyDisposable, type PtyProcess, type PtyProcessFactory } from './interaction/pty-process.mjs';
import { createScreenProjector, type TerminalSnapshotProjector } from './interaction/screen-projector.mjs';
import { createPtyStrategy, type PtyTerminationStrategy } from './interaction/termination.mjs';

/** 默认 PTY 终端尺寸。 */
const DEFAULT_COLUMNS = 100;
const DEFAULT_ROWS = 30;
/** 默认优雅终止宽限期。 */
const DEFAULT_GRACE_MS = 3_000;
/** 默认最终输出字符上限。 */
const DEFAULT_OUTPUT_CHARS = 20_000;
/** 进程树跟踪的最小间隔，避免每个输出分片都同步读取系统进程表。 */
const TREE_TRACK_INTERVAL_MS = 1_000;
/** terminal_update 事件最小发送间隔。 */
const TERMINAL_UPDATE_INTERVAL_MS = 50;

/** Shell 有序运行事件接收函数。 */
export type ShellRunEventSink = (event: ShellRunEventEnvelope) => void;

/** PTY runner 创建选项。 */
export interface CreatePtyRunnerOptions {
  /** 可注入 PTY 工厂。 */
  ptyFactory?: PtyProcessFactory;
  /** 可注入终止策略。 */
  terminationStrategy?: PtyTerminationStrategy;
  /** 终止宽限期。 */
  gracePeriodMs?: number;
  /** 仅供测试缩短固定安全窗口的 Controller 覆盖。 */
  autoDefaultOptions?: Partial<AutoDefaultOptions>;
}

/** PTY Shell runner。 */
export interface PtyShellRunner {
  /** 运行 PTY 命令。 */
  run(request: ShellCommandRunRequest, sink?: ShellRunEventSink): Promise<ShellCommandRunResult>;
  /** 取消运行中的命令。 */
  cancel(commandId: string): boolean;
}

/** 活跃 PTY 命令记录。 */
interface ActivePtyCommand {
  /** PTY 进程。 */
  process: PtyProcess;
  /** 请求取消。 */
  cancel(): void;
}

/**
 * 解析真实路径，路径不存在时回退到规范化路径。
 * @param targetPath - 目标路径
 * @returns 真实路径或规范化路径
 */
async function resolveRealPath(targetPath: string): Promise<string> {
  return realpath(targetPath).catch((): string => path.resolve(targetPath));
}

/**
 * 判断执行目录真实路径是否在工作区真实路径内。
 * @param cwd - 执行目录
 * @param workspaceRoot - 工作区根目录
 * @returns 是否允许
 */
async function isInsideWorkspace(cwd: string, workspaceRoot: string): Promise<boolean> {
  const [resolvedWorkspaceRoot, resolvedCwd] = await Promise.all([resolveRealPath(workspaceRoot), resolveRealPath(cwd)]);
  const relative = path.relative(resolvedWorkspaceRoot, resolvedCwd);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * 创建 PTY Shell runner。
 * @param options - 依赖与宽限期选项
 * @returns PTY runner
 */
export function createPtyShellRunner(options: CreatePtyRunnerOptions = {}): PtyShellRunner {
  const strategy = options.terminationStrategy ?? createPtyStrategy();
  const gracePeriodMs = options.gracePeriodMs ?? DEFAULT_GRACE_MS;
  const activeCommands = new Map<string, ActivePtyCommand>();

  /**
   * 运行单条 PTY 命令。
   * @param request - 命令请求
   * @param sink - 有序事件接收函数
   * @returns 最终结构化结果
   */
  async function run(request: ShellCommandRunRequest, sink?: ShellRunEventSink): Promise<ShellCommandRunResult> {
    if (!(await isInsideWorkspace(request.cwd, request.workspaceRoot))) return Promise.reject(new Error('命令执行目录必须位于当前工作区内'));
    const startedAt = Date.now();
    const maxOutputChars = request.maxOutputChars ?? DEFAULT_OUTPUT_CHARS;
    const autoOptions: AutoDefaultOptions = { ...DEFAULT_AUTO_OPTIONS, ...options.autoDefaultOptions };
    let process: PtyProcess | undefined;
    let projector: TerminalSnapshotProjector | undefined;
    const controller: AutoDefaultController = createAutoDefaultController(autoOptions);
    let eventSequence = 0;
    let lastScreen = '';
    let lastOutputAt = startedAt;
    let settled = false;
    let stopping = false;
    let requestedTermination: ShellCommandTermination | null = null;
    let requestedStopReason: NonNullable<ShellCommandRunResult['autoInteraction']>['stopReason'];
    let lastUnsupportedReason: 'text' | 'path' | 'account' | 'secret' = 'text';

    /** 安全发送 UI side-channel 事件。 */
    function emit(event: ShellRunEvent): void {
      eventSequence += 1;
      try {
        sink?.({ commandId: request.commandId, sequence: eventSequence, createdAt: new Date().toISOString(), event });
      } catch {
        // renderer 断开不能改变命令生命周期或最终工具结果。
      }
    }

    try {
      // 原生 node-pty 仅在请求 PTY 能力时加载；projector 也由普通 pipe runner 复用。
      const ptyFactory = options.ptyFactory ?? createNativePtyFactory();
      projector = createScreenProjector({ columns: DEFAULT_COLUMNS, rows: DEFAULT_ROWS });
      process = ptyFactory.spawn({ shell: request.shell, command: request.command, cwd: request.cwd, columns: DEFAULT_COLUMNS, rows: DEFAULT_ROWS });
    } catch (error: unknown) {
      controller.dispose();
      projector?.dispose();
      const message = error instanceof Error ? error.message : 'PTY 启动失败';
      const result: ShellCommandRunResult = {
        commandId: request.commandId,
        shell: request.shell,
        command: request.command,
        cwd: request.cwd,
        exitCode: null,
        signal: null,
        durationMs: Date.now() - startedAt,
        timedOut: false,
        truncated: false,
        outputMode: 'pty',
        terminalOutput: '',
        termination: { kind: 'spawn_error', message },
        autoInteraction: { enabled: true, answerCount: 0 }
      };
      emit({ type: 'finished', result });
      return Promise.resolve(result);
    }
    if (!process || !projector) return Promise.reject(new Error('PTY 初始化未完成'));
    const ptyProcess = process;
    const screenProjector = projector;

    return new Promise<ShellCommandRunResult>((resolve: (result: ShellCommandRunResult) => void) => {
      let dataSubscription: PtyDisposable | null = null;
      let exitSubscription: PtyDisposable | null = null;
      let pollTimer: ReturnType<typeof setInterval> | null = null;
      let toolTimer: ReturnType<typeof setTimeout> | null = null;
      let graceTimer: ReturnType<typeof setTimeout> | null = null;
      let forceTimer: ReturnType<typeof setTimeout> | null = null;
      let finalizeTimer: ReturnType<typeof setTimeout> | null = null;
      let terminalUpdateTimer: ReturnType<typeof setTimeout> | null = null;
      let processing = Promise.resolve();
      let lastTreeTrackAt = 0;
      let lastTerminalUpdateAt = 0;
      let pendingTerminalContent: string | null = null;

      /** 立即发送当前待处理的 Screen Snapshot。 */
      function flushTerminalUpdate(): void {
        if (pendingTerminalContent === null) return;
        emit({ type: 'terminal_update', content: pendingTerminalContent });
        pendingTerminalContent = null;
        lastTerminalUpdateAt = Date.now();
        if (terminalUpdateTimer) clearTimeout(terminalUpdateTimer);
        terminalUpdateTimer = null;
      }

      /** 合并高频 Screen Snapshot，并限制 renderer 更新频率。 */
      function queueTerminalUpdate(content: string): void {
        pendingTerminalContent = content;
        const remaining = TERMINAL_UPDATE_INTERVAL_MS - (Date.now() - lastTerminalUpdateAt);
        if (remaining <= 0) {
          flushTerminalUpdate();
          return;
        }
        if (terminalUpdateTimer) return;
        terminalUpdateTimer = setTimeout(flushTerminalUpdate, remaining);
      }

      /** 清理全部 runner 资源。 */
      function cleanup(): void {
        if (pollTimer) clearInterval(pollTimer);
        if (toolTimer) clearTimeout(toolTimer);
        if (graceTimer) clearTimeout(graceTimer);
        if (forceTimer) clearTimeout(forceTimer);
        if (finalizeTimer) clearTimeout(finalizeTimer);
        if (terminalUpdateTimer) clearTimeout(terminalUpdateTimer);
        dataSubscription?.dispose();
        exitSubscription?.dispose();
        controller.dispose();
        screenProjector.dispose();
        strategy.releaseTree(ptyProcess);
        activeCommands.delete(request.commandId);
        pollTimer = null;
        toolTimer = null;
        graceTimer = null;
        forceTimer = null;
        finalizeTimer = null;
        terminalUpdateTimer = null;
      }

      /**
       * 唯一完成出口。
       * @param termination - 权威终止语义
       */
      function finish(termination: ShellCommandTermination): void {
        if (settled) return;
        settled = true;
        flushTerminalUpdate();
        const projected = screenProjector.projectOutput(maxOutputChars);
        const exitCode = termination.kind === 'exit' ? termination.exitCode : null;
        const signal = termination.kind === 'signal' ? termination.signal : null;
        const result: ShellCommandRunResult = {
          commandId: request.commandId,
          shell: request.shell,
          command: request.command,
          cwd: request.cwd,
          exitCode,
          signal,
          durationMs: Date.now() - startedAt,
          timedOut: termination.kind === 'tool_timeout',
          truncated: projected.truncated,
          outputMode: 'pty',
          terminalOutput: projected.content,
          termination,
          autoInteraction: {
            enabled: true,
            answerCount: controller.answerCount(),
            stopReason: requestedStopReason ?? (termination.kind === 'exit' || termination.kind === 'signal' ? 'process_exit' : undefined)
          }
        };
        emit({ type: 'finished', result });
        cleanup();
        resolve(result);
      }

      /** 强制信号后轮询进程树，直到确认清空或返回独立清理失败。 */
      function forceAndFinalize(termination: ShellCommandTermination): void {
        strategy.forceTree(ptyProcess);
        const cleanupDeadline = Date.now() + Math.max(gracePeriodMs, 250);

        /** 等待强制信号生效，并在后代仍存活时返回独立清理失败。 */
        function finalizeTree(): void {
          if (!strategy.isTreeAlive(ptyProcess)) {
            finish(requestedTermination ?? termination);
            return;
          }
          if (Date.now() >= cleanupDeadline) {
            finish({ kind: 'process_cleanup_failed', message: 'PTY 命令已终止，但仍有后代进程存活' });
            return;
          }
          finalizeTimer = setTimeout(finalizeTree, 25);
        }

        finalizeTree();
      }

      /** 启动 interrupt → terminate → force 的用户请求终止链。 */
      function requestStop(termination: ShellCommandTermination, stopReason: NonNullable<ShellCommandRunResult['autoInteraction']>['stopReason']): void {
        if (stopping || settled) return;
        stopping = true;
        requestedTermination = termination;
        requestedStopReason = stopReason;
        strategy.interruptTree(ptyProcess);
        graceTimer = setTimeout((): void => {
          strategy.terminateTree(ptyProcess);
          forceTimer = setTimeout((): void => forceAndFinalize(termination), gracePeriodMs);
        }, gracePeriodMs);
      }

      /** leader 已退出但捕获的后代仍存活时，直接进入 terminate → force 清理链。 */
      function cleanupAfterExit(termination: ShellCommandTermination): void {
        if (stopping || settled) return;
        stopping = true;
        requestedTermination = termination;
        requestedStopReason = 'process_exit';
        strategy.terminateTree(ptyProcess);
        forceTimer = setTimeout((): void => forceAndFinalize(termination), gracePeriodMs);
      }

      /** 投影并评估最新屏幕。 */
      async function evaluate(): Promise<void> {
        if (settled || stopping) return;
        const now = Date.now();
        const snapshot = screenProjector.snapshot(now);
        if (snapshot.content !== lastScreen) {
          lastScreen = snapshot.content;
          queueTerminalUpdate(snapshot.content.slice(-12_000));
        }
        const region = createPromptRegion(snapshot);
        const hasRecentOutput = now - lastOutputAt < autoOptions.activeOutputWindowMs;
        const detectorSnapshot = hasRecentOutput
          ? snapshot
          : { ...snapshot, activity: { spinner: false, progress: false, compiling: false, streamingLogs: false } };
        const hasActivity = Object.values(detectorSnapshot.activity).some((active: boolean): boolean => active);
        // 没有 prompt region 时，持续的进度或编译信号仍需作为轮次转换屏障；带 prompt 的单次 PTY 回显不会进入此分支。
        let decision: PromptDecision = { type: 'unknown' };
        if (region) decision = detectPrompt(detectorSnapshot, region);
        else if (hasRecentOutput && hasActivity) decision = { type: 'active_output' };
        if (decision.type === 'unsupported_input') lastUnsupportedReason = decision.reason;
        const intent = controller.observe({ screenHash: region?.screenHash, decision, now, lastOutputAt });
        if (intent?.type === 'submit_enter') {
          // auto_answer 之前先刷新对应 prompt，确保 UI 事件语义顺序稳定。
          flushTerminalUpdate();
          try {
            ptyProcess.write('\r');
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : '无法写入 PTY';
            requestStop({ kind: 'spawn_error', message: `PTY 自动回答写入失败：${message}` }, undefined);
            return;
          }
          emit({ type: 'auto_answer', count: controller.answerCount() });
        } else if (intent?.type === 'request_stop') {
          if (intent.reason === 'interaction_timeout') requestStop({ kind: 'interaction_timeout' }, 'interaction_timeout');
          if (intent.reason === 'answer_limit') requestStop({ kind: 'answer_limit' }, 'answer_limit');
          if (intent.reason === 'unsupported_prompt') {
            requestStop({ kind: 'unsupported_prompt', reason: lastUnsupportedReason }, 'unsupported_prompt');
          }
        }
      }

      /** 将评估串行化，避免 terminal.write 与退出竞争。 */
      function queueEvaluation(data?: string): void {
        processing = processing
          .then(async (): Promise<void> => {
            if (data !== undefined) await screenProjector.write(data);
            await evaluate();
          })
          .catch((error: unknown): void => {
            const message = error instanceof Error ? error.message : '终端投影失败';
            requestStop({ kind: 'spawn_error', message: `PTY 终端处理失败：${message}` }, undefined);
          });
      }

      dataSubscription = ptyProcess.onData((data: string): void => {
        const now = Date.now();
        lastOutputAt = now;
        if (now - lastTreeTrackAt >= TREE_TRACK_INTERVAL_MS) {
          strategy.trackTree(ptyProcess);
          lastTreeTrackAt = now;
        }
        queueEvaluation(data);
      });
      exitSubscription = ptyProcess.onExit((event: { exitCode: number; signal?: number }): void => {
        processing.then((): void => {
          if (requestedTermination) {
            // Ctrl+C 可能只结束 PTY leader；后代仍存活时保留升级定时器。
            if (!strategy.isTreeAlive(ptyProcess)) finish(requestedTermination);
            return;
          }
          const termination: ShellCommandTermination =
            event.signal !== undefined && event.signal !== 0 ? { kind: 'signal', signal: String(event.signal) } : { kind: 'exit', exitCode: event.exitCode };
          if (strategy.isTreeAlive(ptyProcess)) cleanupAfterExit(termination);
          else finish(termination);
        });
      });
      pollTimer = setInterval((): void => queueEvaluation(), 50);
      if (request.timeoutMs !== undefined) {
        toolTimer = setTimeout((): void => requestStop({ kind: 'tool_timeout' }, 'tool_timeout'), request.timeoutMs);
      }
      activeCommands.set(request.commandId, {
        process: ptyProcess,
        cancel: (): void => requestStop({ kind: 'cancelled' }, 'cancelled')
      });
    });
  }

  /**
   * 取消活跃 PTY 命令。
   * @param commandId - 命令 ID
   * @returns 是否找到命令
   */
  function cancel(commandId: string): boolean {
    const active = activeCommands.get(commandId);
    if (!active) return false;
    active.cancel();
    return true;
  }

  return { run, cancel };
}
