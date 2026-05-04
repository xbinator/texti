/* eslint-disable max-classes-per-file */
/**
 * @file chat-storage-sqlite.test.ts
 * @description 验证聊天消息在真实 SQLite 链路中的迁移、写入与读取。
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ChatMessageRecord, ChatSession } from 'types/chat';
import type { DbExecuteResult, ElectronAPI } from 'types/electron-api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 测试期间使用的临时 userData 目录。
 */
let tempUserDataDir = '';

vi.mock('better-sqlite3', () => {
  /**
   * better-sqlite3 `prepare` 语句的最小测试替身。
   */
  class BetterSqliteStatementMock {
    /**
     * 原生 SQLite 预编译语句。
     */
    private readonly statement;

    /**
     * 初始化预编译语句。
     * @param statement - 原生 SQLite 预编译语句。
     */
    constructor(statement: ReturnType<DatabaseSync['prepare']>) {
      this.statement = statement;
    }

    /**
     * 执行写操作语句。
     * @param params - SQL 参数列表。
     * @returns 写操作结果。
     */
    run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint } {
      return this.statement.run(...params);
    }

    /**
     * 执行读操作语句。
     * @param params - SQL 参数列表。
     * @returns 查询结果列表。
     */
    all(...params: unknown[]): unknown[] {
      return this.statement.all(...params);
    }
  }

  /**
   * 基于 Node 内置 SQLite 的 better-sqlite3 兼容替身。
   */
  class BetterSqliteDatabaseMock {
    /**
     * 原生 SQLite 数据库实例。
     */
    private readonly database;

    /**
     * 初始化数据库连接。
     * @param databasePath - 数据库文件路径。
     */
    constructor(databasePath: string) {
      this.database = new DatabaseSync(databasePath);
    }

    /**
     * 兼容 better-sqlite3 的 pragma 调用。
     * @param sql - pragma 语句。
     */
    pragma(sql: string): void {
      this.database.exec(`PRAGMA ${sql}`);
    }

    /**
     * 执行原始 SQL。
     * @param sql - SQL 语句。
     */
    exec(sql: string): void {
      this.database.exec(sql);
    }

    /**
     * 创建预编译语句。
     * @param sql - SQL 语句。
     * @returns 兼容 better-sqlite3 的语句对象。
     */
    prepare(sql: string): BetterSqliteStatementMock {
      return new BetterSqliteStatementMock(this.database.prepare(sql));
    }

    /**
     * 关闭数据库连接。
     */
    close(): void {
      this.database.close();
    }
  }

  return {
    default: BetterSqliteDatabaseMock
  };
});

vi.mock('electron', () => ({
  app: {
    getPath: (name: string): string => {
      if (name !== 'userData') {
        throw new Error(`Unexpected app path request: ${name}`);
      }

      return tempUserDataDir;
    }
  }
}));

/**
 * 构造用于断言的会话记录。
 * @returns 标准化的聊天会话。
 */
function createSession(): ChatSession {
  return {
    id: 'session-1',
    type: 'assistant',
    title: 'SQLite references session',
    createdAt: '2026-04-25T00:00:00.000Z',
    updatedAt: '2026-04-25T00:00:00.000Z',
    lastMessageAt: '2026-04-25T00:00:00.000Z'
  };
}

/**
 * 构造用于断言的消息记录。
 * @param overrides - 需要覆盖的消息字段。
 * @returns 标准化的聊天消息。
 */
function createMessage(overrides: Partial<ChatMessageRecord> = {}): ChatMessageRecord {
  return {
    id: 'message-1',
    sessionId: 'session-1',
    role: 'user',
    content: 'Test message',
    parts: [{ type: 'text', text: 'Test message' }],
    createdAt: '2026-04-25T00:00:01.000Z',
    ...overrides
  };
}

describe('chatStorage SQLite references', () => {
  beforeEach(() => {
    vi.resetModules();
    tempUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tibis-chat-storage-'));
  });

  afterEach(async () => {
    const { closeDatabase } = await import('../../electron/main/modules/database/service.mts');

    closeDatabase();
    fs.rmSync(tempUserDataDir, { recursive: true, force: true });
  });

  it('updates only the session title metadata when auto naming completes', async () => {
    const { initDatabase, dbExecute, dbSelect } = await import('../../electron/main/modules/database/service.mts');

    await initDatabase();

    vi.doMock('@/shared/platform/electron-api', () => {
      /**
       * Creates the minimal Electron API backed by the real test SQLite database.
       * @returns Electron API subset used by shared storage.
       */
      function createElectronApi(): ElectronAPI {
        return {
          dbExecute: async (sql: string, params?: unknown[]): Promise<DbExecuteResult> => {
            const result = dbExecute(sql, params);

            return {
              changes: result.changes,
              lastInsertRowid: Number(result.lastInsertRowid)
            };
          },
          dbSelect: async <T>(sql: string, params?: unknown[]): Promise<T[]> => dbSelect<T>(sql, params)
        } as ElectronAPI;
      }

      return {
        hasElectronAPI: (): boolean => true,
        getElectronAPI: (): ElectronAPI => createElectronApi()
      };
    });

    const { chatStorage } = await import('@/shared/storage/chats');
    const session = createSession();
    const message = createMessage({
      role: 'assistant',
      usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 }
    });

    await chatStorage.createSession(session);
    await chatStorage.addMessage(message);
    await chatStorage.updateSessionLastMessageAt(session.id, message.createdAt);
    await chatStorage.addSessionUsage(session.id, message.usage!);
    await chatStorage.updateSessionTitle(session.id, '自动命名标题');

    const rows = await dbSelect<{
      title: string;
      updated_at: string;
      last_message_at: string;
      usage_json: string | null;
    }>('SELECT title, updated_at, last_message_at, usage_json FROM chat_sessions WHERE id = ?', [session.id]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe('自动命名标题');
    expect(rows[0]?.last_message_at).toBe(message.createdAt);
    expect(rows[0]?.usage_json).toBe(JSON.stringify(message.usage));
    expect(rows[0]?.updated_at).not.toBe(session.updatedAt);
  }, 15000);
});
