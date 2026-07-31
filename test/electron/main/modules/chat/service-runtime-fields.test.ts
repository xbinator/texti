/**
 * @file service-runtime-fields.test.ts
 * @description 主进程聊天服务的 Runtime 字段、用量与会话分支持久化测试。
 */
import type { ChatMessageRecord, ChatSessionModelMetadata } from 'types/chat';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chatSessionManager } from '../../../../../electron/main/modules/chat/service.mts';

const databaseMock = vi.hoisted(() => ({
  dbExecute: vi.fn(),
  dbSelect: vi.fn(),
  transaction: vi.fn((fn: () => unknown): unknown => fn())
}));

const filesystemMock = vi.hoisted(() => ({
  /** 同步规范化路径。 */
  realpathSync: vi.fn(),
  /** 同步读取路径状态。 */
  statSync: vi.fn()
}));

vi.mock('../../../../../electron/main/modules/database/service.mjs', () => databaseMock);
vi.mock('node:fs', () => filesystemMock);

describe('chat main service runtime fields', (): void => {
  beforeEach((): void => {
    databaseMock.dbExecute.mockReset();
    databaseMock.dbSelect.mockReset();
    databaseMock.transaction.mockImplementation((fn: () => unknown): unknown => fn());
    filesystemMock.realpathSync.mockReset();
    filesystemMock.statSync.mockReset();
    filesystemMock.realpathSync.mockImplementation((targetPath: string): string => targetPath);
    filesystemMock.statSync.mockReturnValue({ isDirectory: (): boolean => true });
  });

  it('maps valid session metadata and ignores malformed model or workspace fields', (): void => {
    databaseMock.dbSelect
      .mockReturnValueOnce([
        {
          id: 'session-valid',
          type: 'assistant',
          title: 'Valid',
          created_at: '2026-07-22T00:00:00.000Z',
          updated_at: '2026-07-22T00:00:00.000Z',
          last_message_at: '2026-07-22T00:00:00.000Z',
          usage_json: null,
          metadata_json: JSON.stringify({ model: { providerId: 'provider-1', modelId: 'model-2' }, workspaceRoot: '/private/tmp/project' })
        }
      ])
      .mockReturnValueOnce([
        {
          id: 'session-invalid',
          type: 'assistant',
          title: 'Invalid',
          created_at: '2026-07-22T00:00:00.000Z',
          updated_at: '2026-07-22T00:00:00.000Z',
          last_message_at: '2026-07-22T00:00:00.000Z',
          usage_json: null,
          metadata_json: JSON.stringify({ model: { providerId: '', modelId: 1 } })
        }
      ])
      .mockReturnValueOnce([
        {
          id: 'session-invalid-workspace',
          type: 'assistant',
          title: 'Invalid workspace',
          created_at: '2026-07-22T00:00:00.000Z',
          updated_at: '2026-07-22T00:00:00.000Z',
          last_message_at: '2026-07-22T00:00:00.000Z',
          usage_json: null,
          metadata_json: JSON.stringify({ workspaceRoot: 1 })
        }
      ]);

    const validSession = chatSessionManager.getSessionById('session-valid');

    expect(validSession?.metadata?.model).toEqual({ providerId: 'provider-1', modelId: 'model-2' });
    expect(validSession?.metadata?.workspaceRoot).toBe('/private/tmp/project');
    expect(chatSessionManager.getSessionById('session-invalid')?.metadata).toBeUndefined();
    expect(chatSessionManager.getSessionById('session-invalid-workspace')?.metadata).toBeUndefined();
  });

  it('serializes model metadata when creating a session', (): void => {
    const metadata = { model: { providerId: 'provider-1', modelId: 'model-2' } };

    chatSessionManager.createSession({
      id: 'session-created',
      type: 'assistant',
      title: 'Created',
      createdAt: '2026-07-22T00:00:00.000Z',
      updatedAt: '2026-07-22T00:00:00.000Z',
      lastMessageAt: '2026-07-22T00:00:00.000Z',
      metadata
    });

    expect(databaseMock.dbExecute).toHaveBeenCalledWith(expect.stringContaining('INSERT OR REPLACE INTO chat_sessions'), [
      'session-created',
      'assistant',
      'Created',
      '2026-07-22T00:00:00.000Z',
      '2026-07-22T00:00:00.000Z',
      '2026-07-22T00:00:00.000Z',
      null,
      JSON.stringify(metadata)
    ]);
  });

  it('atomically merges and returns updated session model metadata', (): void => {
    const model: ChatSessionModelMetadata = { providerId: 'provider-2', modelId: 'model-3' };
    databaseMock.dbSelect.mockReturnValueOnce([
      {
        id: 'session-1',
        type: 'assistant',
        title: 'Session',
        created_at: '2026-07-22T00:00:00.000Z',
        updated_at: '2026-07-22T00:00:00.000Z',
        last_message_at: '2026-07-22T00:00:00.000Z',
        usage_json: null,
        metadata_json: JSON.stringify({ layout: 'compact', model: { providerId: 'provider-1', modelId: 'model-1' } })
      }
    ]);

    const session = chatSessionManager.updateSessionModel('session-1', model);

    expect(session.metadata).toMatchObject({ layout: 'compact', model });
    expect(databaseMock.transaction).toHaveBeenCalled();
    expect(databaseMock.dbExecute).toHaveBeenCalledWith(expect.stringContaining('UPDATE chat_sessions'), [
      JSON.stringify({ layout: 'compact', model }),
      expect.any(String),
      'session-1'
    ]);
  });

  it('atomically merges and returns updated session workspace metadata', (): void => {
    const workspaceRoot = '/private/tmp/project';
    databaseMock.dbSelect.mockReturnValueOnce([
      {
        id: 'session-1',
        type: 'assistant',
        title: 'Session',
        created_at: '2026-07-22T00:00:00.000Z',
        updated_at: '2026-07-22T00:00:00.000Z',
        last_message_at: '2026-07-22T00:00:00.000Z',
        usage_json: null,
        metadata_json: JSON.stringify({ layout: 'compact', model: { providerId: 'provider-1', modelId: 'model-1' } })
      }
    ]);

    const session = chatSessionManager.updateSessionWorkspace('session-1', workspaceRoot);

    expect(session.metadata).toMatchObject({ layout: 'compact', model: { providerId: 'provider-1', modelId: 'model-1' }, workspaceRoot });
    expect(databaseMock.transaction).toHaveBeenCalled();
    expect(databaseMock.dbExecute).toHaveBeenCalledWith(expect.stringContaining('UPDATE chat_sessions'), [
      JSON.stringify({ layout: 'compact', model: { providerId: 'provider-1', modelId: 'model-1' }, workspaceRoot }),
      expect.any(String),
      'session-1'
    ]);
  });

  it('canonicalizes the workspace directory before persisting it', (): void => {
    databaseMock.dbSelect.mockReturnValueOnce([
      {
        id: 'session-1',
        type: 'assistant',
        title: 'Session',
        created_at: '2026-07-22T00:00:00.000Z',
        updated_at: '2026-07-22T00:00:00.000Z',
        last_message_at: '2026-07-22T00:00:00.000Z',
        usage_json: null,
        metadata_json: null
      }
    ]);
    filesystemMock.realpathSync.mockReturnValue('/private/tmp/workspace');

    const session = chatSessionManager.updateSessionWorkspace('session-1', '/tmp/link-workspace');

    expect(session.metadata?.workspaceRoot).toBe('/private/tmp/workspace');
    expect(filesystemMock.statSync).toHaveBeenCalledWith('/private/tmp/workspace');
  });

  it('rejects an unavailable workspace before persisting it', (): void => {
    databaseMock.dbSelect.mockReturnValueOnce([
      {
        id: 'session-1',
        type: 'assistant',
        title: 'Session',
        created_at: '2026-07-22T00:00:00.000Z',
        updated_at: '2026-07-22T00:00:00.000Z',
        last_message_at: '2026-07-22T00:00:00.000Z',
        usage_json: null,
        metadata_json: null
      }
    ]);
    filesystemMock.realpathSync.mockImplementation((): never => {
      throw new Error('ENOENT');
    });

    expect((): void => {
      chatSessionManager.updateSessionWorkspace('session-1', '/tmp/missing-workspace');
    }).toThrow('会话工作区不可用');
    expect(databaseMock.dbExecute).not.toHaveBeenCalled();
  });

  it('rejects an unavailable workspace while creating a session', (): void => {
    filesystemMock.realpathSync.mockImplementation((): never => {
      throw new Error('ENOENT');
    });

    expect((): void => {
      chatSessionManager.createSession({
        id: 'session-created',
        type: 'assistant',
        title: 'Created',
        createdAt: '2026-07-22T00:00:00.000Z',
        updatedAt: '2026-07-22T00:00:00.000Z',
        lastMessageAt: '2026-07-22T00:00:00.000Z',
        metadata: { workspaceRoot: '/tmp/missing-workspace' }
      });
    }).toThrow('会话工作区不可用');
    expect(databaseMock.dbExecute).not.toHaveBeenCalled();
  });

  it('clears only the workspace metadata and preserves the remaining session metadata', (): void => {
    databaseMock.dbSelect.mockReturnValueOnce([
      {
        id: 'session-1',
        type: 'assistant',
        title: 'Session',
        created_at: '2026-07-22T00:00:00.000Z',
        updated_at: '2026-07-22T00:00:00.000Z',
        last_message_at: '2026-07-22T00:00:00.000Z',
        usage_json: null,
        metadata_json: JSON.stringify({ layout: 'compact', model: { providerId: 'provider-1', modelId: 'model-1' }, workspaceRoot: '/private/tmp/project' })
      }
    ]);

    const session = chatSessionManager.clearSessionWorkspace('session-1');

    expect(session.metadata).toEqual({ layout: 'compact', model: { providerId: 'provider-1', modelId: 'model-1' } });
    expect(databaseMock.transaction).toHaveBeenCalled();
    expect(databaseMock.dbExecute).toHaveBeenCalledWith(expect.stringContaining('UPDATE chat_sessions'), [
      JSON.stringify({ layout: 'compact', model: { providerId: 'provider-1', modelId: 'model-1' } }),
      expect.any(String),
      'session-1'
    ]);
  });

  it('maps runtime ownership fields from persisted message rows', (): void => {
    databaseMock.dbSelect.mockReturnValue([
      {
        id: 'message-1',
        session_id: 'session-1',
        role: 'assistant',
        content: 'summary',
        parts_json: JSON.stringify([{ type: 'text', text: 'summary' }]),
        thinking: null,
        files_json: null,
        usage_json: null,
        created_at: '2026-06-18T00:00:00.000Z',
        loading: null,
        finished: 1,
        agent_id: 'agent-1',
        runtime_id: 'runtime-1',
        parent_runtime_id: 'runtime-parent'
      }
    ]);

    const [message] = chatSessionManager.getMessages('session-1');

    expect(message).toMatchObject({
      id: 'message-1',
      agentId: 'agent-1',
      runtimeId: 'runtime-1',
      parentRuntimeId: 'runtime-parent'
    });
  });

  it('orders user messages before assistant messages when runtime records share createdAt', (): void => {
    databaseMock.dbSelect.mockReturnValue([
      {
        id: 'assistant-runtime-1',
        session_id: 'session-1',
        role: 'assistant',
        content: 'answer',
        parts_json: JSON.stringify([{ type: 'text', text: 'answer' }]),
        thinking: null,
        files_json: null,
        usage_json: null,
        created_at: '2026-06-19T00:00:00.000Z',
        loading: 0,
        finished: 1,
        agent_id: null,
        runtime_id: 'runtime-1',
        parent_runtime_id: null
      },
      {
        id: 'user-runtime-1',
        session_id: 'session-1',
        role: 'user',
        content: 'question',
        parts_json: JSON.stringify([{ type: 'text', text: 'question' }]),
        thinking: null,
        files_json: null,
        usage_json: null,
        created_at: '2026-06-19T00:00:00.000Z',
        loading: 0,
        finished: 1,
        agent_id: null,
        runtime_id: 'runtime-1',
        parent_runtime_id: null
      }
    ]);

    const messages = chatSessionManager.getMessages('session-1');

    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant']);
  });

  it('uses role order as part of the history cursor boundary for shared createdAt records', (): void => {
    const cursor = {
      beforeCreatedAt: '2026-06-19T00:00:00.000Z',
      beforeId: 'user-runtime-1',
      beforeRole: 'user'
    } as Parameters<typeof chatSessionManager.getMessages>[1] & { beforeRole: 'user' };

    databaseMock.dbSelect.mockReturnValue([]);

    chatSessionManager.getMessages('session-1', cursor);

    expect(databaseMock.dbSelect).toHaveBeenCalledWith(expect.stringContaining('CASE role'), [
      'session-1',
      cursor.beforeCreatedAt,
      cursor.beforeCreatedAt,
      1,
      1,
      cursor.beforeId,
      expect.any(Number)
    ]);
  });

  it('adds only the new usage delta when updating a runtime assistant message', (): void => {
    databaseMock.dbSelect
      .mockReturnValueOnce([{ usage_json: JSON.stringify({ inputTokens: 1, outputTokens: 2, totalTokens: 3 }) }])
      .mockReturnValueOnce([{ usage_json: JSON.stringify({ inputTokens: 10, outputTokens: 20, totalTokens: 30 }) }]);

    chatSessionManager.updateMessage({
      id: 'assistant-runtime-1',
      sessionId: 'session-1',
      role: 'assistant',
      content: 'answer',
      parts: [{ id: 'part0129', type: 'text', text: 'answer' }],
      usage: { inputTokens: 4, outputTokens: 6, totalTokens: 10 },
      createdAt: '2026-06-19T00:00:00.000Z',
      loading: false,
      finished: true
    });

    expect(databaseMock.dbExecute).toHaveBeenCalledWith('UPDATE chat_sessions SET usage_json = ? WHERE id = ?', [
      JSON.stringify({ inputTokens: 13, outputTokens: 24, totalTokens: 37 }),
      'session-1'
    ]);
  });

  it('does not double-count usage when updating a message with unchanged usage', (): void => {
    databaseMock.dbSelect.mockReturnValueOnce([{ usage_json: JSON.stringify({ inputTokens: 4, outputTokens: 6, totalTokens: 10 }) }]);

    chatSessionManager.updateMessage({
      id: 'assistant-runtime-1',
      sessionId: 'session-1',
      role: 'assistant',
      content: 'answer',
      parts: [{ id: 'part0130', type: 'text', text: 'answer' }],
      usage: { inputTokens: 4, outputTokens: 6, totalTokens: 10 },
      createdAt: '2026-06-19T00:00:00.000Z',
      loading: false,
      finished: true
    });

    expect(databaseMock.dbExecute).not.toHaveBeenCalledWith('UPDATE chat_sessions SET usage_json = ? WHERE id = ?', expect.any(Array));
  });

  it('removes invalid checkpoint chains before replacing persisted session messages', (): void => {
    const message: ChatMessageRecord = {
      id: 'assistant-truncated',
      sessionId: 'session-1',
      role: 'assistant',
      content: '保留正文',
      parts: [
        { id: 'source-retained', type: 'text', text: '保留正文' },
        {
          id: 'checkpoint-invalid-after-truncate',
          type: 'compaction',
          status: 'success',
          trigger: 'automatic',
          boundaryPartId: 'missing-boundary',
          sourceFingerprint: 'sha256:stale',
          modelSnapshot: {
            providerType: 'openai',
            providerId: 'provider-1',
            modelId: 'model-1',
            contextWindow: 20_000
          },
          budgetSnapshot: {
            outputReserve: 2_000,
            safetyReserve: 1_000,
            usableInputTokens: 17_000,
            triggerTokens: 13_600,
            targetTokens: 9_350,
            summaryMaxTokens: 2_000,
            rawTailMaxTokens: 4_000
          },
          summary: {
            schemaVersion: 1,
            objectives: [],
            facts: [],
            artifacts: [],
            completedActions: [],
            pendingActions: [],
            openQuestions: [],
            failures: []
          },
          createdAt: 1,
          completedAt: 2
        }
      ],
      createdAt: '2026-07-16T00:00:00.000Z',
      loading: false,
      finished: true
    };

    chatSessionManager.setSessionMessages('session-1', [message]);

    const upsertCall = databaseMock.dbExecute.mock.calls.find(([sql]) => String(sql).includes('INSERT OR REPLACE INTO chat_messages'));
    const params = upsertCall?.[1] as unknown[] | undefined;
    expect(JSON.parse(String(params?.[4]))).toEqual([{ id: 'source-retained', type: 'text', text: '保留正文' }]);
  });

  it('creates a session branch from the complete history in one transaction', (): void => {
    databaseMock.dbSelect
      .mockReturnValueOnce([
        {
          id: 'session-source',
          type: 'assistant',
          title: '原标题',
          created_at: '2026-07-14T08:00:00.000Z',
          updated_at: '2026-07-14T08:00:00.000Z',
          last_message_at: '2026-07-14T08:02:00.000Z',
          usage_json: null,
          metadata_json: JSON.stringify({ model: { providerId: 'provider-branch', modelId: 'model-branch' } })
        }
      ])
      .mockReturnValueOnce([
        {
          id: 'user-1',
          session_id: 'session-source',
          role: 'user',
          content: '问题一',
          parts_json: JSON.stringify([{ id: 'part-user-1', type: 'text', text: '问题一' }]),
          thinking: null,
          files_json: null,
          usage_json: null,
          created_at: '2026-07-14T08:01:00.000Z',
          loading: 0,
          finished: 1,
          agent_id: 'primary',
          runtime_id: 'runtime-1',
          parent_runtime_id: null
        },
        {
          id: 'assistant-1',
          session_id: 'session-source',
          role: 'assistant',
          content: '回答一',
          parts_json: JSON.stringify([{ id: 'part-assistant-1', type: 'text', text: '回答一' }]),
          thinking: null,
          files_json: null,
          usage_json: null,
          created_at: '2026-07-14T08:02:00.000Z',
          loading: 0,
          finished: 1,
          agent_id: 'primary',
          runtime_id: 'runtime-1',
          parent_runtime_id: null
        }
      ])
      .mockReturnValueOnce([]);

    const transactionCallCount = databaseMock.transaction.mock.calls.length;
    const session = chatSessionManager.branchSession('session-source', 'assistant-1');

    expect(databaseMock.transaction).toHaveBeenCalledTimes(transactionCallCount + 1);
    expect(databaseMock.dbSelect.mock.calls[1]?.[0]).not.toContain('LIMIT');
    expect(session).toMatchObject({ type: 'assistant', title: '原标题（2）' });
    expect(session.metadata?.model).toEqual({ providerId: 'provider-branch', modelId: 'model-branch' });
    expect(session.id).not.toBe('session-source');
    const sessionInsertCall = databaseMock.dbExecute.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO chat_sessions'));
    expect(sessionInsertCall?.[1]).toEqual(expect.arrayContaining([JSON.stringify(session.metadata)]));
    expect(databaseMock.dbExecute.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO chat_messages'))).toHaveLength(2);
    expect(databaseMock.dbExecute.mock.calls.every(([sql]) => !String(sql).includes('OR REPLACE'))).toBe(true);
  });

  it('rejects corrupted branch message JSON before writing any data', (): void => {
    databaseMock.dbSelect
      .mockReturnValueOnce([
        {
          id: 'session-source',
          type: 'assistant',
          title: '原标题',
          created_at: '2026-07-14T08:00:00.000Z',
          updated_at: '2026-07-14T08:00:00.000Z',
          last_message_at: '2026-07-14T08:02:00.000Z',
          usage_json: null
        }
      ])
      .mockReturnValueOnce([
        {
          id: 'user-1',
          session_id: 'session-source',
          role: 'user',
          content: '问题一',
          parts_json: '{invalid-json',
          thinking: null,
          files_json: null,
          usage_json: null,
          created_at: '2026-07-14T08:01:00.000Z',
          loading: 0,
          finished: 1,
          agent_id: 'primary',
          runtime_id: null,
          parent_runtime_id: null
        },
        {
          id: 'assistant-1',
          session_id: 'session-source',
          role: 'assistant',
          content: '回答一',
          parts_json: JSON.stringify([{ id: 'part-assistant-1', type: 'text', text: '回答一' }]),
          thinking: null,
          files_json: null,
          usage_json: null,
          created_at: '2026-07-14T08:02:00.000Z',
          loading: 0,
          finished: 1,
          agent_id: 'primary',
          runtime_id: null,
          parent_runtime_id: null
        }
      ])
      .mockReturnValueOnce([]);

    expect((): void => {
      chatSessionManager.branchSession('session-source', 'assistant-1');
    }).toThrow('无法解析消息 user-1 的 parts_json');
    expect(databaseMock.dbExecute).not.toHaveBeenCalled();
  });
});
