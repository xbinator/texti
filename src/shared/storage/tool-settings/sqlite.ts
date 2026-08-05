/**
 * @file sqlite.ts
 * @description Tavily 与 MCP 工具设置的归一化与 ~/.tibis/settings.json 持久化。
 */
import type { ToolSettingsState, MCPToolSettings, MCPServerConfig, MCPOAuthConfig, TavilyToolSettings } from './types';
import { isBoolean, isFinite, isPlainObject, isString, pickBy, uniq } from 'lodash-es';
import { settingsFileStorage } from '@/shared/storage/settings';
import { asyncTo } from '@/utils/asyncTo';
import {
  DEFAULT_TOOL_SETTINGS,
  DEFAULT_MCP_TOOL_SETTINGS,
  DEFAULT_MCP_CONNECT_TIMEOUT_MS,
  DEFAULT_MCP_TOOL_CALL_TIMEOUT_MS,
  MIN_CONNECT_TIMEOUT_MS,
  MAX_CONNECT_TIMEOUT_MS,
  MIN_TOOL_CALL_TIMEOUT_MS,
  MAX_TOOL_CALL_TIMEOUT_MS
} from './types';

// ─── MCP Normalization Helpers ─────────────────────────────────────────────────

/**
 * 归一化 Tavily 工具设置。
 * @param value - 原始 Tavily 设置
 * @returns 合法 Tavily 设置
 */
export function normalizeTavilySettings(value: unknown): TavilyToolSettings {
  const source = isPlainObject(value) ? (value as Partial<TavilyToolSettings>) : {};

  return {
    enabled: isBoolean(source.enabled) ? source.enabled : DEFAULT_TOOL_SETTINGS.tavily.enabled,
    apiKey: isString(source.apiKey) ? source.apiKey : DEFAULT_TOOL_SETTINGS.tavily.apiKey
  };
}

/**
 * 归一化 timeout 值到合理范围。
 */
function normalizeTimeoutMs(value: unknown, defaultMs: number, minMs: number, maxMs: number): number {
  if (!isFinite(value)) {
    return defaultMs;
  }
  return Math.min(maxMs, Math.max(minMs, Math.round(value as number)));
}

/**
 * 归一化 env 字典。
 */
function normalizeEnv(value: unknown): Record<string, string> {
  if (!isPlainObject(value)) {
    return {};
  }
  return pickBy(value as Record<string, unknown>, (val, key): val is string => key.trim().length > 0 && isString(val));
}

/**
 * 归一化 OAuth 配置。
 */
function normalizeOAuthConfig(value: unknown): MCPOAuthConfig | undefined {
  if (!isPlainObject(value)) return undefined;
  const source = value as Partial<MCPOAuthConfig>;
  return {
    clientId: isString(source.clientId) ? source.clientId : undefined,
    clientSecret: isString(source.clientSecret) ? source.clientSecret : undefined,
    accessToken: isString(source.accessToken) ? source.accessToken : undefined,
    refreshToken: isString(source.refreshToken) ? source.refreshToken : undefined,
    expiresAt: isFinite(source.expiresAt) ? source.expiresAt : undefined,
    scope: isString(source.scope) ? source.scope : undefined
  };
}

/**
 * 归一化单个 MCP server 配置。
 */
function normalizeMCPServerConfig(value: unknown): MCPServerConfig | null {
  if (!isPlainObject(value)) {
    return null;
  }
  const source = value as Partial<MCPServerConfig>;

  if (!source.id?.trim()) return null;

  const transport = source.transport === 'streamableHTTP' || source.transport === 'sse' ? source.transport : 'stdio';
  const args = Array.isArray(source.args) ? source.args.filter(isString) : [];

  return {
    id: source.id.trim(),
    name: source.name?.trim() || source.command?.trim() || 'Unnamed MCP Server',
    enabled: Boolean(source.enabled),
    ...(isString(source.editorJsonText) ? { editorJsonText: source.editorJsonText } : {}),
    transport,
    url: transport !== 'stdio' && isString(source.url) ? source.url.trim() : undefined,
    command: isString(source.command) ? source.command.trim() : '',
    args,
    env: normalizeEnv(source.env),
    headers: normalizeEnv(source.headers),
    toolAllowlist: Array.isArray(source.toolAllowlist)
      ? uniq(source.toolAllowlist.filter((t: unknown): t is string => isString(t) && t.trim().length > 0).map((t: string) => t.trim()))
      : [],
    oauth: normalizeOAuthConfig(source.oauth),
    watchToolChanges: isBoolean(source.watchToolChanges) ? source.watchToolChanges : undefined,
    connectTimeoutMs: normalizeTimeoutMs(source.connectTimeoutMs, DEFAULT_MCP_CONNECT_TIMEOUT_MS, MIN_CONNECT_TIMEOUT_MS, MAX_CONNECT_TIMEOUT_MS),
    toolCallTimeoutMs: normalizeTimeoutMs(source.toolCallTimeoutMs, DEFAULT_MCP_TOOL_CALL_TIMEOUT_MS, MIN_TOOL_CALL_TIMEOUT_MS, MAX_TOOL_CALL_TIMEOUT_MS)
  };
}

/**
 * 归一化 MCP 工具设置。
 */
export function normalizeMCPSettings(value: unknown): MCPToolSettings {
  if (!isPlainObject(value)) {
    return DEFAULT_MCP_TOOL_SETTINGS;
  }
  const source = value as Partial<MCPToolSettings>;

  return {
    servers: source.servers?.map((s) => normalizeMCPServerConfig(s)).filter((s) => s !== null) || []
  };
}

/**
 * 归一化全部工具设置。
 * @param value - 原始持久化值
 * @returns 合法工具设置
 */
export function normalizeToolSettings(value: unknown): ToolSettingsState {
  const source = isPlainObject(value) ? (value as Partial<ToolSettingsState>) : {};

  return {
    tavily: normalizeTavilySettings(source.tavily),
    mcp: normalizeMCPSettings(source.mcp)
  };
}

/**
 * 工具设置存储。
 */
export const toolSettingsStorage = {
  /**
   * 读取设置。
   * @returns 归一化后的工具设置
   */
  getSettings(): ToolSettingsState {
    return normalizeToolSettings({});
  },

  /**
   * 异步读取完整工具设置。
   * @returns 归一化后的工具设置
   */
  async loadSettings(): Promise<ToolSettingsState> {
    const [error, settingsFile] = await asyncTo(settingsFileStorage.read());
    const normalized = normalizeToolSettings(error ? {} : { tavily: settingsFile.tavily, mcp: settingsFile.mcp });
    return normalized;
  },

  /**
   * 保存设置。
   * @param settings - 待保存设置
   * @returns 归一化后的工具设置
   */
  async saveSettings(settings: Partial<ToolSettingsState>): Promise<ToolSettingsState> {
    const normalized = normalizeToolSettings(settings);
    await asyncTo(settingsFileStorage.update((current) => ({ ...current, tavily: normalized.tavily, mcp: normalized.mcp })));
    return normalized;
  }
};
