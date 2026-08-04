/**
 * @file client.mts
 * @description MCP SDK Client 包装，提供统一的连接、工具发现与调用接口。
 */
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { Progress } from '@modelcontextprotocol/sdk/types.js';
import type { MCPDiscoveredToolSnapshot, MCPServerConfig } from 'types/ai';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

/** MCP progress 通道在没有新通知时允许等待的兜底时长。 */
export const MCP_PROGRESS_TIMEOUT_MS = 65_000;

/** 单次 MCP tool 调用选项。 */
export interface MCPToolCallOptions {
  /** 调用中止信号。 */
  signal?: AbortSignal;
  /** MCP progress 通知回调。 */
  onProgress?: (progress: Progress) => void;
  /** 非 Runtime 直接调用使用的固定总时限。 */
  timeoutMs?: number;
}

/**
 * MCP 客户端包装接口。
 */
export interface MCPClientWrapper {
  /** 底层 SDK Client */
  readonly client: Client;
  /** 服务器配置 */
  readonly server: MCPServerConfig;
  /** 连接到服务器 */
  connect(): Promise<void>;
  /** 断开连接 */
  disconnect(): Promise<void>;
  /** 获取工具列表 */
  listTools(): Promise<MCPDiscoveredToolSnapshot[]>;
  /** 调用工具 */
  callTool(name: string, args: unknown, options?: MCPToolCallOptions): Promise<unknown>;
  /** 是否已连接 */
  isConnected(): boolean;
}

/**
 * 创建 MCP 客户端包装。
 * @param server - MCP server 配置
 * @param transport - SDK Transport 实例
 * @returns 客户端包装
 */
export async function createMcpClient(server: MCPServerConfig, transport: Transport): Promise<MCPClientWrapper> {
  const client = new Client({ name: 'tibis', version: '0.1.0' }, { capabilities: {} });

  let connected = false;

  return {
    client,
    server,

    async connect(): Promise<void> {
      await client.connect(transport);
      connected = true;
    },

    async disconnect(): Promise<void> {
      await client.close();
      connected = false;
    },

    async listTools(): Promise<MCPDiscoveredToolSnapshot[]> {
      const result = await client.listTools();
      return result.tools.map((tool) => ({
        serverId: server.id,
        toolName: tool.name,
        description: tool.description ?? undefined,
        inputSchema: tool.inputSchema as Record<string, unknown> | undefined
      }));
    },

    async callTool(name: string, args: unknown, options: MCPToolCallOptions = {}): Promise<unknown> {
      const safeArgs = args !== null && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
      const usesStaticTimeout = options.timeoutMs !== undefined;
      const result = await client.callTool({ name, arguments: safeArgs }, undefined, {
        signal: options.signal,
        onprogress: options.onProgress,
        timeout: options.timeoutMs ?? MCP_PROGRESS_TIMEOUT_MS,
        resetTimeoutOnProgress: !usesStaticTimeout
      });
      return result;
    },

    isConnected(): boolean {
      return connected;
    }
  };
}
