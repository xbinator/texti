/**
 * @file message.ts
 * @description BChat 消息创建、转换与持久化过滤工具
 */
import type { Message } from './types';
import type { ModelMessage } from 'ai';
import type { ChatMessageRole } from 'types/chat';
import { nanoid } from 'nanoid';

/**
 * 可发送给模型的聊天消息
 */
export type ModelCompatibleMessage = Message & { role: Extract<ChatMessageRole, 'user' | 'assistant'> };

/**
 * 可保存到聊天记录的数据消息
 */
export type PersistableMessage = Message & { role: ChatMessageRole };

/**
 * 判断消息是否可传给模型
 * @param message - 待判断的聊天消息
 * @returns 是否为用户或助手消息
 */
export function isModelMessage(message: Message): message is ModelCompatibleMessage {
  return message.role === 'user' || message.role === 'assistant';
}

/**
 * 判断消息是否可持久化
 * @param message - 待判断的聊天消息
 * @returns 是否为聊天记录支持的消息角色
 */
export function isPersistableMessage(message: Message): message is PersistableMessage {
  return message.role === 'user' || message.role === 'assistant' || message.role === 'error';
}

/**
 * 将组件消息转换为 AI SDK 的 ModelMessage 格式
 * @param sourceMessages - 组件内部消息列表
 * @returns AI SDK 兼容的消息格式
 */
export function toModelMessages(sourceMessages: Message[]): ModelMessage[] {
  return sourceMessages.filter(isModelMessage).map((item) => ({ role: item.role, content: item.content }));
}

/**
 * 创建 assistant 消息占位符
 * @returns 空的 assistant 消息对象
 */
export function createAssistantPlaceholder(): Message {
  return { id: nanoid(), role: 'assistant', content: '', thinking: '', createdAt: '', loading: true };
}

/**
 * 创建错误消息
 * @param content - 错误说明文案
 * @returns 可展示在聊天视图中的错误消息
 */
export function createErrorMessage(content: string): Message {
  return { id: nanoid(), role: 'error', content, createdAt: new Date().toISOString(), loading: false, finished: true };
}
