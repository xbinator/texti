/**
 * @file chat.ts
 * @description 聊天会话与消息状态管理
 */
import type { ChatMessageRecord, ChatSession, ChatSessionType } from 'types/chat';
import type { AIUsage } from 'types/ai';
import { defineStore } from 'pinia';
import { nanoid } from 'nanoid';
import { isPersistableMessage, type PersistableMessage } from '@/components/BChat/message';
import type { Message } from '@/components/BChat/types';
import { chatStorage } from '@/shared/storage';

/**
 * 将组件消息转换为聊天记录
 * @param sessionId - 会话 ID
 * @param message - 可持久化的组件消息
 * @returns 可写入存储层的聊天消息记录
 */
function toRecordMessage(sessionId: string, message: PersistableMessage): ChatMessageRecord {
  const { id, role, content, thinking, files, usage, createdAt = new Date().toISOString() } = message;

  return { sessionId, id, role, content, thinking, files, usage, createdAt };
}

/**
 * 累加消息列表中的 Token 使用统计
 * @param messages - 当前会话保留的消息列表
 * @returns 累计后的 Token 使用统计，没有 usage 时返回 undefined
 */
function sumMessagesUsage(messages: PersistableMessage[]): AIUsage | undefined {
  const usageList = messages.map((message) => message.usage).filter((usage): usage is AIUsage => usage !== undefined);

  if (!usageList.length) return undefined;

  return usageList.reduce<AIUsage>(
    (total, usage) => ({
      inputTokens: total.inputTokens + usage.inputTokens,
      outputTokens: total.outputTokens + usage.outputTokens,
      totalTokens: total.totalTokens + usage.totalTokens
    }),
    { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
  );
}

export const useChatStore = defineStore('chat', {
  actions: {
    async getSessionMessages(sessionId: string): Promise<Message[]> {
      const messages = await chatStorage.getMessages(sessionId);

      return messages.map((message) => ({ ...message, finished: true }));
    },

    getSessions(type: ChatSessionType): Promise<ChatSession[]> {
      return chatStorage.getSessionsByType(type);
    },

    async createSession(type: ChatSessionType, { title = '新对话' }: { title?: string } = {}): Promise<ChatSession> {
      const now = new Date().toISOString();
      const session: ChatSession = { id: nanoid(), type, title, createdAt: now, updatedAt: now, lastMessageAt: now };

      await chatStorage.createSession(session);

      return session;
    },

    async addSessionMessage(sessionId: string | null, message: Message): Promise<void> {
      if (!sessionId) return;
      if (!isPersistableMessage(message)) return;

      const record = toRecordMessage(sessionId, message);

      await chatStorage.addMessage(record);
      await chatStorage.updateSessionLastMessageAt(sessionId, record.createdAt);
      if (record.usage) {
        await chatStorage.addSessionUsage(sessionId, record.usage);
      }
    },

    async setSessionMessages(sessionId: string | null, messages: Message[]): Promise<void> {
      if (!sessionId) return;

      const persistableMessages = messages.filter(isPersistableMessage);
      const records = persistableMessages.map((message) => toRecordMessage(sessionId, message));

      await chatStorage.setSessionMessages(sessionId, records);
      await chatStorage.updateSessionUsage(sessionId, sumMessagesUsage(persistableMessages));
    },

    async deleteSession(sessionId: string): Promise<void> {
      await chatStorage.deleteSession(sessionId);
    }
  }
});
