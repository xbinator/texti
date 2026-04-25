/**
 * @file chat.ts
 * @description 聊天会话与消息状态管理
 */
import type { AIUsage } from 'types/ai';
import type { ChatMessageHistoryCursor, ChatMessageRecord, ChatSession, ChatSessionType } from 'types/chat';
import { defineStore } from 'pinia';
import { nanoid } from 'nanoid';
import { is, type PersistableMessage } from '@/components/BChatSidebar/utils/message';
import type { Message } from '@/components/BChatSidebar/utils/types';
import { chatStorage } from '@/shared/storage';

/**
 * 将组件消息转换为聊天记录
 * @param sessionId - 会话 ID
 * @param message - 可持久化的组件消息
 * @returns 可写入存储层的聊天消息记录
 */
function toRecordMessage(sessionId: string, message: PersistableMessage): ChatMessageRecord {
  const { id, role, content, parts, references, thinking, files, usage, createdAt = new Date().toISOString() } = message;

  return { sessionId, id, role, content, parts, references, thinking, files, usage, createdAt };
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
    /**
     * 读取会话消息，未传游标时返回最新一段，传游标时返回更早历史。
     * @param sessionId - 会话 ID
     * @param cursor - 历史加载游标
     * @returns 已补齐完成状态的组件消息
     */
    async getSessionMessages(sessionId: string, cursor?: ChatMessageHistoryCursor): Promise<Message[]> {
      const messages = await chatStorage.getMessages(sessionId, cursor);

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
      if (!is.persistableMessage(message)) return;

      const record = toRecordMessage(sessionId, message);

      await chatStorage.addMessage(record);
      await chatStorage.updateSessionLastMessageAt(sessionId, record.createdAt);
      if (record.usage) {
        await chatStorage.addSessionUsage(sessionId, record.usage);
      }
    },

    async setSessionMessages(sessionId: string | null, messages: Message[]): Promise<void> {
      if (!sessionId) return;

      const persistableMessages = messages.filter(is.persistableMessage);
      const records = persistableMessages.map((message) => toRecordMessage(sessionId, message));

      await chatStorage.setSessionMessages(sessionId, records);
      await chatStorage.updateSessionUsage(sessionId, sumMessagesUsage(persistableMessages));
    },

    async deleteSession(sessionId: string): Promise<void> {
      await chatStorage.deleteSession(sessionId);
    }
  }
});
