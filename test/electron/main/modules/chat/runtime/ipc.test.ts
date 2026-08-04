/**
 * @file ipc.test.ts
 * @description ChatRuntime 恢复 IPC 注册测试。
 */
import { readFileSync } from 'node:fs';
import type { ChatRuntimeHandlerResult, ChatRuntimeRecoverySnapshot } from 'types/chat-runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerChatHandlers } from '../../../../../../electron/main/modules/chat/ipc.mjs';
import { chatRuntimeLocks } from '../../../../../../electron/main/modules/chat/runtime/infrastructure/locks.mjs';
import { registerChatRuntimeHandlers } from '../../../../../../electron/main/modules/chat/runtime/ipc.mjs';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
  recoverInterruptedCompactions: vi.fn(),
  listRecoverySnapshots: vi.fn(),
  estimateContext: vi.fn(),
  compact: vi.fn(),
  submitToolActivity: vi.fn(),
  controlTool: vi.fn(),
  getMessages: vi.fn(),
  addMessage: vi.fn(),
  updateMessage: vi.fn(),
  deleteMessage: vi.fn(),
  setSessionMessages: vi.fn(),
  branchSession: vi.fn(),
  deleteSession: vi.fn(),
  getSessionById: vi.fn()
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => Promise<unknown>): void => {
      mocks.handlers.set(channel, handler);
    })
  }
}));

vi.mock('../../../../../../electron/main/modules/chat/runtime/service.mjs', () => ({
  chatRuntimeService: {
    recoverInterruptedCompactions: mocks.recoverInterruptedCompactions,
    listRecoverySnapshots: mocks.listRecoverySnapshots,
    estimateContext: mocks.estimateContext,
    compact: mocks.compact,
    submitToolActivity: mocks.submitToolActivity,
    controlTool: mocks.controlTool
  }
}));

vi.mock('../../../../../../electron/main/modules/chat/service.mjs', () => ({
  chatSessionManager: {
    getSessionsByType: vi.fn(),
    createSession: vi.fn(),
    getSessionById: mocks.getSessionById,
    branchSession: mocks.branchSession,
    updateSessionTitle: vi.fn(),
    updateSessionModel: vi.fn(),
    deleteSession: mocks.deleteSession,
    getSessionUsage: vi.fn(),
    getMessages: mocks.getMessages,
    addMessage: mocks.addMessage,
    updateMessage: mocks.updateMessage,
    deleteMessage: mocks.deleteMessage,
    setSessionMessages: mocks.setSessionMessages
  }
}));

describe('chat runtime recovery IPC', (): void => {
  beforeEach((): void => {
    mocks.handlers.clear();
    mocks.recoverInterruptedCompactions.mockReset();
    mocks.recoverInterruptedCompactions.mockResolvedValue(undefined);
    mocks.listRecoverySnapshots.mockReset();
    mocks.estimateContext.mockReset();
    mocks.compact.mockReset();
    mocks.submitToolActivity.mockReset();
    mocks.controlTool.mockReset();
    mocks.getMessages.mockReset();
    mocks.addMessage.mockReset();
    mocks.updateMessage.mockReset();
    mocks.deleteMessage.mockReset();
    mocks.setSessionMessages.mockReset();
    mocks.branchSession.mockReset();
    mocks.deleteSession.mockReset();
    mocks.getSessionById.mockReset();
    mocks.getSessionById.mockReturnValue({ id: 'session-1' });
  });

  it('returns active runtime recovery snapshots through the standard result envelope', async (): Promise<void> => {
    const snapshots: ChatRuntimeRecoverySnapshot[] = [
      {
        runtimeId: 'runtime-1',
        sessionId: 'session-1',
        turnId: 'turn-1',
        clientId: 'bchat',
        agentId: 'primary',
        rootRuntimeId: 'runtime-1',
        phase: 'streaming',
        createdAt: 1,
        pendingRequests: []
      }
    ];
    mocks.listRecoverySnapshots.mockReturnValue(snapshots);
    registerChatRuntimeHandlers();

    const handler = mocks.handlers.get('chat:runtime:list-active');
    if (!handler) throw new Error('list-active handler was not registered');
    const result = (await handler({})) as ChatRuntimeHandlerResult<ChatRuntimeRecoverySnapshot[]>;

    expect(mocks.recoverInterruptedCompactions).toHaveBeenCalledOnce();
    expect(result).toEqual({ ok: true, data: snapshots });
  });

  it('registers the manual compaction command with the standard result envelope', async (): Promise<void> => {
    mocks.compact.mockResolvedValue({ runtimeId: 'runtime-compact', sessionId: 'session-1' });
    registerChatRuntimeHandlers();

    const handler = mocks.handlers.get('chat:runtime:compact');
    if (!handler) throw new Error('compact handler was not registered');
    const input = { runtimeId: 'runtime-compact', sessionId: 'session-1', clientId: 'bchat', agentId: 'primary', contextWindow: 12_000 };
    const result = await handler({}, input);

    expect(mocks.compact).toHaveBeenCalledWith(input);
    expect(result).toEqual({ ok: true, data: { runtimeId: 'runtime-compact', sessionId: 'session-1' } });
  });

  it('rejects a Runtime start after its explicit Session has already been deleted', async (): Promise<void> => {
    mocks.getSessionById.mockReturnValue(undefined);
    mocks.compact.mockResolvedValue({ runtimeId: 'runtime-compact', sessionId: 'session-deleted' });
    registerChatRuntimeHandlers();

    const handler = mocks.handlers.get('chat:runtime:compact');
    if (!handler) throw new Error('compact handler was not registered');
    const input = { runtimeId: 'runtime-compact', sessionId: 'session-deleted', clientId: 'bchat', agentId: 'primary', contextWindow: 12_000 };
    const result = await handler({}, input);

    expect(result).toMatchObject({ ok: false, code: 'SESSION_NOT_FOUND' });
    expect(mocks.compact).not.toHaveBeenCalled();
  });

  it('registers the idle context estimate query with the standard result envelope', async (): Promise<void> => {
    const input = { sessionId: 'session-1', contextWindow: 1_000_000 };
    const snapshot = { usedTokens: 54_700, contextWindow: 1_000_000 };
    mocks.estimateContext.mockResolvedValue(snapshot);
    registerChatRuntimeHandlers();

    const handler = mocks.handlers.get('chat:runtime:estimate-context');
    if (!handler) throw new Error('estimate-context handler was not registered');
    const result = await handler({}, input);

    expect(mocks.estimateContext).toHaveBeenCalledWith(input);
    expect(result).toEqual({ ok: true, data: snapshot });
  });

  it('rejects history mutations while allowing reads through a shared continuation fence', async (): Promise<void> => {
    mocks.getMessages.mockReturnValue([{ id: 'message-1' }]);
    registerChatHandlers();
    const fence = chatRuntimeLocks.acquireContinuationFence({
      scope: 'session:session-fenced/history',
      checkpointId: 'checkpoint-1'
    });
    if (!fence) throw new Error('Test continuation fence must be acquired');

    try {
      const mutationCases: Array<{ channel: string; args: unknown[]; mutation: ReturnType<typeof vi.fn> }> = [
        { channel: 'chat:session:branch', args: ['session-fenced', 'message-1'], mutation: mocks.branchSession },
        { channel: 'chat:session:delete', args: ['session-fenced'], mutation: mocks.deleteSession },
        { channel: 'chat:message:add', args: [{ id: 'message-2', sessionId: 'session-fenced' }], mutation: mocks.addMessage },
        { channel: 'chat:message:update', args: [{ id: 'message-2', sessionId: 'session-fenced' }], mutation: mocks.updateMessage },
        { channel: 'chat:message:delete', args: ['session-fenced', 'message-2'], mutation: mocks.deleteMessage },
        { channel: 'chat:message:setAll', args: ['session-fenced', []], mutation: mocks.setSessionMessages }
      ];
      for (const testCase of mutationCases) {
        const handler = mocks.handlers.get(testCase.channel);
        if (!handler) throw new Error(`${testCase.channel} handler was not registered`);
        // eslint-disable-next-line no-await-in-loop
        const result = await handler({}, ...testCase.args);
        expect(result).toMatchObject({ ok: false, code: 'TURN_WAITING_CHILDREN' });
        expect(testCase.mutation).not.toHaveBeenCalled();
      }

      const readHandler = mocks.handlers.get('chat:message:list');
      if (!readHandler) throw new Error('chat:message:list handler was not registered');
      expect(await readHandler({}, 'session-fenced')).toEqual({ ok: true, data: [{ id: 'message-1' }] });
      expect(mocks.getMessages).toHaveBeenCalledWith('session-fenced', undefined);
    } finally {
      fence.release();
    }
  });

  it('rejects session deletion while a main Runtime owns the writing lock', async (): Promise<void> => {
    registerChatHandlers();
    const lock = chatRuntimeLocks.acquireWritingLock({ sessionId: 'session-running', runtimeId: 'runtime-1' });
    expect(lock).toEqual({ ok: true });

    try {
      const handler = mocks.handlers.get('chat:session:delete');
      if (!handler) throw new Error('chat:session:delete handler was not registered');

      expect(await handler({}, 'session-running')).toMatchObject({ ok: false, code: 'SESSION_BUSY' });
      expect(mocks.deleteSession).not.toHaveBeenCalled();
    } finally {
      chatRuntimeLocks.releaseWritingLock({ sessionId: 'session-running', runtimeId: 'runtime-1' });
    }
  });

  it('recovers Agent delegations after database initialization and before IPC registration', (): void => {
    const startupSource = readFileSync('electron/main/index.mts', 'utf8');
    const databaseIndex = startupSource.indexOf('await initDatabase()');
    const recoveryIndex = startupSource.indexOf('await recoverChatAgentDelegations()');
    const ipcIndex = startupSource.indexOf('registerAllIpcHandlers()');

    expect(databaseIndex).toBeGreaterThan(-1);
    expect(recoveryIndex).toBeGreaterThan(databaseIndex);
    expect(ipcIndex).toBeGreaterThan(recoveryIndex);
  });

  it('exposes tool activity and scoped tool control through preload channels', (): void => {
    const preloadSource = readFileSync('electron/preload/index.mts', 'utf8');

    expect(preloadSource).toContain("chatRuntimeSubmitToolActivity: (input) => ipcRenderer.invoke('chat:runtime:tool-activity', input)");
    expect(preloadSource).toContain("chatRuntimeControlTool: (input) => ipcRenderer.invoke('chat:runtime:tool-control', input)");
  });

  it('routes tool activity and scoped controls through runtime handlers', async (): Promise<void> => {
    mocks.submitToolActivity.mockResolvedValue(undefined);
    mocks.controlTool.mockResolvedValue(undefined);
    registerChatRuntimeHandlers();
    const activityHandler = mocks.handlers.get('chat:runtime:tool-activity');
    const controlHandler = mocks.handlers.get('chat:runtime:tool-control');
    if (!activityHandler || !controlHandler) throw new Error('tool activity handlers were not registered');
    const activity = {
      runtimeId: 'runtime-1',
      toolCallId: 'tool-1',
      sequence: 1,
      occurredAt: 1,
      activity: { kind: 'started' }
    };
    const control = { runtimeId: 'runtime-1', toolCallId: 'tool-1', action: 'stop' };

    expect(await activityHandler({}, activity)).toEqual({ ok: true, data: undefined });
    expect(await controlHandler({}, control)).toEqual({ ok: true, data: undefined });
    expect(mocks.submitToolActivity).toHaveBeenCalledWith(activity);
    expect(mocks.controlTool).toHaveBeenCalledWith(control);
  });
});
