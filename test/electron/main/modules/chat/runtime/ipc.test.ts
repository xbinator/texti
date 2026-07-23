/**
 * @file ipc.test.ts
 * @description ChatRuntime 恢复 IPC 注册测试。
 */
import type { ChatRuntimeHandlerResult, ChatRuntimeRecoverySnapshot } from 'types/chat-runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerChatRuntimeHandlers } from '../../../../../../electron/main/modules/chat/runtime/ipc.mjs';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
  recoverInterruptedCompactions: vi.fn(),
  listRecoverySnapshots: vi.fn(),
  estimateContext: vi.fn(),
  compact: vi.fn()
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
    compact: mocks.compact
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
});
