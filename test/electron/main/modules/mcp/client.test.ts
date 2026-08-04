/**
 * @file client.test.ts
 * @description MCP 客户端长调用进度与通道超时选项测试。
 */
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { MCPServerConfig } from 'types/ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMcpClient, MCP_PROGRESS_TIMEOUT_MS } from '../../../../../electron/main/modules/mcp/client.mjs';

/** MCP SDK Client 边界 mock。 */
const clientMocks = vi.hoisted(() => ({
  callTool: vi.fn(),
  close: vi.fn(),
  connect: vi.fn(),
  listTools: vi.fn()
}));

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class ClientMock {
    public callTool = clientMocks.callTool;

    public close = clientMocks.close;

    public connect = clientMocks.connect;

    public listTools = clientMocks.listTools;
  }
}));

/**
 * 创建最小 MCP server 配置。
 * @returns MCP server 配置
 */
function createServer(): MCPServerConfig {
  return {
    id: 'server-1',
    name: 'Server 1',
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

describe('MCP client tool progress', (): void => {
  beforeEach((): void => {
    vi.clearAllMocks();
    clientMocks.callTool.mockResolvedValue({ content: [] });
  });

  it('requests progress and resets only the channel timeout without a total cap', async (): Promise<void> => {
    const onProgress = vi.fn();
    const controller = new AbortController();
    const wrapper = await createMcpClient(createServer(), {} as Transport);

    await wrapper.callTool('long-tool', { query: 'status' }, { signal: controller.signal, onProgress });

    expect(clientMocks.callTool).toHaveBeenCalledWith({ name: 'long-tool', arguments: { query: 'status' } }, undefined, {
      signal: controller.signal,
      onprogress: onProgress,
      timeout: MCP_PROGRESS_TIMEOUT_MS,
      resetTimeoutOnProgress: true
    });
    expect(clientMocks.callTool.mock.calls[0]?.[2]).not.toHaveProperty('maxTotalTimeout');
  });

  it('uses the configured timeout as a fixed boundary for direct calls', async (): Promise<void> => {
    const wrapper = await createMcpClient(createServer(), {} as Transport);

    await wrapper.callTool('direct-tool', {}, { timeoutMs: 30_000 });

    expect(clientMocks.callTool).toHaveBeenCalledWith({ name: 'direct-tool', arguments: {} }, undefined, {
      signal: undefined,
      onprogress: undefined,
      timeout: 30_000,
      resetTimeoutOnProgress: false
    });
  });
});
