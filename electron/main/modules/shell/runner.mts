/**
 * @file runner.mts
 * @description Shell 命令子进程 runner，负责进程生命周期、实时输出、超时和取消。
 */
import { spawn } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import type { ShellCommandOutputChunk, ShellCommandRunRequest, ShellCommandRunResult, ShellCommandTermination, ShellRunEvent } from './types.mjs';
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from 'node:child_process';
import { debounce } from 'lodash-es';
import { asyncTo } from '../../../../src/utils/asyncTo.js';
import { getAutoDefaultCapability, type ShellAutoDefaultCapability } from './interaction/capability.mjs';
import { createScreenProjector, type ScreenProjectorOptions, type TerminalSnapshotProjector } from './interaction/screen-projector.mjs';
import { createPtyShellRunner, type PtyShellRunner, type ShellRunEventSink } from './pty-runner.mjs';

/** 默认最终输出截断字符数。 */
const DEFAULT_MAX_OUTPUT_CHARS = 20_000;

/** 普通 pipe 输出使用的固定终端列数。 */
const DEFAULT_TERMINAL_COLUMNS = 100;

/** 普通 pipe 输出使用的固定终端行数。 */
const DEFAULT_TERMINAL_ROWS = 30;

/** 普通 pipe 实时 Screen Snapshot 最大字符数。 */
const DEFAULT_SNAPSHOT_CHARS = 12_000;

/** 普通 pipe Screen Snapshot 静止后发布等待时间。 */
const TERMINAL_UPDATE_SETTLE_MS = 16;

/** 普通 pipe Screen Snapshot 持续变化时的最大发布等待时间。 */
const TERMINAL_UPDATE_MAX_WAIT_MS = 50;

/** 投影等待文本达到 1 MiB 时暂停 child 输出流。 */
const PROJECTION_HIGH_WATER_CHARS = 1_024 * 1_024;

/** 投影等待文本降至 512 KiB 时恢复 child 输出流。 */
const PROJECTION_LOW_WATER_CHARS = 512 * 1_024;

/** SIGTERM 后等待进程退出的宽限期（毫秒），超时后升级为 SIGKILL。 */
const GRACE_PERIOD_MS = 3_000;

/**
 * 允许传递给子进程的环境变量白名单键名。
 * 仅包含 PATH、HOME 等基础变量和常见包管理器变量，
 * 避免将 API 密钥等敏感信息泄露给 LLM 生成的命令。
 */
const ALLOWED_ENV_KEYS: ReadonlySet<string> = new Set([
  // 基础路径
  'PATH',
  'HOME',
  'USER',
  'SHELL',
  'TMPDIR',
  'TEMP',
  'TMP',
  // 包管理器
  'NPM_CONFIG_REGISTRY',
  'YARN_REGISTRY',
  'PNPM_HOME',
  'CARGO_HOME',
  'RUSTUP_HOME',
  'GOPATH',
  'GOPROXY',
  // 语言运行时
  'PYTHONIOENCODING',
  // 区域设置
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  // 终端
  'TERM',
  'COLORTERM'
]);

/**
 * 从 process.env 中提取白名单内的环境变量。
 * @returns 最小化环境变量对象
 */
function buildMinimalEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ALLOWED_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return env;
}

/**
 * 终止进程及其所有子进程（进程树清理）。
 * Unix: 使用负 PID 杀死进程组。
 * Windows: 回退到仅杀死直接子进程。
 * @param child - 子进程对象
 * @param signal - 终止信号
 */
function killProcessTree(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals = 'SIGTERM'): void {
  if (child.pid === undefined) {
    child.kill(signal);
    return;
  }

  if (process.platform === 'win32') {
    // Windows 不支持进程组 kill，回退到直接 kill
    child.kill(signal);
  } else {
    try {
      // 负 PID 表示向整个进程组发送信号
      process.kill(-child.pid, signal);
    } catch {
      // 进程组不存在时回退到直接 kill
      child.kill(signal);
    }
  }
}

/** Shell 命令输出接收函数。 */
export type ShellCommandOutputSink = (chunk: ShellCommandOutputChunk) => void;

/** Shell 命令 spawn 函数。 */
export type ShellCommandSpawn = (command: string, args: string[], options: SpawnOptionsWithoutStdio) => ChildProcessWithoutNullStreams;

/** Shell 终端投影器创建函数。 */
export type ScreenProjectorFactory = (options: ScreenProjectorOptions) => TerminalSnapshotProjector;

/**
 * Shell 命令 runner 创建选项。
 */
export interface CreateShellCommandRunnerOptions {
  /** 子进程创建函数，测试时可注入。 */
  spawnProcess?: ShellCommandSpawn;
  /** PTY runner，测试时可注入。 */
  ptyRunner?: PtyShellRunner;
  /** 获取版本化 auto-default capability。 */
  getAutoDefaultCapability?: () => ShellAutoDefaultCapability;
  /** 普通 pipe 输出投影器创建函数，测试时可注入。 */
  screenProjectorFactory?: ScreenProjectorFactory;
}

/**
 * Shell 命令 runner。
 */
export interface ShellCommandRunner {
  /**
   * 运行命令。
   * @param request - 命令执行请求
   * @param sink - 实时输出接收函数
   * @returns 命令执行结果
   */
  run: (request: ShellCommandRunRequest, sink?: ShellCommandOutputSink, eventSink?: ShellRunEventSink) => Promise<ShellCommandRunResult>;
  /**
   * 按命令 ID 取消运行中的命令。
   * @param commandId - 命令 ID
   * @returns 是否找到并取消
   */
  cancel: (commandId: string) => boolean;
}

/**
 * 活跃命令记录。
 */
interface ActiveCommand {
  /** 子进程对象。 */
  child: ChildProcessWithoutNullStreams;
  /** 是否已经触发超时。 */
  timedOut: boolean;
  /** 是否已进入终止流程，防止重复 cancel 重复安排定时器。 */
  terminating: boolean;
  /** 主动终止原因，用于派生权威 termination。 */
  terminationReason: 'timeout' | 'cancel' | null;
  /** SIGTERM 后的宽限期定时器。 */
  graceTimer: ReturnType<typeof setTimeout> | null;
  /** 强制终止回调（Promise 闭包内设置，cancel/timeout 共用）。 */
  forceTerminate: ((reason: 'timeout' | 'cancel') => void) | null;
}

/**
 * 将 shell 请求转换为可执行命令和参数。
 * @param request - 命令执行请求
 * @returns spawn 参数
 */
function resolveSpawnCommand(request: ShellCommandRunRequest): { command: string; args: string[] } {
  if (request.shell === 'powershell') {
    const executable = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
    return {
      command: executable,
      args: ['-NoProfile', '-NonInteractive', '-Command', request.command]
    };
  }

  return {
    command: 'bash',
    args: ['--noprofile', '--norc', '-c', request.command]
  };
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
 * 判断目标目录真实路径是否位于工作区真实路径内。
 * @param cwd - 执行目录
 * @param workspaceRoot - 工作区根目录
 * @returns 是否位于工作区内
 */
async function isCwdInsideWorkspace(cwd: string, workspaceRoot: string): Promise<boolean> {
  const [resolvedCwd, resolvedWorkspace] = await Promise.all([resolveRealPath(cwd), resolveRealPath(workspaceRoot)]);
  const relativePath = path.relative(resolvedWorkspace, resolvedCwd);

  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

/**
 * 追加输出并按最大长度截断。
 * @param current - 当前输出
 * @param next - 新输出
 * @param maxChars - 最大字符数
 * @returns 新输出和是否截断
 */
function appendBoundedOutput(current: string, next: string, maxChars: number): { value: string; truncated: boolean } {
  const merged = `${current}${next}`;
  if (merged.length <= maxChars) {
    return { value: merged, truncated: false };
  }

  return { value: merged.slice(merged.length - maxChars), truncated: true };
}

/**
 * 安全释放终端投影器，清理异常不能改变 Shell 命令生命周期。
 * @param projector - 待释放投影器
 */
function safeDisposeProjector(projector: TerminalSnapshotProjector | undefined): void {
  if (!projector) return;
  try {
    projector.dispose();
  } catch {
    // headless terminal 清理失败不影响原始 Shell 进程与输出。
  }
}

/**
 * 创建 Shell 命令 runner。
 * @param options - runner 创建选项
 * @returns Shell 命令 runner
 */
export function createShellCommandRunner(options: CreateShellCommandRunnerOptions = {}): ShellCommandRunner {
  const spawnProcess = options.spawnProcess ?? spawn;
  const ptyRunner = options.ptyRunner ?? createPtyShellRunner();
  const resolveAutoDefaultCapability = options.getAutoDefaultCapability ?? getAutoDefaultCapability;
  const screenProjectorFactory = options.screenProjectorFactory ?? createScreenProjector;
  const activeCommands = new Map<string, ActiveCommand>();

  /**
   * 运行命令。
   * @param request - 命令执行请求
   * @param sink - 实时输出接收函数
   * @returns 命令执行结果
   */
  async function run(request: ShellCommandRunRequest, sink?: ShellCommandOutputSink, eventSink?: ShellRunEventSink): Promise<ShellCommandRunResult> {
    if (!(await isCwdInsideWorkspace(request.cwd, request.workspaceRoot))) {
      return Promise.reject(new Error('命令执行目录必须位于当前工作区内'));
    }
    if (request.interactionMode === 'auto-default') {
      const capability = resolveAutoDefaultCapability();
      if (!capability.enabled) {
        return Promise.reject(new Error(`Shell auto-default capability 未开放：${capability.reason ?? 'UNKNOWN'}`));
      }
      return ptyRunner.run(request, eventSink);
    }

    const maxOutputChars = request.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;
    const startedAt = Date.now();
    const spawnCommand = resolveSpawnCommand(request);
    let projector: TerminalSnapshotProjector | undefined;

    // 先初始化显示旁路再 spawn，避免首次加载 headless terminal 延迟注册输出监听器。
    try {
      projector = screenProjectorFactory({ columns: DEFAULT_TERMINAL_COLUMNS, rows: DEFAULT_TERMINAL_ROWS, convertEol: true });
    } catch {
      projector = undefined;
    }

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawnProcess(spawnCommand.command, spawnCommand.args, {
        cwd: request.cwd,
        shell: false,
        env: buildMinimalEnv(),
        detached: true
      });
    } catch (error: unknown) {
      safeDisposeProjector(projector);
      throw error;
    }
    const activeCommand: ActiveCommand = {
      child,
      timedOut: false,
      terminating: false,
      terminationReason: null,
      graceTimer: null,
      forceTerminate: null
    };
    let stdout = '';
    let stderr = '';
    let truncated = false;
    let sequence = 0;
    let settled = false;
    let projectionQueue = Promise.resolve();
    let pendingProjectionChars = 0;
    let projectionStreamsPaused = false;
    let runEventSequence = 0;
    let pendingTerminalContent: string | null = null;
    let lastTerminalContent: string | null = null;

    activeCommands.set(request.commandId, activeCommand);

    /** 可选主超时定时器；Runtime 管理的命令不创建绝对时限。 */
    let timeout: ReturnType<typeof setTimeout> | null = null;

    /**
     * 释放当前投影器，释放异常不能改变命令结果。
     */
    function releaseProjector(): void {
      const activeProjector = projector;
      projector = undefined;
      safeDisposeProjector(activeProjector);
    }

    /**
     * 安全发送实时输出，renderer 断开不能改变命令生命周期。
     * @param chunk - 待发送输出片段
     */
    function emitOutput(chunk: ShellCommandOutputChunk): void {
      try {
        sink?.(chunk);
      } catch {
        // 实时显示是旁路；最终结构化结果仍由 run Promise 返回。
      }
    }

    /**
     * 安全发送 Shell 有序运行事件，renderer 断开不能改变命令生命周期。
     * @param event - 待发送运行事件
     */
    function emitRunEvent(event: ShellRunEvent): void {
      runEventSequence += 1;
      try {
        eventSink?.({ commandId: request.commandId, sequence: runEventSequence, createdAt: new Date().toISOString(), event });
      } catch {
        // Screen Snapshot 是显示旁路；最终结构化结果仍由 run Promise 返回。
      }
    }

    /**
     * 发布 trailing settle 后的 Screen Snapshot。
     */
    function publishTerminalUpdate(): void {
      const content = pendingTerminalContent;
      pendingTerminalContent = null;
      if (content === null || content === lastTerminalContent) return;
      // 已有非空画面时忽略擦除与重绘之间的瞬时空帧，避免终端块高度归零。
      if (content === '' && Boolean(lastTerminalContent)) return;
      lastTerminalContent = content;
      emitRunEvent({ type: 'terminal_update', content });
    }

    /** trailing settle 发布器；maxWait 保证持续输出不会饿死画面刷新。 */
    const scheduleTerminalUpdate = debounce(publishTerminalUpdate, TERMINAL_UPDATE_SETTLE_MS, {
      leading: false,
      trailing: true,
      maxWait: TERMINAL_UPDATE_MAX_WAIT_MS
    });

    /**
     * 立即发布当前待处理的稳定 Screen Snapshot。
     */
    function flushTerminalUpdate(): void {
      scheduleTerminalUpdate.flush();
    }

    /**
     * 在 trailing settle 窗口内只保留最新 Screen Snapshot。
     * @param content - 最新终端屏幕
     */
    function queueTerminalUpdate(content: string): void {
      pendingTerminalContent = content;
      scheduleTerminalUpdate();
    }

    /**
     * 投影积压达到高水位时暂停两条输出流，对 child 施加自然 pipe 背压。
     */
    function pauseStreams(): void {
      if (projectionStreamsPaused || pendingProjectionChars < PROJECTION_HIGH_WATER_CHARS) return;
      projectionStreamsPaused = true;
      child.stdout.pause();
      child.stderr.pause();
    }

    /**
     * 投影积压降到低水位后恢复两条输出流。
     * @param force - 清理阶段是否忽略低水位条件
     */
    function resumeStreams(force = false): void {
      if (!projectionStreamsPaused || (!force && pendingProjectionChars > PROJECTION_LOW_WATER_CHARS)) return;
      projectionStreamsPaused = false;
      child.stdout.resume();
      child.stderr.resume();
    }

    /**
     * 按原始 chunk sequence 串行解释终端控制序列。
     * @param text - 原始输出文本
     */
    function queueProjection(text: string): void {
      if (!projector) return;
      pendingProjectionChars += text.length;
      pauseStreams();
      projectionQueue = projectionQueue.then(async (): Promise<void> => {
        try {
          const activeProjector = projector;
          if (!activeProjector) return;

          const [writeError] = await asyncTo(activeProjector.write(text));
          if (writeError) {
            // 当前与后续 chunk 在异步写入失败后关闭显示旁路，raw 输出已经即时发送。
            releaseProjector();
            return;
          }

          try {
            const terminalContent = activeProjector.snapshot(Date.now(), DEFAULT_SNAPSHOT_CHARS).content;
            queueTerminalUpdate(terminalContent);
          } catch {
            // 同步快照失败同样关闭显示旁路，raw 输出不受影响。
            releaseProjector();
          }
        } finally {
          pendingProjectionChars = Math.max(0, pendingProjectionChars - text.length);
          resumeStreams();
        }
      });
    }

    /**
     * 清理命令：清除定时器、从活跃列表移除。
     */
    function cleanup(): void {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      if (activeCommand.graceTimer) {
        clearTimeout(activeCommand.graceTimer);
        activeCommand.graceTimer = null;
      }
      scheduleTerminalUpdate.cancel();
      pendingTerminalContent = null;
      resumeStreams(true);
      releaseProjector();
      activeCommands.delete(request.commandId);
    }

    /**
     * 处理输出流片段。
     * @param stream - 输出流类型
     * @param chunk - 输出内容
     */
    function handleOutput(stream: 'stdout' | 'stderr', chunk: Buffer | string): void {
      const text = chunk.toString();
      const bounded = appendBoundedOutput(stream === 'stdout' ? stdout : stderr, text, maxOutputChars);
      if (stream === 'stdout') {
        stdout = bounded.value;
      } else {
        stderr = bounded.value;
      }
      truncated = truncated || bounded.truncated;
      sequence += 1;
      const outputChunk: ShellCommandOutputChunk = {
        commandId: request.commandId,
        stream,
        text,
        sequence,
        createdAt: new Date().toISOString()
      };
      emitOutput(outputChunk);
      queueProjection(text);
    }

    return new Promise<ShellCommandRunResult>((resolve, reject) => {
      /**
       * 等待实时投影队列后返回普通 pipe 最终结果。
       * @param exitCode - 进程退出码
       * @param signal - 进程退出信号
       * @param termination - 权威终止语义
       */
      async function resolveResult(exitCode: number | null, signal: string | null, termination: ShellCommandTermination): Promise<void> {
        if (settled) return;
        settled = true;
        const finishedAt = Date.now();
        await projectionQueue;
        flushTerminalUpdate();

        let terminalOutput: string | undefined;
        let terminalTruncated = false;
        const activeProjector = projector;
        if (activeProjector) {
          try {
            const projected = activeProjector.projectOutput(maxOutputChars);
            terminalOutput = projected.content;
            terminalTruncated = projected.truncated;
          } catch {
            // 最终投影失败时省略 terminalOutput，保留原始 stdout/stderr。
            releaseProjector();
          }
        }

        const result: ShellCommandRunResult = {
          commandId: request.commandId,
          shell: request.shell,
          command: request.command,
          cwd: request.cwd,
          exitCode,
          signal,
          durationMs: finishedAt - startedAt,
          timedOut: activeCommand.timedOut,
          stdout,
          stderr,
          truncated: truncated || terminalTruncated,
          outputMode: 'pipes',
          ...(terminalOutput !== undefined ? { terminalOutput } : {}),
          termination
        };
        cleanup();
        emitRunEvent({ type: 'finished', result });
        resolve(result);
      }

      /**
       * 等待已排队投影并释放资源后维持原有 child error reject 语义。
       * @param error - 子进程错误
       */
      async function rejectResult(error: Error): Promise<void> {
        if (settled) return;
        settled = true;
        await projectionQueue;
        flushTerminalUpdate();
        cleanup();
        reject(error);
      }

      /**
       * 强制结束：SIGTERM → grace period → SIGKILL → 强制 resolve。
       * cancel 和 timeout 共用此状态机，确保 Promise 始终能 settle。
       * @param reason - 终止原因（timeout / cancel）
       */
      function doForceTerminate(reason: 'timeout' | 'cancel'): void {
        // 已进入终止流程则跳过，防止重复 cancel 重复安排定时器
        if (settled || activeCommand.terminating) return;
        activeCommand.terminating = true;

        // 终止流程启动后清除主超时定时器，避免重复触发
        if (timeout) {
          clearTimeout(timeout);
          timeout = null;
        }

        if (reason === 'timeout') {
          activeCommand.timedOut = true;
        }
        activeCommand.terminationReason = reason;
        killProcessTree(child, 'SIGTERM');

        // 宽限期后升级为 SIGKILL
        activeCommand.graceTimer = setTimeout(() => {
          killProcessTree(child, 'SIGKILL');

          // SIGKILL 后仍未退出则强制 resolve
          activeCommand.graceTimer = setTimeout(() => {
            if (settled) return;
            resolveResult(null, 'SIGKILL', activeCommand.timedOut ? { kind: 'tool_timeout' } : { kind: 'cancelled' });
          }, GRACE_PERIOD_MS);
        }, GRACE_PERIOD_MS);
      }

      // 将终止回调暴露给外部 cancel()，共用同一状态机
      activeCommand.forceTerminate = doForceTerminate;

      if (request.timeoutMs !== undefined) {
        timeout = setTimeout(() => doForceTerminate('timeout'), request.timeoutMs);
      }

      child.stdout.on('data', (chunk: Buffer | string) => handleOutput('stdout', chunk));
      child.stderr.on('data', (chunk: Buffer | string) => handleOutput('stderr', chunk));
      child.on('error', (error: Error) => {
        rejectResult(error);
      });
      // close 保证 stdio 已关闭；exit 之后仍可能有尚未消费的 stdout/stderr 尾部。
      child.on('close', (exitCode: number | null, signal: NodeJS.Signals | null) => {
        if (settled) return;
        let termination: ShellCommandTermination;
        if (activeCommand.terminationReason === 'timeout') termination = { kind: 'tool_timeout' };
        else if (activeCommand.terminationReason === 'cancel') termination = { kind: 'cancelled' };
        else if (exitCode !== null) termination = { kind: 'exit', exitCode };
        else termination = { kind: 'signal', signal: signal ?? 'unknown' };
        resolveResult(exitCode, signal, termination);
      });
    });
  }

  /**
   * 取消运行中的命令。
   * 通过 activeCommand.forceTerminate 回调与 timeout 共用同一终止状态机，
   * 确保 Promise 始终能 settle 并 cleanup。
   * @param commandId - 命令 ID
   * @returns 是否找到并取消
   */
  function cancel(commandId: string): boolean {
    const activeCommand = activeCommands.get(commandId);
    if (!activeCommand) {
      return ptyRunner.cancel(commandId);
    }

    if (activeCommand.forceTerminate) {
      activeCommand.forceTerminate('cancel');
    } else {
      // forceTerminate 尚未设置（spawn 还没完成），直接 kill
      killProcessTree(activeCommand.child, 'SIGTERM');
    }
    return true;
  }

  return { run, cancel };
}

/** 默认 Shell 命令 runner。 */
export const shellCommandRunner = createShellCommandRunner();
