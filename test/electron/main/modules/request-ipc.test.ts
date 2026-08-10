/**
 * @file request-ipc.test.ts
 * @description Electron 主进程托管 request 代理测试。
 */
import type { RequestInput } from 'types/request';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { REQUEST_MAX_CONCURRENT, REQUEST_MAX_PENDING, REQUEST_MAX_RESPONSE_BYTES } from '../../../../electron/main/modules/request/core/constants.mts';
import { createRequestQueue } from '../../../../electron/main/modules/request/core/queue.mts';
import { registerRequestHandlers } from '../../../../electron/main/modules/request/ipc.mts';
import { runRequest } from '../../../../electron/main/modules/request/service.mts';

/** IPC handler 注册替身。 */
const ipcHandleMock = vi.hoisted(() => vi.fn());

vi.mock('electron', () => ({
  ipcMain: {
    handle: ipcHandleMock
  }
}));

/** 测试用 request IPC sender。 */
interface RequestSenderFixture {
  /** WebContents ID。 */
  id: number;
  /** 注册一次性销毁监听。 */
  once: (eventName: 'destroyed', listener: () => void) => void;
}

/** request IPC handler。 */
type RequestHandler = (event: { sender: RequestSenderFixture }, request: RequestInput) => Promise<unknown>;

/**
 * 读取 request IPC handler。
 * @returns 已注册 handler
 */
function getRequestHandler(): RequestHandler {
  registerRequestHandlers();
  const registration = ipcHandleMock.mock.calls.find(([channel]) => channel === 'request:send');
  if (typeof registration?.[1] !== 'function') throw new Error('request:send handler should be registered');
  return registration[1] as RequestHandler;
}

afterEach((): void => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('runRequest', (): void => {
  /**
   * 等待请求队列推进到下一轮宏任务。
   * @returns 等待完成信号
   */
  async function waitForRequestQueue(): Promise<void> {
    await Promise.resolve();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  }

  /**
   * 分批释放队列中已经启动的请求。
   * @param expectedCount - 需要释放的请求数
   * @param releaseCallbacks - 请求释放函数队列
   */
  async function releaseQueuedRequests(expectedCount: number, releaseCallbacks: Array<() => void>): Promise<void> {
    let releasedCount = 0;
    while (releasedCount < expectedCount) {
      // 请求释放后队列才会继续启动下一批任务，这里需要按批次等待。
      // eslint-disable-next-line no-await-in-loop
      await waitForRequestQueue();
      const releases = releaseCallbacks.splice(0);
      if (releases.length === 0) {
        throw new Error('没有可释放的 request 任务');
      }
      releases.forEach((release): void => release());
      releasedCount += releases.length;
    }
  }

  it('rejects non-http protocols before fetch', async (): Promise<void> => {
    await expect(runRequest({ method: 'GET', url: 'file:///etc/passwd' })).rejects.toThrow('仅支持 http/https 请求');
  });

  it('serializes query params and parses JSON responses', async (): Promise<void> => {
    const fetchMock = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(JSON.stringify({ temperature: 28 }), {
        status: 200,
        headers: {
          'content-type': 'application/json'
        }
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const request: RequestInput = {
      method: 'GET',
      url: 'https://api.example.com/weather',
      query: {
        city: '上海'
      }
    };

    const response = await runRequest(request);

    expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/weather?city=%E4%B8%8A%E6%B5%B7', expect.objectContaining({ method: 'GET' }));
    expect(response).toMatchObject({
      status: 200,
      ok: true,
      data: { temperature: 28 }
    });
  });

  it('returns invalid JSON response text for business-level handling', async (): Promise<void> => {
    const fetchMock = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response('upstream error is not json', {
        status: 502,
        headers: {
          'content-type': 'application/json'
        }
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await runRequest({
      method: 'GET',
      url: 'https://api.example.com/error'
    });

    expect(response).toMatchObject({
      status: 502,
      ok: false,
      data: 'upstream error is not json'
    });
  });

  it('omits request bodies for GET requests', async (): Promise<void> => {
    const fetchMock = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await runRequest({
      method: 'GET',
      url: 'https://api.example.com/weather',
      body: {
        city: '上海'
      }
    });

    const fetchInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(fetchInit?.method).toBe('GET');
    expect(fetchInit?.body).toBeUndefined();
    expect(fetchInit?.headers).toBeUndefined();
  });

  it('passes string request bodies without JSON stringifying', async (): Promise<void> => {
    const fetchMock = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await runRequest({
      method: 'POST',
      url: 'https://api.example.com/message',
      body: 'raw text'
    });

    const fetchInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(fetchInit?.body).toBe('raw text');
    expect(fetchInit?.headers).toBeUndefined();
  });

  it('passes special request bodies without JSON stringifying', async (): Promise<void> => {
    const fetchMock = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const body = new URLSearchParams({ city: '上海' });

    await runRequest({
      method: 'POST',
      url: 'https://api.example.com/search',
      body
    });

    const fetchInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(fetchInit?.body).toBe(body);
    expect(fetchInit?.headers).toBeUndefined();
  });

  it('rejects timed out requests with a readable timeout message', async (): Promise<void> => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof globalThis.fetch>().mockImplementation((_input, init): Promise<Response> => {
      return new Promise<Response>((_resolve, reject): void => {
        init?.signal?.addEventListener('abort', (): void => reject(new DOMException('This operation was aborted', 'AbortError')));
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const requestPromise = runRequest({ method: 'GET', url: 'https://api.example.com/slow' });
    const requestExpectation = expect(requestPromise).rejects.toThrow('请求超时，请检查网络是否正常');
    await vi.advanceTimersByTimeAsync(10000);

    await requestExpectation;
  });

  it('returns truncated response text after the response size limit is exceeded', async (): Promise<void> => {
    const chunk = new Uint8Array(256_000).fill(65);
    let pullCount = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller): void {
        pullCount += 1;
        controller.enqueue(chunk);
        if (pullCount >= 20) {
          controller.close();
        }
      },
      cancel(): void {
        cancelled = true;
      }
    });
    const fetchMock = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: {
          'content-type': 'text/plain'
        }
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await runRequest({ method: 'GET', url: 'https://api.example.com/large' });

    expect(pullCount).toBeLessThan(Math.ceil(REQUEST_MAX_RESPONSE_BYTES / chunk.byteLength) + 2);
    expect(cancelled).toBe(true);
    expect(response).toMatchObject({
      status: 200,
      ok: true
    });
    expect(typeof response.data).toBe('string');
    expect((response.data as string).length).toBeLessThanOrEqual(REQUEST_MAX_RESPONSE_BYTES);
  });

  it('limits concurrent fetches in the main-process request queue', async (): Promise<void> => {
    let runningCount = 0;
    let maxRunningCount = 0;
    const releaseCallbacks: Array<() => void> = [];
    const fetchMock = vi.fn<typeof globalThis.fetch>().mockImplementation(async (): Promise<Response> => {
      runningCount += 1;
      maxRunningCount = Math.max(maxRunningCount, runningCount);
      await new Promise<void>((resolve) => {
        releaseCallbacks.push(resolve);
      });
      runningCount -= 1;
      return new Response('ok', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const requests = Array.from({ length: 5 }, (_item, index): Promise<unknown> => runRequest({ method: 'GET', url: `https://api.example.com/${index}` }));

    await waitForRequestQueue();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(maxRunningCount).toBe(4);

    releaseCallbacks.shift()?.();
    await waitForRequestQueue();
    expect(fetchMock).toHaveBeenCalledTimes(5);

    releaseCallbacks.forEach((release): void => release());
    await Promise.all(requests);
    expect(maxRunningCount).toBe(4);
  });

  it('rejects requests after the bounded waiting queue is full', async (): Promise<void> => {
    const releaseCallbacks: Array<() => void> = [];
    const fetchMock = vi.fn<typeof globalThis.fetch>().mockImplementation(async (): Promise<Response> => {
      await new Promise<void>((resolve) => {
        releaseCallbacks.push(resolve);
      });
      return new Response('ok', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const acceptedCount = REQUEST_MAX_CONCURRENT + REQUEST_MAX_PENDING;
    const requests = Array.from(
      { length: acceptedCount },
      (_item, index): Promise<unknown> => runRequest({ method: 'GET', url: `https://api.example.com/${index}` })
    );
    const overflowRequest = runRequest({ method: 'GET', url: 'https://api.example.com/overflow' });
    const overflowExpectation = expect(overflowRequest).rejects.toThrow('请求队列已满');

    await waitForRequestQueue();
    expect(fetchMock).toHaveBeenCalledTimes(REQUEST_MAX_CONCURRENT);
    await overflowExpectation;

    await releaseQueuedRequests(acceptedCount, releaseCallbacks);
    await expect(Promise.all(requests)).resolves.toHaveLength(acceptedCount);
  });

  it('removes an aborted task while it is still waiting in the queue', async (): Promise<void> => {
    const queue = createRequestQueue(1, 1);
    let releaseActive = (): void => undefined;
    const activeTask = queue.add(
      async (): Promise<string> =>
        new Promise<string>((resolve): void => {
          releaseActive = (): void => resolve('active');
        })
    );
    const controller = new AbortController();
    const waitingTask = queue.add(async (): Promise<string> => 'waiting', { signal: controller.signal });

    controller.abort(new Error('sender destroyed'));

    await expect(waitingTask).rejects.toThrow('sender destroyed');
    releaseActive();
    await expect(activeTask).resolves.toBe('active');
  });

  it('returns to zero retained tasks after 100 queue lifecycle cycles', async (): Promise<void> => {
    const queue = createRequestQueue(2, 4);

    for (let index = 0; index < 100; index += 1) {
      // eslint-disable-next-line no-await-in-loop -- 压力验证每轮完整结束后队列计数归零。
      await queue.add(async (): Promise<number> => index);
    }

    expect(queue.getActiveCount()).toBe(0);
    expect(queue.getPendingCount()).toBe(0);
  });

  it('aborts every owned request when the invoking webContents is destroyed', async (): Promise<void> => {
    let handleDestroyed = (): void => undefined;
    const sender: RequestSenderFixture = {
      id: 71,
      once: (_eventName, listener): void => {
        handleDestroyed = listener;
      }
    };
    const fetchMock = vi.fn<typeof globalThis.fetch>().mockImplementation((_input, init): Promise<Response> => {
      return new Promise<Response>((_resolve, reject): void => {
        init?.signal?.addEventListener('abort', (): void => reject(init.signal?.reason));
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const handler = getRequestHandler();
    const request = handler({ sender }, { method: 'GET', url: 'https://api.example.com/owned' });
    const requestExpectation = expect(request).rejects.toThrow('请求调用方已销毁');
    await waitForRequestQueue();

    handleDestroyed();

    await requestExpectation;
  });
});
