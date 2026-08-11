/**
 * @file liveMessageProjection.ts
 * @description 无 Vue 依赖地预验证并应用 Assistant 实时追加 mutation。
 */
import type { Message } from '../utils/types';
import type { ChatMessagePart, ChatMessageToolPart } from 'types/chat';
import type { ChatRuntimeMessageMutation } from 'types/chat-runtime';

/**
 * 验证 mutation 的目标类型，保证整批增量不会只应用一半。
 * @param message - 当前 Renderer 消息
 * @param mutations - 待应用变更
 * @returns 所有目标都可安全追加时返回 true
 */
export function validateMutations(message: Message, mutations: ChatRuntimeMessageMutation[]): boolean {
  const createdPartTypes = new Map<string, Extract<ChatMessagePart['type'], 'text' | 'thinking'>>();
  for (const mutation of mutations) {
    if (mutation.kind === 'append-tool-input') {
      const toolPart = message.parts.find(
        (part: ChatMessagePart): part is ChatMessageToolPart => part.type === 'tool' && part.toolCallId === mutation.toolCallId
      );
      if (!toolPart) return false;
      continue;
    }

    const expectedType = mutation.kind === 'append-text' ? 'text' : 'thinking';
    const existingPart = message.parts.find((part: ChatMessagePart): boolean => part.id === mutation.partId);
    const createdType = createdPartTypes.get(mutation.partId);
    if ((existingPart && existingPart.type !== expectedType) || (createdType && createdType !== expectedType)) return false;
    if (!existingPart && !createdType) createdPartTypes.set(mutation.partId, expectedType);
  }
  return true;
}

/**
 * 把一个已验证追加 mutation 应用到目标消息。
 * @param message - 当前 Renderer 消息
 * @param mutation - 已验证变更
 */
function applyMutation(message: Message, mutation: ChatRuntimeMessageMutation): void {
  if (mutation.kind === 'append-tool-input') {
    const toolPart = message.parts.find(
      (part: ChatMessagePart): part is ChatMessageToolPart => part.type === 'tool' && part.toolCallId === mutation.toolCallId
    );
    if (toolPart) toolPart.inputText = `${toolPart.inputText ?? ''}${mutation.text}`;
    return;
  }

  if (mutation.kind === 'append-text') {
    const textPart = message.parts.find((part: ChatMessagePart): boolean => part.id === mutation.partId);
    if (textPart?.type === 'text') textPart.text += mutation.text;
    else message.parts.push({ id: mutation.partId, type: 'text', text: mutation.text });
    message.content = `${message.content}${mutation.text}`;
    return;
  }

  const thinkingPart = message.parts.find((part: ChatMessagePart): boolean => part.id === mutation.partId);
  if (thinkingPart?.type === 'thinking') thinkingPart.thinking += mutation.text;
  else message.parts.push({ id: mutation.partId, type: 'thinking', thinking: mutation.text });
  message.thinking = `${message.thinking ?? ''}${mutation.text}`;
}

/**
 * 按顺序应用一批已整体验证的追加 mutation。
 * @param message - 当前 Renderer 消息
 * @param mutations - 已验证变更
 */
export function applyMutations(message: Message, mutations: ChatRuntimeMessageMutation[]): void {
  mutations.forEach((mutation: ChatRuntimeMessageMutation): void => applyMutation(message, mutation));
}
