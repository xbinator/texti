/**
 * @file message-worker.test.ts
 * @description BMessage 共享 Markdown Worker 请求管理测试。
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ParseMessageNodesResult } from '@/components/BMessage/types';

/** Worker 替身实例公开能力。 */
interface WorkerMockInstance {
  /** Main 发给 Worker 的请求。 */
  readonly requests: unknown[];
  /** 返回 Worker 响应。 */
  respond: (data: unknown) => void;
  /** 触发 Worker 错误。 */
  fail: () => void;
}

/** Worker 测试替身。 */
class WorkerMock {
  /** 最近创建的 Worker。 */
  public static instance: WorkerMockInstance | null = null;

  /** 下一次 postMessage 需要抛出的错误类型。 */
  public static postErrorName: string | null = null;

  /** Main 发给 Worker 的请求。 */
  public readonly requests: unknown[] = [];

  /** Worker 消息监听器。 */
  public onmessage: ((event: MessageEvent<unknown>) => void) | null = null;

  /** Worker 错误监听器。 */
  public onerror: ((event: ErrorEvent) => void) | null = null;

  /** 记录最近实例。 */
  public constructor() {
    WorkerMock.instance = this;
  }

  /**
   * 接收解析请求。
   * @param message - Worker 请求载荷
   */
  public postMessage(message: unknown): void {
    if (WorkerMock.postErrorName) {
      const error = new Error('post failed');
      error.name = WorkerMock.postErrorName;
      WorkerMock.postErrorName = null;
      throw error;
    }
    this.requests.push(message);
  }

  /** 停止 Worker。 */
  public terminate(): void {
    return undefined;
  }

  /**
   * 向 manager 返回响应。
   * @param data - Worker 响应载荷
   */
  public respond(data: unknown): void {
    this.onmessage?.(new MessageEvent('message', { data }));
  }

  /** 模拟当前 Worker 自身崩溃。 */
  public fail(): void {
    this.onerror?.(new ErrorEvent('error', { error: new Error('worker crashed') }));
  }
}

/** 创建最小解析结果。 */
function createResult(text: string): ParseMessageNodesResult {
  return {
    blocks: [{ type: 'paragraph', id: text, raw: text, children: [{ type: 'text', text }] }],
    images: []
  };
}

afterEach((): void => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
  WorkerMock.instance = null;
  WorkerMock.postErrorName = null;
});

describe('message parser worker manager', (): void => {
  it('routes successful responses to the matching request', async (): Promise<void> => {
    vi.stubGlobal('Worker', WorkerMock);
    const { parseMessageInWorker } = await import('@/components/BMessage/utils/messageWorker');

    const request = parseMessageInWorker({ content: 'large', mode: 'markdown', loading: true });
    WorkerMock.instance?.respond({ requestId: request.requestId, result: createResult('parsed') });

    await expect(request.result).resolves.toEqual(createResult('parsed'));
  });

  it('settles a cancelled subscription without accepting its late response', async (): Promise<void> => {
    vi.stubGlobal('Worker', WorkerMock);
    const { cancelMessageParse, parseMessageInWorker } = await import('@/components/BMessage/utils/messageWorker');
    const request = parseMessageInWorker({ content: 'stale', mode: 'markdown', loading: true });

    cancelMessageParse(request.requestId);
    await expect(request.result).resolves.toBeNull();
    WorkerMock.instance?.respond({ requestId: request.requestId, result: createResult('stale') });
  });

  it('posts at most one parse to the shared Worker and dispatches the next after completion', async (): Promise<void> => {
    vi.stubGlobal('Worker', WorkerMock);
    const { parseMessageInWorker } = await import('@/components/BMessage/utils/messageWorker');
    const firstRequest = parseMessageInWorker({ content: 'first', mode: 'markdown', loading: true });
    const secondRequest = parseMessageInWorker({ content: 'second', mode: 'markdown', loading: true });

    expect(WorkerMock.instance?.requests).toHaveLength(1);
    WorkerMock.instance?.respond({ requestId: firstRequest.requestId, result: createResult('first') });
    await expect(firstRequest.result).resolves.toEqual(createResult('first'));
    expect(WorkerMock.instance?.requests).toHaveLength(2);
    WorkerMock.instance?.respond({ requestId: secondRequest.requestId, result: createResult('second') });
    await expect(secondRequest.result).resolves.toEqual(createResult('second'));
  });

  it('turns a synchronous postMessage failure into a typed rejected request', async (): Promise<void> => {
    vi.stubGlobal('Worker', WorkerMock);
    WorkerMock.postErrorName = 'DataCloneError';
    const { parseMessageInWorker } = await import('@/components/BMessage/utils/messageWorker');

    const request = parseMessageInWorker({ content: 'clone failure', mode: 'markdown', loading: false });

    await expect(request.result).rejects.toMatchObject({ name: 'DataCloneError' });
  });

  it('ignores an error emitted by a terminated stale Worker after its replacement starts', async (): Promise<void> => {
    vi.stubGlobal('Worker', WorkerMock);
    const { cancelMessageParse, parseMessageInWorker } = await import('@/components/BMessage/utils/messageWorker');
    const staleRequest = parseMessageInWorker({ content: 'stale', mode: 'markdown', loading: true });
    const staleWorker = WorkerMock.instance;
    cancelMessageParse(staleRequest.requestId);
    const latestRequest = parseMessageInWorker({ content: 'latest', mode: 'markdown', loading: true });
    const latestWorker = WorkerMock.instance;

    staleWorker?.fail();
    latestWorker?.respond({ requestId: latestRequest.requestId, result: createResult('latest') });

    await expect(latestRequest.result).resolves.toEqual(createResult('latest'));
  });

  it('rejects a request with only the Worker error type', async (): Promise<void> => {
    vi.stubGlobal('Worker', WorkerMock);
    const { parseMessageInWorker } = await import('@/components/BMessage/utils/messageWorker');
    const request = parseMessageInWorker({ content: 'broken', mode: 'markdown', loading: false });

    WorkerMock.instance?.respond({ requestId: request.requestId, errorName: 'RangeError' });

    await expect(request.result).rejects.toMatchObject({ name: 'RangeError' });
  });

  it('restarts a shared Worker that stops responding and rejects every queued request', async (): Promise<void> => {
    vi.useFakeTimers();
    vi.stubGlobal('Worker', WorkerMock);
    const { MESSAGE_WORKER_TIMEOUT_MS, parseMessageInWorker } = await import('@/components/BMessage/utils/messageWorker');
    const firstRequest = parseMessageInWorker({ content: 'hung', mode: 'markdown', loading: true });
    const firstWorker = WorkerMock.instance;
    const secondRequest = parseMessageInWorker({ content: 'queued', mode: 'markdown', loading: true });
    const firstFailure = expect(firstRequest.result).rejects.toMatchObject({ name: 'WorkerTimeoutError' });
    const secondFailure = expect(secondRequest.result).rejects.toMatchObject({ name: 'WorkerTimeoutError' });

    await vi.advanceTimersByTimeAsync(MESSAGE_WORKER_TIMEOUT_MS);

    await Promise.all([firstFailure, secondFailure]);
    parseMessageInWorker({ content: 'retry', mode: 'markdown', loading: false });
    expect(WorkerMock.instance).not.toBe(firstWorker);
  });
});
