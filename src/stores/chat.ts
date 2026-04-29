/**
 * @file chat.ts
 * @description Chat session and message persistence store.
 */
import type { AIUsage } from 'types/ai';
import type { ChatMessageHistoryCursor, ChatMessageRecord, ChatSession, ChatSessionType } from 'types/chat';
import { defineStore } from 'pinia';
import { nanoid } from 'nanoid';
import { is, type PersistableMessage } from '@/components/BChatSidebar/utils/messageHelper';
import type { Message } from '@/components/BChatSidebar/utils/types';
import { chatStorage } from '@/shared/storage';

/**
 * Convert a persistable sidebar message into a storage record.
 * @param sessionId - Target chat session id.
 * @param message - Persistable message payload.
 * @returns Storage-ready chat message record.
 */
function toRecordMessage(sessionId: string, message: PersistableMessage): ChatMessageRecord {
  const { id, role, content, parts, references, thinking, files, usage, createdAt = new Date().toISOString() } = message;

  return { sessionId, id, role, content, parts, references, thinking, files, usage, createdAt };
}

/**
 * Sum usage values from a list of persistable messages.
 * @param messages - Persisted messages to aggregate.
 * @returns Aggregated usage totals, or undefined if no usage exists.
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
     * Load chat messages for a session, optionally using a history cursor.
     * @param sessionId - Session id to load.
     * @param cursor - Optional history cursor.
     * @returns Finished chat messages ready for the UI.
     */
    async getSessionMessages(sessionId: string, cursor?: ChatMessageHistoryCursor): Promise<Message[]> {
      const messages = await chatStorage.getMessages(sessionId, cursor);

      return messages.map((message) => ({ ...message, finished: true }));
    },

    /**
     * Load sessions by type for history navigation.
     * @param type - Session type filter.
     * @returns Matching chat sessions.
     */
    getSessions(type: ChatSessionType): Promise<ChatSession[]> {
      return chatStorage.getSessionsByType(type);
    },

    /**
     * Read the persisted usage for a single session.
     * @param sessionId - Session id to inspect.
     * @returns Persisted usage totals, or undefined if the session has none.
     */
    getSessionUsage(sessionId: string): Promise<AIUsage | undefined> {
      return chatStorage.getSessionUsage(sessionId);
    },

    /**
     * Create a new chat session and persist it immediately.
     * @param type - Session type to create.
     * @param options - Optional session metadata.
     * @returns Created session record.
     */
    async createSession(type: ChatSessionType, { title = '新会话' }: { title?: string } = {}): Promise<ChatSession> {
      const now = new Date().toISOString();
      const session: ChatSession = { id: nanoid(), type, title, createdAt: now, updatedAt: now, lastMessageAt: now };

      await chatStorage.createSession(session);

      return session;
    },

    /**
     * Persist a single message and its usage metadata when available.
     * @param sessionId - Session id to update.
     * @param message - Message to persist.
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
     * Replace all persisted messages for a session and recalculate aggregate usage.
     * @param sessionId - Session id to update.
     * @param messages - Complete message list to persist.
     */
    async setSessionMessages(sessionId: string | null, messages: Message[]): Promise<void> {
      if (!sessionId) return;

      const persistableMessages = messages.filter(is.persistableMessage);
      const records = persistableMessages.map((message) => toRecordMessage(sessionId, message));

      await chatStorage.setSessionMessages(sessionId, records);
      await chatStorage.updateSessionUsage(sessionId, sumMessagesUsage(persistableMessages));
    },

    /**
     * Update only a session title so ordering and usage metadata stay intact.
     * @param sessionId - Session id to update.
     * @param title - New session title.
     */
    async updateSessionTitle(sessionId: string, title: string): Promise<void> {
      await chatStorage.updateSessionTitle(sessionId, title);
    },

    /**
     * Delete a session and its persisted messages.
     * @param sessionId - Session id to delete.
     */
    async deleteSession(sessionId: string): Promise<void> {
      await chatStorage.deleteSession(sessionId);
    }
  }
});
