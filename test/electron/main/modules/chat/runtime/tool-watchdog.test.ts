/**
 * @file tool-watchdog.test.ts
 * @description Chat Runtime 工具活性、进展、等待与取消状态机测试。
 */
import type { ChatToolActivitySnapshot } from 'types/ai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createToolWatchdogs,
  type ToolWatchdogClock,
  type ToolWatchdogOptions,
  type ToolWatchdogs
} from '../../../../../../electron/main/modules/chat/runtime/controllers/tool-watchdog.mjs';

/** 测试使用的短计时配置。 */
const TEST_TIMEOUTS = {
  livenessMs: 100,
  idleMs: 100,
  cancelGraceMs: 5,
  heartbeatRateMs: 10,
  persistRateMs: 10
} as const;

/**
 * 创建使用 Vitest fake timers 的 Watchdog。
 * @param onChange - 状态投影回调
 * @param overrides - 局部计时配置
 * @returns Watchdog 注册表
 */
function createTestWatchdogs(
  onChange: (snapshot: ChatToolActivitySnapshot, immediate: boolean) => void = (): void => undefined,
  overrides: Partial<ToolWatchdogOptions> = {}
): ToolWatchdogs {
  const clock: ToolWatchdogClock = {
    monotonicNow: (): number => performance.now(),
    wallNow: (): number => Date.now()
  };
  return createToolWatchdogs({ clock, ...TEST_TIMEOUTS, ...overrides, onChange });
}

afterEach((): void => {
  vi.useRealTimers();
});

describe('tool execution watchdog', (): void => {
  it('aborts a tool that never confirms liveness', async (): Promise<void> => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const watchdogs = createTestWatchdogs();
    const lease = watchdogs.start({ runtimeId: 'runtime-1', toolCallId: 'tool-1', toolName: 'slow_tool' });

    await vi.advanceTimersByTimeAsync(100);

    await expect(lease.settled).resolves.toMatchObject({ status: 'failure', error: { code: 'TOOL_UNRESPONSIVE' } });
    expect(lease.signal.aborted).toBe(true);
    expect(watchdogs.read('runtime-1', 'tool-1')).toBeNull();
  });

  it('uses heartbeat for liveness without treating it as progress', async (): Promise<void> => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const changes: ChatToolActivitySnapshot[] = [];
    const watchdogs = createTestWatchdogs((snapshot): void => {
      changes.push(snapshot);
    });
    const lease = watchdogs.start({ runtimeId: 'runtime-1', toolCallId: 'tool-1', toolName: 'slow_tool' });

    expect(lease.report({ kind: 'started' })).toBe(true);
    await vi.advanceTimersByTimeAsync(90);
    expect(lease.report({ kind: 'heartbeat' })).toBe(true);
    await vi.advanceTimersByTimeAsync(10);

    expect(watchdogs.read('runtime-1', 'tool-1')?.state).toBe('running_idle');
    expect(lease.signal.aborted).toBe(false);
    expect(changes.some((snapshot) => snapshot.state === 'running_idle')).toBe(true);
    lease.finish();
  });

  it('does not let an identical progress snapshot avoid the idle warning', async (): Promise<void> => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const watchdogs = createTestWatchdogs();
    const lease = watchdogs.start({ runtimeId: 'runtime-1', toolCallId: 'tool-1', toolName: 'scan_tool' });
    const progress = { phase: 'scan', completed: 1, total: 10, message: '扫描中' };

    lease.report({ kind: 'started' });
    lease.report({ kind: 'progress', progress });
    await vi.advanceTimersByTimeAsync(50);
    lease.report({ kind: 'progress', progress });
    await vi.advanceTimersByTimeAsync(50);

    expect(watchdogs.read('runtime-1', 'tool-1')).toMatchObject({
      state: 'running_idle',
      progress: { completed: 1 }
    });
    expect(lease.signal.aborted).toBe(false);
    lease.finish();
  });

  it('restores executing only after genuinely new progress', async (): Promise<void> => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const watchdogs = createTestWatchdogs();
    const lease = watchdogs.start({ runtimeId: 'runtime-1', toolCallId: 'tool-1', toolName: 'scan_tool' });

    lease.report({ kind: 'started' });
    await vi.advanceTimersByTimeAsync(90);
    lease.report({ kind: 'heartbeat' });
    await vi.advanceTimersByTimeAsync(10);
    expect(watchdogs.read('runtime-1', 'tool-1')?.state).toBe('running_idle');

    expect(watchdogs.control({ runtimeId: 'runtime-1', toolCallId: 'tool-1', action: 'continue_waiting' })).toBe(true);
    const acknowledged = watchdogs.read('runtime-1', 'tool-1');
    expect(acknowledged?.state).toBe('executing');
    expect(acknowledged?.lastProgressAt).toBeUndefined();

    lease.report({ kind: 'progress', progress: { phase: 'scan', completed: 2 } });
    expect(watchdogs.read('runtime-1', 'tool-1')).toMatchObject({ state: 'executing', progress: { completed: 2 } });
    lease.finish();
  });

  it('pauses liveness while waiting for the user and resumes with the remaining time', async (): Promise<void> => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const watchdogs = createTestWatchdogs();
    const lease = watchdogs.start({ runtimeId: 'runtime-1', toolCallId: 'tool-1', toolName: 'write_tool' });

    lease.report({ kind: 'started' });
    await vi.advanceTimersByTimeAsync(80);
    lease.report({ kind: 'waiting_user', prompt: '确认写入？' });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(lease.signal.aborted).toBe(false);
    expect(watchdogs.read('runtime-1', 'tool-1')?.state).toBe('waiting_user');

    lease.report({ kind: 'resumed' });
    await vi.advanceTimersByTimeAsync(19);
    expect(lease.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(lease.settled).resolves.toMatchObject({ error: { code: 'TOOL_UNRESPONSIVE' } });
  });

  it('requires a bounded external wait and enforces its deadline', async (): Promise<void> => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const watchdogs = createTestWatchdogs();
    const lease = watchdogs.start({ runtimeId: 'runtime-1', toolCallId: 'tool-1', toolName: 'remote_tool' });

    lease.report({ kind: 'started' });
    expect(lease.report({ kind: 'waiting_external', wait: { reason: '限流', retryAt: 1_100, deadlineAt: 1_050 } })).toBe(false);
    expect(lease.report({ kind: 'waiting_external', wait: { reason: '限流', retryAt: 1_050, deadlineAt: 1_100 } })).toBe(true);
    expect(lease.report({ kind: 'resumed' })).toBe(false);

    await vi.advanceTimersByTimeAsync(100);
    await expect(lease.settled).resolves.toMatchObject({ status: 'failure', error: { code: 'EXTERNAL_WAIT_TIMEOUT' } });
    expect(lease.signal.aborted).toBe(true);
  });

  it('rejects stale renderer sequences and rate-limits heartbeats', async (): Promise<void> => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const watchdogs = createTestWatchdogs();
    const lease = watchdogs.start({ runtimeId: 'runtime-1', toolCallId: 'tool-1', toolName: 'renderer_tool' });

    expect(watchdogs.submit({ runtimeId: 'runtime-1', toolCallId: 'tool-1', sequence: 1, occurredAt: 0, activity: { kind: 'started' } })).toBe(true);
    expect(watchdogs.submit({ runtimeId: 'runtime-1', toolCallId: 'tool-1', sequence: 1, occurredAt: 0, activity: { kind: 'heartbeat' } })).toBe(false);
    expect(watchdogs.submit({ runtimeId: 'runtime-1', toolCallId: 'tool-1', sequence: 2, occurredAt: 1, activity: { kind: 'heartbeat' } })).toBe(true);
    expect(watchdogs.submit({ runtimeId: 'runtime-1', toolCallId: 'tool-1', sequence: 3, occurredAt: 2, activity: { kind: 'heartbeat' } })).toBe(false);
    expect(watchdogs.submit({ runtimeId: 'runtime-other', toolCallId: 'tool-1', sequence: 4, occurredAt: 3, activity: { kind: 'heartbeat' } })).toBe(false);
    lease.finish();
  });

  it('truncates messages and coalesces progress persistence', async (): Promise<void> => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const onChange = vi.fn<(snapshot: ChatToolActivitySnapshot, immediate: boolean) => void>();
    const watchdogs = createTestWatchdogs(onChange);
    const lease = watchdogs.start({ runtimeId: 'runtime-1', toolCallId: 'tool-1', toolName: 'scan_tool' });

    lease.report({ kind: 'started' });
    lease.report({ kind: 'progress', progress: { phase: 'scan', completed: 1, message: '😀'.repeat(600) } });
    lease.report({ kind: 'progress', progress: { phase: 'scan', completed: 2, message: '第二批' } });

    expect(Array.from(watchdogs.read('runtime-1', 'tool-1')?.progress?.message ?? '')).toHaveLength(3);
    expect(onChange.mock.calls.filter((call) => call[1] === false)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(10);
    expect(onChange.mock.calls.filter((call) => call[1] === false)).toHaveLength(2);
    expect(onChange.mock.calls.at(-1)?.[0]).toMatchObject({ progress: { completed: 2, message: '第二批' } });
    lease.finish();
  });

  it('enters stopping and settles cancellation after the grace period', async (): Promise<void> => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const watchdogs = createTestWatchdogs();
    const lease = watchdogs.start({ runtimeId: 'runtime-1', toolCallId: 'tool-1', toolName: 'slow_tool' });
    lease.report({ kind: 'started' });

    expect(watchdogs.control({ runtimeId: 'runtime-1', toolCallId: 'tool-1', action: 'stop' })).toBe(true);
    expect(watchdogs.read('runtime-1', 'tool-1')?.state).toBe('stopping');
    expect(lease.signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(5);

    await expect(lease.settled).resolves.toMatchObject({ status: 'cancelled', error: { code: 'USER_CANCELLED' } });
  });

  it('interrupts every active tool when a runtime is cleared', async (): Promise<void> => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const watchdogs = createTestWatchdogs();
    const first = watchdogs.start({ runtimeId: 'runtime-1', toolCallId: 'tool-1', toolName: 'tool_a' });
    const second = watchdogs.start({ runtimeId: 'runtime-1', toolCallId: 'tool-2', toolName: 'tool_b' });

    watchdogs.clear('runtime-1', 'RUNTIME_INTERRUPTED');

    await expect(first.settled).resolves.toMatchObject({ error: { code: 'RUNTIME_INTERRUPTED' } });
    await expect(second.settled).resolves.toMatchObject({ error: { code: 'RUNTIME_INTERRUPTED' } });
    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('settles liveness failures even when the projection callback throws', async (): Promise<void> => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const watchdogs = createTestWatchdogs((): never => {
      throw new Error('projection unavailable');
    });
    let lease: ReturnType<ToolWatchdogs['start']> | undefined;

    expect((): void => {
      lease = watchdogs.start({ runtimeId: 'runtime-projection', toolCallId: 'tool-projection', toolName: 'slow_tool' });
    }).not.toThrow();
    if (!lease) throw new Error('Watchdog lease was not created');

    await vi.advanceTimersByTimeAsync(100);

    await expect(lease.settled).resolves.toMatchObject({ status: 'failure', error: { code: 'TOOL_UNRESPONSIVE' } });
    expect(lease.signal.aborted).toBe(true);
    expect(watchdogs.read('runtime-projection', 'tool-projection')).toBeNull();
  });

  it('rejects malformed activity without poisoning the renderer sequence', (): void => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const watchdogs = createTestWatchdogs();
    const lease = watchdogs.start({ runtimeId: 'runtime-input', toolCallId: 'tool-input', toolName: 'renderer_tool' });

    expect(
      watchdogs.submit({
        runtimeId: 'runtime-input',
        toolCallId: 'tool-input',
        sequence: 1,
        occurredAt: 0,
        activity: { kind: 'started' }
      })
    ).toBe(true);
    expect(
      watchdogs.submit({
        runtimeId: 'runtime-input',
        toolCallId: 'tool-input',
        sequence: 2,
        occurredAt: 1,
        activity: { kind: 'progress', progress: { phase: 42 } }
      } as unknown as Parameters<ToolWatchdogs['submit']>[0])
    ).toBe(false);
    expect(
      watchdogs.submit({
        runtimeId: 'runtime-input',
        toolCallId: 'tool-input',
        sequence: 2,
        occurredAt: 2,
        activity: { kind: 'progress', progress: { phase: 'scan', completed: 1 } }
      })
    ).toBe(true);
    expect(watchdogs.read('runtime-input', 'tool-input')).toMatchObject({ sequence: 2, progress: { phase: 'scan', completed: 1 } });
    lease.finish();
  });
});
