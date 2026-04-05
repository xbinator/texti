export interface Migration {
  version: number;
  sql: string;
}

export const migrations: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS api_key_profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        provider TEXT NOT NULL,
        key_ref TEXT NOT NULL,
        base_url TEXT,
        connection_status TEXT DEFAULT 'untested',
        last_tested_at INTEGER,
        latency_ms INTEGER,
        is_default INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS models (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        provider TEXT NOT NULL,
        model_id TEXT NOT NULL,
        api_key_profile_id TEXT NOT NULL,
        max_tokens INTEGER DEFAULT 4096,
        temperature REAL DEFAULT 0.7,
        is_enabled INTEGER DEFAULT 1,
        is_default INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (api_key_profile_id) REFERENCES api_key_profiles(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS assistants (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        model_id TEXT NOT NULL,
        system_prompt TEXT,
        is_default INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (model_id) REFERENCES models(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_models_api_key_profile_id ON models(api_key_profile_id);
      CREATE INDEX IF NOT EXISTS idx_assistants_model_id ON assistants(model_id);
    `
  }
];

export const CURRENT_DB_VERSION = migrations.length;
