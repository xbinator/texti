/**
 * @file session.test.ts
 * @description MCP 按需连接阶段的工具取消传播测试。
 */
import type { MCPClientWrapper } from '../../../../../electron/main/modules/mcp/client.mjs';
import type { MCPServerConfig } from 'types/ai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  connectMcpServer,
  executeMcpTool,
  forgetMcpServer,
  getMcpDiscoveryCache,
  getMcpSessionCount,
  resetMcpState
} from '../../../../../electron/main/modules/mcp/session.mjs';
import { getStatusCount } from '../../../../../electron/main/modules/mcp/status.mjs';

/** MCP session 依赖 mock。 */
const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createTransport: vi.fn((): Record<string, never> => ({})),
  registerNotifications: vi.fn()
}));

vi.mock('../../../../../electron/main/modules/mcp/client.mjs', () => ({
  createMcpClient: mocks.createClient
}));

vi.mock('../../../../../electron/main/modules/mcp/transport.mjs', () => ({
  createTransport: mocks.createTransport
}));

vi.mock('../../../../../electron/main/modules/mcp/notifications.mjs', () => ({
  registerNotificationHandlers: mocks.registerNotifications
}));

/**
 * 创建测试 MCP server。
 * @returns MCP server 配置
 */
function createServer(id = 'server-connect-abort'): MCPServerConfig {
  return {
    id,
    name: 'Abort server',
    enabled: true,
    transport: 'stdio',
    command: 'server-command',
    args: [],
    env: {},
    headers: {},
    toolAllowlist: [],
    connectTimeoutMs: 30_000,
    toolCallTimeoutMs: 60_000
  };
}

describe('MCP session cancellation', (): void => {
  beforeEach((): void => {
    vi.clearAllMocks();
  });

  afterEach(async (): Promise<void> => {
    await resetMcpState();
  });

  it('forgets a connected server and removes every runtime cache entry', async (): Promise<void> => {
    const server = createServer('server-forget');
    const disconnect = vi.fn(async (): Promise<void> => undefined);
    const wrapper: MCPClientWrapper = {
      client: {} as MCPClientWrapper['client'],
      server,
      connect: vi.fn(async (): Promise<void> => undefined),
      disconnect,
      listTools: vi.fn(async (): Promise<[]> => []),
      callTool: vi.fn(async (): Promise<unknown> => ({ content: [] })),
      isConnected: vi.fn((): boolean => true)
    };
    mocks.createClient.mockResolvedValue(wrapper);

    await expect(connectMcpServer(server)).resolves.toMatchObject({ ok: true });
    expect(getMcpSessionCount()).toBe(1);
    expect(getStatusCount()).toBe(1);
    expect(getMcpDiscoveryCache()).toHaveLength(1);

    await forgetMcpServer(server.id);

    expect(disconnect).toHaveBeenCalledOnce();
    expect(getMcpSessionCount()).toBe(0);
    expect(getStatusCount()).toBe(0);
    expect(getMcpDiscoveryCache()).toEqual([]);
  });

  it('disconnects an in-flight on-demand connection when the tool is aborted', async (): Promise<void> => {
    let rejectConnect: ((reason: Error) => void) | undefined;
    const disconnect = vi.fn(async (): Promise<void> => {
      rejectConnect?.(new Error('connection aborted'));
    });
    const wrapper: MCPClientWrapper = {
      client: {} as MCPClientWrapper['client'],
      server: createServer(),
      connect: vi.fn(
        async (): Promise<void> =>
          new Promise((_resolve, reject): void => {
            rejectConnect = reject;
          })
      ),
      disconnect,
      listTools: vi.fn(async (): Promise<[]> => []),
      callTool: vi.fn(async (): Promise<unknown> => ({ content: [] })),
      isConnected: vi.fn((): boolean => false)
    };
    mocks.createClient.mockResolvedValue(wrapper);
    const controller = new AbortController();
    const execution = executeMcpTool(createServer(), 'long-tool', {}, { signal: controller.signal });
    const rejection = execution.catch((error: unknown): unknown => error);
    await vi.waitFor((): void => {
      expect(wrapper.connect).toHaveBeenCalledOnce();
    });

    controller.abort(new Error('tool stopped'));

    await vi.waitFor((): void => {
      expect(disconnect).toHaveBeenCalledOnce();
    });
    await expect(rejection).resolves.toBeInstanceOf(Error);
    expect(wrapper.callTool).not.toHaveBeenCalled();
  });

  it('closes a wrapper created after the abort event already fired', async (): Promise<void> => {
    let resolveClient: ((wrapper: MCPClientWrapper) => void) | undefined;
    const disconnect = vi.fn(async (): Promise<void> => undefined);
    const wrapper: MCPClientWrapper = {
      client: {} as MCPClientWrapper['client'],
      server: createServer(),
      connect: vi.fn(async (): Promise<void> => undefined),
      disconnect,
      listTools: vi.fn(async (): Promise<[]> => []),
      callTool: vi.fn(async (): Promise<unknown> => ({ content: [] })),
      isConnected: vi.fn((): boolean => false)
    };
    mocks.createClient.mockImplementation(
      async (): Promise<MCPClientWrapper> =>
        new Promise((resolve): void => {
          resolveClient = resolve;
        })
    );
    const controller = new AbortController();
    const execution = executeMcpTool(createServer(), 'long-tool', {}, { signal: controller.signal });
    const rejection = execution.catch((error: unknown): unknown => error);
    await vi.waitFor((): void => {
      expect(mocks.createClient).toHaveBeenCalledOnce();
    });

    controller.abort(new Error('tool stopped before client creation'));
    resolveClient?.(wrapper);

    await expect(rejection).resolves.toBeInstanceOf(Error);
    expect(disconnect).toHaveBeenCalledOnce();
    expect(wrapper.callTool).not.toHaveBeenCalled();
  });

  it('removes a published wrapper when final connection setup fails', async (): Promise<void> => {
    const server = createServer('server-publish-failure');
    const firstWrapper: MCPClientWrapper = {
      client: {} as MCPClientWrapper['client'],
      server,
      connect: vi.fn(async (): Promise<void> => undefined),
      disconnect: vi.fn(async (): Promise<void> => undefined),
      listTools: vi.fn(async (): Promise<[]> => []),
      callTool: vi.fn(async (): Promise<unknown> => ({ stale: true })),
      isConnected: vi.fn((): boolean => true)
    };
    const secondWrapper: MCPClientWrapper = {
      client: {} as MCPClientWrapper['client'],
      server,
      connect: vi.fn(async (): Promise<void> => undefined),
      disconnect: vi.fn(async (): Promise<void> => undefined),
      listTools: vi.fn(async (): Promise<[]> => []),
      callTool: vi.fn(async (): Promise<unknown> => ({ fresh: true })),
      isConnected: vi.fn((): boolean => true)
    };
    mocks.createClient.mockResolvedValueOnce(firstWrapper).mockResolvedValueOnce(secondWrapper);
    mocks.registerNotifications.mockImplementationOnce((): never => {
      throw new Error('notification setup failed');
    });

    await expect(connectMcpServer(server)).resolves.toMatchObject({ ok: false });
    await expect(executeMcpTool(server, 'long-tool', {})).resolves.toEqual({ fresh: true });

    expect(firstWrapper.disconnect).toHaveBeenCalledOnce();
    expect(firstWrapper.callTool).not.toHaveBeenCalled();
    expect(mocks.createClient).toHaveBeenCalledTimes(2);
  });
});
