/**
 * @file runner.mts
 * @description Shell 命令子进程 runner，负责进程生命周期、实时输出、超时和取消。
 */
import { spawn } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import type { ShellCommandOutputChunk, ShellCommandRunRequest, ShellCommandRunResult, ShellCommandTermination } from './types.mjs';
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from 'node:child_process';
import { getAutoDefaultCapability, type ShellAutoDefaultCapability } from './interaction/capability.mjs';
import { createPtyShellRunner, type PtyShellRunner, type ShellRunEventSink } from './pty-runner.mjs';

/** 默认最终输出截断字符数。 */
const DEFAULT_MAX_OUTPUT_CHARS = 20_000;

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
 * 创建 Shell 命令 runner。
 * @param options - runner 创建选项
 * @returns Shell 命令 runner
 */
export function createShellCommandRunner(options: CreateShellCommandRunnerOptions = {}): ShellCommandRunner {
  const spawnProcess = options.spawnProcess ?? spawn;
  const ptyRunner = options.ptyRunner ?? createPtyShellRunner();
  const resolveAutoDefaultCapability = options.getAutoDefaultCapability ?? getAutoDefaultCapability;
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
    const child = spawnProcess(spawnCommand.command, spawnCommand.args, {
      cwd: request.cwd,
      shell: false,
      env: buildMinimalEnv(),
      detached: true
    });
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

    activeCommands.set(request.commandId, activeCommand);

    /** 可选主超时定时器；Runtime 管理的命令不创建绝对时限。 */
    let timeout: ReturnType<typeof setTimeout> | null = null;

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
      sink?.({
        commandId: request.commandId,
        stream,
        text,
        sequence,
        createdAt: new Date().toISOString()
      });
    }

    return new Promise<ShellCommandRunResult>((resolve, reject) => {
      /**
       * 强制结束：SIGTERM → grace period → SIGKILL → 强制 resolve。
       * cancel 和 timeout 共用此状态机，确保 Promise 始终能 settle。
       * @param reason - 终止原因（timeout / cancel）
       */
      function doForceTerminate(reason: 'timeout' | 'cancel'): void {
        // 已进入终止流程则跳过，防止重复 cancel 重复安排定时器
        if (activeCommand.terminating) return;
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
            settled = true;
            cleanup();
            resolve({
              commandId: request.commandId,
              shell: request.shell,
              command: request.command,
              cwd: request.cwd,
              exitCode: null,
              signal: 'SIGKILL',
              durationMs: Date.now() - startedAt,
              timedOut: activeCommand.timedOut,
              stdout,
              stderr,
              truncated,
              outputMode: 'pipes',
              termination: activeCommand.timedOut ? { kind: 'tool_timeout' } : { kind: 'cancelled' }
            });
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
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(error);
      });
      child.on('exit', (exitCode: number | null, signal: NodeJS.Signals | null) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        let termination: ShellCommandTermination;
        if (activeCommand.terminationReason === 'timeout') termination = { kind: 'tool_timeout' };
        else if (activeCommand.terminationReason === 'cancel') termination = { kind: 'cancelled' };
        else if (exitCode !== null) termination = { kind: 'exit', exitCode };
        else termination = { kind: 'signal', signal: signal ?? 'unknown' };
        resolve({
          commandId: request.commandId,
          shell: request.shell,
          command: request.command,
          cwd: request.cwd,
          exitCode,
          signal,
          durationMs: Date.now() - startedAt,
          timedOut: activeCommand.timedOut,
          stdout,
          stderr,
          truncated,
          outputMode: 'pipes',
          termination
        });
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
