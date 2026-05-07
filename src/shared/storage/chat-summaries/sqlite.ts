/**
 * @file sqlite.ts
 * @description 聊天会话摘要的 SQLite 存储实现。
 */
import { cloneDeep, orderBy } from 'lodash-es';
import { CURRENT_SCHEMA_VERSION } from '@/components/BChatSidebar/utils/compression/constant';
import type {
  ConversationSummaryRecord,
  StructuredConversationSummary,
  SummaryRecordStatus,
  SummaryStorage
} from '@/components/BChatSidebar/utils/compression/types';
import { local } from '@/shared/storage/base';
import { dbSelect, dbExecute, isDatabaseAvailable, parseJson, stringifyJson } from '../utils';

const CHAT_SUMMARIES_STORAGE_KEY = 'chat_session_summaries_fallback';

const SELECT_VALID_SUMMARY_SQL = `
  SELECT *
  FROM chat_session_summaries
  WHERE session_id = ? AND status = 'valid'
  ORDER BY created_at DESC
  LIMIT 1
`;

const INSERT_SUMMARY_SQL = `
  INSERT INTO chat_session_summaries (
    id, session_id, build_mode, derived_from_summary_id,
    covered_start_message_id, covered_end_message_id, covered_until_message_id,
    source_message_ids_json, preserved_message_ids_json,
    summary_text, structured_summary_json,
    trigger_reason, message_count_snapshot, char_count_snapshot,
    schema_version, status, invalid_reason, degrade_reason,
    created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

const UPDATE_SUMMARY_STATUS_SQL = `
  UPDATE chat_session_summaries
  SET status = ?, invalid_reason = ?, updated_at = ?
  WHERE id = ?
`;

const SELECT_ALL_SUMMARIES_SQL = `
  SELECT *
  FROM chat_session_summaries
  WHERE session_id = ?
  ORDER BY created_at DESC
`;

interface ChatSessionSummaryRow {
  id: string;
  session_id: string;
  build_mode: string;
  derived_from_summary_id: string | null;
  covered_start_message_id: string;
  covered_end_message_id: string;
  covered_until_message_id: string;
  source_message_ids_json: string;
  preserved_message_ids_json: string;
  summary_text: string;
  structured_summary_json: string;
  trigger_reason: string;
  message_count_snapshot: number;
  char_count_snapshot: number;
  schema_version: number;
  status: string;
  invalid_reason: string | null;
  degrade_reason: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * 解析并验证结构化摘要 JSON。
 * schema_version 不匹配或 JSON 格式错误时返回 null。
 */
function parseStructuredSummary(row: ChatSessionSummaryRow): StructuredConversationSummary | null {
  // schema 版本校验
  if (row.schema_version !== CURRENT_SCHEMA_VERSION) {
    return null;
  }

  const parsed = parseJson<StructuredConversationSummary>(row.structured_summary_json);
  if (!parsed) {
    return null;
  }

  // 验证必需字段存在且类型正确
  if (typeof parsed.goal !== 'string' || typeof parsed.recentTopic !== 'string') {
    return null;
  }

  // 验证数组字段类型（防止畸形数据导致后续运行时错误）
  const arrayFields: (keyof StructuredConversationSummary)[] = [
    'userPreferences', 'constraints', 'decisions',
    'importantFacts', 'fileContext', 'openQuestions', 'pendingActions'
  ];
  for (const field of arrayFields) {
    if (!Array.isArray(parsed[field])) {
      return null;
    }
  }

  return parsed;
}

/**
 * 将数据库行映射为摘要记录对象，解析并验证结构化摘要。
 * 返回 null 表示该行数据无效应被跳过。
 */
function mapRowToSummary(row: ChatSessionSummaryRow): ConversationSummaryRecord | null {
  const parsedSummary = parseStructuredSummary(row);
  if (!parsedSummary) {
    return null;
  }

  return {
    id: row.id,
    sessionId: row.session_id,
    buildMode: row.build_mode as 'incremental' | 'full_rebuild',
    derivedFromSummaryId: row.derived_from_summary_id ?? undefined,
    coveredStartMessageId: row.covered_start_message_id,
    coveredEndMessageId: row.covered_end_message_id,
    coveredUntilMessageId: row.covered_until_message_id,
    sourceMessageIds: parseJson<string[]>(row.source_message_ids_json) ?? [],
    preservedMessageIds: parseJson<string[]>(row.preserved_message_ids_json) ?? [],
    summaryText: row.summary_text,
    structuredSummary: parsedSummary,
    triggerReason: row.trigger_reason as 'message_count' | 'context_size' | 'manual',
    messageCountSnapshot: row.message_count_snapshot,
    charCountSnapshot: row.char_count_snapshot,
    schemaVersion: row.schema_version,
    status: row.status as SummaryRecordStatus,
    invalidReason: row.invalid_reason ?? undefined,
    degradeReason: (row.degrade_reason as 'degraded_to_incremental' | null) ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/**
 * 聊天会话摘要存储实现。
 */
export const chatSummariesStorage: SummaryStorage = {
  /**
   * 获取会话的最新有效摘要。
   */
  async getValidSummary(sessionId: string): Promise<ConversationSummaryRecord | undefined> {
    if (isDatabaseAvailable()) {
      const rows = await dbSelect<ChatSessionSummaryRow>(SELECT_VALID_SUMMARY_SQL, [sessionId]);
      // 尝试解析每一行，解析失败则标记无效并跳过
      for (const row of rows) {
        const parsed = mapRowToSummary(row);
        if (parsed) {
          return parsed;
        }
        // 解析失败：标记该行为 invalid
        await chatSummariesStorage.updateSummaryStatus(row.id, 'invalid', 'unsupported_schema_version');
      }
      return undefined;
    }

    // 降级到本地存储，过滤 schema_version 不匹配的摘要
    const allSummaries = local.getItem<ConversationSummaryRecord[]>(CHAT_SUMMARIES_STORAGE_KEY) ?? [];
    const validSummaries = allSummaries.filter((s: ConversationSummaryRecord) => {
      return s.sessionId === sessionId && s.status === 'valid' && s.schemaVersion === CURRENT_SCHEMA_VERSION;
    });
    const [latestSummary] = orderBy(validSummaries, ['createdAt'], ['desc']);
    return latestSummary;
  },

  /**
   * 创建摘要记录。
   */
  async createSummary(record: Omit<ConversationSummaryRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<ConversationSummaryRecord> {
    const now = new Date().toISOString();
    const newRecord: ConversationSummaryRecord = {
      ...record,
      id: `summary-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      createdAt: now,
      updatedAt: now
    };

    if (isDatabaseAvailable()) {
      await dbExecute(INSERT_SUMMARY_SQL, [
        newRecord.id,
        newRecord.sessionId,
        newRecord.buildMode,
        newRecord.derivedFromSummaryId ?? null,
        newRecord.coveredStartMessageId,
        newRecord.coveredEndMessageId,
        newRecord.coveredUntilMessageId,
        stringifyJson(newRecord.sourceMessageIds),
        stringifyJson(newRecord.preservedMessageIds),
        newRecord.summaryText,
        stringifyJson(newRecord.structuredSummary),
        newRecord.triggerReason,
        newRecord.messageCountSnapshot,
        newRecord.charCountSnapshot,
        newRecord.schemaVersion,
        newRecord.status,
        newRecord.invalidReason ?? null,
        newRecord.degradeReason ?? null,
        newRecord.createdAt,
        newRecord.updatedAt
      ]);
    } else {
      // 降级到本地存储
      const allSummaries = local.getItem<ConversationSummaryRecord[]>(CHAT_SUMMARIES_STORAGE_KEY) ?? [];
      allSummaries.push(newRecord);
      local.setItem(CHAT_SUMMARIES_STORAGE_KEY, allSummaries);
    }

    return newRecord;
  },

  /**
   * 更新摘要状态。
   */
  async updateSummaryStatus(id: string, status: SummaryRecordStatus, invalidReason?: string): Promise<void> {
    const now = new Date().toISOString();

    if (isDatabaseAvailable()) {
      await dbExecute(UPDATE_SUMMARY_STATUS_SQL, [status, invalidReason ?? null, now, id]);
    } else {
      // 降级到本地存储
      const rawSummaries = local.getItem<ConversationSummaryRecord[]>(CHAT_SUMMARIES_STORAGE_KEY) ?? [];
      const allSummaries = cloneDeep(rawSummaries);
      const index = allSummaries.findIndex((s: ConversationSummaryRecord) => s.id === id);
      if (index !== -1) {
        allSummaries[index] = {
          ...allSummaries[index],
          status,
          invalidReason,
          updatedAt: now
        };
        local.setItem(CHAT_SUMMARIES_STORAGE_KEY, allSummaries);
      }
    }
  },

  /**
   * 获取会话的所有摘要记录。
   */
  async getAllSummaries(sessionId: string): Promise<ConversationSummaryRecord[]> {
    if (isDatabaseAvailable()) {
      const rows = await dbSelect<ChatSessionSummaryRow>(SELECT_ALL_SUMMARIES_SQL, [sessionId]);
      return rows.map(mapRowToSummary).filter((s): s is ConversationSummaryRecord => s !== null);
    }

    // 降级到本地存储
    const allSummaries = local.getItem<ConversationSummaryRecord[]>(CHAT_SUMMARIES_STORAGE_KEY) ?? [];
    return allSummaries.filter((s: ConversationSummaryRecord) => s.sessionId === sessionId);
  }
};
