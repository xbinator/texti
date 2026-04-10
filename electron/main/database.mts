/**
 * SQLite 数据库管理模块
 * 使用 better-sqlite3 提供同步高性能的数据库操作
 * 负责初始化数据库、执行 SQL 查询和更新操作
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import { app } from 'electron';

// 数据库实例类型
type DatabaseInstance = InstanceType<typeof Database>;

// 数据库连接实例（单例模式）
let db: DatabaseInstance | null = null;

/**
 * 获取数据库文件路径
 * 存储在用户数据目录下：~/Library/Application Support/Texti/texti.db (macOS)
 */
export function getDbPath(): string {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'texti.db');
}

/**
 * 初始化数据库连接和表结构
 * 创建必要的表：provider_settings, custom_providers, service_models
 */
export async function initDatabase(): Promise<void> {
  const dbPath = getDbPath();
  const dbDir = path.dirname(dbPath);

  // 确保数据库目录存在
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  // 创建数据库连接（WAL 模式提升并发性能）
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  // 创建应用所需的表结构
  db.exec(`
    -- 服务商设置表：存储内置服务商的配置（API密钥、基础URL等）
    CREATE TABLE IF NOT EXISTS provider_settings (
      id          TEXT    PRIMARY KEY,     -- 服务商ID
      is_enabled  INTEGER NOT NULL,        -- 是否启用（0/1）
      api_key     TEXT,                    -- API密钥
      base_url    TEXT,                    -- 自定义基础URL
      models_json TEXT,                    -- 模型列表JSON
      updated_at  INTEGER NOT NULL         -- 更新时间戳
    );

    -- 自定义服务商表：存储用户添加的第三方服务商
    CREATE TABLE IF NOT EXISTS custom_providers (
      id          TEXT    PRIMARY KEY,     -- 服务商唯一ID
      name        TEXT    NOT NULL,        -- 显示名称
      description TEXT    NOT NULL,        -- 描述
      type        TEXT    NOT NULL,        -- 类型：openai/anthropic/google
      logo        TEXT,                    -- Logo图标
      is_enabled  INTEGER NOT NULL,        -- 是否启用
      api_key     TEXT,                    -- API密钥
      base_url    TEXT,                    -- 基础URL
      models_json TEXT,                    -- 支持的模型列表
      created_at  INTEGER NOT NULL,        -- 创建时间
      updated_at  INTEGER NOT NULL         -- 更新时间
    );

    -- 服务模型配置表：存储各功能使用的模型配置
    CREATE TABLE IF NOT EXISTS service_models (
      service_type TEXT PRIMARY KEY,       -- 服务类型（如：chat/translate/summary）
      provider_id TEXT,                    -- 使用哪个服务商
      model_id TEXT,                       -- 使用哪个模型
      custom_prompt TEXT,                  -- 自定义提示词
      updated_at INTEGER NOT NULL          -- 更新时间
    );
  `);
}

/**
 * 数据库执行结果接口
 */
interface ExecuteResult {
  changes: number; // 受影响的行数
  lastInsertRowid: number | bigint; // 最后插入的行ID
}

/**
 * 执行数据库写操作（INSERT/UPDATE/DELETE）
 * @param sql SQL语句
 * @param params 参数数组（防止SQL注入）
 */
export function dbExecute(sql: string, params?: unknown[]): ExecuteResult {
  if (!db) throw new Error('Database not initialized');
  return db.prepare(sql).run(...(params || []));
}

/**
 * 执行数据库查询操作（SELECT）
 * @param sql SQL查询语句
 * @param params 参数数组
 * @returns 查询结果数组
 */
export function dbSelect<T = unknown[]>(sql: string, params?: unknown[]): T[] {
  if (!db) throw new Error('Database not initialized');
  return db.prepare(sql).all(...(params || [])) as T[];
}

/**
 * 关闭数据库连接
 * 应用退出时调用，确保数据写入磁盘
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
