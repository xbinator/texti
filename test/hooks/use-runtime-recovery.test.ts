/**
 * @file use-runtime-recovery.test.ts
 * @description renderer 启动时 ChatRuntime 恢复测试。
 * @vitest-environment jsdom
 */
import type { ChatRuntimeRecoverySnapshot } from 'types/chat-runtime';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createChatActorSystem } from '@/ai/chat/actorSystem';
import { recoverRuntimes } from '@/hooks/useChat/useRuntimeRecovery';
import { useChatTabStore } from '@/stores/chat/tab';
import { useSettingStore } from '@/stores/ui/setting';
import { useTabsStore } from '@/stores/workspace/tabs';

const electronAPIMock = vi.hoisted(() => ({
  chatRuntimeListActive: vi.fn(),
  chatRuntimeAbort: vi.fn(),
  chatRuntimeSubmitToolResult: vi.fn(),
  chatRuntimeSubmitBridgeResponse: vi.fn()
}));

vi.mock('@/shared/platform/electron-api', () => ({
  getElectronAPI: (): typeof electronAPIMock => electronAPIMock
}));

/** 创建包含三类待处理请求的恢复快照。 */
function createSnapshot(): ChatRuntimeRecoverySnapshot {
  const base = {
    runtimeId: 'runtime-1',
    sessionId: 'session-1',
    turnId: 'turn-1',
    clientId: 'bchat',
    agentId: 'primary',
    rootRuntimeId: 'runtime-1'
  };
  return {
    ...base,
    phase: 'streaming',
    createdAt: 1,
    capabilities: { rendererToolNames: ['read_current_document'], documentId: 'document-1' },
    pendingRequests: [
      { type: 'tool', event: { ...base, toolCallId: 'tool-call-1', toolName: 'read_current_document', input: {} } },
      {
        type: 'confirmation',
        event: {
          ...base,
          confirmationId: 'confirmation-1',
          request: { toolName: 'write_file', title: '写入文件', description: '是否写入？', riskLevel: 'write' }
        }
      },
      { type: 'bridge', event: { ...base, requestId: 'bridge-1', kind: 'document-snapshot' } }
    ]
  };
}

describe('recoverRuntimes', (): void => {
  beforeEach((): void => {
    setActivePinia(createPinia());
    electronAPIMock.chatRuntimeListActive.mockReset();
    electronAPIMock.chatRuntimeAbort.mockReset();
    electronAPIMock.chatRuntimeAbort.mockResolvedValue({ ok: true, data: {} });
    electronAPIMock.chatRuntimeSubmitToolResult.mockReset();
    electronAPIMock.chatRuntimeSubmitBridgeResponse.mockReset();
  });

  it('hydrates actors, replays confirmation, and resolves degraded renderer requests', async (): Promise<void> => {
    const snapshot = createSnapshot();
    useTabsStore().tabs = [{ id: 'chat:session-1', path: '/chat/session-1', title: '会话 1', cacheKey: 'chat:session-1' }];
    electronAPIMock.chatRuntimeListActive.mockResolvedValue({ ok: true, data: [snapshot] });
    electronAPIMock.chatRuntimeSubmitToolResult.mockResolvedValue({ ok: true });
    electronAPIMock.chatRuntimeSubmitBridgeResponse.mockResolvedValue({ ok: true });
    const system = createChatActorSystem();
    system.start();

    await recoverRuntimes(system);

    expect(system.getSession('session-1')?.getSnapshot().matches('waitingForUser')).toBe(true);
    expect(system.getRuntimeCapabilities('runtime-1')?.documentId).toBe('document-1');
    expect(electronAPIMock.chatRuntimeSubmitToolResult).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimeId: 'runtime-1',
        result: expect.objectContaining({ status: 'failure', error: expect.objectContaining({ code: 'RUNTIME_INTERRUPTED' }) })
      })
    );
    expect(electronAPIMock.chatRuntimeSubmitBridgeResponse).toHaveBeenCalledWith(
      expect.objectContaining({ runtimeId: 'runtime-1', result: expect.objectContaining({ status: 'failure' }) })
    );
    const runtimeStore = useChatTabStore();
    expect(runtimeStore.getStatus('chat:session-1')).toBe('waiting');
    const confirmationListener = vi.fn();
    system.subscribeSessionEvents('session-1', confirmationListener);
    expect(confirmationListener).toHaveBeenCalledWith(expect.objectContaining({ type: 'confirmationRequested' }));
    system.stop();
  });

  it('retries a still-pending renderer request on the authoritative second snapshot', async (): Promise<void> => {
    const snapshot = createSnapshot();
    electronAPIMock.chatRuntimeListActive.mockResolvedValue({ ok: true, data: [snapshot] });
    electronAPIMock.chatRuntimeSubmitToolResult
      .mockResolvedValueOnce({ ok: false, error: 'temporary failure', code: 'IPC_FAILED' })
      .mockResolvedValueOnce({ ok: true });
    electronAPIMock.chatRuntimeSubmitBridgeResponse.mockResolvedValue({ ok: true });
    const system = createChatActorSystem();
    system.start();

    await recoverRuntimes(system);

    expect(electronAPIMock.chatRuntimeSubmitToolResult).toHaveBeenCalledTimes(2);
    expect(electronAPIMock.chatRuntimeSubmitToolResult.mock.invocationCallOrder[1]).toBeLessThan(
      electronAPIMock.chatRuntimeSubmitBridgeResponse.mock.invocationCallOrder[0]
    );
    system.stop();
  });

  it('backs off twice before replaying later requests in order', async (): Promise<void> => {
    vi.useFakeTimers();
    const snapshot = createSnapshot();
    electronAPIMock.chatRuntimeListActive.mockResolvedValue({ ok: true, data: [snapshot] });
    electronAPIMock.chatRuntimeSubmitToolResult
      .mockResolvedValueOnce({ ok: false, error: 'first', code: 'IPC_FAILED' })
      .mockResolvedValueOnce({ ok: false, error: 'second', code: 'IPC_FAILED' })
      .mockResolvedValueOnce({ ok: false, error: 'third', code: 'IPC_FAILED' })
      .mockResolvedValueOnce({ ok: true });
    electronAPIMock.chatRuntimeSubmitBridgeResponse.mockResolvedValue({ ok: true });
    const system = createChatActorSystem();
    system.start();
    const recoveryOutcome = recoverRuntimes(system).then(
      (): { error: null } => ({ error: null }),
      (error: unknown): { error: unknown } => ({ error })
    );

    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(electronAPIMock.chatRuntimeSubmitToolResult).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(49);
      expect(electronAPIMock.chatRuntimeSubmitToolResult).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(electronAPIMock.chatRuntimeSubmitToolResult).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(99);
      expect(electronAPIMock.chatRuntimeSubmitToolResult).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(1);

      expect((await recoveryOutcome).error).toBeNull();
      expect(electronAPIMock.chatRuntimeSubmitToolResult).toHaveBeenCalledTimes(4);
      expect(electronAPIMock.chatRuntimeSubmitToolResult.mock.invocationCallOrder[3]).toBeLessThan(
        electronAPIMock.chatRuntimeSubmitBridgeResponse.mock.invocationCallOrder[0]
      );
    } finally {
      system.stop();
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('rejects after bounded replay retries without executing later requests', async (): Promise<void> => {
    vi.useFakeTimers();
    const snapshot = createSnapshot();
    electronAPIMock.chatRuntimeListActive.mockResolvedValue({ ok: true, data: [snapshot] });
    electronAPIMock.chatRuntimeSubmitToolResult
      .mockResolvedValueOnce({ ok: false, error: 'first', code: 'IPC_FAILED' })
      .mockResolvedValueOnce({ ok: false, error: 'second', code: 'IPC_FAILED' })
      .mockResolvedValueOnce({ ok: false, error: 'third', code: 'IPC_FAILED' })
      .mockResolvedValueOnce({ ok: false, error: 'fourth', code: 'IPC_FAILED' });
    electronAPIMock.chatRuntimeSubmitBridgeResponse.mockResolvedValue({ ok: true });
    const system = createChatActorSystem();
    system.start();
    const recoveryOutcome = recoverRuntimes(system).then(
      (): { error: null } => ({ error: null }),
      (error: unknown): { error: unknown } => ({ error })
    );

    try {
      await vi.advanceTimersByTimeAsync(150);
      const { error } = await recoveryOutcome;

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe('fourth');
      expect(electronAPIMock.chatRuntimeSubmitToolResult).toHaveBeenCalledTimes(4);
      expect(electronAPIMock.chatRuntimeSubmitBridgeResponse).not.toHaveBeenCalled();
    } finally {
      system.stop();
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('removes a runtime that completes between recovery queries', async (): Promise<void> => {
    const snapshot = createSnapshot();
    useTabsStore().tabs = [{ id: 'chat:session-1', path: '/chat/session-1', title: '会话 1', cacheKey: 'chat:session-1' }];
    electronAPIMock.chatRuntimeListActive.mockResolvedValueOnce({ ok: true, data: [snapshot] }).mockResolvedValueOnce({ ok: true, data: [] });
    electronAPIMock.chatRuntimeSubmitToolResult.mockResolvedValue({ ok: true });
    electronAPIMock.chatRuntimeSubmitBridgeResponse.mockResolvedValue({ ok: true });
    const system = createChatActorSystem();
    system.start();

    await recoverRuntimes(system);

    expect(system.actor.getSnapshot().context.runtimeRoutes.has('runtime-1')).toBe(false);
    expect(system.getSession('session-1')?.getSnapshot().matches('idle')).toBe(true);
    expect(useChatTabStore().getStatus('chat:session-1')).toBe('completed');
    system.stop();
  });

  it('does not mark a recovered completion unread when its tab is active', async (): Promise<void> => {
    const snapshot = createSnapshot();
    useTabsStore().tabs = [{ id: 'chat:session-1', path: '/chat/session-1', title: '会话 1', cacheKey: 'chat:session-1' }];
    electronAPIMock.chatRuntimeListActive.mockResolvedValueOnce({ ok: true, data: [snapshot] }).mockResolvedValueOnce({ ok: true, data: [] });
    electronAPIMock.chatRuntimeSubmitToolResult.mockResolvedValue({ ok: true });
    electronAPIMock.chatRuntimeSubmitBridgeResponse.mockResolvedValue({ ok: true });
    const system = createChatActorSystem();
    system.start();

    await recoverRuntimes(system, { isTabActive: (tabId: string): boolean => tabId === 'chat:session-1' });

    expect(useChatTabStore().getStatus('chat:session-1')).toBe('idle');
    system.stop();
  });

  it('keeps a detached background binding when its top tab closes between recovery queries', async (): Promise<void> => {
    const snapshot = createSnapshot();
    const tabsStore = useTabsStore();
    const runtimeStore = useChatTabStore();
    tabsStore.tabs = [{ id: 'chat:session-1', path: '/chat/session-1', title: '会话 1', cacheKey: 'chat:session-1' }];
    electronAPIMock.chatRuntimeListActive
      .mockResolvedValueOnce({ ok: true, data: [snapshot] })
      .mockImplementationOnce(async (): Promise<{ ok: true; data: ChatRuntimeRecoverySnapshot[] }> => {
        tabsStore.tabs = [];
        runtimeStore.removeTab('chat:session-1');
        return { ok: true, data: [snapshot] };
      });
    electronAPIMock.chatRuntimeSubmitToolResult.mockResolvedValue({ ok: true });
    electronAPIMock.chatRuntimeSubmitBridgeResponse.mockResolvedValue({ ok: true });
    const system = createChatActorSystem();
    system.start();

    await recoverRuntimes(system);

    expect(runtimeStore.records['chat:session-1']).toMatchObject({ sessionId: 'session-1', status: 'waiting' });
    system.stop();
  });

  it('restores a running draft runtime to the persisted chat:new tab', async (): Promise<void> => {
    const snapshot = createSnapshot();
    useTabsStore().tabs = [{ id: 'chat:new', path: '/chat', title: '新会话', cacheKey: 'chat:new' }];
    electronAPIMock.chatRuntimeListActive.mockResolvedValue({ ok: true, data: [snapshot] });
    electronAPIMock.chatRuntimeSubmitToolResult.mockResolvedValue({ ok: true });
    electronAPIMock.chatRuntimeSubmitBridgeResponse.mockResolvedValue({ ok: true });
    const system = createChatActorSystem();
    system.start();

    await recoverRuntimes(system);

    const runtimeStore = useChatTabStore();
    expect(runtimeStore.findOwner('session-1')?.tabId).toBe('chat:new');
    expect(runtimeStore.getStatus('chat:new')).toBe('waiting');
    expect(runtimeStore.records['chat:session-1']).toBeUndefined();
    system.stop();
  });

  it('restores a recovered ChatSider runtime as a detached background record', async (): Promise<void> => {
    const snapshot = createSnapshot();
    useSettingStore().setChatSidebarActiveSessionId('session-1');
    electronAPIMock.chatRuntimeListActive.mockResolvedValue({ ok: true, data: [snapshot] });
    electronAPIMock.chatRuntimeSubmitToolResult.mockResolvedValue({ ok: true });
    electronAPIMock.chatRuntimeSubmitBridgeResponse.mockResolvedValue({ ok: true });
    const system = createChatActorSystem();
    system.start();

    await recoverRuntimes(system);

    const runtimeStore = useChatTabStore();
    expect(runtimeStore.findOwner('session-1')?.tabId).toBe('chat:session-1');
    expect(runtimeStore.records['chat:session-1']).toMatchObject({ sessionId: 'session-1', status: 'waiting' });
    expect(system.getSession('session-1')?.getSnapshot().matches('waitingForUser')).toBe(true);
    system.stop();
  });

  it('only rebuilds active runtimes and leaves delegation checkpoint recovery to the application hook', async (): Promise<void> => {
    electronAPIMock.chatRuntimeListActive.mockResolvedValue({ ok: true, data: [] });
    const system = createChatActorSystem();
    system.start();

    await recoverRuntimes(system);

    expect(electronAPIMock.chatRuntimeListActive).toHaveBeenCalledTimes(2);
    expect(system.actor.getSnapshot().context.runtimeRoutes.size).toBe(0);
    system.stop();
  });
});
