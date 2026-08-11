/**
 * @file stream/request.mts
 * @description ChatRuntime 流式请求构建。
 */
import type { ActiveChatRuntime } from '../types.mjs';
import type { AIRequestOptions } from 'types/ai';
import type { ChatMessageRecord } from 'types/chat';
import { toRuntimeModelMessages } from '../context/model-message.mjs';

/**
 * 构建 runtime 流式请求。
 * @param modelId - 模型 ID
 * @param runtime - runtime 状态
 * @param userMessage - user 消息
 * @param sourceMessages - 源消息
 * @param maxOutputTokens - Provider 模型配置的输出 Token 上限
 * @returns AI 请求参数
 */
export function createRuntimeStreamRequest(
  modelId: string,
  runtime: ActiveChatRuntime,
  userMessage: ChatMessageRecord,
  sourceMessages?: ChatMessageRecord[],
  maxOutputTokens?: number
): AIRequestOptions {
  return {
    requestId: runtime.runtimeId,
    modelId,
    ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
    messages: toRuntimeModelMessages(sourceMessages?.length ? sourceMessages : [userMessage], { skillContentHashes: runtime.skillContentHashes }),
    ...(runtime.system ? { system: runtime.system } : {}),
    ...(runtime.tools?.length ? { tools: runtime.tools } : {}),
    ...(runtime.tavily ? { tavily: runtime.tavily } : {}),
    ...(runtime.mcp ? { mcp: runtime.mcp } : {})
  };
}
