import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import { app } from 'electron';

type DatabaseInstance = InstanceType<typeof Database>;

let db: DatabaseInstance | null = null;

export function getDbPath(): string {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'texti.db');
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
  `);
}

interface ExecuteResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export function dbExecute(sql: string, params?: unknown[]): ExecuteResult {
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
