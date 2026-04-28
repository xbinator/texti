/**
 * @file chat-storage-sqlite.test.ts
 * @description 验证聊天消息 references 在真实 SQLite 链路中的迁移、写入与读取。
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessageFileReference, ChatMessageRecord, ChatReferenceSnapshot, ChatSession } from 'types/chat';
import type { DbExecuteResult, ElectronAPI } from 'types/electron-api';

/**
 * SQLite 表结构信息行。
 */
interface TableInfoRow {
  /** 列名。 */
  name: string;
}

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
 * 构造用于断言的文件引用。
 * @returns 标准化的消息文件引用。
 */
function createReference(): ChatMessageFileReference {
  return {
    id: 'ref-1',
    token: '{{file-ref:ref-1}}',
    documentId: 'doc-1',
    fileName: 'draft.md',
    line: '12-18',
    path: null,
    snapshotId: 'snapshot-1',
    excerpt: '## Heading'
  };
}

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
    content: '{{file-ref:ref-1}}',
    parts: [{ type: 'text', text: '{{file-ref:ref-1}}' }],
    references: [createReference()],
    createdAt: '2026-04-25T00:00:01.000Z',
    ...overrides
  };
}

/**
 * Builds a normalized snapshot fixture for persistence assertions.
 * @returns Chat reference snapshot fixture.
 */
function createSnapshot(): ChatReferenceSnapshot {
  return {
    id: 'snapshot-1',
    documentId: 'doc-1',
    title: 'draft.md',
    content: 'line 1\nline 2\nline 3',
    createdAt: '2026-04-25T00:00:00.000Z'
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

  it('adds references_json during database migration', async () => {
    const legacyDbPath = path.join(tempUserDataDir, 'tibis.db');
    const legacyDb = new DatabaseSync(legacyDbPath);

    legacyDb.exec(`
      CREATE TABLE chat_sessions (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_message_at TEXT NOT NULL
      );

      CREATE TABLE chat_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        files_json TEXT,
        usage_json TEXT,
        created_at TEXT NOT NULL
      );
    `);
    legacyDb.close();

    const { initDatabase, dbSelect } = await import('../../electron/main/modules/database/service.mts');

    await initDatabase();

    const tableInfo = dbSelect<TableInfoRow>('PRAGMA table_info(chat_messages)');

    expect(tableInfo.map((row) => row.name)).toContain('references_json');
  });

  it('round-trips references through addMessage and getMessages', async () => {
    const { initDatabase, dbExecute, dbSelect } = await import('../../electron/main/modules/database/service.mts');

    await initDatabase();

    vi.doMock('@/shared/platform/electron-api', () => {
      /**
       * 基于真实数据库服务提供渲染层需要的 Electron API 子集。
       * @returns 指向 SQLite 数据库服务的测试 API。
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
    const message = createMessage();

    await chatStorage.createSession(session);
    await chatStorage.addMessage(message);

    const persistedRows = await dbSelect<{ references_json: string | null }>(
      'SELECT references_json FROM chat_messages WHERE id = ?',
      [message.id]
    );
    const loadedMessages = await chatStorage.getMessages(session.id);

    expect(persistedRows[0]?.references_json).toBe(JSON.stringify(message.references));
    expect(loadedMessages).toEqual([message]);
  }, 15000);

  it('round-trips references through setSessionMessages', async () => {
    const { initDatabase, dbExecute, dbSelect } = await import('../../electron/main/modules/database/service.mts');

    await initDatabase();

    vi.doMock('@/shared/platform/electron-api', () => {
      /**
       * 基于真实数据库服务提供渲染层需要的 Electron API 子集。
       * @returns 指向 SQLite 数据库服务的测试 API。
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
    const firstMessage = createMessage();
    const secondMessage = createMessage({
      id: 'message-2',
      content: 'Follow-up reference',
      parts: [{ type: 'text', text: 'Follow-up reference' }],
      references: [
        {
          ...createReference(),
          id: 'ref-2',
          token: '{{file-ref:ref-2}}'
        }
      ],
      createdAt: '2026-04-25T00:00:02.000Z'
    });

    await chatStorage.createSession(session);
    await chatStorage.setSessionMessages(session.id, [firstMessage, secondMessage]);

    const persistedRows = await dbSelect<{ id: string; references_json: string | null }>(
      'SELECT id, references_json FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC, id ASC',
      [session.id]
    );
    const loadedMessages = await chatStorage.getMessages(session.id);

    expect(persistedRows).toEqual([
      { id: firstMessage.id, references_json: JSON.stringify(firstMessage.references) },
      { id: secondMessage.id, references_json: JSON.stringify(secondMessage.references) }
    ]);
    expect(loadedMessages).toEqual([firstMessage, secondMessage]);
  }, 15000);

  it('round-trips persisted reference snapshots through SQLite storage', async () => {
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
    const snapshot = createSnapshot();

    await chatStorage.upsertReferenceSnapshots([snapshot]);

    const persistedRows = await dbSelect<{ id: string; document_id: string; title: string; content: string }>(
      'SELECT id, document_id, title, content FROM chat_reference_snapshots WHERE id = ?',
      [snapshot.id]
    );
    const loadedSnapshots = await chatStorage.getReferenceSnapshots([snapshot.id]);

    expect(persistedRows).toEqual([
      {
        id: snapshot.id,
        document_id: snapshot.documentId,
        title: snapshot.title,
        content: snapshot.content
      }
    ]);
    expect(loadedSnapshots).toEqual([snapshot]);
  }, 15000);

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
    }>(
      'SELECT title, updated_at, last_message_at, usage_json FROM chat_sessions WHERE id = ?',
      [session.id]
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe('自动命名标题');
    expect(rows[0]?.last_message_at).toBe(message.createdAt);
    expect(rows[0]?.usage_json).toBe(JSON.stringify(message.usage));
    expect(rows[0]?.updated_at).not.toBe(session.updatedAt);
  }, 15000);
});
