/**
 * @file projection.test.ts
 * @description ChatRuntime Assistant 实时增量与耐久快照合并器测试。
 */
import type { ChatMessageRecord } from 'types/chat';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createAssistantProjection,
  type AssistantProjection,
  type AssistantProjectionOptions
} from '../../../../../../../electron/main/modules/chat/runtime/stream/projection.mjs';

/**
 * 创建测试 Assistant 消息。
 * @returns 可变工作消息
 */
function createMessage(): ChatMessageRecord {
  return {
    id: 'assistant-1',
    sessionId: 'session-1',
    role: 'assistant',
    content: '',
    parts: [],
    createdAt: '2026-08-10T00:00:00.000Z',
    loading: true,
    finished: false
  };
}

/** 投影器测试上下文。 */
interface ProjectionHarness {
  /** 工作消息。 */
  message: ChatMessageRecord;
  /** 增量发送替身。 */
  emitDelta: ReturnType<typeof vi.fn>;
  /** 快照持久化替身。 */
  persist: ReturnType<typeof vi.fn>;
  /** 被测投影器。 */
  projection: AssistantProjection;
}

/**
 * 创建投影器测试上下文。
 * @param overrides - 依赖覆盖
 * @returns 投影器及其依赖替身
 */
function createHarness(overrides: Partial<AssistantProjectionOptions> = {}): ProjectionHarness {
  const message = createMessage();
  const emitDelta = vi.fn();
  const persist = vi.fn<(snapshot: ChatMessageRecord, revision: number) => Promise<void>>().mockResolvedValue(undefined);
  const projection = createAssistantProjection({
    messageId: message.id,
    createSnapshot: (): ChatMessageRecord => structuredClone(message),
    emitDelta,
    persist,
    ...overrides
  });
  return { message, emitDelta, persist, projection };
}

describe('assistant projection coalescer', (): void => {
  beforeEach((): void => {
    vi.useFakeTimers();
  });

  afterEach((): void => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('coalesces adjacent live text at 16ms and persists at 100ms', async (): Promise<void> => {
    const { emitDelta, persist, projection } = createHarness();

    projection.append({ kind: 'append-text', partId: 'text-1', text: 'a' });
    projection.append({ kind: 'append-text', partId: 'text-1', text: 'b' });
    await vi.advanceTimersByTimeAsync(15);
    expect(emitDelta).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(emitDelta).toHaveBeenCalledOnce();
    expect(emitDelta).toHaveBeenCalledWith({
      messageId: 'assistant-1',
      baseRevision: 0,
      revision: 2,
      mutations: [{ kind: 'append-text', partId: 'text-1', text: 'ab' }]
    });
    expect(persist).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(84);
    expect(persist).toHaveBeenCalledOnce();
    expect(persist.mock.calls[0]?.[1]).toBe(2);
    await projection.flush();
  });

  it('continues the Runtime revision across multiple model rounds', async (): Promise<void> => {
    const onRevision = vi.fn();
    const { emitDelta, projection } = createHarness({ initialRevision: 7, onRevision });

    projection.append({ kind: 'append-text', partId: 'text-1', text: 'continued' });
    await projection.flush();

    expect(emitDelta).toHaveBeenCalledWith(expect.objectContaining({ baseRevision: 7, revision: 8 }));
    expect(onRevision).toHaveBeenCalledWith(8);
    projection.cancel();
  });

  it('flushes a continuously extended live batch no later than 50ms', async (): Promise<void> => {
    const { emitDelta, projection } = createHarness();

    for (let index = 0; index < 6; index += 1) {
      projection.append({ kind: 'append-text', partId: 'text-1', text: String(index) });
      // 按真实时间顺序推进连续输入，验证 maxWait 而不是并行定时器。
      // eslint-disable-next-line no-await-in-loop
      await vi.advanceTimersByTimeAsync(10);
    }

    expect(emitDelta).toHaveBeenCalled();
    expect(emitDelta.mock.calls[0]?.[0]).toMatchObject({ baseRevision: 0, revision: 5 });
    await projection.flush();
  });

  it('flushes live deltas immediately when accumulated text reaches 64KiB', (): void => {
    const { emitDelta, projection } = createHarness();

    projection.append({ kind: 'append-text', partId: 'text-1', text: 'a'.repeat(64 * 1024) });

    expect(emitDelta).toHaveBeenCalledOnce();
    projection.cancel();
  });

  it('bounds one synchronous live batch when mutation targets keep alternating', (): void => {
    const { emitDelta, projection } = createHarness();

    for (let index = 0; index < 1_000; index += 1) {
      projection.append({ kind: 'append-text', partId: `text-${index % 2}`, text: 'x' });
    }

    expect(emitDelta).toHaveBeenCalled();
    expect(emitDelta.mock.calls[0]?.[0].mutations.length).toBeLessThanOrEqual(512);
    projection.cancel();
  });

  it('persists a continuous dirty stream no later than 250ms', async (): Promise<void> => {
    const { persist, projection } = createHarness();

    for (let index = 0; index < 6; index += 1) {
      projection.mark();
      // 按真实时间顺序推进连续脏状态，验证耐久 maxWait。
      // eslint-disable-next-line no-await-in-loop
      await vi.advanceTimersByTimeAsync(50);
    }

    expect(persist).toHaveBeenCalled();
    expect(persist.mock.calls[0]?.[1]).toBe(5);
    await projection.flush();
  });

  it('keeps only the latest dirty snapshot while a slow write is active', async (): Promise<void> => {
    let releaseFirst: () => void = (): void => undefined;
    const firstWrite = new Promise<void>((resolve): void => {
      releaseFirst = resolve;
    });
    const persist = vi.fn<(snapshot: ChatMessageRecord, revision: number) => Promise<void>>().mockReturnValueOnce(firstWrite).mockResolvedValue(undefined);
    const { projection } = createHarness({ persist });

    projection.mark();
    await vi.advanceTimersByTimeAsync(100);
    projection.mark();
    await vi.advanceTimersByTimeAsync(100);
    projection.mark();
    await vi.advanceTimersByTimeAsync(100);

    expect(persist).toHaveBeenCalledTimes(1);
    releaseFirst();
    await firstWrite;
    await vi.runAllTimersAsync();
    await projection.flush();

    expect(persist).toHaveBeenCalledTimes(2);
    expect(persist.mock.calls[1]?.[1]).toBe(3);
  });

  it('flushes live deltas before the matching durable checkpoint', async (): Promise<void> => {
    const order: string[] = [];
    const { projection } = createHarness({
      emitDelta: vi.fn((): void => {
        order.push('delta');
      }),
      persist: vi.fn(async (): Promise<void> => {
        order.push('persist');
      })
    });
    projection.append({ kind: 'append-reasoning', partId: 'thinking-1', text: 'reason' });

    await projection.checkpoint();

    expect(order).toEqual(['delta', 'persist']);
    projection.cancel();
  });

  it('propagates the first persistence failure from a forced flush', async (): Promise<void> => {
    const failure = new Error('database unavailable');
    const { projection } = createHarness({
      persist: vi.fn().mockRejectedValue(failure)
    });
    projection.mark();

    await expect(projection.flush()).rejects.toMatchObject({ message: failure.message, cause: failure });
    projection.cancel();
  });

  it('cancels pending timers and rejects later mutations', async (): Promise<void> => {
    const { emitDelta, persist, projection } = createHarness();
    projection.append({ kind: 'append-text', partId: 'text-1', text: 'pending' });

    projection.cancel();
    projection.append({ kind: 'append-text', partId: 'text-1', text: 'late' });
    await vi.runAllTimersAsync();

    expect(emitDelta).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('waits for an active durable write while closing', async (): Promise<void> => {
    let releaseWrite: () => void = (): void => undefined;
    const activeWrite = new Promise<void>((resolve): void => {
      releaseWrite = resolve;
    });
    const persist = vi.fn().mockReturnValue(activeWrite);
    const { projection } = createHarness({ persist });
    projection.mark();
    await vi.advanceTimersByTimeAsync(100);

    const closing = projection.cancel();

    expect(persist).toHaveBeenCalledOnce();
    expect(closing).toBeInstanceOf(Promise);
    releaseWrite();
    await closing;
  });
});
