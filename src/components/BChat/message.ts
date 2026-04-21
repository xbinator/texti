/**
 * @file message.ts
 * @description BChat 消息创建、转换与持久化过滤工具。
 */
import type { Message, MessageToolCall } from './types';
import type { ModelMessage } from 'ai';
import type { ChatMessageRole } from 'types/chat';
import { nanoid } from 'nanoid';

/**
 * 可传给模型的消息
 */
export type ModelCompatibleMessage = Message & { role: Extract<ChatMessageRole, 'user' | 'assistant'> };

/**
 * 可持久化的消息
 */
export type PersistableMessage = Message & { role: ChatMessageRole };

/**
 * 判断消息是否可传给模型
 * @param message - 待判断的消息
 */
export function isModelMessage(message: Message): message is ModelCompatibleMessage {
  return message.role === 'user' || message.role === 'assistant';
}

/**
 * 判断消息是否可持久化
 * @param message - 待判断的消息
 */
export function isPersistableMessage(message: Message): message is PersistableMessage {
  return message.role === 'user' || message.role === 'assistant' || message.role === 'error';
}

/**
 * 判断 assistant 消息是否仍可视为空占位
 * @param message - 待判断的消息
 */
export function isRemovableAssistantPlaceholder(message: Message | undefined): boolean {
  if (!message || message.role !== 'assistant') {
    return false;
  }

  return !message.content && !message.usage && !message.toolCalls?.length;
}

/**
 * 将 assistant 工具调用记录转换为 AI SDK 所需的内容片段
 * @param toolCalls - 工具调用记录
 */
function toAssistantToolCallParts(toolCalls: MessageToolCall[]): {
  type: 'tool-call';
  toolCallId: string;
  toolName: string;
  input: unknown;
}[] {
  return toolCalls.map((item) => ({
    type: 'tool-call',
    toolCallId: item.toolCallId,
    toolName: item.toolName,
    input: item.input
  }));
}

/**
 * 将组件消息转换为 AI SDK 的 ModelMessage
 * @param sourceMessages - 组件内部消息
 */
export function toModelMessages(sourceMessages: Message[]): ModelMessage[] {
  return sourceMessages.filter(isModelMessage).map((item) => {
    if (item.role !== 'assistant' || !item.toolCalls?.length) {
      return { role: item.role, content: item.content };
    }

    const contentParts = [
      ...(item.content ? [{ type: 'text' as const, text: item.content }] : []),
      ...toAssistantToolCallParts(item.toolCalls)
    ];

    return { role: item.role, content: contentParts };
  });
}

/**
 * 创建 assistant 占位消息
 */
export function createAssistantPlaceholder(): Message {
  return { id: nanoid(), role: 'assistant', content: '', thinking: '', createdAt: '', loading: true };
}

/**
 * 创建错误消息
 * @param content - 错误说明
 */
export function createErrorMessage(content: string): Message {
  return { id: nanoid(), role: 'error', content, createdAt: new Date().toISOString(), loading: false, finished: true };
}
