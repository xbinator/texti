import { isTauri } from '@tauri-apps/api/core';
import Database from '@tauri-apps/plugin-sql';
import { migrations, CURRENT_DB_VERSION, type Migration } from './migrations';

let dbInstance: Database | null = null;

const DB_PATH = 'sqlite:texti.db';

async function getDbVersion(database: Database): Promise<number> {
  try {
    const result = await database.select<Array<{ version: number }>>('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1');
    return result.length > 0 ? result[0].version : 0;
  } catch {
    return 0;
  }
}

async function initSchemaVersionTable(database: Database): Promise<void> {
  await database.execute(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);
}

async function applyMigration(database: Database, migration: Migration): Promise<void> {
  await database.execute(migration.sql);
  await database.execute('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)', [migration.version, Date.now()]);
}

async function applyPendingMigrations(database: Database, currentVersion: number): Promise<void> {
  const pendingMigrations = migrations.filter((m) => m.version > currentVersion);

  await pendingMigrations.reduce(async (promise, migration) => {
    await promise;
    await applyMigration(database, migration);
  }, Promise.resolve());
}

export async function initDatabase(): Promise<Database> {
  if (dbInstance) {
    return dbInstance;
  }

  if (!isTauri()) {
    throw new Error('Database initialization requires Tauri environment');
  }

  dbInstance = await Database.load(DB_PATH);

  await initSchemaVersionTable(dbInstance);

  const currentVersion = await getDbVersion(dbInstance);

  await applyPendingMigrations(dbInstance, currentVersion);

  return dbInstance;
}

export function getDatabase(): Database {
  if (!dbInstance) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return dbInstance;
}

export async function closeDatabase(): Promise<void> {
  if (dbInstance) {
    await dbInstance.close();
    dbInstance = null;
  }
}

export { CURRENT_DB_VERSION };
