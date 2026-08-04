/**
 * @file subprocess-runner.mts
 * @description ChatRuntime 主进程有界子进程 runner。
 */
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import type { AIToolActivityReporter, AIToolExecutionError, ChatToolProgressSnapshot } from 'types/ai';

/** 收到终止请求后等待子进程正常退出的宽限期。 */
export const RUNTIME_SUBPROCESS_FORCE_KILL_GRACE_MS = 5_000;
/** 发出强杀信号后等待 Node close 事件的最终宽限期。 */
export const RUNTIME_SUBPROCESS_CLOSE_GRACE_MS = 1_000;

/** 子进程可保留的结构化 Watchdog 中止码。 */
const SUBPROCESS_ABORT_CODES: ReadonlySet<AIToolExecutionError['code']> = new Set([
  'USER_CANCELLED',
  'TOOL_UNRESPONSIVE',
  'EXTERNAL_WAIT_TIMEOUT',
  'RUNTIME_INTERRUPTED'
]);

/** 本 runner 使用的子进程类型。 */
type RuntimeChildProcess = ChildProcessByStdio<null, Readable, Readable>;

/** stdout 流式处理决策。 */
export type RuntimeSubprocessStdoutDecision = 'continue' | 'terminate';

/** stdout 流式处理回调。 */
export type RuntimeSubprocessStdoutHandler = (chunk: Buffer) => RuntimeSubprocessStdoutDecision | void;

/** 有界子进程执行输入。 */
export interface RuntimeSubprocessInput {
  /** 可执行命令。 */
  command: string;
  /** 命令参数。 */
  args: string[];
  /** 工作目录。 */
  cwd?: string;
  /** 可选固定超时时间；Runtime Watchdog 托管时省略。 */
  timeoutMs?: number;
  /** stdout 最大字节数。 */
  stdoutLimitBytes: number;
  /** stderr 最大字节数。 */
  stderrLimitBytes: number;
  /** 是否缓存 stdout 文本。 */
  bufferStdout?: boolean;
  /** stdout 流式处理回调。 */
  onStdoutChunk?: RuntimeSubprocessStdoutHandler;
  /** 外部取消信号。 */
  signal?: AbortSignal;
  /** 安全活动上报器。 */
  activity?: AIToolActivityReporter;
}

/** 有界子进程执行结果。 */
export interface RuntimeSubprocessResult {
  /** 退出码。 */
  exitCode: number | null;
  /** 退出信号。 */
  signal: NodeJS.Signals | null;
  /** stdout 文本。 */
  stdout: string;
  /** stderr 文本。 */
  stderr: string;
  /** 是否超时。 */
  timedOut: boolean;
  /** 是否由 stdout 消费者主动终止。 */
  terminatedByConsumer: boolean;
  /** 执行耗时。 */
  elapsedMs: number;
}

/** 文件搜索子进程错误。 */
export class RuntimeSubprocessError extends Error {
  /** 工具错误码。 */
  readonly code: AIToolExecutionError['code'];

  /**
   * 创建子进程错误。
   * @param code - 工具错误码
   * @param message - 错误消息
   */
  constructor(code: AIToolExecutionError['code'], message: string) {
    super(message);
    this.name = 'RuntimeSubprocessError';
    this.code = code;
  }
}

/**
 * 安全 kill 子进程或进程组。
 * @param child - 子进程
 */
function killRuntimeChildProcess(child: RuntimeChildProcess | null, signal: NodeJS.Signals = 'SIGTERM'): boolean {
  if (!child || child.pid === undefined) return false;

  if (process.platform !== 'win32') {
    try {
      return process.kill(-child.pid, signal);
    } catch {
      try {
        return child.kill(signal);
      } catch {
        return false;
      }
    }
  }

  try {
    return child.kill(signal);
  } catch {
    return false;
  }
}

/**
 * 拼接缓冲区为 UTF-8 文本。
 * @param chunks - Buffer 列表
 * @returns UTF-8 文本
 */
function concatRuntimeBufferText(chunks: Buffer[]): string {
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * 安全上报子进程进展，隔离旁路投影故障。
 * @param activity - 可选活动上报器
 * @param progress - 安全进展摘要
 */
function reportSubprocessProgress(activity: AIToolActivityReporter | undefined, progress: Omit<ChatToolProgressSnapshot, 'updatedAt'>): void {
  try {
    activity?.progress(progress);
  } catch {
    // 活动投影不是子进程生命周期的权威边界，失败时继续执行清理与收敛。
  }
}

/**
 * 从 AbortSignal 构造保留 Watchdog 语义的子进程错误。
 * @param signal - 外部中止信号
 * @returns 结构化子进程错误
 */
function createAbortError(signal: AbortSignal | undefined): RuntimeSubprocessError {
  const reason: unknown = signal?.reason;
  if (typeof reason === 'object' && reason !== null && 'code' in reason && 'message' in reason) {
    const { code, message } = reason;
    if (typeof code === 'string' && SUBPROCESS_ABORT_CODES.has(code as AIToolExecutionError['code']) && typeof message === 'string') {
      return new RuntimeSubprocessError(code as AIToolExecutionError['code'], message);
    }
  }
  return new RuntimeSubprocessError('USER_CANCELLED', '工具调用已取消');
}

/**
 * 执行有界子进程。
 * @param input - 子进程执行输入
 * @returns 子进程执行结果
 */
export function runBoundedSubprocess(input: RuntimeSubprocessInput): Promise<RuntimeSubprocessResult> {
  return new Promise<RuntimeSubprocessResult>((resolve, reject) => {
    const startedAt = Date.now();
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let timedOut = false;
    let terminatedByConsumer = false;
    let terminationRequested = false;
    let childClosed = false;
    let child: RuntimeChildProcess | null = null;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let forceKillTimeout: ReturnType<typeof setTimeout> | null = null;
    let closeTimeout: ReturnType<typeof setTimeout> | null = null;
    let abortListener: (() => void) | null = null;
    let pendingFailure: RuntimeSubprocessError | null = null;
    let handleStdout: (chunk: Buffer) => void = (): void => undefined;
    let handleStderr: (chunk: Buffer) => void = (): void => undefined;
    let handleChildError: (error: Error) => void = (): void => undefined;
    let handleChildClose: (exitCode: number | null, signal: NodeJS.Signals | null) => void = (): void => undefined;

    /**
     * 清理定时器和取消监听。
     */
    function cleanup(): void {
      if (timeout) clearTimeout(timeout);
      if (forceKillTimeout) {
        clearTimeout(forceKillTimeout);
      }
      if (closeTimeout) clearTimeout(closeTimeout);
      if (abortListener) {
        input.signal?.removeEventListener('abort', abortListener);
      }
      child?.stdout.removeListener('data', handleStdout);
      child?.stderr.removeListener('data', handleStderr);
      child?.removeListener('error', handleChildError);
      child?.removeListener('close', handleChildClose);
    }

    /**
     * 结束当前 Promise。
     * @param callback - 结束回调
     */
    function settleOnce(callback: () => void): void {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    }

    /**
     * 请求终止子进程，并等待 close 事件完成清理。
     * @param error - 终止后需要返回的错误
     */
    function requestTermination(error: RuntimeSubprocessError | null): void {
      if (error && !pendingFailure) {
        pendingFailure = error;
      }

      if (terminationRequested) return;
      terminationRequested = true;
      reportSubprocessProgress(input.activity, { phase: 'exiting', completed: stdoutBytes + stderrBytes, message: '正在停止子进程' });
      killRuntimeChildProcess(child);
      if (!forceKillTimeout && !childClosed) {
        forceKillTimeout = setTimeout(() => {
          if (childClosed) return;
          const forced = killRuntimeChildProcess(child, 'SIGKILL');
          if (!forced) {
            settleOnce(() => reject(new RuntimeSubprocessError('PROCESS_CLEANUP_FAILED', '无法终止子进程')));
            return;
          }
          closeTimeout = setTimeout((): void => {
            if (!childClosed) settleOnce(() => reject(new RuntimeSubprocessError('PROCESS_CLEANUP_FAILED', '子进程强制终止后未确认退出')));
          }, RUNTIME_SUBPROCESS_CLOSE_GRACE_MS);
        }, RUNTIME_SUBPROCESS_FORCE_KILL_GRACE_MS);
      }
    }

    /**
     * 处理 stdout 数据并报告累计输出进展。
     * @param chunk - stdout 数据块
     */
    handleStdout = (chunk: Buffer): void => {
      if (pendingFailure || chunk.byteLength === 0) return;
      stdoutBytes += chunk.byteLength;
      let shouldTerminate = false;
      try {
        shouldTerminate = input.onStdoutChunk?.(chunk) === 'terminate';
      } catch (error) {
        const message = error instanceof Error ? error.message : '处理 stdout 失败';
        requestTermination(new RuntimeSubprocessError('EXECUTION_FAILED', message));
        return;
      }

      reportSubprocessProgress(input.activity, {
        phase: 'running',
        completed: stdoutBytes + stderrBytes,
        message: `已接收 ${stdoutBytes + stderrBytes} 字节输出`
      });
      if (stdoutBytes > input.stdoutLimitBytes && !shouldTerminate) {
        requestTermination(new RuntimeSubprocessError('EXECUTION_FAILED', 'stdout 超过工具输出上限'));
        return;
      }
      if (input.bufferStdout !== false) stdoutChunks.push(chunk);
      if (shouldTerminate) {
        terminatedByConsumer = true;
        requestTermination(null);
      }
    };

    /**
     * 处理 stderr 数据并报告累计输出进展。
     * @param chunk - stderr 数据块
     */
    handleStderr = (chunk: Buffer): void => {
      if (pendingFailure || chunk.byteLength === 0) return;
      stderrBytes += chunk.byteLength;
      reportSubprocessProgress(input.activity, {
        phase: 'running',
        completed: stdoutBytes + stderrBytes,
        message: `已接收 ${stdoutBytes + stderrBytes} 字节输出`
      });
      if (stderrBytes > input.stderrLimitBytes) {
        requestTermination(new RuntimeSubprocessError('EXECUTION_FAILED', 'stderr 超过工具输出上限'));
        return;
      }
      stderrChunks.push(chunk);
    };

    /**
     * 处理子进程启动或运行错误。
     * @param error - 子进程错误
     */
    handleChildError = (error: Error): void => {
      childClosed = true;
      settleOnce(() => reject(pendingFailure ?? new RuntimeSubprocessError('EXECUTION_FAILED', error.message)));
    };

    /**
     * 处理子进程关闭并收敛结果。
     * @param exitCode - 退出码
     * @param signal - 退出信号
     */
    handleChildClose = (exitCode: number | null, signal: NodeJS.Signals | null): void => {
      childClosed = true;
      reportSubprocessProgress(input.activity, { phase: 'exiting', completed: stdoutBytes + stderrBytes, message: '子进程已退出' });
      if (pendingFailure) {
        settleOnce(() => reject(pendingFailure));
        return;
      }

      settleOnce(() =>
        resolve({
          exitCode,
          signal,
          stdout: concatRuntimeBufferText(stdoutChunks),
          stderr: concatRuntimeBufferText(stderrChunks),
          timedOut,
          terminatedByConsumer,
          elapsedMs: Date.now() - startedAt
        })
      );
    };

    abortListener = (): void => {
      requestTermination(createAbortError(input.signal));
    };

    try {
      child = spawn(input.command, input.args, {
        ...(input.cwd ? { cwd: input.cwd } : {}),
        detached: process.platform !== 'win32',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (error) {
      cleanup();
      const message = error instanceof Error ? error.message : '启动子进程失败';
      reject(new RuntimeSubprocessError('EXECUTION_FAILED', message));
      return;
    }

    reportSubprocessProgress(input.activity, { phase: 'spawn', completed: 0, message: '子进程已启动' });
    if (input.timeoutMs !== undefined) {
      timeout = setTimeout(() => {
        timedOut = true;
        requestTermination(new RuntimeSubprocessError('TOOL_TIMEOUT', 'grep 执行超时'));
      }, input.timeoutMs);
    }

    child.stdout.on('data', handleStdout);
    child.stderr.on('data', handleStderr);
    child.on('error', handleChildError);
    child.on('close', handleChildClose);

    if (input.signal?.aborted) {
      abortListener();
      return;
    }

    input.signal?.addEventListener('abort', abortListener, { once: true });
  });
}
