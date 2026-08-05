/**
 * @file useRuntimeConfig.ts
 * @description ChatRuntime 请求配置解析 hook。
 */
import type { AIMCPRequestConfig, AITavilyRuntimeConfig } from 'types/ai';
import type { BuildMemoryContextOptions, MemorySelectionContext, MemorySelectionDebugInfo } from '@/ai/memory/types';
import { useMemoryStore } from '@/stores/ai/memory';
import { useToolSettingsStore } from '@/stores/ai/toolSettings';

/**
 * Runtime 配置 hook 返回值。
 */
interface UseRuntimeConfigReturn {
  /** 解析 runtime system prompt 上下文。 */
  resolveRuntimeSystemPrompt: (
    selection?: MemorySelectionContext,
    onSelectionDebug?: (debugInfo: MemorySelectionDebugInfo) => void
  ) => Promise<string | undefined>;
  /** 解析可交给主进程执行的 Tavily 配置。 */
  resolveRuntimeTavilyConfig: () => AITavilyRuntimeConfig | undefined;
  /** 解析可交给主进程执行的 MCP 配置。 */
  resolveRuntimeMcpRequestConfig: () => AIMCPRequestConfig | undefined;
}

/**
 * 判断 MCP server 是否可在主进程执行。
 * @param server - MCP server 配置
 * @returns 是否可执行
 */
function isRuntimeEnabledMcpServer(server: AIMCPRequestConfig['servers'][number]): boolean {
  if (!server.enabled) return false;
  if (server.transport === 'stdio') return server.command.trim().length > 0;

  return Boolean(server.url?.trim());
}

/**
 * 管理 ChatRuntime 的 system prompt、Tavily 和 MCP 请求配置。
 * @returns Runtime 配置解析方法
 */
export function useRuntimeConfig(): UseRuntimeConfigReturn {
  const memoryStore = useMemoryStore();
  const toolSettingsStore = useToolSettingsStore();

  /**
   * 解析 runtime system prompt 上下文。
   * @param selection - 当前请求的记忆筛选上下文
   * @param onSelectionDebug - 记忆选择调试回调
   * @returns system prompt
   */
  async function resolveRuntimeSystemPrompt(
    selection?: MemorySelectionContext,
    onSelectionDebug?: (debugInfo: MemorySelectionDebugInfo) => void
  ): Promise<string | undefined> {
    if (!memoryStore.loaded) {
      await memoryStore.loadMemory();
    }

    const memoryOptions: BuildMemoryContextOptions | undefined = selection ? { selection } : undefined;
    if (memoryOptions && onSelectionDebug) {
      memoryOptions.onSelectionDebug = onSelectionDebug;
    }

    const memoryContext = memoryStore.buildSystemPromptContext(memoryOptions);
    return memoryContext.trim() ? memoryContext : undefined;
  }

  /**
   * 解析可交给主进程执行的 Tavily 配置。
   * @returns Tavily runtime 配置
   */
  function resolveRuntimeTavilyConfig(): AITavilyRuntimeConfig | undefined {
    const { tavily } = toolSettingsStore;
    if (!tavily?.enabled || !tavily.apiKey.trim()) return undefined;

    return {
      enabled: tavily.enabled,
      apiKey: tavily.apiKey
    };
  }

  /**
   * 解析可交给主进程执行的 MCP 配置。
   * @returns MCP runtime 请求配置
   */
  function resolveRuntimeMcpRequestConfig(): AIMCPRequestConfig | undefined {
    const servers = toolSettingsStore.mcp.servers.filter(isRuntimeEnabledMcpServer).map((server) => ({
      id: server.id,
      name: server.name,
      enabled: server.enabled,
      transport: server.transport,
      url: server.url,
      command: server.command,
      args: [...server.args],
      env: { ...server.env },
      headers: { ...server.headers },
      toolAllowlist: [...server.toolAllowlist],
      oauth: server.oauth ? { ...server.oauth } : undefined,
      watchToolChanges: server.watchToolChanges,
      connectTimeoutMs: server.connectTimeoutMs,
      toolCallTimeoutMs: server.toolCallTimeoutMs
    }));
    if (!servers.length) return undefined;

    return {
      servers,
      enabledServerIds: servers.map((server) => server.id),
      enabledTools: [],
      toolInstructions: ''
    };
  }

  return {
    resolveRuntimeSystemPrompt,
    resolveRuntimeTavilyConfig,
    resolveRuntimeMcpRequestConfig
  };
}
