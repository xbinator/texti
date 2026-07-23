/**
 * @file service.mts
 * @description Electron 主进程 SQLite 数据库初始化、迁移与基础读写服务。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import { app } from 'electron';

type DatabaseInstance = InstanceType<typeof Database>;
type DatabaseTableName =
  | 'chat_messages'
  | 'chat_sessions'
  | 'chat_agent_tasks'
  | 'chat_agent_attempts'
  | 'chat_agent_delegation_checkpoints'
  | 'chat_agent_events'
  | 'chat_agent_outbox';

interface DatabaseTableInfoRow {
  name: string;
}

let db: DatabaseInstance | null = null;

/**
 * 检查数据表是否已经包含指定列。
 * @param tableName - 数据表名称
 * @param columnName - 需要检查的列名
 * @returns 数据表是否包含该列
 */
function hasColumn(tableName: DatabaseTableName, columnName: string): boolean {
  if (!db) throw new Error('Database not initialized');

  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as DatabaseTableInfoRow[];

  return rows.some((row) => row.name === columnName);
}

/**
 * 按需补齐已有数据库缺失的表列。
 * @param tableName - 数据表名称
 * @param columnName - 需要补齐的列名
 * @param definition - SQLite 列定义
 */
function ensureColumn(tableName: DatabaseTableName, columnName: string, definition: string): void {
  if (!db) throw new Error('Database not initialized');
  if (hasColumn(tableName, columnName)) return;

  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${definition}`);
}

/**
 * 执行向后兼容的数据库结构迁移。
 */
function migrateDatabase(): void {
  ensureColumn('chat_sessions', 'usage_json', 'usage_json TEXT');
  ensureColumn('chat_sessions', 'metadata_json', 'metadata_json TEXT');
  ensureColumn('chat_messages', 'thinking', 'thinking TEXT');
  ensureColumn('chat_messages', 'parts_json', 'parts_json TEXT');
  ensureColumn('chat_messages', 'loading', 'loading INTEGER');
  ensureColumn('chat_messages', 'finished', 'finished INTEGER');
  ensureColumn('chat_messages', 'agent_id', 'agent_id TEXT');
  ensureColumn('chat_messages', 'runtime_id', 'runtime_id TEXT');
  ensureColumn('chat_messages', 'parent_runtime_id', 'parent_runtime_id TEXT');
}

/**
 * 增量创建 Child Agent 委派事实表和查询索引。
 * @param database - 已打开且与聊天表共享事务域的 SQLite 实例
 */
export function createAgentTables(database: Pick<DatabaseInstance, 'exec'>): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS chat_agent_tasks (
      task_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      parent_agent_id TEXT NOT NULL,
      root_runtime_id TEXT NOT NULL,
      checkpoint_id TEXT NOT NULL,
      tool_call_id TEXT NOT NULL,
      contract_snapshot_json TEXT NOT NULL,
      contract_snapshot_hash TEXT NOT NULL,
      execution_plan_snapshot_json TEXT,
      execution_plan_snapshot_hash TEXT,
      status TEXT NOT NULL,
      queue_phase TEXT,
      priority TEXT NOT NULL,
      deadline_at TEXT,
      current_attempt_id TEXT,
      cancel_requested_at TEXT,
      result_json TEXT,
      result_hash TEXT,
      error_json TEXT,
      record_state TEXT NOT NULL DEFAULT 'active',
      unfinished_journal_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (record_state IN ('active', 'tombstoned')),
      CHECK (unfinished_journal_count >= 0),
      CHECK (
        (execution_plan_snapshot_json IS NULL AND execution_plan_snapshot_hash IS NULL)
        OR (execution_plan_snapshot_json IS NOT NULL AND execution_plan_snapshot_hash IS NOT NULL)
      ),
      CHECK (
        (result_json IS NULL AND result_hash IS NULL)
        OR (result_json IS NOT NULL AND result_hash IS NOT NULL)
      )
    );

    CREATE TABLE IF NOT EXISTS chat_agent_attempts (
      attempt_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      attempt_number INTEGER NOT NULL,
      parent_runtime_id TEXT NOT NULL,
      plan_hash TEXT NOT NULL,
      initial_runtime_id TEXT NOT NULL,
      current_runtime_id TEXT NOT NULL,
      runtime_sequence INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      error_json TEXT,
      created_at TEXT NOT NULL,
      CHECK (attempt_number > 0),
      CHECK (runtime_sequence > 0),
      UNIQUE (task_id, attempt_number)
    );

    CREATE TABLE IF NOT EXISTS chat_agent_delegation_checkpoints (
      checkpoint_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      primary_agent_id TEXT NOT NULL,
      root_runtime_id TEXT NOT NULL,
      source_runtime_id TEXT NOT NULL,
      assistant_message_id TEXT NOT NULL,
      continuation_snapshot_json TEXT NOT NULL,
      continuation_snapshot_hash TEXT NOT NULL,
      status TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 0,
      terminal_results_json TEXT NOT NULL DEFAULT '{}',
      resume_runtime_id TEXT,
      error_json TEXT,
      record_state TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (version >= 0),
      CHECK (record_state IN ('active', 'tombstoned'))
    );

    CREATE TABLE IF NOT EXISTS chat_agent_events (
      event_id TEXT PRIMARY KEY,
      aggregate_kind TEXT NOT NULL,
      aggregate_id TEXT NOT NULL,
      task_id TEXT,
      checkpoint_id TEXT,
      sequence INTEGER NOT NULL,
      attempt_id TEXT,
      runtime_id TEXT,
      event_type TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      source TEXT NOT NULL,
      schema_version INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      CHECK (aggregate_kind IN ('task', 'checkpoint')),
      CHECK (sequence > 0),
      CHECK (schema_version > 0),
      CHECK (
        (aggregate_kind = 'task' AND task_id IS NOT NULL AND task_id = aggregate_id)
        OR (aggregate_kind = 'checkpoint' AND checkpoint_id IS NOT NULL AND checkpoint_id = aggregate_id)
      )
    );

    CREATE TABLE IF NOT EXISTS chat_agent_outbox (
      outbox_id TEXT PRIMARY KEY,
      dedupe_key TEXT NOT NULL UNIQUE,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      schema_version INTEGER NOT NULL,
      delivery_status TEXT NOT NULL DEFAULT 'pending',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      delivered_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (schema_version > 0),
      CHECK (delivery_status IN ('pending', 'delivered')),
      CHECK (attempt_count >= 0)
    );

    CREATE TRIGGER IF NOT EXISTS trg_chat_agent_tasks_immutable
    BEFORE UPDATE OF
      task_id, session_id, turn_id, agent_id, parent_agent_id, root_runtime_id,
      checkpoint_id, tool_call_id, contract_snapshot_json, contract_snapshot_hash, created_at
    ON chat_agent_tasks
    WHEN
      NEW.task_id IS NOT OLD.task_id
      OR NEW.session_id IS NOT OLD.session_id
      OR NEW.turn_id IS NOT OLD.turn_id
      OR NEW.agent_id IS NOT OLD.agent_id
      OR NEW.parent_agent_id IS NOT OLD.parent_agent_id
      OR NEW.root_runtime_id IS NOT OLD.root_runtime_id
      OR NEW.checkpoint_id IS NOT OLD.checkpoint_id
      OR NEW.tool_call_id IS NOT OLD.tool_call_id
      OR NEW.contract_snapshot_json IS NOT OLD.contract_snapshot_json
      OR NEW.contract_snapshot_hash IS NOT OLD.contract_snapshot_hash
      OR NEW.created_at IS NOT OLD.created_at
    BEGIN
      SELECT RAISE(ABORT, 'agent_task_immutable');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_chat_agent_tasks_plan_once
    BEFORE UPDATE OF execution_plan_snapshot_json, execution_plan_snapshot_hash
    ON chat_agent_tasks
    WHEN NOT (
      (
        NEW.execution_plan_snapshot_json IS OLD.execution_plan_snapshot_json
        AND NEW.execution_plan_snapshot_hash IS OLD.execution_plan_snapshot_hash
      )
      OR (
        OLD.execution_plan_snapshot_json IS NULL
        AND OLD.execution_plan_snapshot_hash IS NULL
        AND NEW.execution_plan_snapshot_json IS NOT NULL
        AND NEW.execution_plan_snapshot_hash IS NOT NULL
      )
    )
    BEGIN
      SELECT RAISE(ABORT, 'agent_task_plan_immutable');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_chat_agent_tasks_result_once
    BEFORE UPDATE OF result_json, result_hash
    ON chat_agent_tasks
    WHEN NOT (
      (
        NEW.result_json IS OLD.result_json
        AND NEW.result_hash IS OLD.result_hash
      )
      OR (
        OLD.result_json IS NULL
        AND OLD.result_hash IS NULL
        AND NEW.result_json IS NOT NULL
        AND NEW.result_hash IS NOT NULL
      )
    )
    BEGIN
      SELECT RAISE(ABORT, 'agent_task_result_immutable');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_chat_agent_attempts_immutable
    BEFORE UPDATE OF
      attempt_id, task_id, attempt_number, parent_runtime_id, plan_hash,
      initial_runtime_id, created_at
    ON chat_agent_attempts
    WHEN
      NEW.attempt_id IS NOT OLD.attempt_id
      OR NEW.task_id IS NOT OLD.task_id
      OR NEW.attempt_number IS NOT OLD.attempt_number
      OR NEW.parent_runtime_id IS NOT OLD.parent_runtime_id
      OR NEW.plan_hash IS NOT OLD.plan_hash
      OR NEW.initial_runtime_id IS NOT OLD.initial_runtime_id
      OR NEW.created_at IS NOT OLD.created_at
    BEGIN
      SELECT RAISE(ABORT, 'agent_attempt_immutable');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_chat_agent_checkpoints_immutable
    BEFORE UPDATE OF
      checkpoint_id, session_id, turn_id, primary_agent_id, root_runtime_id,
      source_runtime_id, assistant_message_id, continuation_snapshot_json,
      continuation_snapshot_hash, created_at
    ON chat_agent_delegation_checkpoints
    WHEN
      NEW.checkpoint_id IS NOT OLD.checkpoint_id
      OR NEW.session_id IS NOT OLD.session_id
      OR NEW.turn_id IS NOT OLD.turn_id
      OR NEW.primary_agent_id IS NOT OLD.primary_agent_id
      OR NEW.root_runtime_id IS NOT OLD.root_runtime_id
      OR NEW.source_runtime_id IS NOT OLD.source_runtime_id
      OR NEW.assistant_message_id IS NOT OLD.assistant_message_id
      OR NEW.continuation_snapshot_json IS NOT OLD.continuation_snapshot_json
      OR NEW.continuation_snapshot_hash IS NOT OLD.continuation_snapshot_hash
      OR NEW.created_at IS NOT OLD.created_at
    BEGIN
      SELECT RAISE(ABORT, 'agent_checkpoint_immutable');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_chat_agent_events_append_only
    BEFORE UPDATE ON chat_agent_events
    BEGIN
      SELECT RAISE(ABORT, 'agent_event_append_only');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_chat_agent_outbox_immutable
    BEFORE UPDATE OF
      outbox_id, dedupe_key, event_type, payload_json, payload_hash, schema_version, created_at
    ON chat_agent_outbox
    WHEN
      NEW.outbox_id IS NOT OLD.outbox_id
      OR NEW.dedupe_key IS NOT OLD.dedupe_key
      OR NEW.event_type IS NOT OLD.event_type
      OR NEW.payload_json IS NOT OLD.payload_json
      OR NEW.payload_hash IS NOT OLD.payload_hash
      OR NEW.schema_version IS NOT OLD.schema_version
      OR NEW.created_at IS NOT OLD.created_at
    BEGIN
      SELECT RAISE(ABORT, 'agent_outbox_immutable');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_chat_agent_tasks_no_delete
    BEFORE DELETE ON chat_agent_tasks
    BEGIN
      SELECT RAISE(ABORT, 'agent_fact_delete_forbidden');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_chat_agent_attempts_no_delete
    BEFORE DELETE ON chat_agent_attempts
    BEGIN
      SELECT RAISE(ABORT, 'agent_fact_delete_forbidden');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_chat_agent_checkpoints_no_delete
    BEFORE DELETE ON chat_agent_delegation_checkpoints
    BEGIN
      SELECT RAISE(ABORT, 'agent_fact_delete_forbidden');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_chat_agent_events_no_delete
    BEFORE DELETE ON chat_agent_events
    BEGIN
      SELECT RAISE(ABORT, 'agent_fact_delete_forbidden');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_chat_agent_outbox_no_delete
    BEFORE DELETE ON chat_agent_outbox
    BEGIN
      SELECT RAISE(ABORT, 'agent_fact_delete_forbidden');
    END;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_agent_tasks_checkpoint_tool_call
    ON chat_agent_tasks(checkpoint_id, tool_call_id);

    CREATE INDEX IF NOT EXISTS idx_chat_agent_tasks_session_turn
    ON chat_agent_tasks(session_id, turn_id, created_at ASC);

    CREATE INDEX IF NOT EXISTS idx_chat_agent_attempts_task_status
    ON chat_agent_attempts(task_id, status);

    CREATE INDEX IF NOT EXISTS idx_chat_agent_checkpoints_session_status
    ON chat_agent_delegation_checkpoints(session_id, status, updated_at ASC);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_agent_events_aggregate_sequence
    ON chat_agent_events(aggregate_kind, aggregate_id, sequence);

    CREATE INDEX IF NOT EXISTS idx_chat_agent_events_checkpoint
    ON chat_agent_events(checkpoint_id, occurred_at ASC);

    CREATE INDEX IF NOT EXISTS idx_chat_agent_outbox_delivery
    ON chat_agent_outbox(delivery_status, created_at ASC);
  `);
}

export function getDbPath(): string {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'tibis.db');
}

export async function initDatabase(): Promise<void> {
  const dbPath = getDbPath();
  const dbDir = path.dirname(dbPath);

  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS service_models (
      service_type TEXT PRIMARY KEY,
      provider_id TEXT,
      model_id TEXT,
      custom_prompt TEXT,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_message_at TEXT NOT NULL,
      usage_json TEXT,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      parts_json TEXT,
      thinking TEXT,
      files_json TEXT,
      usage_json TEXT,
      created_at TEXT NOT NULL,
      loading INTEGER,
      finished INTEGER,
      agent_id TEXT,
      runtime_id TEXT,
      parent_runtime_id TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_chat_sessions_type_last_message_at
    ON chat_sessions(type, last_message_at DESC);

    CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id_created_at
    ON chat_messages(session_id, created_at ASC);
  `);

  createAgentTables(db);
  migrateDatabase();
}

export function dbExecute(sql: string, params?: unknown[]): { changes: number; lastInsertRowid: number | bigint } {
  if (!db) throw new Error('Database not initialized');
  return db.prepare(sql).run(...(params || []));
}

export function dbSelect<T = unknown[]>(sql: string, params?: unknown[]): T[] {
  if (!db) throw new Error('Database not initialized');
  return db.prepare(sql).all(...(params || [])) as T[];
}

export function transaction<T>(fn: () => T): T {
  if (!db) throw new Error('Database not initialized');
  return db.transaction(fn)();
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
