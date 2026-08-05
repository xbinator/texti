/**
 * @file settings-file.mts
 * @description ChatRuntime 主进程 MCP settings 文件读写。
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { RuntimeSettingsFile } from './types.mjs';
import type { MCPServerConfig, MCPToolSettings } from 'types/ai';
import { ensureTibisWorkspaceRoot } from '../../../workspace/root.mjs';
import {
  DEFAULT_MCP_CONNECT_TIMEOUT_MS,
  DEFAULT_MCP_TOOL_CALL_TIMEOUT_MS,
  MAX_CONNECT_TIMEOUT_MS,
  MAX_TOOL_CALL_TIMEOUT_MS,
  MIN_CONNECT_TIMEOUT_MS,
  MIN_TOOL_CALL_TIMEOUT_MS,
  RUNTIME_SETTINGS_FILE_NAME
} from './constants.mjs';
import { isRecord } from './guards.mjs';

/** Runtime settings 写入队列。 */
let runtimeSettingsWriteQueue: Promise<void> = Promise.resolve();

/**
 * 判断值是否为 MCP transport。
 * @param value - 待判断值
 * @returns 是否为 MCP transport
 */
function isRuntimeMcpTransport(value: unknown): MCPServerConfig['transport'] | null {
  if (value === 'streamableHTTP' || value === 'sse') return value;
  if (value === 'stdio') return value;
  return null;
}

/**
 * 归一化字符串数组。
 * @param value - 原始值
 * @returns 字符串数组
 */
export function normalizeRuntimeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((item: unknown): item is string => typeof item === 'string')
    .map((item: string) => item.trim())
    .filter(Boolean);
}

/**
 * 归一化字符串字典。
 * @param value - 原始值
 * @returns 字符串字典
 */
export function normalizeRuntimeStringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};

  const normalized: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key.trim() && typeof item === 'string') {
      normalized[key] = item;
    }
  }
  return normalized;
}

/**
 * 归一化 MCP 超时字段。
 * @param value - 原始值
 * @param fallback - 默认值
 * @param minValue - 最小值
 * @param maxValue - 最大值
 * @returns 合法超时值
 */
export function normalizeRuntimeMcpTimeoutMs(value: unknown, fallback: number, minValue: number, maxValue: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;

  return Math.min(maxValue, Math.max(minValue, Math.round(value)));
}

/**
 * 归一化 MCP OAuth 配置。
 * @param value - 原始值
 * @returns OAuth 配置或 undefined
 */
function normalizeRuntimeMcpOAuth(value: unknown): MCPServerConfig['oauth'] | undefined {
  if (!isRecord(value)) return undefined;

  return {
    ...(typeof value.clientId === 'string' ? { clientId: value.clientId } : {}),
    ...(typeof value.clientSecret === 'string' ? { clientSecret: value.clientSecret } : {}),
    ...(typeof value.accessToken === 'string' ? { accessToken: value.accessToken } : {}),
    ...(typeof value.refreshToken === 'string' ? { refreshToken: value.refreshToken } : {}),
    ...(typeof value.expiresAt === 'number' && Number.isFinite(value.expiresAt) ? { expiresAt: value.expiresAt } : {}),
    ...(typeof value.scope === 'string' ? { scope: value.scope } : {})
  };
}

/**
 * 归一化单个 MCP server 配置。
 * @param value - 原始 server 配置
 * @returns MCP server 配置，不合法时返回 null
 */
function normalizeRuntimeMcpServer(value: unknown): MCPServerConfig | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim()) return null;

  const transport = isRuntimeMcpTransport(value.transport) ?? 'stdio';
  const command = typeof value.command === 'string' ? value.command.trim() : '';
  const name =
    typeof value.name === 'string' && value.name.trim()
      ? value.name.trim()
      : command || (transport !== 'stdio' && typeof value.url === 'string' ? value.url.trim() : 'Unnamed MCP Server');
  const oauth = normalizeRuntimeMcpOAuth(value.oauth);

  return {
    id: value.id.trim(),
    name,
    enabled: value.enabled === true,
    ...(typeof value.editorJsonText === 'string' ? { editorJsonText: value.editorJsonText } : {}),
    transport,
    ...(transport !== 'stdio' && typeof value.url === 'string' ? { url: value.url.trim() } : {}),
    command,
    args: normalizeRuntimeStringArray(value.args),
    env: normalizeRuntimeStringRecord(value.env),
    headers: normalizeRuntimeStringRecord(value.headers),
    toolAllowlist: normalizeRuntimeStringArray(value.toolAllowlist),
    ...(oauth ? { oauth } : {}),
    ...(typeof value.watchToolChanges === 'boolean' ? { watchToolChanges: value.watchToolChanges } : {}),
    connectTimeoutMs: normalizeRuntimeMcpTimeoutMs(value.connectTimeoutMs, DEFAULT_MCP_CONNECT_TIMEOUT_MS, MIN_CONNECT_TIMEOUT_MS, MAX_CONNECT_TIMEOUT_MS),
    toolCallTimeoutMs: normalizeRuntimeMcpTimeoutMs(
      value.toolCallTimeoutMs,
      DEFAULT_MCP_TOOL_CALL_TIMEOUT_MS,
      MIN_TOOL_CALL_TIMEOUT_MS,
      MAX_TOOL_CALL_TIMEOUT_MS
    )
  };
}

/**
 * 归一化 MCP 设置。
 * @param value - 原始 MCP 设置
 * @returns MCP 设置
 */
export function normalizeRuntimeMcpSettings(value: unknown): MCPToolSettings {
  if (!isRecord(value) || !Array.isArray(value.servers)) {
    return { servers: [] };
  }

  return {
    servers: value.servers.map((server: unknown) => normalizeRuntimeMcpServer(server)).filter((server): server is MCPServerConfig => server !== null)
  };
}

/**
 * 移除仅供编辑器回显使用的 MCP server 原始 JSON。
 * @param settings - MCP 设置
 * @returns 可安全返回给 AI 工具的 MCP 设置
 */
export function redactMcpEditorJson(settings: MCPToolSettings): MCPToolSettings {
  return {
    servers: settings.servers.map((server): MCPServerConfig => {
      const runtimeServer: MCPServerConfig = { ...server };
      delete runtimeServer.editorJsonText;

      return runtimeServer;
    })
  };
}

/**
 * 归一化 runtime settings 文件。
 * @param value - 原始 settings 文件内容
 * @returns settings 文件结构
 */
function normalizeRuntimeSettingsFile(value: unknown): RuntimeSettingsFile {
  const source = isRecord(value) ? value : {};
  return {
    version: 1,
    providers: Array.isArray(source.providers) ? source.providers : [],
    mcp: normalizeRuntimeMcpSettings(source.mcp),
    ...(source.tavily !== undefined ? { tavily: source.tavily } : {})
  };
}

/**
 * 读取 runtime settings 文件。
 * @returns settings 文件结构
 */
async function readRuntimeSettingsFile(): Promise<RuntimeSettingsFile> {
  try {
    const root = await ensureTibisWorkspaceRoot();
    const content = await fs.readFile(path.join(root.rootPath, RUNTIME_SETTINGS_FILE_NAME), 'utf8');
    return normalizeRuntimeSettingsFile(JSON.parse(content) as unknown);
  } catch {
    return normalizeRuntimeSettingsFile({});
  }
}

/**
 * 写入 runtime settings 文件。
 * @param settings - settings 文件结构
 */
async function writeRuntimeSettingsFile(settings: RuntimeSettingsFile): Promise<void> {
  const root = await ensureTibisWorkspaceRoot();
  const filePath = path.join(root.rootPath, RUNTIME_SETTINGS_FILE_NAME);

  try {
    const currentContent = await fs.readFile(filePath, 'utf8');
    await fs.writeFile(`${filePath}.bak`, currentContent, 'utf8');
  } catch {
    // 文件不存在或无法读取时直接写入新 settings。
  }

  await fs.writeFile(filePath, JSON.stringify(normalizeRuntimeSettingsFile(settings), null, 2), 'utf8');
}

/**
 * 串行更新 MCP 设置。
 * @param transformer - MCP 设置转换函数
 * @returns 更新后的 MCP 设置
 */
export async function updateRuntimeMcpSettings(transformer: (current: MCPToolSettings) => MCPToolSettings): Promise<MCPToolSettings> {
  const previousWriteQueue = runtimeSettingsWriteQueue;
  let updatedMcp: MCPToolSettings = { servers: [] };
  const updatePromise = (async (): Promise<void> => {
    await previousWriteQueue;
    const currentSettings = await readRuntimeSettingsFile();
    updatedMcp = normalizeRuntimeMcpSettings(transformer(currentSettings.mcp));
    await writeRuntimeSettingsFile({ ...currentSettings, mcp: updatedMcp });
  })();

  runtimeSettingsWriteQueue = updatePromise.catch((): void => undefined);
  await updatePromise;
  return updatedMcp;
}

/**
 * 读取主进程 MCP 设置。
 * @returns MCP 设置
 */
export async function readRuntimeMcpSettings(): Promise<MCPToolSettings> {
  const settings = await readRuntimeSettingsFile();
  return settings.mcp;
}

/**
 * 查找 MCP server。
 * @param settings - MCP 设置
 * @param serverId - server ID
 * @returns MCP server，不存在时返回 undefined
 */
export function findRuntimeMcpServer(settings: MCPToolSettings, serverId: string): MCPServerConfig | undefined {
  return settings.servers.find((server) => server.id === serverId);
}
