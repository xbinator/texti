/**
 * @file callback-server.test.ts
 * @description OAuth 本地回调服务器的终态关闭与定时器清理测试。
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OAuthCallbackServer } from '../../../../../../electron/main/modules/mcp/oauth/callback-server.mjs';

/** HTTP 请求处理函数。 */
type RequestHandler = (request: IncomingMessage, response: ServerResponse) => void;
/** HTTP server error 处理函数。 */
type ErrorHandler = (error: NodeJS.ErrnoException) => void;

const httpMock = vi.hoisted(() => {
  let requestHandler: RequestHandler = (): void => undefined;
  let errorHandler: ErrorHandler = (): void => undefined;
  const close = vi.fn<() => void>();
  const listen = vi.fn((_port: number, callback: () => void): void => callback());
  const on = vi.fn((event: string, callback: ErrorHandler): void => {
    if (event === 'error') errorHandler = callback;
  });
  const createServer = vi.fn((callback: RequestHandler) => {
    requestHandler = callback;
    return { close, listen, on };
  });

  return {
    close,
    createServer,
    emitError(error: NodeJS.ErrnoException): void {
      errorHandler(error);
    },
    emitRequest(url: string): void {
      const response = {
        end: vi.fn(),
        writeHead: vi.fn()
      } as unknown as ServerResponse;
      requestHandler({ url } as IncomingMessage, response);
    },
    reset(): void {
      close.mockReset();
      createServer.mockClear();
      listen.mockClear();
      on.mockClear();
      requestHandler = (): void => undefined;
      errorHandler = (): void => undefined;
    }
  };
});

vi.mock('node:http', () => ({
  default: {
    createServer: httpMock.createServer
  }
}));

vi.mock('../../../../../../electron/main/modules/logger/service.mjs', () => ({
  log: { info: vi.fn() }
}));

describe('OAuthCallbackServer', (): void => {
  beforeEach((): void => {
    vi.useFakeTimers();
    httpMock.reset();
  });

  afterEach((): void => {
    vi.useRealTimers();
  });

  it('closes the server and clears the timeout after a successful callback', async (): Promise<void> => {
    const callbackServer = new OAuthCallbackServer();
    const result = callbackServer.waitForCallback('expected-state', 1_000);

    httpMock.emitRequest('/mcp/oauth/callback?code=auth-code&state=expected-state');

    await expect(result).resolves.toEqual({ code: 'auth-code', state: 'expected-state' });
    expect(httpMock.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('closes the server and clears the timeout after an invalid callback', async (): Promise<void> => {
    const callbackServer = new OAuthCallbackServer();
    const result = callbackServer.waitForCallback('expected-state', 1_000);
    const rejection = expect(result).rejects.toThrow('Missing authorization code');

    httpMock.emitRequest('/mcp/oauth/callback?state=expected-state');

    await rejection;
    expect(httpMock.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('closes the server and clears the timeout after a server error', async (): Promise<void> => {
    const callbackServer = new OAuthCallbackServer();
    const result = callbackServer.waitForCallback('expected-state', 1_000);
    const rejection = expect(result).rejects.toThrow('already in use');

    httpMock.emitError(Object.assign(new Error('occupied'), { code: 'EADDRINUSE' }));

    await rejection;
    expect(httpMock.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('closes the server and clears the timer after timeout', async (): Promise<void> => {
    const callbackServer = new OAuthCallbackServer();
    const result = callbackServer.waitForCallback('expected-state', 1_000);
    const rejection = expect(result).rejects.toThrow('OAuth callback timeout');

    await vi.advanceTimersByTimeAsync(1_000);

    await rejection;
    expect(httpMock.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
