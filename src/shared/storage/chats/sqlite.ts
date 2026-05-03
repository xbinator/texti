/**
 * @file sqlite.ts
 * @description 聊天会话与消息的 SQLite/本地降级存储实现
 */
import type { AIUsage } from 'types/ai';
import type {
  ChatMessageFile,
  ChatMessageFileReference,
  ChatMessageHistoryCursor,
  ChatMessagePart,
  ChatMessageRecord,
  ChatMessageRole,
  ChatSession,
  ChatSessionType,
  PaginatedSessionsResult,
  SessionCursor,
  SessionPaginationParams
} from 'types/chat';
import { local } from '@/shared/storage/base';
import { dbSelect, dbExecute, isDatabaseAvailable, parseJson, stringifyJson } from '../utils';

const CHAT_SESSIONS_STORAGE_KEY = 'chat_sessions_fallback';
const CHAT_MESSAGES_STORAGE_KEY = 'chat_messages_fallback';
const CHAT_MESSAGE_HISTORY_LIMIT = 30;

const SELECT_SESSIONS_BY_TYPE_SQL = `
  SELECT id, type, title, created_at, updated_at, last_message_at, usage_json
  FROM chat_sessions
  WHERE type = ?
  ORDER BY last_message_at DESC, updated_at DESC, created_at DESC
  LIMIT ?
`;
const SELECT_SESSIONS_BY_CURSOR_SQL = `
  SELECT id, type, title, created_at, updated_at, last_message_at, usage_json
  FROM chat_sessions
  WHERE type = ?
    AND (last_message_at < ? OR (last_message_at = ? AND created_at < ?))
  ORDER BY last_message_at DESC, updated_at DESC, created_at DESC
  LIMIT ?
`;
const UPSERT_SESSION_SQL = `
  INSERT OR REPLACE INTO chat_sessions
    (id, type, title, created_at, updated_at, last_message_at, usage_json)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`;
const UPDATE_SESSION_LAST_MESSAGE_AT_SQL = `
  UPDATE chat_sessions
  SET last_message_at = ?
  WHERE id = ?
`;
const UPDATE_SESSION_TITLE_SQL = `
  UPDATE chat_sessions
  SET title = ?, updated_at = ?
  WHERE id = ?
`;
const SELECT_SESSION_USAGE_SQL = 'SELECT usage_json FROM chat_sessions WHERE id = ?';
const UPDATE_SESSION_USAGE_SQL = 'UPDATE chat_sessions SET usage_json = ? WHERE id = ?';

const SELECT_MESSAGES_BY_SESSION_SQL = `
  SELECT id, session_id, role, content, parts_json, references_json, thinking, files_json, usage_json, created_at
  FROM chat_messages
  WHERE session_id = ?
  ORDER BY created_at DESC, id DESC
  LIMIT ?
`;
const SELECT_MESSAGES_BEFORE_CURSOR_SQL = `
  SELECT id, session_id, role, content, parts_json, references_json, thinking, files_json, usage_json, created_at
  FROM chat_messages
  WHERE session_id = ?
    AND (created_at < ? OR (created_at = ? AND id < ?))
  ORDER BY created_at DESC, id DESC
  LIMIT ?
`;
const UPSERT_MESSAGE_SQL = `
  INSERT OR REPLACE INTO chat_messages
    (id, session_id, role, content, parts_json, references_json, thinking, files_json, usage_json, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
  usage_json: string | null;
}

interface ChatMessageRow {
  id: string;
  session_id: string;
  role: string;
  content: string;
  parts_json: string | null;
  references_json: string | null;
  thinking: string | null;
  files_json: string | null;
  usage_json: string | null;
  created_at: string;
}

interface FallbackMessagesMap {
  [sessionId: string]: ChatMessageRecord[] | undefined;
}

interface ChatSessionUsageRow {
  usage_json: string | null;
}

function isChatSessionType(value: string): value is ChatSessionType {
  return ['chat', 'document', 'assistant', 'workflow'].includes(value);
}

/**
 * 判断数据库角色字段是否为支持的聊天消息角色
 * @param value - 数据库读取到的角色字段
 * @returns 是否为有效聊天消息角色
 */
function isChatMessageRole(value: string): value is ChatMessageRole {
  return value === 'user' || value === 'assistant' || value === 'error';
}

function mapSessionRow(row: ChatSessionRow): ChatSession | null {
  if (!isChatSessionType(row.type)) return null;

  return {
    id: row.id,
    type: row.type,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastMessageAt: row.last_message_at,
    usage: parseJson<AIUsage>(row.usage_json)
  };
}

/**
 * 将 SQLite 消息行映射为共享聊天消息记录格式
 * @param row - 原始 SQLite 消息行
 * @returns 标准化的聊天消息记录
 */
function mapMessageRow(row: ChatMessageRow): ChatMessageRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: isChatMessageRole(row.role) ? row.role : 'user',
    content: row.content,
    parts: parseJson<ChatMessagePart[]>(row.parts_json) ?? [],
    references: parseJson<ChatMessageFileReference[]>(row.references_json),
    thinking: row.thinking ?? undefined,
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

/**
 * 按消息创建时间和 ID 排序，保证同时间戳消息的顺序稳定。
 * @param messages - 待排序消息
 * @returns 按时间正序排列的消息
 */
function sortMessages(messages: ChatMessageRecord[]): ChatMessageRecord[] {
  return [...messages].sort((left, right) => {
    if (left.createdAt !== right.createdAt) return left.createdAt.localeCompare(right.createdAt);
    return left.id.localeCompare(right.id);
  });
}

/**
 * 判断消息是否位于历史游标之前。
 * @param message - 待判断消息
 * @param cursor - 历史加载游标
 * @returns 消息是否早于游标边界
 */
function isBeforeHistoryCursor(message: ChatMessageRecord, cursor: ChatMessageHistoryCursor): boolean {
  if (message.createdAt !== cursor.beforeCreatedAt) {
    return message.createdAt < cursor.beforeCreatedAt;
  }

  return message.id < cursor.beforeId;
}

/**
 * 截取指定游标之前的一段历史消息。
 * @param messages - 完整消息列表
 * @param cursor - 历史加载游标
 * @returns 按时间正序排列的消息片段
 */
function sliceMessagesByCursor(messages: ChatMessageRecord[], cursor?: ChatMessageHistoryCursor): ChatMessageRecord[] {
  const sortedMessages = sortMessages(messages);
  const filteredMessages = cursor ? sortedMessages.filter((message) => isBeforeHistoryCursor(message, cursor)) : sortedMessages;

  return filteredMessages.slice(-CHAT_MESSAGE_HISTORY_LIMIT);
}

/**
 * 累加两段 Token 使用统计
 * @param currentUsage - 当前会话已记录的 Token 使用统计
 * @param nextUsage - 本次消息新增的 Token 使用统计
 * @returns 累加后的 Token 使用统计
 */
function addUsage(currentUsage: AIUsage | undefined, nextUsage: AIUsage): AIUsage {
  return {
    inputTokens: (currentUsage?.inputTokens ?? 0) + nextUsage.inputTokens,
    outputTokens: (currentUsage?.outputTokens ?? 0) + nextUsage.outputTokens,
    totalTokens: (currentUsage?.totalTokens ?? 0) + nextUsage.totalTokens
  };
}

async function upsertSessionMessages(messages: ChatMessageRecord[]): Promise<void> {
  await Promise.all(
    messages.map((message) =>
      dbExecute(UPSERT_MESSAGE_SQL, [
        message.id,
        message.sessionId,
        message.role,
        message.content,
        stringifyJson(message.parts),
        stringifyJson(message.references),
        message.thinking ?? null,
        stringifyJson(message.files),
        stringifyJson(message.usage),
        message.createdAt
      ])
    )
  );
}

export const chatStorage = {
  async getSessionsByType(type: ChatSessionType, pagination?: SessionPaginationParams): Promise<PaginatedSessionsResult> {
    const limit = pagination?.limit ?? 20;
    const cursor = pagination?.cursor;

    if (!isDatabaseAvailable()) {
      const allSessions = sortSessions(loadFallbackSessions().filter((item) => item.type === type));
      return this.paginateFallbackSessions(allSessions, limit, cursor);
    }

    let rows: ChatSessionRow[];

    if (!cursor) {
      rows = await dbSelect<ChatSessionRow>(SELECT_SESSIONS_BY_TYPE_SQL, [type, limit]);
    } else {
      rows = await dbSelect<ChatSessionRow>(SELECT_SESSIONS_BY_CURSOR_SQL, [type, cursor.lastMessageAt, cursor.lastMessageAt, cursor.createdAt, limit]);
    }

    const items = rows.map(mapSessionRow).filter((item): item is ChatSession => item !== null);

    return this.buildPaginatedResult(items, limit);
  },

  /**
   * 对降级存储的会话列表进行游标分页截取
   * @param allSessions - 已排序的完整会话列表
   * @param limit - 每页数量
   * @param cursor - 游标（可选）
   * @returns 分页结果
   */
  paginateFallbackSessions(allSessions: ChatSession[], limit: number, cursor?: SessionCursor): PaginatedSessionsResult {
    let startIndex = 0;

    if (cursor) {
      startIndex = allSessions.findIndex(
        (session) => session.lastMessageAt < cursor.lastMessageAt || (session.lastMessageAt === cursor.lastMessageAt && session.createdAt < cursor.createdAt)
      );
      if (startIndex === -1) {
        return { items: [], hasMore: false };
      }
    }

    const items = allSessions.slice(startIndex, startIndex + limit);

    return this.buildPaginatedResult(items, limit);
  },

  /**
   * 根据当前页数据构建分页结果，计算是否有更多数据及下一页游标
   * @param items - 当前页数据
   * @param limit - 每页数量
   * @returns 分页结果
   */
  buildPaginatedResult(items: ChatSession[], limit: number): PaginatedSessionsResult {
    const hasMore = items.length === limit;

    let nextCursor: SessionCursor | undefined;
    if (hasMore && items.length > 0) {
      const lastItem = items[items.length - 1];
      nextCursor = {
        lastMessageAt: lastItem.lastMessageAt,
        createdAt: lastItem.createdAt
      };
    }

    return { items, hasMore, nextCursor };
  },

  async createSession(session: ChatSession): Promise<void> {
    if (!isDatabaseAvailable()) {
      const sessions = loadFallbackSessions().filter((item) => item.id !== session.id);
      sessions.unshift(session);
      saveFallbackSessions(sortSessions(sessions));
      return;
    }

    await dbExecute(UPSERT_SESSION_SQL, [
      session.id,
      session.type,
      session.title,
      session.createdAt,
      session.updatedAt,
      session.lastMessageAt,
      stringifyJson(session.usage)
    ]);
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

  /**
   * 仅更新会话标题与标题变更时间，避免覆盖排序和 usage 等会话元数据。
   * @param sessionId - 目标会话 ID。
   * @param title - 新的会话标题。
   */
  async updateSessionTitle(sessionId: string, title: string): Promise<void> {
    if (!isDatabaseAvailable()) {
      const sessions = loadFallbackSessions();
      const index = sessions.findIndex((item) => item.id === sessionId);
      if (index === -1) return;

      sessions[index] = { ...sessions[index], title, updatedAt: new Date().toISOString() };
      saveFallbackSessions(sortSessions(sessions));
      return;
    }

    await dbExecute(UPDATE_SESSION_TITLE_SQL, [title, new Date().toISOString(), sessionId]);
  },

  async addSessionUsage(sessionId: string, usage: AIUsage): Promise<void> {
    if (!isDatabaseAvailable()) {
      const sessions = loadFallbackSessions();
      const index = sessions.findIndex((item) => item.id === sessionId);
      if (index === -1) return;

      sessions[index] = { ...sessions[index], usage: addUsage(sessions[index].usage, usage) };
      saveFallbackSessions(sortSessions(sessions));
      return;
    }

    const rows = await dbSelect<ChatSessionUsageRow>(SELECT_SESSION_USAGE_SQL, [sessionId]);
    const currentUsage = parseJson<AIUsage>(rows[0]?.usage_json ?? null);

    await dbExecute(UPDATE_SESSION_USAGE_SQL, [stringifyJson(addUsage(currentUsage, usage)), sessionId]);
  },

  /**
   * 读取会话累计用量，供侧边栏用量面板直接消费持久化结果。
   * @param sessionId - 目标会话 ID。
   * @returns 会话累计 Token 用量，不存在时返回 undefined。
   */
  async getSessionUsage(sessionId: string): Promise<AIUsage | undefined> {
    if (!isDatabaseAvailable()) {
      return loadFallbackSessions().find((item) => item.id === sessionId)?.usage;
    }

    const rows = await dbSelect<ChatSessionUsageRow>(SELECT_SESSION_USAGE_SQL, [sessionId]);
    return parseJson<AIUsage>(rows[0]?.usage_json ?? null);
  },

  async updateSessionUsage(sessionId: string, usage: AIUsage | undefined): Promise<void> {
    if (!isDatabaseAvailable()) {
      const sessions = loadFallbackSessions();
      const index = sessions.findIndex((item) => item.id === sessionId);
      if (index === -1) return;

      sessions[index] = { ...sessions[index], usage };
      saveFallbackSessions(sortSessions(sessions));
      return;
    }

    await dbExecute(UPDATE_SESSION_USAGE_SQL, [stringifyJson(usage), sessionId]);
  },

  async getMessages(sessionId: string, cursor?: ChatMessageHistoryCursor): Promise<ChatMessageRecord[]> {
    if (!isDatabaseAvailable()) {
      const messages = loadFallbackMessages()[sessionId] ?? [];
      return sliceMessagesByCursor(messages, cursor);
    }

    const rows = cursor
      ? await dbSelect<ChatMessageRow>(SELECT_MESSAGES_BEFORE_CURSOR_SQL, [
          sessionId,
          cursor.beforeCreatedAt,
          cursor.beforeCreatedAt,
          cursor.beforeId,
          CHAT_MESSAGE_HISTORY_LIMIT
        ])
      : await dbSelect<ChatMessageRow>(SELECT_MESSAGES_BY_SESSION_SQL, [sessionId, CHAT_MESSAGE_HISTORY_LIMIT]);

    return sortMessages(rows.map(mapMessageRow));
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
      stringifyJson(message.parts),
      stringifyJson(message.references),
      message.thinking ?? null,
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
