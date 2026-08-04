/**
 * @file finalizer.mts
 * @description ChatRuntime assistant 消息终态处理。
 */
import type { AIToolExecutionCancelledResult, AIToolExecutionFailureResult, AIServiceError } from 'types/ai';
import type { ChatMessageRecord, ChatMessageToolPart } from 'types/chat';
import { nanoid } from 'nanoid';

/**
 * 补齐续跑 assistant 的创建时间。
 * @param message - assistant 消息
 * @param fallbackCreatedAt - 兜底创建时间
 */
export function ensureRuntimeMessageCreatedAt(message: ChatMessageRecord, fallbackCreatedAt: string): void {
  if (!message.createdAt) {
    message.createdAt = fallbackCreatedAt;
  }
}

/**
 * 将未完成工具片段标记为失败。
 * @param message - assistant 草稿消息
 * @param error - runtime 错误
 * @returns 是否存在被标记失败的工具片段
 */
function failPendingToolParts(message: ChatMessageRecord, error: AIServiceError): boolean {
  let hasFailedToolPart = false;

  for (const part of message.parts) {
    if (part.type !== 'tool') continue;

    const toolPart = part as ChatMessageToolPart;
    const isAwaitingUserInput = toolPart.result?.status === 'awaiting_user_input';
    if (toolPart.status === 'done' && !isAwaitingUserInput) continue;

    toolPart.status = 'done';
    toolPart.result = {
      toolName: toolPart.toolName,
      status: 'failure',
      error: { code: 'EXECUTION_FAILED', message: error.message }
    } satisfies AIToolExecutionFailureResult;
    delete toolPart.activity;
    delete toolPart.inputText;
    hasFailedToolPart = true;
  }

  return hasFailedToolPart;
}

/**
 * 将 assistant 草稿标记为失败终态。
 * @param message - assistant 草稿消息
 * @param error - runtime 错误
 */
export function markAssistantMessageFailed(message: ChatMessageRecord, error: AIServiceError): void {
  const hasFailedToolPart = failPendingToolParts(message, error);

  message.content = message.content ? `${message.content}\n${error.message}` : error.message;
  if (!hasFailedToolPart) {
    message.parts.push({ id: nanoid(), type: 'error', text: error.message });
  }
  message.loading = false;
  message.finished = true;
}

/**
 * 将未完成工具片段标记为已取消。
 * @param message - assistant 草稿消息
 */
export function finalizeToolPartsAsCancelled(message: ChatMessageRecord): void {
  for (const part of message.parts) {
    if (part.type !== 'tool') continue;

    const toolPart = part as ChatMessageToolPart;
    const isAwaitingUserInput = toolPart.result?.status === 'awaiting_user_input';
    if (toolPart.status === 'done' && !isAwaitingUserInput) continue;

    toolPart.status = 'done';
    toolPart.result = {
      toolName: toolPart.toolName,
      status: 'cancelled',
      error: { code: 'USER_CANCELLED', message: '用户中止了操作' }
    } satisfies AIToolExecutionCancelledResult;
    delete toolPart.activity;
    delete toolPart.inputText;
  }
}

/**
 * 将 assistant 草稿标记为中断后的稳定终态。
 * @param message - assistant 草稿消息
 */
export function finishAssistantMessageInterrupted(message: ChatMessageRecord): void {
  finalizeToolPartsAsCancelled(message);
  message.loading = false;
  message.finished = true;
}

/**
 * 判断 assistant 草稿是否已有可保留的模型响应。
 * @param message - assistant 草稿消息
 * @returns 是否已有模型输出内容
 */
export function hasAssistantResponseContent(message: ChatMessageRecord): boolean {
  return Boolean(message.content.trim() || message.thinking?.trim() || message.parts.length > 0);
}
