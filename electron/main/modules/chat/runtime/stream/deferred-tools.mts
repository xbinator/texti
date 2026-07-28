/**
 * @file deferred-tools.mts
 * @description ChatRuntime 延迟工具消息的持久化可见性边界。
 */
import type { ChatRuntimeDeferredToolCall } from '../types.mjs';
import type { RuntimeToolCallChunk } from './types.mjs';
import type { AIMCPRequestConfig, AITavilyRuntimeConfig, AIToolExecutionResult, AITransportTool } from 'types/ai';
import type { ChatMessageRecord } from 'types/chat';
import type { AgentTaskError } from 'types/chat-agent';
import { DELEGATE_TASK_TOOL_NAME, getToolRegistryEntry } from '../../../../../../shared/ai/tools/index.js';
import { hashAgentPayload, validateFoundationContract } from '../../agents/contracts.mjs';

/** 合法延迟工具调用解析结果。 */
export interface DeferredToolCallSuccess {
  /** 解析是否成功。 */
  ok: true;
  /** 经校验并哈希的延迟调用。 */
  toolCall: ChatRuntimeDeferredToolCall;
}

/** 非法延迟工具调用解析结果。 */
export interface DeferredToolCallFailure {
  /** 解析是否成功。 */
  ok: false;
  /** 稳定契约错误。 */
  error: AgentTaskError;
}

/** 延迟工具调用解析结果。 */
export type DeferredToolCallParseResult = DeferredToolCallSuccess | DeferredToolCallFailure;

/**
 * 判断工具是否通过 registry 声明为延迟协调执行。
 * @param toolName - 工具名称
 * @returns 是否属于延迟协调执行类
 */
export function isDeferredToolName(toolName: string): boolean {
  return getToolRegistryEntry(toolName)?.executionClass === 'deferred-coordination';
}

/**
 * 从当前请求实际暴露的工具快照中提取延迟协调工具名。
 * Registry 分类只定义能力类型，不会绕过 runtime.tools 的显式暴露边界。
 * @param tools - 当前 Runtime 的传输工具快照
 * @returns 本次请求实际暴露的延迟工具名
 */
export function getDeferredToolNames(tools: readonly AITransportTool[] | undefined): Set<string> {
  return new Set(tools?.filter((tool): boolean => isDeferredToolName(tool.name)).map((tool): string => tool.name) ?? []);
}

/**
 * 判断 Tavily 配置是否会注册 AI SDK 可执行工具。
 * @param tavily - Tavily 运行时配置
 * @returns 是否存在可执行 Tavily 工具
 */
export function hasExecutableTavily(tavily: AITavilyRuntimeConfig | undefined): boolean {
  return Boolean(tavily?.enabled && tavily.apiKey.trim());
}

/**
 * 判断 MCP server 是否在当前请求中可运行。
 * @param server - MCP server 配置
 * @param mcp - MCP 请求配置
 * @returns 是否可进入 discovery
 */
function isMcpServerRunnable(server: AIMCPRequestConfig['servers'][number], mcp: AIMCPRequestConfig): boolean {
  if (!server.enabled || !mcp.enabledServerIds.includes(server.id)) return false;
  if (server.transport === 'stdio') return server.command.trim().length > 0;
  return Boolean(server.url?.trim());
}

/**
 * 判断可运行 server 是否可能暴露至少一个请求允许的工具。
 * 空 enabledTools 按现有 MCP 语义表示不限制。
 * @param server - 可运行 MCP server
 * @param mcp - MCP 请求配置
 * @returns 是否存在请求级与 server 级允许范围的交集
 */
function hasEnabledMcpTool(server: AIMCPRequestConfig['servers'][number], mcp: AIMCPRequestConfig): boolean {
  if (mcp.enabledTools.length === 0) return true;

  const serverAllowlist = new Set(server.toolAllowlist.map((toolName): string => toolName.trim()).filter(Boolean));
  return mcp.enabledTools.some((selector): boolean => {
    const toolName = selector.toolName.trim();
    return selector.serverId === server.id && toolName.length > 0 && (serverAllowlist.size === 0 || serverAllowlist.has(toolName));
  });
}

/**
 * 判断 MCP 配置是否可能注册至少一个 AI SDK 可执行工具。
 * @param mcp - MCP 请求配置
 * @returns 是否存在可执行 MCP 配置
 */
export function hasExecutableMcp(mcp: AIMCPRequestConfig | undefined): boolean {
  return Boolean(mcp?.servers.some((server): boolean => isMcpServerRunnable(server, mcp) && hasEnabledMcpTool(server, mcp)));
}

/**
 * 创建延迟调用未通过实际暴露边界时的稳定错误。
 * @param toolName - Provider 声明的工具名称
 * @returns 协议失败结果
 */
function createExposureFailure(toolName: string): DeferredToolCallFailure {
  return {
    ok: false,
    error: {
      code: 'protocol_error',
      phase: 'contract_validation',
      category: 'protocol',
      retryable: false,
      message: 'Tool call is not an exposed deferred coordination tool',
      details: {
        reason: 'deferred_tool_not_exposed',
        toolName
      }
    }
  };
}

/**
 * 校验并生成 Provider 边界的延迟工具调用。
 * @param chunk - 完整工具调用 chunk
 * @param exposedToolNames - 当前请求实际暴露的延迟工具名
 * @returns 延迟调用或稳定契约错误
 */
export function parseDeferredToolCall(chunk: RuntimeToolCallChunk, exposedToolNames: ReadonlySet<string>): DeferredToolCallParseResult {
  if (chunk.toolName !== DELEGATE_TASK_TOOL_NAME || !isDeferredToolName(chunk.toolName) || !exposedToolNames.has(chunk.toolName)) {
    return createExposureFailure(chunk.toolName);
  }

  const validation = validateFoundationContract(chunk.input);
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }

  return {
    ok: true,
    toolCall: {
      toolCallId: chunk.toolCallId,
      toolName: DELEGATE_TASK_TOOL_NAME,
      input: validation.contract,
      argumentsHash: hashAgentPayload(validation.contract),
      ...(chunk.providerMetadata === undefined ? {} : { providerMetadataHash: hashAgentPayload(chunk.providerMetadata) })
    }
  };
}

/**
 * 创建禁止执行整个混合步骤时的稳定工具协议错误。
 * @param toolName - 被拒绝的工具名称
 * @param reason - 稳定协议原因
 * @returns 模型可见但不包含委派控制数据的失败结果
 */
export function createProtocolToolResult(toolName: string, reason: string): AIToolExecutionResult {
  return {
    toolName,
    status: 'failure',
    error: {
      code: 'protocol_error',
      message: `工具步骤违反延迟委派协议：${reason}`
    }
  };
}

/**
 * 创建可在委派事务提交前持久化的 assistant 深克隆。
 * @param workingMessage - 保留完整延迟工具输入的内存工作消息
 * @param deferredToolCallIds - 尚未提交的延迟工具调用 ID
 * @returns 仅裁剪匹配工具片段的独立消息快照
 */
export function createPersistableAssistant(workingMessage: ChatMessageRecord, deferredToolCallIds: ReadonlySet<string>): ChatMessageRecord {
  const persistedMessage = structuredClone(workingMessage);
  persistedMessage.parts = persistedMessage.parts.filter((part): boolean => part.type !== 'tool' || !deferredToolCallIds.has(part.toolCallId));

  return persistedMessage;
}

/**
 * 清除非法 deferred part 中不能进入持久化或模型上下文的控制数据。
 * 工具身份、状态与 protocol_error 结果保留用于诊断。
 * @param workingMessage - 当前 working assistant
 * @param deferredToolCallIds - 已按 registry 识别的 deferred 调用 ID
 */
export function scrubDeferredParts(workingMessage: ChatMessageRecord, deferredToolCallIds: ReadonlySet<string>): void {
  for (const part of workingMessage.parts) {
    if (part.type !== 'tool' || !deferredToolCallIds.has(part.toolCallId)) continue;

    part.input = null;
    delete part.inputText;
    delete part.providerMetadata;
  }
}
