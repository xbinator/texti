/**
 * @file parseMCPServerConfig.ts
 * @description MCP Server 配置 JSON 解析工具，用于将用户输入的 JSON 文本解析为草稿结构。
 */
import { isArray, isObject } from 'lodash-es';
import type { MCPTransportType } from '@/shared/storage/tool-settings';
import { DEFAULT_MCP_TOOL_CALL_TIMEOUT_MS } from '@/shared/storage/tool-settings';
import { safeJsonParse } from '@/utils/json';

/**
 * MCP Server 编辑弹窗提交的草稿结构。
 */
export interface MCPServerEditorDraft {
  /** 展示名称 */
  name: string;
  /** 传输类型 */
  transport: MCPTransportType;
  /** 启动命令（stdio） */
  command: string;
  /** 启动参数（stdio） */
  args: string[];
  /** 环境变量（stdio） */
  env: Record<string, string>;
  /** 远程 MCP 请求头 */
  headers: Record<string, string>;
  /** 服务端 URL（streamableHTTP/sse） */
  url: string;
  /** 是否启用 OAuth */
  enableOAuth: boolean;
  /** 允许暴露的工具名列表 */
  toolAllowlist: string[];
  /** 单次工具调用超时 */
  toolCallTimeoutMs: number;
}

/**
 * JSON 解析结果。
 */
export interface MCPServerDraftParseResult {
  /** 解析后的草稿 */
  draft: MCPServerEditorDraft | null;
  /** 解析错误信息 */
  error: string;
}

/**
 * 将任意对象安全转换为字符串字典。
 * @param value - 待转换值
 * @returns 字符串字典
 */
function normalizeStringRecord(value: unknown): Record<string, string> {
  if (!isObject(value) || isArray(value)) {
    return {};
  }

  return Object.fromEntries(Object.entries(value).map(([key, itemValue]) => [String(key), String(itemValue)]));
}

/**
 * 将任意值安全转换为字符串数组。
 * @param value - 待转换值
 * @returns 字符串数组
 */
function normalizeStringArray(value: unknown): string[] {
  return isArray(value) ? value.map((item) => String(item)) : [];
}

/**
 * 归一化 MCP transport 字段。
 * 兼容第三方配置常见的 type 字段和不同大小写写法。
 * @param value - 原始 transport/type 值
 * @returns MCP transport 类型，无法识别时返回 null
 */
function normalizeTransportType(value: unknown): MCPTransportType | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'streamablehttp' || normalized === 'streamable-http') {
    return 'streamableHTTP';
  }
  if (normalized === 'sse') {
    return 'sse';
  }
  if (normalized === 'stdio') {
    return 'stdio';
  }
  return null;
}

/**
 * 将 JSON 文本解析为可提交的 MCP server 草稿。
 * 支持两种格式：
 * 1. 扁平格式：{ "name": "...", "transport": "...", ... }
 * 2. mcpServers 包裹格式（兼容 Claude Desktop 等导出格式），自动取第一个 server。
 * @param jsonText - 编辑器中的 JSON 文本
 * @returns 解析结果
 */
export function parseMCPServerEditorDraft(jsonText: string): MCPServerDraftParseResult {
  const raw = jsonText.trim();
  if (!raw) {
    return { draft: null, error: '请输入 MCP Server JSON 配置。' };
  }

  const parsed = safeJsonParse<Record<string, unknown> | null>(raw, null);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { draft: null, error: 'JSON 格式错误' };
  }

  // 兼容 mcpServers 包裹格式：自动取第一个 server 配置
  let effectiveParsed = parsed;
  let wrapperName: string | undefined;
  if (parsed.mcpServers && typeof parsed.mcpServers === 'object' && !Array.isArray(parsed.mcpServers)) {
    const servers = parsed.mcpServers as Record<string, unknown>;
    const entries = Object.entries(servers);
    if (entries.length === 0) {
      return { draft: null, error: 'mcpServers 中未包含任何 server 配置。' };
    }
    if (entries.length > 1) {
      return { draft: null, error: 'mcpServers 一次只能包含一个 server 配置，请拆分后分别添加。' };
    }
    const [firstKey, firstValue] = entries[0];
    if (!firstValue || typeof firstValue !== 'object' || Array.isArray(firstValue)) {
      return { draft: null, error: `mcpServers["${firstKey}"] 不是有效的 server 配置对象。` };
    }
    wrapperName = firstKey;
    effectiveParsed = firstValue as Record<string, unknown>;
  }

  // 自动推断传输类型：显式 transport/type > 有 url 则为 streamableHTTP > 默认 stdio
  const explicitTransport = normalizeTransportType(effectiveParsed.transport) ?? normalizeTransportType(effectiveParsed.type);
  const transport: MCPTransportType = explicitTransport ?? (typeof effectiveParsed.url === 'string' && effectiveParsed.url.trim() ? 'streamableHTTP' : 'stdio');

  // 名称优先级：显式 name 字段 > mcpServers 包裹键名 > 默认值
  const explicitName = typeof effectiveParsed.name === 'string' && effectiveParsed.name.trim() ? effectiveParsed.name.trim() : '';
  const name = explicitName || wrapperName || 'New MCP Server';

  return {
    draft: {
      name,
      transport,
      command: typeof effectiveParsed.command === 'string' ? effectiveParsed.command.trim() : '',
      args: normalizeStringArray(effectiveParsed.args),
      env: normalizeStringRecord(effectiveParsed.env),
      headers: normalizeStringRecord(effectiveParsed.headers),
      url: typeof effectiveParsed.url === 'string' ? effectiveParsed.url.trim() : '',
      enableOAuth: Boolean(effectiveParsed.enableOAuth),
      toolAllowlist: normalizeStringArray(effectiveParsed.toolAllowlist),
      toolCallTimeoutMs: typeof effectiveParsed.toolCallTimeoutMs === 'number' ? effectiveParsed.toolCallTimeoutMs : DEFAULT_MCP_TOOL_CALL_TIMEOUT_MS
    },
    error: ''
  };
}
