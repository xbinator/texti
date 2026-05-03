/**
 * @file chat.ts
 * @description 聊天会话和消息持久化存储。
 */
import type { AIUsage } from 'types/ai';
import type { ChatMessageHistoryCursor, ChatMessageRecord, ChatSession, ChatSessionType, PaginatedSessionsResult, SessionPaginationParams } from 'types/chat';
import { defineStore } from 'pinia';
import { nanoid } from 'nanoid';
import { is, type PersistableMessage } from '@/components/BChatSidebar/utils/messageHelper';
import type { Message } from '@/components/BChatSidebar/utils/types';
import { chatStorage } from '@/shared/storage';

/**
 * 将可持久化的侧边栏消息转换为存储记录。
 * @param sessionId - 目标聊天会话 ID。
 * @param message - 可持久化的消息数据。
 * @returns 可存储的聊天消息记录。
 */
function toRecordMessage(sessionId: string, message: PersistableMessage): ChatMessageRecord {
  const { id, role, content, parts, thinking, files, usage, createdAt = new Date().toISOString() } = message;

  return { sessionId, id, role, content, parts, thinking, files, usage, createdAt };
}

/**
 * 汇总可持久化消息的使用量。
 * @param messages - 要汇总的已持久化消息列表。
 * @returns 汇总后的使用量总计，如果没有使用量则返回 undefined。
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
     * 加载会话的聊天消息，可选择使用历史游标。
     * @param sessionId - 要加载的会话 ID。
     * @param cursor - 可选的历史游标。
     * @returns 已完成的聊天消息，可直接用于 UI 展示。
     */
    async getSessionMessages(sessionId: string, cursor?: ChatMessageHistoryCursor): Promise<Message[]> {
      const messages = await chatStorage.getMessages(sessionId, cursor);

      return messages.map((message) => ({ ...message, finished: true }));
    },

    /**
     * 按类型加载会话，用于历史导航，支持基于游标的分页。
     * @param type - 会话类型过滤器。
     * @param pagination - 可选的分页参数，用于基于游标的加载。
     * @returns 分页会话结果，包含会话列表、是否有更多数据标志和下一个游标。
     */
    getSessions(type: ChatSessionType, pagination?: SessionPaginationParams): Promise<PaginatedSessionsResult> {
      return chatStorage.getSessionsByType(type, pagination);
    },

    /**
     * 读取单个会话的已持久化使用量。
     * @param sessionId - 要查看的会话 ID。
     * @returns 已持久化的使用量总计，如果会话没有使用量则返回 undefined。
     */
    getSessionUsage(sessionId: string): Promise<AIUsage | undefined> {
      return chatStorage.getSessionUsage(sessionId);
    },

    /**
     * 创建新的聊天会话并立即持久化。
     * @param type - 要创建的会话类型。
     * @param options - 可选的会话元数据。
     * @returns 创建的会话记录。
     */
    async createSession(type: ChatSessionType, { title = '新会话' }: { title?: string } = {}): Promise<ChatSession> {
      const now = new Date().toISOString();
      const session: ChatSession = { id: nanoid(), type, title, createdAt: now, updatedAt: now, lastMessageAt: now };

      await chatStorage.createSession(session);

      return session;
    },

    /**
     * 持久化单条消息及其使用量元数据（如果可用）。
     * @param sessionId - 要更新的会话 ID。
     * @param message - 要持久化的消息。
     */
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

    /**
     * 替换会话的所有已持久化消息，并重新计算汇总使用量。
     * @param sessionId - 要更新的会话 ID。
     * @param messages - 要持久化的完整消息列表。
     */
    async setSessionMessages(sessionId: string | null, messages: Message[]): Promise<void> {
      if (!sessionId) return;

      const persistableMessages = messages.filter(is.persistableMessage);
      const records = persistableMessages.map((message) => toRecordMessage(sessionId, message));

      await chatStorage.setSessionMessages(sessionId, records);
      await chatStorage.updateSessionUsage(sessionId, sumMessagesUsage(persistableMessages));
    },

    /**
     * 仅更新会话标题，保持排序和使用量元数据不变。
     * @param sessionId - 要更新的会话 ID。
     * @param title - 新的会话标题。
     */
    async updateSessionTitle(sessionId: string, title: string): Promise<void> {
      await chatStorage.updateSessionTitle(sessionId, title);
    },

    /**
     * 删除会话及其已持久化的消息。
     * @param sessionId - 要删除的会话 ID。
     */
    async deleteSession(sessionId: string): Promise<void> {
      await chatStorage.deleteSession(sessionId);
    }
  }
});
