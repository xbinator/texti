import type { AIUsage } from 'types/ai';
import type { ChatMessageFile, ChatMessageRecord, ChatSession, ChatSessionType } from 'types/chat';
import { local } from '@/shared/storage/base';
import { dbSelect, dbExecute, isDatabaseAvailable, parseJson, stringifyJson } from '../utils';

const CHAT_SESSIONS_STORAGE_KEY = 'chat_sessions_fallback';
const CHAT_MESSAGES_STORAGE_KEY = 'chat_messages_fallback';

const SELECT_SESSIONS_BY_TYPE_SQL = `
  SELECT id, type, title, created_at, updated_at, last_message_at
  FROM chat_sessions
  WHERE type = ?
  ORDER BY last_message_at DESC, updated_at DESC, created_at DESC
`;
const UPSERT_SESSION_SQL = `
  INSERT OR REPLACE INTO chat_sessions
    (id, type, title, created_at, updated_at, last_message_at)
  VALUES (?, ?, ?, ?, ?, ?)
`;
const UPDATE_SESSION_LAST_MESSAGE_AT_SQL = `
  UPDATE chat_sessions
  SET last_message_at = ?
  WHERE id = ?
`;

const SELECT_MESSAGES_BY_SESSION_SQL = `
  SELECT id, session_id, role, content, files_json, usage_json, created_at
  FROM chat_messages
  WHERE session_id = ?
  ORDER BY created_at ASC
`;
const UPSERT_MESSAGE_SQL = `
  INSERT OR REPLACE INTO chat_messages
    (id, session_id, role, content, files_json, usage_json, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`;
const DELETE_SESSION_SQL = 'DELETE FROM chat_sessions WHERE id = ?';
const DELETE_MESSAGES_BY_SESSION_SQL = 'DELETE FROM chat_messages WHERE session_id = ?';

interface ChatSessionRow {
  id: string;
  type: string;
  title: string;
  created_at: string;
  updated_at: string;
  last_message_at: string;
}

interface ChatMessageRow {
  id: string;
  session_id: string;
  role: string;
  content: string;
  files_json: string | null;
  usage_json: string | null;
  created_at: string;
}

interface FallbackMessagesMap {
  [sessionId: string]: ChatMessageRecord[] | undefined;
}

function isChatSessionType(value: string): value is ChatSessionType {
  return ['chat', 'document', 'assistant', 'workflow'].includes(value);
}

function mapSessionRow(row: ChatSessionRow): ChatSession | null {
  if (!isChatSessionType(row.type)) return null;

  return {
    id: row.id,
    type: row.type,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastMessageAt: row.last_message_at
  };
}

function mapMessageRow(row: ChatMessageRow): ChatMessageRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role === 'assistant' ? 'assistant' : 'user',
    content: row.content,
    files: parseJson<ChatMessageFile[]>(row.files_json),
    usage: parseJson<AIUsage>(row.usage_json),
    createdAt: row.created_at
  };
}

function loadFallbackSessions(): ChatSession[] {
  return local.getItem<ChatSession[]>(CHAT_SESSIONS_STORAGE_KEY) ?? [];
}

function saveFallbackSessions(sessions: ChatSession[]): void {
  local.setItem(CHAT_SESSIONS_STORAGE_KEY, sessions);
}

function loadFallbackMessages(): FallbackMessagesMap {
  return local.getItem<FallbackMessagesMap>(CHAT_MESSAGES_STORAGE_KEY) ?? {};
}

function saveFallbackMessages(messages: FallbackMessagesMap): void {
  local.setItem(CHAT_MESSAGES_STORAGE_KEY, messages);
}

function sortSessions(sessions: ChatSession[]): ChatSession[] {
  return [...sessions].sort((left, right) => {
    if (right.lastMessageAt !== left.lastMessageAt) return right.lastMessageAt.localeCompare(left.lastMessageAt);
    if (right.updatedAt !== left.updatedAt) return right.updatedAt.localeCompare(left.updatedAt);
    return right.createdAt.localeCompare(left.createdAt);
  });
}

function sortMessages(messages: ChatMessageRecord[]): ChatMessageRecord[] {
  return [...messages].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

async function upsertSessionMessages(messages: ChatMessageRecord[]): Promise<void> {
  await Promise.all(
    messages.map((message) =>
      dbExecute(UPSERT_MESSAGE_SQL, [
        message.id,
        message.sessionId,
        message.role,
        message.content,
        stringifyJson(message.files),
        stringifyJson(message.usage),
        message.createdAt
      ])
    )
  );
}

export const chatStorage = {
  async getSessionsByType(type: ChatSessionType): Promise<ChatSession[]> {
    if (!isDatabaseAvailable()) {
      return sortSessions(loadFallbackSessions().filter((item) => item.type === type));
    }

    const rows = await dbSelect<ChatSessionRow>(SELECT_SESSIONS_BY_TYPE_SQL, [type]);
    return rows.map(mapSessionRow).filter((item): item is ChatSession => item !== null);
  },

  async createSession(session: ChatSession): Promise<void> {
    if (!isDatabaseAvailable()) {
      const sessions = loadFallbackSessions().filter((item) => item.id !== session.id);
      sessions.unshift(session);
      saveFallbackSessions(sortSessions(sessions));
      return;
    }

    await dbExecute(UPSERT_SESSION_SQL, [session.id, session.type, session.title, session.createdAt, session.updatedAt, session.lastMessageAt]);
  },

  async updateSessionLastMessageAt(sessionId: string, lastMessageAt: string): Promise<void> {
    if (!isDatabaseAvailable()) {
      const sessions = loadFallbackSessions();
      const index = sessions.findIndex((item) => item.id === sessionId);
      if (index === -1) return;

      sessions[index] = { ...sessions[index], lastMessageAt };
      saveFallbackSessions(sortSessions(sessions));
      return;
    }

    await dbExecute(UPDATE_SESSION_LAST_MESSAGE_AT_SQL, [lastMessageAt, sessionId]);
  },

  async getMessages(sessionId: string): Promise<ChatMessageRecord[]> {
    if (!isDatabaseAvailable()) {
      const messages = loadFallbackMessages()[sessionId] ?? [];
      return sortMessages(messages);
    }

    const rows = await dbSelect<ChatMessageRow>(SELECT_MESSAGES_BY_SESSION_SQL, [sessionId]);
    return rows.map(mapMessageRow);
  },

  async addMessage(message: ChatMessageRecord): Promise<void> {
    if (!isDatabaseAvailable()) {
      const messages = loadFallbackMessages();
      const sessionMessages = messages[message.sessionId] ?? [];
      sessionMessages.push(message);
      messages[message.sessionId] = sortMessages(sessionMessages);
      saveFallbackMessages(messages);
      return;
    }

    await dbExecute(UPSERT_MESSAGE_SQL, [
      message.id,
      message.sessionId,
      message.role,
      message.content,
      stringifyJson(message.files),
      stringifyJson(message.usage),
      message.createdAt
    ]);
  },

  async setSessionMessages(sessionId: string, messages: ChatMessageRecord[]): Promise<void> {
    if (!isDatabaseAvailable()) {
      const allMessages = loadFallbackMessages();
      allMessages[sessionId] = sortMessages(messages);
      saveFallbackMessages(allMessages);

      if (messages.length > 0) {
        await this.updateSessionLastMessageAt(sessionId, messages[messages.length - 1].createdAt);
      }

      return;
    }

    await dbExecute(DELETE_MESSAGES_BY_SESSION_SQL, [sessionId]);
    await upsertSessionMessages(messages);

    if (messages.length > 0) {
      await this.updateSessionLastMessageAt(sessionId, messages[messages.length - 1].createdAt);
    }
  },

  async deleteSession(sessionId: string): Promise<void> {
    if (!isDatabaseAvailable()) {
      const sessions = loadFallbackSessions().filter((item) => item.id !== sessionId);
      const messages = loadFallbackMessages();
      delete messages[sessionId];
      saveFallbackSessions(sessions);
      saveFallbackMessages(messages);
      return;
    }

    await dbExecute(DELETE_MESSAGES_BY_SESSION_SQL, [sessionId]);
    await dbExecute(DELETE_SESSION_SQL, [sessionId]);
  }
};
