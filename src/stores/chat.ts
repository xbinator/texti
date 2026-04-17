import type { ChatMessageRecord, ChatSession, ChatSessionType } from 'types/chat';
import { defineStore } from 'pinia';
import { nanoid } from 'nanoid';
import type { Message } from '@/components/BChat/types';
import { chatStorage } from '@/shared/storage';

function toRecordMessage(sessionId: string, message: Message): ChatMessageRecord {
  const { id, role, content, files, usage, createdAt = new Date().toISOString() } = message;

  return { sessionId, id, role, content, files, usage, createdAt };
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

      const record = toRecordMessage(sessionId, message);

      await chatStorage.addMessage(record);
      await chatStorage.updateSessionLastMessageAt(sessionId, record.createdAt);
    },

    async setSessionMessages(sessionId: string | null, messages: Message[]): Promise<void> {
      if (!sessionId) return;

      const records = messages.map((message) => toRecordMessage(sessionId, message));

      await chatStorage.setSessionMessages(sessionId, records);
    },

    async deleteSession(sessionId: string): Promise<void> {
      await chatStorage.deleteSession(sessionId);
    }
  }
});
