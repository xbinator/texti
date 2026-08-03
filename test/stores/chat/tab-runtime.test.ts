/**
 * @file tab-runtime.test.ts
 * @description 聊天标签运行时归属、状态与后台分离测试。
 * @vitest-environment jsdom
 */
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { isActiveRuntimeStatus, useChatTabStore } from '@/stores/chat/tab';
import type { Tab } from '@/stores/workspace/tabs';
import { useTabsStore } from '@/stores/workspace/tabs';

/**
 * 创建聊天标签测试数据。
 * @param id - 标签 ID
 * @returns 标签数据
 */
function createTab(id: string): Tab {
  return {
    id,
    path: id === 'chat:new' ? '/chat' : `/chat/${id.slice('chat:'.length)}`,
    title: id,
    cacheKey: id
  };
}

describe('chat tab runtime store', (): void => {
  beforeEach((): void => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  it('promotes draft ownership to the persisted tab', (): void => {
    const store = useChatTabStore();
    const tabsStore = useTabsStore();
    tabsStore.tabs = [createTab('chat:new')];
    store.ensureTab('chat:new');
    store.bindSession('chat:new', 'session-a');
    store.setStatus('chat:new', 'running');
    tabsStore.tabs = [createTab('chat:session-a')];

    store.promoteTab('chat:new', 'chat:session-a', 'session-a');

    expect(store.findOwner('session-a')?.tabId).toBe('chat:session-a');
    expect(store.records['chat:new']).toBeUndefined();
    expect(tabsStore.tabs[0]?.status).toBe('loading');
  });

  it('keeps completed unread until the tab is viewed', (): void => {
    const store = useChatTabStore();
    const tabsStore = useTabsStore();
    tabsStore.tabs = [createTab('chat:session-a')];
    store.ensureTab('chat:session-a', 'session-a');
    store.setStatus('chat:session-a', 'running');
    store.markCompleted('chat:session-a', false);
    store.setStatus('chat:session-a', 'idle');

    expect(store.getStatus('chat:session-a')).toBe('completed');
    expect(tabsStore.tabs[0]?.status).toBe('completed');
    store.markViewed('chat:session-a');
    expect(store.getStatus('chat:session-a')).toBe('idle');
    expect(tabsStore.tabs[0]?.status).toBeUndefined();
  });

  it('does not mark an active completed tab as unread', (): void => {
    const store = useChatTabStore();
    const tabsStore = useTabsStore();
    tabsStore.tabs = [createTab('chat:session-a')];
    store.ensureTab('chat:session-a', 'session-a');
    store.setStatus('chat:session-a', 'running');

    store.markCompleted('chat:session-a', true);

    expect(store.getStatus('chat:session-a')).toBe('idle');
    expect(tabsStore.tabs[0]?.status).toBeUndefined();
  });

  it.each([
    ['running', 'loading'],
    ['waiting', 'attention']
  ] as const)('hides viewed %s state while preserving its resumable runtime status', (status, expectedTabStatus): void => {
    const tabsStore = useTabsStore();
    tabsStore.tabs = [createTab('chat:session-a')];
    const store = useChatTabStore();
    store.ensureTab('chat:session-a', 'session-a');
    store.setStatus('chat:session-a', status);

    store.markViewed('chat:session-a');

    expect(store.getStatus('chat:session-a')).toBe(status);
    expect(tabsStore.tabs[0]?.status).toBeUndefined();
    store.syncStatus('chat:session-a');
    expect(tabsStore.tabs[0]?.status).toBe(expectedTabStatus);
  });

  it.each(['error', 'completed'] as const)('acknowledges viewed %s status as idle', (status): void => {
    const tabsStore = useTabsStore();
    tabsStore.tabs = [createTab('chat:session-a')];
    const store = useChatTabStore();
    store.ensureTab('chat:session-a', 'session-a');
    if (status === 'completed') store.markCompleted('chat:session-a', false);
    else store.setStatus('chat:session-a', status);

    store.markViewed('chat:session-a');

    expect(store.getStatus('chat:session-a')).toBe('idle');
    expect(tabsStore.tabs[0]?.status).toBeUndefined();
  });

  it('writes chat runtime states through to generic tab status', (): void => {
    const tabsStore = useTabsStore();
    tabsStore.tabs = [createTab('chat:running'), createTab('chat:waiting'), createTab('chat:error'), createTab('chat:completed')];
    const store = useChatTabStore();
    store.ensureTab('chat:running');
    store.ensureTab('chat:waiting');
    store.ensureTab('chat:error');
    store.ensureTab('chat:completed');

    store.setStatus('chat:running', 'running');
    store.setStatus('chat:waiting', 'waiting');
    store.setStatus('chat:error', 'error');
    store.markCompleted('chat:completed', false);

    expect(tabsStore.tabs.map((tab: Tab): Tab['status'] => tab.status)).toEqual(['loading', 'attention', 'error', 'completed']);
  });

  it('clears generic status when removing a runtime record', (): void => {
    const tabsStore = useTabsStore();
    tabsStore.tabs = [createTab('chat:session-a')];
    const store = useChatTabStore();
    store.ensureTab('chat:session-a', 'session-a');
    store.setStatus('chat:session-a', 'running');

    store.removeTab('chat:session-a');

    expect(tabsStore.tabs[0]?.status).toBeUndefined();
  });

  it('keeps runtime record setup free of generic tab status side effects', (): void => {
    const tabsStore = useTabsStore();
    tabsStore.tabs = [{ ...createTab('chat:session-a'), status: 'attention' }];
    const store = useChatTabStore();

    store.ensureTab('chat:session-a');
    store.bindSession('chat:session-a', 'session-a');
    expect(tabsStore.tabs[0]?.status).toBe('attention');
  });

  it('restores an existing runtime status through an explicit action', (): void => {
    const store = useChatTabStore();
    const tabsStore = useTabsStore();
    store.ensureTab('chat:session-a', 'session-a');
    store.setStatus('chat:session-a', 'running');
    tabsStore.tabs = [createTab('chat:session-a')];

    store.syncStatus('chat:session-a');
    expect(tabsStore.tabs[0]?.status).toBe('loading');
  });

  it('stores only runtime ownership and status for a waiting tab', (): void => {
    const store = useChatTabStore();
    store.ensureTab('chat:session-a', 'session-a');
    store.setStatus('chat:session-a', 'waiting');

    expect(store.records['chat:session-a']).toEqual({ tabId: 'chat:session-a', sessionId: 'session-a', status: 'waiting' });
  });

  it('increments explicit focus requests for an existing chat tab', (): void => {
    const store = useChatTabStore();
    store.ensureTab('chat:session-a', 'session-a');

    store.requestFocus('chat:session-a');
    store.requestFocus('chat:session-a');
    store.requestFocus('chat:missing');

    expect(store.records['chat:session-a']?.focusRequestId).toBe(2);
    expect(store.records['chat:missing']).toBeUndefined();
  });

  it('classifies only running and waiting as active runtime states', (): void => {
    expect(isActiveRuntimeStatus('running')).toBe(true);
    expect(isActiveRuntimeStatus('waiting')).toBe(true);
    expect(isActiveRuntimeStatus('idle')).toBe(false);
    expect(isActiveRuntimeStatus('error')).toBe(false);
    expect(isActiveRuntimeStatus('completed')).toBe(false);
  });

  it('detaches a running persisted Runtime when its visible tab closes', (): void => {
    const store = useChatTabStore();
    const tabsStore = useTabsStore();
    tabsStore.tabs = [createTab('chat:session-a')];
    store.ensureTab('chat:session-a', 'session-a');
    store.setStatus('chat:session-a', 'running');
    store.markClosing(['chat:session-a']);

    store.closeTab('chat:session-a');

    expect(store.records['chat:session-a']).toEqual({ tabId: 'chat:session-a', sessionId: 'session-a', status: 'running' });
    expect(tabsStore.tabs[0]?.status).toBeUndefined();
    expect(store.isClosing('chat:session-a')).toBe(false);
  });

  it('rekeys a running draft Runtime to its persisted detached identity', (): void => {
    const store = useChatTabStore();
    store.ensureTab('chat:new');
    store.bindSession('chat:new', 'session-a');
    store.setStatus('chat:new', 'waiting');

    store.closeTab('chat:new');

    expect(store.records['chat:new']).toBeUndefined();
    expect(store.records['chat:session-a']).toEqual({ tabId: 'chat:session-a', sessionId: 'session-a', status: 'waiting' });
  });

  it('removes an idle Runtime record when its tab closes', (): void => {
    const store = useChatTabStore();
    store.ensureTab('chat:session-a', 'session-a');

    store.closeTab('chat:session-a');

    expect(store.records['chat:session-a']).toBeUndefined();
  });

  it('ignores late callbacks after a chat tab runtime is removed', (): void => {
    const store = useChatTabStore();
    store.ensureTab('chat:session-a', 'session-a');
    store.removeTab('chat:session-a');

    store.setStatus('chat:session-a', 'running');
    store.markCompleted('chat:session-a', false);
    store.bindSession('chat:session-a', 'session-b');
    store.promoteTab('chat:session-a', 'chat:session-b', 'session-b');

    expect(store.records).toEqual({});
  });

  it('tracks a close intent until it is cancelled or the runtime is removed', (): void => {
    const store = useChatTabStore();
    store.ensureTab('chat:session-a', 'session-a');

    store.markClosing(['chat:session-a']);
    expect(store.isClosing('chat:session-a')).toBe(true);

    store.clearClosing(['chat:session-a']);
    expect(store.isClosing('chat:session-a')).toBe(false);

    store.markClosing(['chat:session-a']);
    store.removeTab('chat:session-a');
    expect(store.isClosing('chat:session-a')).toBe(false);
  });

  it('tracks an in-flight tab promotion until it finishes or is removed', (): void => {
    const store = useChatTabStore();
    store.ensureTab('chat:session-a', 'session-a');

    store.markPromoting(['chat:session-a']);
    expect(store.isPromoting('chat:session-a')).toBe(true);

    store.clearPromoting(['chat:session-a']);
    expect(store.isPromoting('chat:session-a')).toBe(false);

    store.markPromoting(['chat:session-a']);
    store.removeTab('chat:session-a');
    expect(store.isPromoting('chat:session-a')).toBe(false);
  });
});
