/**
 * @file service.mts
 * @description 主进程聊天会话管理器，封装会话与消息的全部持久化逻辑。
 */
import { realpathSync, statSync } from 'node:fs';
import type { AIUsage } from 'types/ai';
import type {
  ChatMessageFile,
  ChatMessageHistoryCursor,
  ChatMessagePart,
  ChatMessageRecord,
  ChatMessageRole,
  ChatSession,
  ChatSessionMetadata,
  ChatSessionModelMetadata,
  ChatSessionType,
  PaginatedSessionsResult,
  SessionCursor,
  SessionPaginationParams
} from 'types/chat';
import dayjs from 'dayjs';
import { nanoid } from 'nanoid';
import { dbExecute, dbSelect, transaction } from '../database/service.mjs';
import { createSessionBranchData, type SessionBranchData } from './runtime/branch.mjs';
import { removeInvalidCheckpoints } from './runtime/compaction/topology.mjs';
import { assertSessionHistoryWritable } from './runtime/infrastructure/locks.mjs';

// ==================== 常量 ====================

const CHAT_MESSAGE_HISTORY_LIMIT = 30;
const MESSAGE_ROLE_ORDER_SQL = `
  CASE role
    WHEN 'system' THEN 0
    WHEN 'user' THEN 1
    WHEN 'assistant' THEN 2
    WHEN 'interrupt' THEN 3
    WHEN 'error' THEN 4
    ELSE 1
  END
`;

// ==================== SQL — 会话 (10 条) ====================

const SELECT_SESSIONS_BY_TYPE_SQL = `
  SELECT id, type, title, created_at, updated_at, last_message_at, usage_json, metadata_json
  FROM chat_sessions
  WHERE type = ?
  ORDER BY last_message_at DESC, updated_at DESC, created_at DESC
  LIMIT ?
`;
const SELECT_SESSIONS_BY_CURSOR_SQL = `
  SELECT id, type, title, created_at, updated_at, last_message_at, usage_json, metadata_json
  FROM chat_sessions
  WHERE type = ?
    AND (last_message_at < ? OR (last_message_at = ? AND created_at < ?))
  ORDER BY last_message_at DESC, updated_at DESC, created_at DESC
  LIMIT ?
`;
const SELECT_SESSION_BY_ID_SQL = `
  SELECT id, type, title, created_at, updated_at, last_message_at, usage_json, metadata_json
  FROM chat_sessions
  WHERE id = ?
  LIMIT 1
`;
const UPSERT_SESSION_SQL = `
  INSERT OR REPLACE INTO chat_sessions
    (id, type, title, created_at, updated_at, last_message_at, usage_json, metadata_json)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`;
const INSERT_SESSION_SQL = `
  INSERT INTO chat_sessions
    (id, type, title, created_at, updated_at, last_message_at, usage_json, metadata_json)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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
const UPDATE_SESSION_METADATA_SQL = `
  UPDATE chat_sessions
  SET metadata_json = ?, updated_at = ?
  WHERE id = ?
`;
const SELECT_SESSION_USAGE_SQL = 'SELECT usage_json FROM chat_sessions WHERE id = ?';
const UPDATE_SESSION_USAGE_SQL = 'UPDATE chat_sessions SET usage_json = ? WHERE id = ?';
const SELECT_MESSAGE_USAGE_SQL = 'SELECT usage_json FROM chat_messages WHERE session_id = ? AND id = ?';

// ==================== SQL — 消息 (7 条) ====================

const SELECT_MESSAGES_BY_SESSION_SQL = `
  SELECT id, session_id, role, content, parts_json, thinking, files_json, usage_json, created_at, loading, finished,
         agent_id, runtime_id, parent_runtime_id
  FROM chat_messages
  WHERE session_id = ?
  ORDER BY created_at DESC, ${MESSAGE_ROLE_ORDER_SQL} DESC, id DESC
  LIMIT ?
`;
const SELECT_MESSAGES_BEFORE_CURSOR_SQL = `
  SELECT id, session_id, role, content, parts_json, thinking, files_json, usage_json, created_at, loading, finished,
         agent_id, runtime_id, parent_runtime_id
  FROM chat_messages
  WHERE session_id = ?
    AND (
      created_at < ?
      OR (
        created_at = ?
        AND (
          ${MESSAGE_ROLE_ORDER_SQL} < ?
          OR (${MESSAGE_ROLE_ORDER_SQL} = ? AND id < ?)
        )
      )
    )
  ORDER BY created_at DESC, ${MESSAGE_ROLE_ORDER_SQL} DESC, id DESC
  LIMIT ?
`;
const SELECT_ALL_MESSAGES_BY_SESSION_SQL = `
  SELECT id, session_id, role, content, parts_json, thinking, files_json, usage_json, created_at, loading, finished,
         agent_id, runtime_id, parent_runtime_id
  FROM chat_messages
  WHERE session_id = ?
`;
const SELECT_PENDING_RUNTIME_MESSAGES_SQL = `
  SELECT id, session_id, role, content, parts_json, thinking, files_json, usage_json, created_at, loading, finished,
         agent_id, runtime_id, parent_runtime_id
  FROM chat_messages
  WHERE (parts_json LIKE '%"type":"compaction"%' AND parts_json LIKE '%"status":"pending"%')
     OR (
       parts_json LIKE '%"type":"tool"%'
       AND (parts_json LIKE '%"status":"inputting"%' OR parts_json LIKE '%"status":"executing"%')
     )
`;
const UPSERT_MESSAGE_SQL = `
  INSERT OR REPLACE INTO chat_messages
    (id, session_id, role, content, parts_json, thinking, files_json, usage_json, created_at, loading, finished,
     agent_id, runtime_id, parent_runtime_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;
const INSERT_MESSAGE_SQL = `
  INSERT INTO chat_messages
    (id, session_id, role, content, parts_json, thinking, files_json, usage_json, created_at, loading, finished,
     agent_id, runtime_id, parent_runtime_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;
const DELETE_SESSION_SQL = 'DELETE FROM chat_sessions WHERE id = ?';
const DELETE_MESSAGES_BY_SESSION_SQL = 'DELETE FROM chat_messages WHERE session_id = ?';
const DELETE_MESSAGE_SQL = 'DELETE FROM chat_messages WHERE session_id = ? AND id = ?';

// ==================== Row 接口 ====================

interface ChatSessionRow {
  id: string;
  type: string;
  title: string;
  created_at: string;
  updated_at: string;
  last_message_at: string;
  usage_json: string | null;
  metadata_json: string | null;
}

interface ChatMessageRow {
  id: string;
  session_id: string;
  role: string;
  content: string;
  parts_json: string | null;
  thinking: string | null;
  files_json: string | null;
  usage_json: string | null;
  created_at: string;
  loading: number | null;
  finished: number | null;
  agent_id: string | null;
  runtime_id: string | null;
  parent_runtime_id: string | null;
}

interface ChatSessionUsageRow {
  usage_json: string | null;
}

/**
 * 严格 JSON 字段验证函数。
 */
type JsonValidator<T> = (value: unknown) => value is T;

// ==================== 工具函数 ====================

function parseJson<T>(json: string | null): T | undefined {
  if (!json) return undefined;
  try {
    return JSON.parse(json) as T;
  } catch {
    return undefined;
  }
}

/**
 * 严格解析分支源数据中的 JSON 字段，避免损坏数据被静默降级。
 * @param json - 数据库存储的 JSON
 * @param fieldName - 用于错误提示的字段名称
 * @param validator - 字段结构验证函数
 * @returns 解析后的字段；数据库值为空时返回 undefined
 */
function parseStrictJson<T>(json: string | null, fieldName: string, validator: JsonValidator<T>): T | undefined {
  if (json === null) return undefined;

  let value: unknown;
  try {
    value = JSON.parse(json) as unknown;
  } catch {
    throw new Error(`无法解析${fieldName}`);
  }
  if (!validator(value)) throw new Error(`${fieldName}格式无效`);
  return value;
}

/**
 * 判断未知值是否为普通记录对象。
 * @param value - 待判断值
 * @returns 是否为非空且非数组对象
 */
function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 判断未知值是否为有效的会话模型标识。
 * @param value - 待验证的元数据字段
 * @returns Provider 和模型标识均为非空字符串时返回 true
 */
function isSessionModelMetadata(value: unknown): value is ChatSessionModelMetadata {
  return (
    isRecordValue(value) &&
    typeof value.providerId === 'string' &&
    value.providerId.trim().length > 0 &&
    typeof value.modelId === 'string' &&
    value.modelId.trim().length > 0
  );
}

/**
 * 判断未知值是否为有效的会话工作区路径。
 * @param value - 待验证的元数据字段
 * @returns 非空字符串时返回 true
 */
function isSessionWorkspaceRoot(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * 规范化并验证将要写入会话元数据的工作区目录。
 * @param workspaceRoot - Renderer 传入的候选工作区路径
 * @returns 真实且存在的本地目录路径
 */
function normalizeWorkspaceRoot(workspaceRoot: unknown): string {
  if (!isSessionWorkspaceRoot(workspaceRoot)) throw new Error('会话工作区格式无效');

  try {
    const normalizedWorkspaceRoot = realpathSync(workspaceRoot.trim());
    if (!statSync(normalizedWorkspaceRoot).isDirectory()) throw new Error('工作区不是目录');
    return normalizedWorkspaceRoot;
  } catch {
    throw new Error('会话工作区不可用');
  }
}

/**
 * 规范化会话创建请求中的可选工作区元数据。
 * @param metadata - Renderer 传入的会话元数据
 * @returns 保留其他字段并规范化工作区后的元数据
 */
function normalizeSessionMetadata(metadata: ChatSessionMetadata | undefined): ChatSessionMetadata | undefined {
  if (!metadata || metadata.workspaceRoot === undefined) return metadata;
  return { ...metadata, workspaceRoot: normalizeWorkspaceRoot(metadata.workspaceRoot) };
}

/**
 * 防御性解析会话元数据，损坏的模型字段按缺失元数据处理。
 * @param json - 数据库存储的元数据 JSON
 * @returns 合法元数据；JSON 或模型结构无效时返回 undefined
 */
function parseSessionMetadata(json: string | null): ChatSessionMetadata | undefined {
  const value = parseJson<unknown>(json);
  if (!isRecordValue(value)) return undefined;
  if (value.model !== undefined && !isSessionModelMetadata(value.model)) return undefined;
  if (value.workspaceRoot !== undefined && !isSessionWorkspaceRoot(value.workspaceRoot)) return undefined;
  return value as ChatSessionMetadata;
}

/**
 * 当前版本支持的消息片段类型索引。
 * `satisfies` 保证 ChatMessagePart 新增类型时此处必须同步处理。
 */
const MESSAGE_PART_TYPES = {
  text: true,
  file: true,
  skill_reference: true,
  error: true,
  thinking: true,
  tool: true,
  widget_result: true,
  confirmation: true,
  compaction: true
} as const satisfies Record<ChatMessagePart['type'], true>;

/**
 * 判断消息片段类型是否受当前版本支持。
 * @param value - 待判断值
 * @returns 是否为合法消息片段类型
 */
function isMessagePartType(value: unknown): value is ChatMessagePart['type'] {
  return typeof value === 'string' && Object.hasOwn(MESSAGE_PART_TYPES, value);
}

/**
 * 判断未知值是否为可复制的消息片段数组。
 * @param value - 待判断值
 * @returns 是否为消息片段数组
 */
function isMessageParts(value: unknown): value is ChatMessagePart[] {
  return Array.isArray(value) && value.every((part: unknown): boolean => isRecordValue(part) && typeof part.id === 'string' && isMessagePartType(part.type));
}

/**
 * 判断未知值是否为消息附件数组。
 * @param value - 待判断值
 * @returns 是否为消息附件数组
 */
function isMessageFiles(value: unknown): value is ChatMessageFile[] {
  return (
    Array.isArray(value) &&
    value.every(
      (file: unknown): boolean => isRecordValue(file) && typeof file.id === 'string' && typeof file.name === 'string' && typeof file.type === 'string'
    )
  );
}

/**
 * 判断未知值是否为 Token 用量。
 * @param value - 待判断值
 * @returns 是否包含完整数值字段
 */
function isUsageValue(value: unknown): value is AIUsage {
  return isRecordValue(value) && typeof value.inputTokens === 'number' && typeof value.outputTokens === 'number' && typeof value.totalTokens === 'number';
}

function stringifyJson(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return JSON.stringify(value);
}

function isChatSessionType(value: string): value is ChatSessionType {
  return value === 'assistant';
}

function isChatMessageRole(value: string): value is ChatMessageRole {
  return value === 'user' || value === 'system' || value === 'assistant' || value === 'error' || value === 'interrupt';
}

function addUsage(currentUsage: AIUsage | undefined, nextUsage: AIUsage): AIUsage {
  return {
    inputTokens: (currentUsage?.inputTokens ?? 0) + nextUsage.inputTokens,
    outputTokens: (currentUsage?.outputTokens ?? 0) + nextUsage.outputTokens,
    totalTokens: (currentUsage?.totalTokens ?? 0) + nextUsage.totalTokens
  };
}

/**
 * 计算新旧消息用量之间的差量。
 * @param nextUsage - 即将写入消息的新用量。
 * @param previousUsage - 当前已持久化的旧用量。
 * @returns 需要累加到会话用量的差量。
 */
function subtractUsage(nextUsage: AIUsage, previousUsage: AIUsage | undefined): AIUsage {
  return {
    inputTokens: nextUsage.inputTokens - (previousUsage?.inputTokens ?? 0),
    outputTokens: nextUsage.outputTokens - (previousUsage?.outputTokens ?? 0),
    totalTokens: nextUsage.totalTokens - (previousUsage?.totalTokens ?? 0)
  };
}

/**
 * 判断用量差量是否会改变会话累计值。
 * @param usage - 用量差量。
 * @returns 差量不为零时返回 true。
 */
function hasUsageDelta(usage: AIUsage): boolean {
  return usage.inputTokens !== 0 || usage.outputTokens !== 0 || usage.totalTokens !== 0;
}

/**
 * 获取同一时间戳下的消息角色排序权重。
 * @param role - 消息角色
 * @returns 排序权重，数值越小越靠前
 */
function getMessageRoleOrder(role: ChatMessageRecord['role']): number {
  const roleOrder: Record<ChatMessageRecord['role'], number> = {
    system: 0,
    user: 1,
    assistant: 2,
    interrupt: 3,
    error: 4
  };

  return roleOrder[role];
}

/**
 * 按会话展示顺序排序消息。
 * @param messages - 待排序消息
 * @returns 已排序消息
 */
function sortMessages(messages: ChatMessageRecord[]): ChatMessageRecord[] {
  return [...messages].sort((left, right) => {
    if (left.createdAt !== right.createdAt) return left.createdAt.localeCompare(right.createdAt);
    const roleOrderDelta = getMessageRoleOrder(left.role) - getMessageRoleOrder(right.role);
    if (roleOrderDelta !== 0) return roleOrderDelta;
    return left.id.localeCompare(right.id);
  });
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
    usage: parseJson<AIUsage>(row.usage_json),
    metadata: parseSessionMetadata(row.metadata_json)
  };
}

function mapMessageRow(row: ChatMessageRow): ChatMessageRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: isChatMessageRole(row.role) ? row.role : 'user',
    content: row.content,
    parts: parseJson<ChatMessagePart[]>(row.parts_json) ?? [],
    thinking: row.thinking ?? undefined,
    files: parseJson<ChatMessageFile[]>(row.files_json),
    usage: parseJson<AIUsage>(row.usage_json),
    createdAt: row.created_at,
    loading: row.loading === null ? undefined : row.loading === 1,
    finished: row.finished === null ? undefined : row.finished === 1,
    agentId: row.agent_id ?? undefined,
    runtimeId: row.runtime_id ?? undefined,
    parentRuntimeId: row.parent_runtime_id ?? undefined
  };
}

/**
 * 严格映射创建分支所需的完整消息记录。
 * @param row - 数据库消息行
 * @returns 未丢失任何结构化字段的消息记录
 */
function mapBranchMessageRow(row: ChatMessageRow): ChatMessageRecord {
  if (!isChatMessageRole(row.role)) throw new Error(`消息 ${row.id} 的 role 无效`);

  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    content: row.content,
    parts: parseStrictJson(row.parts_json, `消息 ${row.id} 的 parts_json`, isMessageParts) ?? [],
    thinking: row.thinking ?? undefined,
    files: parseStrictJson(row.files_json, `消息 ${row.id} 的 files_json`, isMessageFiles),
    usage: parseStrictJson(row.usage_json, `消息 ${row.id} 的 usage_json`, isUsageValue),
    createdAt: row.created_at,
    loading: row.loading === null ? undefined : row.loading === 1,
    finished: row.finished === null ? undefined : row.finished === 1,
    agentId: row.agent_id ?? undefined,
    runtimeId: row.runtime_id ?? undefined,
    parentRuntimeId: row.parent_runtime_id ?? undefined
  };
}

/**
 * 将布尔值转换为 SQLite 布尔整型。
 * @param value - 可选布尔值。
 * @returns SQLite 可存储值。
 */
function toSqlBoolean(value: boolean | undefined): number | null {
  if (value === undefined) return null;
  return value ? 1 : 0;
}

/**
 * 构建消息 upsert SQL 参数。
 * @param message - 要写入的聊天消息。
 * @returns SQL 参数列表。
 */
function buildMessageUpsertParams(message: ChatMessageRecord): unknown[] {
  return [
    message.id,
    message.sessionId,
    message.role,
    message.content,
    stringifyJson(message.parts),
    message.thinking ?? null,
    stringifyJson(message.files),
    stringifyJson(message.usage),
    message.createdAt,
    toSqlBoolean(message.loading),
    toSqlBoolean(message.finished),
    message.agentId ?? null,
    message.runtimeId ?? null,
    message.parentRuntimeId ?? null
  ];
}

function buildPaginatedResult(items: ChatSession[], limit: number): PaginatedSessionsResult {
  const hasMore = items.length === limit;
  let nextCursor: SessionCursor | undefined;
  if (hasMore && items.length > 0) {
    const lastItem = items[items.length - 1];
    nextCursor = { lastMessageAt: lastItem.lastMessageAt, createdAt: lastItem.createdAt };
  }
  return { items, hasMore, nextCursor };
}

// ==================== ChatSessionManager ====================

class ChatSessionManager {
  // ======== Session ========

  getSessionsByType(type: ChatSessionType, pagination?: SessionPaginationParams): PaginatedSessionsResult {
    const limit = pagination?.limit ?? 20;
    const cursor = pagination?.cursor;

    let rows: ChatSessionRow[];
    if (!cursor) {
      rows = dbSelect<ChatSessionRow>(SELECT_SESSIONS_BY_TYPE_SQL, [type, limit]);
    } else {
      rows = dbSelect<ChatSessionRow>(SELECT_SESSIONS_BY_CURSOR_SQL, [type, cursor.lastMessageAt, cursor.lastMessageAt, cursor.createdAt, limit]);
    }

    const items = rows.map(mapSessionRow).filter((item): item is ChatSession => item !== null);
    return buildPaginatedResult(items, limit);
  }

  createSession(session: ChatSession): void {
    const metadata = normalizeSessionMetadata(session.metadata);
    dbExecute(UPSERT_SESSION_SQL, [
      session.id,
      session.type,
      session.title,
      session.createdAt,
      session.updatedAt,
      session.lastMessageAt,
      stringifyJson(session.usage),
      stringifyJson(metadata)
    ]);
  }

  /**
   * 读取单个聊天会话。
   * @param sessionId - 会话 ID
   * @returns 会话不存在或类型无效时返回 undefined
   */
  getSessionById(sessionId: string): ChatSession | undefined {
    const rows = dbSelect<ChatSessionRow>(SELECT_SESSION_BY_ID_SQL, [sessionId]);
    return rows.length ? mapSessionRow(rows[0]) ?? undefined : undefined;
  }

  /**
   * 原子合并并持久化单个会话的模型元数据。
   * @param sessionId - 会话 ID
   * @param model - 待持久化的模型标识
   * @returns 已更新的完整会话
   */
  updateSessionModel(sessionId: string, model: ChatSessionModelMetadata): ChatSession {
    if (!isSessionModelMetadata(model)) throw new Error('会话模型格式无效');

    return transaction((): ChatSession => {
      const session = this.getSessionById(sessionId);
      if (!session) throw new Error('找不到聊天会话');

      const updatedAt = dayjs().toISOString();
      const metadata: ChatSessionMetadata = { ...(session.metadata ?? {}), model };
      dbExecute(UPDATE_SESSION_METADATA_SQL, [stringifyJson(metadata), updatedAt, sessionId]);
      return { ...session, metadata, updatedAt };
    });
  }

  /**
   * 原子合并并持久化单个会话的工作区元数据。
   * @param sessionId - 会话 ID
   * @param workspaceRoot - 已由目录选择器规范化的工作区根目录
   * @returns 已更新的完整会话
   */
  updateSessionWorkspace(sessionId: string, workspaceRoot: unknown): ChatSession {
    const normalizedWorkspaceRoot = normalizeWorkspaceRoot(workspaceRoot);

    return transaction((): ChatSession => {
      const session = this.getSessionById(sessionId);
      if (!session) throw new Error('找不到聊天会话');

      const updatedAt = dayjs().toISOString();
      const metadata: ChatSessionMetadata = { ...(session.metadata ?? {}), workspaceRoot: normalizedWorkspaceRoot };
      dbExecute(UPDATE_SESSION_METADATA_SQL, [stringifyJson(metadata), updatedAt, sessionId]);
      return { ...session, metadata, updatedAt };
    });
  }

  /**
   * 原子清除单个会话的工作区覆盖，并保留其余元数据。
   * @param sessionId - 会话 ID
   * @returns 已更新的完整会话
   */
  clearSessionWorkspace(sessionId: string): ChatSession {
    return transaction((): ChatSession => {
      const session = this.getSessionById(sessionId);
      if (!session) throw new Error('找不到聊天会话');

      const metadata: ChatSessionMetadata = { ...(session.metadata ?? {}) };
      delete metadata.workspaceRoot;
      const nextMetadata = Object.keys(metadata).length ? metadata : undefined;
      const updatedAt = dayjs().toISOString();
      dbExecute(UPDATE_SESSION_METADATA_SQL, [stringifyJson(nextMetadata), updatedAt, sessionId]);
      return { ...session, metadata: nextMetadata, updatedAt };
    });
  }

  /**
   * 创建截至目标助手消息的独立会话分支。
   * @param sourceSessionId - 源会话 ID
   * @param targetMessageId - 目标助手消息 ID
   * @param ownerCheckpointId - 内部 continuation owner；Renderer 不得传入
   * @returns 已原子写入的新会话
   */
  branchSession(sourceSessionId: string, targetMessageId: string, ownerCheckpointId?: string): ChatSession {
    assertSessionHistoryWritable(sourceSessionId, ownerCheckpointId);
    return transaction((): ChatSession => {
      const sourceSession = this.getSessionById(sourceSessionId);
      if (!sourceSession) throw new Error('找不到源聊天会话');
      const sourceMessages = this.getAllMessages(sourceSessionId);

      const branch = createSessionBranchData({
        sourceSession,
        sourceMessages,
        targetMessageId,
        now: dayjs().toISOString(),
        createId: nanoid
      });
      this.insertSessionBranch(branch);
      return branch.session;
    });
  }

  /**
   * 在当前事务中写入完整会话分支。
   * @param branch - 已完成引用重建的分支数据
   */
  insertSessionBranch(branch: SessionBranchData): void {
    dbExecute(INSERT_SESSION_SQL, [
      branch.session.id,
      branch.session.type,
      branch.session.title,
      branch.session.createdAt,
      branch.session.updatedAt,
      branch.session.lastMessageAt,
      stringifyJson(branch.session.usage),
      stringifyJson(branch.session.metadata)
    ]);
    for (const message of branch.messages) {
      dbExecute(INSERT_MESSAGE_SQL, buildMessageUpsertParams(message));
    }
  }

  updateSessionTitle(sessionId: string, title: string): void {
    dbExecute(UPDATE_SESSION_TITLE_SQL, [title, dayjs().toISOString(), sessionId]);
  }

  getSessionUsage(sessionId: string): AIUsage | undefined {
    const rows = dbSelect<ChatSessionUsageRow>(SELECT_SESSION_USAGE_SQL, [sessionId]);
    return parseJson<AIUsage>(rows[0]?.usage_json ?? null);
  }

  // ======== Message ========

  getMessages(sessionId: string, cursor?: ChatMessageHistoryCursor): ChatMessageRecord[] {
    const rows = cursor
      ? dbSelect<ChatMessageRow>(SELECT_MESSAGES_BEFORE_CURSOR_SQL, [
          sessionId,
          cursor.beforeCreatedAt,
          cursor.beforeCreatedAt,
          getMessageRoleOrder(cursor.beforeRole),
          getMessageRoleOrder(cursor.beforeRole),
          cursor.beforeId,
          CHAT_MESSAGE_HISTORY_LIMIT
        ])
      : dbSelect<ChatMessageRow>(SELECT_MESSAGES_BY_SESSION_SQL, [sessionId, CHAT_MESSAGE_HISTORY_LIMIT]);

    return sortMessages(rows.map(mapMessageRow));
  }

  /**
   * 读取指定会话的全部消息，不应用历史分页限制。
   * @param sessionId - 会话 ID
   * @returns 按界面展示顺序排列的完整消息
   */
  getAllMessages(sessionId: string): ChatMessageRecord[] {
    const rows = dbSelect<ChatMessageRow>(SELECT_ALL_MESSAGES_BY_SESSION_SQL, [sessionId]);
    return sortMessages(rows.map(mapBranchMessageRow));
  }

  /**
   * 扫描可能包含遗留非终态 Runtime Part 的消息。
   * @returns 仍实际包含 pending compaction 或未完成工具 Part 的完整消息
   */
  listPendingRuntimeMessages(): ChatMessageRecord[] {
    const rows = dbSelect<ChatMessageRow>(SELECT_PENDING_RUNTIME_MESSAGES_SQL);
    return rows
      .map(mapMessageRow)
      .filter((message: ChatMessageRecord): boolean =>
        message.parts.some(
          (part: ChatMessagePart): boolean => (part.type === 'compaction' && part.status === 'pending') || (part.type === 'tool' && part.status !== 'done')
        )
      );
  }

  /**
   * 保留旧调用名并复用完整 Runtime 恢复扫描。
   * @returns 遗留非终态 Runtime 消息
   */
  listPendingCompactionMessages(): ChatMessageRecord[] {
    return this.listPendingRuntimeMessages();
  }

  /**
   * 新增聊天消息。
   * @param message - 要新增的聊天消息
   * @param ownerCheckpointId - 内部 continuation owner；Renderer 不得传入
   */
  addMessage(message: ChatMessageRecord, ownerCheckpointId?: string): void {
    assertSessionHistoryWritable(message.sessionId, ownerCheckpointId);
    transaction(() => {
      dbExecute(UPSERT_MESSAGE_SQL, buildMessageUpsertParams(message));
      dbExecute(UPDATE_SESSION_LAST_MESSAGE_AT_SQL, [message.createdAt, message.sessionId]);
      if (message.usage) {
        const rows = dbSelect<ChatSessionUsageRow>(SELECT_SESSION_USAGE_SQL, [message.sessionId]);
        const current = parseJson<AIUsage>(rows[0]?.usage_json ?? null);
        dbExecute(UPDATE_SESSION_USAGE_SQL, [stringifyJson(addUsage(current, message.usage)), message.sessionId]);
      }
    });
  }

  /**
   * 更新或创建单条消息，不更新会话用量汇总。
   * 用于流式 assistant 草稿和硬中断恢复回写。
   * @param message - 要更新的聊天消息。
   * @param ownerCheckpointId - 内部 continuation owner；Renderer 不得传入
   */
  updateMessage(message: ChatMessageRecord, ownerCheckpointId?: string): void {
    assertSessionHistoryWritable(message.sessionId, ownerCheckpointId);
    transaction(() => {
      // 查询当前消息已有的用量记录，用于后续计算用量差值
      let previousMessageUsage: AIUsage | undefined;
      if (message.usage !== undefined) {
        const rows = dbSelect<ChatSessionUsageRow>(SELECT_MESSAGE_USAGE_SQL, [message.sessionId, message.id]);
        previousMessageUsage = parseJson<AIUsage>(rows[0]?.usage_json ?? null);
      }

      dbExecute(UPSERT_MESSAGE_SQL, buildMessageUpsertParams(message));
      dbExecute(UPDATE_SESSION_LAST_MESSAGE_AT_SQL, [message.createdAt, message.sessionId]);
      if (message.usage) {
        const usageDelta = subtractUsage(message.usage, previousMessageUsage);
        if (hasUsageDelta(usageDelta)) {
          const rows = dbSelect<ChatSessionUsageRow>(SELECT_SESSION_USAGE_SQL, [message.sessionId]);
          const current = parseJson<AIUsage>(rows[0]?.usage_json ?? null);
          dbExecute(UPDATE_SESSION_USAGE_SQL, [stringifyJson(addUsage(current, usageDelta)), message.sessionId]);
        }
      }
    });
  }

  /**
   * 删除指定会话中的单条消息。
   * @param sessionId - 会话 ID。
   * @param messageId - 消息 ID。
   * @param ownerCheckpointId - 内部 continuation owner；Renderer 不得传入
   */
  deleteMessage(sessionId: string, messageId: string, ownerCheckpointId?: string): void {
    assertSessionHistoryWritable(sessionId, ownerCheckpointId);
    dbExecute(DELETE_MESSAGE_SQL, [sessionId, messageId]);
  }

  /**
   * 原子替换会话消息，并在写入前清理截断后依赖不完整的 checkpoint 链。
   * @param sessionId - 会话 ID
   * @param messages - 完整消息级截断结果
   * @param ownerCheckpointId - 内部 continuation owner；Renderer 不得传入
   */
  setSessionMessages(sessionId: string, messages: ChatMessageRecord[], ownerCheckpointId?: string): void {
    assertSessionHistoryWritable(sessionId, ownerCheckpointId);
    const normalizedMessages = removeInvalidCheckpoints(messages);
    transaction(() => {
      dbExecute(DELETE_MESSAGES_BY_SESSION_SQL, [sessionId]);
      for (const msg of normalizedMessages) {
        dbExecute(UPSERT_MESSAGE_SQL, buildMessageUpsertParams(msg));
      }
      if (normalizedMessages.length > 0) {
        dbExecute(UPDATE_SESSION_LAST_MESSAGE_AT_SQL, [normalizedMessages[normalizedMessages.length - 1].createdAt, sessionId]);
      }
      const totalUsage = normalizedMessages.reduce<AIUsage | undefined>((sum, m) => (m.usage ? addUsage(sum, m.usage) : sum), undefined);
      dbExecute(UPDATE_SESSION_USAGE_SQL, [stringifyJson(totalUsage), sessionId]);
    });
  }

  // ======== Delete ========

  /**
   * 删除会话及其消息。
   * @param sessionId - 会话 ID
   * @param ownerCheckpointId - 内部 continuation owner；Renderer 不得传入
   */
  deleteSession(sessionId: string, ownerCheckpointId?: string): void {
    assertSessionHistoryWritable(sessionId, ownerCheckpointId);
    transaction(() => {
      dbExecute(DELETE_MESSAGES_BY_SESSION_SQL, [sessionId]);
      dbExecute(DELETE_SESSION_SQL, [sessionId]);
    });
  }
}

export const chatSessionManager = new ChatSessionManager();
