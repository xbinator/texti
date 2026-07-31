/**
 * @file use-tab-close-guard.test.ts
 * @description 顶部标签关闭前置确认与聊天 Runtime 终止测试。
 * @vitest-environment jsdom
 */
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTabCloseGuard } from '@/layouts/default/hooks/useTabCloseGuard';
import { useChatTabStore } from '@/stores/chat/tab';
import type { TabClosePlan } from '@/stores/workspace/tabs';

const modalConfirmMock = vi.hoisted(() => vi.fn<(title: string, content: string) => Promise<[boolean, boolean]>>());

vi.mock('@/utils/modal', () => ({
  Modal: {
    confirm: modalConfirmMock
  }
}));

/**
 * 创建标签关闭计划。
 * @param overrides - 需要覆盖的关闭字段
 * @returns 完整关闭计划
 */
function createPlan(overrides: Partial<TabClosePlan> = {}): TabClosePlan {
  return {
    action: 'close',
    anchorTabId: 'chat:session-a',
    activeTabId: null,
    allowCloseLastTab: true,
    disabled: false,
    targetTabIds: [],
    dirtyTabIds: [],
    requiresConfirm: false,
    requiresNavigation: false,
    nextActivePath: null,
    ...overrides
  };
}

describe('useTabCloseGuard', (): void => {
  beforeEach((): void => {
    localStorage.clear();
    setActivePinia(createPinia());
    modalConfirmMock.mockReset();
    modalConfirmMock.mockResolvedValue([false, true]);
  });

  it('rejects a disabled close plan without prompting', async (): Promise<void> => {
    await expect(useTabCloseGuard().canClose(createPlan({ disabled: true }))).resolves.toBe(false);
    expect(modalConfirmMock).not.toHaveBeenCalled();
  });

  it('rejects a chat tab close while its identity promotion is in flight', async (): Promise<void> => {
    const runtimeStore = useChatTabStore();
    runtimeStore.ensureTab('chat:session-a', 'session-a');
    runtimeStore.markPromoting(['chat:session-a']);

    await expect(useTabCloseGuard().canClose(createPlan({ targetTabIds: ['chat:session-a'] }))).resolves.toBe(false);

    expect(runtimeStore.isClosing('chat:session-a')).toBe(false);
    expect(modalConfirmMock).not.toHaveBeenCalled();
  });

  it('allows a running Runtime tab to close without confirmation or abort', async (): Promise<void> => {
    const runtimeStore = useChatTabStore();
    runtimeStore.ensureTab('chat:session-a', 'session-a');
    runtimeStore.setStatus('chat:session-a', 'running');

    await expect(useTabCloseGuard().canClose(createPlan({ targetTabIds: ['chat:session-a'] }))).resolves.toBe(true);
    expect(modalConfirmMock).not.toHaveBeenCalled();
  });

  it('allows a running Runtime batch to close without Runtime confirmation', async (): Promise<void> => {
    const runtimeStore = useChatTabStore();
    runtimeStore.ensureTab('chat:session-a', 'session-a');
    runtimeStore.ensureTab('chat:session-b', 'session-b');
    runtimeStore.setStatus('chat:session-a', 'running');
    runtimeStore.setStatus('chat:session-b', 'waiting');

    await expect(useTabCloseGuard().canClose(createPlan({ action: 'closeAll', targetTabIds: ['chat:session-a', 'chat:session-b'] }))).resolves.toBe(true);
    expect(modalConfirmMock).not.toHaveBeenCalled();
  });

  it('keeps close intent after approval until cleanup or explicit cancellation', async (): Promise<void> => {
    const runtimeStore = useChatTabStore();
    runtimeStore.ensureTab('chat:session-a', 'session-a');
    const guard = useTabCloseGuard();

    await expect(guard.canClose(createPlan({ targetTabIds: ['chat:session-a'] }))).resolves.toBe(true);
    expect(runtimeStore.isClosing('chat:session-a')).toBe(true);

    guard.cancelClose(['chat:session-a']);
    expect(runtimeStore.isClosing('chat:session-a')).toBe(false);
  });

  it('retains the existing dirty confirmation result', async (): Promise<void> => {
    modalConfirmMock.mockResolvedValue([true, false]);

    await expect(useTabCloseGuard().canClose(createPlan({ requiresConfirm: true, dirtyTabIds: ['editor-a'] }))).resolves.toBe(false);
    expect(modalConfirmMock).toHaveBeenCalledWith('关闭标签', '当前标签有未保存更改，确认关闭吗？');
  });

  it('detaches running records and removes idle records after tabs have closed', (): void => {
    const runtimeStore = useChatTabStore();
    runtimeStore.ensureTab('chat:session-a', 'session-a');
    runtimeStore.ensureTab('chat:session-b', 'session-b');
    runtimeStore.setStatus('chat:session-a', 'running');

    useTabCloseGuard().cleanupClosedTabs(['chat:session-a', 'chat:session-b', 'editor-a']);

    expect(runtimeStore.records['chat:session-a']).toMatchObject({ sessionId: 'session-a', status: 'running' });
    expect(runtimeStore.records['chat:session-b']).toBeUndefined();
  });
});
