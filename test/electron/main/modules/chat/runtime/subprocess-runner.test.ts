/**
 * @file subprocess-runner.test.ts
 * @description ChatRuntime 子进程输出进展与分级停止测试。
 */
import { EventEmitter } from 'node:events';
import { PassThrough, type Readable } from 'node:stream';
import type { ChildProcessByStdio } from 'node:child_process';
import type { AIToolActivityReporter } from 'types/ai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RUNTIME_SUBPROCESS_FORCE_KILL_GRACE_MS,
  runBoundedSubprocess,
  type RuntimeSubprocessInput
} from '../../../../../../electron/main/modules/chat/runtime/tools/subprocess-runner.mjs';

/** 子进程 spawn mock。 */
const subprocessMocks = vi.hoisted(() => ({
  spawn: vi.fn()
}));

vi.mock('node:child_process', (): { spawn: typeof subprocessMocks.spawn } => ({
  spawn: subprocessMocks.spawn
}));

/** 测试 runner 使用的子进程类型。 */
type RuntimeChildProcess = ChildProcessByStdio<null, Readable, Readable>;

/** 可控子进程夹具。 */
interface ControlledChild {
  /** runner 接收的子进程。 */
  child: RuntimeChildProcess;
  /** 可写 stdout。 */
  stdout: PassThrough;
  /** 可写 stderr。 */
  stderr: PassThrough;
  /** 发出 close 事件。 */
  close(exitCode?: number | null, signal?: NodeJS.Signals | null): void;
}

/**
 * 创建可控子进程。
 * @param pid - 子进程 PID
 * @returns 可控子进程
 */
function createControlledChild(pid = 2468): ControlledChild {
  const emitter = new EventEmitter();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const child = Object.assign(emitter, {
    pid,
    killed: false,
    stdout,
    stderr,
    kill: vi.fn((): boolean => true)
  }) as unknown as RuntimeChildProcess;

  return {
    child,
    stdout,
    stderr,
    close(exitCode: number | null = 0, signal: NodeJS.Signals | null = null): void {
      emitter.emit('close', exitCode, signal);
    }
  };
}

/**
 * 创建子进程活动上报器。
 * @returns 活动上报器与进展 mock
 */
function createSubprocessActivity(): { activity: AIToolActivityReporter; progress: ReturnType<typeof vi.fn<AIToolActivityReporter['progress']>> } {
  const progress = vi.fn<AIToolActivityReporter['progress']>();
  return {
    activity: {
      heartbeat: vi.fn(),
      progress,
      waitUser: vi.fn(),
      waitExternal: vi.fn(),
      resume: vi.fn()
    },
    progress
  };
}

describe('runtime subprocess runner', (): void => {
  beforeEach((): void => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach((): void => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('reports cumulative non-empty stdout and stderr progress', async (): Promise<void> => {
    const controlled = createControlledChild();
    const { activity, progress } = createSubprocessActivity();
    subprocessMocks.spawn.mockReturnValue(controlled.child);

    const result = runBoundedSubprocess({
      command: 'safe-command',
      args: [],
      timeoutMs: 10_000,
      stdoutLimitBytes: 1024,
      stderrLimitBytes: 1024,
      activity
    });
    controlled.stdout.write(Buffer.from('abc'));
    controlled.stdout.write(Buffer.alloc(0));
    controlled.stderr.write(Buffer.from('de'));
    controlled.close();

    await expect(result).resolves.toMatchObject({ exitCode: 0, stdout: 'abc', stderr: 'de' });
    expect(progress.mock.calls.map(([snapshot]) => snapshot)).toEqual([
      { phase: 'spawn', completed: 0, message: '子进程已启动' },
      { phase: 'running', completed: 3, message: '已接收 3 字节输出' },
      { phase: 'running', completed: 5, message: '已接收 5 字节输出' },
      { phase: 'exiting', completed: 5, message: '子进程已退出' }
    ]);
  });

  it('does not force kill when an aborted child exits during the grace period', async (): Promise<void> => {
    const controlled = createControlledChild();
    const controller = new AbortController();
    const killSpy = vi.spyOn(process, 'kill').mockReturnValue(true);
    subprocessMocks.spawn.mockReturnValue(controlled.child);

    const result = runBoundedSubprocess({
      command: 'safe-command',
      args: [],
      timeoutMs: 10_000,
      stdoutLimitBytes: 1024,
      stderrLimitBytes: 1024,
      signal: controller.signal
    });
    const rejection = expect(result).rejects.toMatchObject({ code: 'USER_CANCELLED' });
    controller.abort();
    controlled.close(null, 'SIGTERM');
    await vi.advanceTimersByTimeAsync(RUNTIME_SUBPROCESS_FORCE_KILL_GRACE_MS);

    await rejection;
    expect(killSpy).toHaveBeenCalledTimes(1);
    expect(killSpy).toHaveBeenCalledWith(-2468, 'SIGTERM');
  });

  it('force kills only the held process group after the grace period', async (): Promise<void> => {
    const controlled = createControlledChild();
    const controller = new AbortController();
    const killSpy = vi.spyOn(process, 'kill').mockReturnValue(true);
    subprocessMocks.spawn.mockReturnValue(controlled.child);

    const result = runBoundedSubprocess({
      command: 'safe-command',
      args: [],
      timeoutMs: 10_000,
      stdoutLimitBytes: 1024,
      stderrLimitBytes: 1024,
      signal: controller.signal
    });
    const rejection = expect(result).rejects.toMatchObject({ code: 'USER_CANCELLED' });
    controller.abort();
    await vi.advanceTimersByTimeAsync(RUNTIME_SUBPROCESS_FORCE_KILL_GRACE_MS - 1);
    expect(killSpy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(killSpy).toHaveBeenNthCalledWith(2, -2468, 'SIGKILL');
    controlled.close(null, 'SIGKILL');

    await rejection;
    expect(killSpy).toHaveBeenCalledTimes(2);
  });

  it('supports watchdog-owned subprocesses without a fixed total timeout', async (): Promise<void> => {
    const controlled = createControlledChild();
    subprocessMocks.spawn.mockReturnValue(controlled.child);
    const input = {
      command: 'safe-command',
      args: [],
      stdoutLimitBytes: 1024,
      stderrLimitBytes: 1024
    } as RuntimeSubprocessInput;

    const result = runBoundedSubprocess(input);
    await vi.advanceTimersByTimeAsync(300_000);
    controlled.close();

    await expect(result).resolves.toMatchObject({ exitCode: 0, timedOut: false });
  });

  it('keeps subprocess cleanup independent from activity projection failures', async (): Promise<void> => {
    const controlled = createControlledChild();
    const { activity } = createSubprocessActivity();
    activity.progress = vi.fn((): never => {
      throw new Error('activity projection failed');
    });
    subprocessMocks.spawn.mockReturnValue(controlled.child);

    const result = runBoundedSubprocess({
      command: 'safe-command',
      args: [],
      timeoutMs: 10_000,
      stdoutLimitBytes: 1024,
      stderrLimitBytes: 1024,
      activity
    });
    controlled.stdout.write(Buffer.from('ok'));
    controlled.close();

    await expect(result).resolves.toMatchObject({ exitCode: 0, stdout: 'ok' });
  });

  it('settles with a cleanup failure when neither graceful nor forced kill can be sent', async (): Promise<void> => {
    const controlled = createControlledChild();
    const controller = new AbortController();
    vi.spyOn(process, 'kill').mockImplementation((): never => {
      throw new Error('group unavailable');
    });
    vi.mocked(controlled.child.kill).mockImplementation((): never => {
      throw new Error('child unavailable');
    });
    subprocessMocks.spawn.mockReturnValue(controlled.child);

    const result = runBoundedSubprocess({
      command: 'safe-command',
      args: [],
      timeoutMs: 10_000,
      stdoutLimitBytes: 1024,
      stderrLimitBytes: 1024,
      signal: controller.signal
    });
    const rejection = expect(result).rejects.toMatchObject({ code: 'PROCESS_CLEANUP_FAILED' });
    controller.abort();
    await vi.advanceTimersByTimeAsync(RUNTIME_SUBPROCESS_FORCE_KILL_GRACE_MS);

    await rejection;
  });

  it('preserves a structured Watchdog abort reason after the child closes', async (): Promise<void> => {
    const controlled = createControlledChild();
    const controller = new AbortController();
    vi.spyOn(process, 'kill').mockReturnValue(true);
    subprocessMocks.spawn.mockReturnValue(controlled.child);

    const result = runBoundedSubprocess({
      command: 'safe-command',
      args: [],
      stdoutLimitBytes: 1024,
      stderrLimitBytes: 1024,
      signal: controller.signal
    });
    controller.abort({ code: 'TOOL_UNRESPONSIVE', message: 'no executor activity' });
    controlled.close(null, 'SIGTERM');

    await expect(result).rejects.toMatchObject({ code: 'TOOL_UNRESPONSIVE', message: 'no executor activity' });
  });
});
