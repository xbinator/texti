import * as fs from 'node:fs';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import { app } from 'electron';

type DatabaseInstance = InstanceType<typeof Database>;
type DatabaseTableName = 'chat_messages' | 'chat_sessions';

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
  ensureColumn('chat_messages', 'thinking', 'thinking TEXT');
  ensureColumn('chat_messages', 'parts_json', 'parts_json TEXT');
  ensureColumn('chat_messages', 'references_json', 'references_json TEXT');
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
    CREATE TABLE IF NOT EXISTS provider_settings (
      id          TEXT    PRIMARY KEY,
      is_enabled  INTEGER NOT NULL,
      api_key     TEXT,
      base_url    TEXT,
      models_json TEXT,
      updated_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS custom_providers (
      id          TEXT    PRIMARY KEY,
      name        TEXT    NOT NULL,
      description TEXT    NOT NULL,
      type        TEXT    NOT NULL,
      logo        TEXT,
      is_enabled  INTEGER NOT NULL,
      api_key     TEXT,
      base_url    TEXT,
      models_json TEXT,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );

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
      usage_json TEXT
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      parts_json TEXT,
      references_json TEXT,
      thinking TEXT,
      files_json TEXT,
      usage_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_reference_snapshots (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_chat_sessions_type_last_message_at
    ON chat_sessions(type, last_message_at DESC);

    CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id_created_at
    ON chat_messages(session_id, created_at ASC);

    CREATE INDEX IF NOT EXISTS idx_chat_reference_snapshots_document_id_created_at
    ON chat_reference_snapshots(document_id, created_at DESC);
  `);

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

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
