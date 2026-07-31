/**
 * @file use-chat-route.test.ts
 * @description ChatSider 会话路由协调测试。
 * @vitest-environment jsdom
 */
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatRoute } from '@/layouts/default/hooks/useChatRoute';
import { useChatTabStore } from '@/stores/chat/tab';
import { useSettingStore } from '@/stores/ui/setting';
import type { Tab } from '@/stores/workspace/tabs';
import { useTabsStore } from '@/stores/workspace/tabs';

const routerPushMock = vi.hoisted(() => vi.fn<(path: string) => Promise<unknown>>());
const routeMock = vi.hoisted(() => ({ fullPath: '/welcome' }));
const routeFailureMock = vi.hoisted(() => ({ type: 'aborted' }));
const removeRecentMock = vi.hoisted(() => vi.fn<(_id: string) => Promise<void>>());

vi.mock('vue-router', () => ({
  useRoute: (): typeof routeMock => routeMock,
  useRouter: (): { push: typeof routerPushMock } => ({ push: routerPushMock })
}));

vi.mock('@/router/navigation', () => ({
  isBlockingNavigationFailure: (result: unknown): boolean => result === routeFailureMock
}));

vi.mock('@/stores/workspace/recent', () => ({
  useRecentStore: () => ({
    removeFile: removeRecentMock
  })
}));

/**
 * 创建测试标签。
 * @param id - 标签 ID
 * @param path - 标签路径
 * @returns 标签数据
 */
function createTab(id: string, path: string): Tab {
  return { id, path, title: id, cacheKey: id };
}

const switchSessionMock = vi.fn<(sessionId: string) => Promise<void>>();
const openDraftSessionMock = vi.fn<() => Promise<void>>();
const syncDeletedSessionMock = vi.fn<(sessionId: string) => void>();

/**
 * 创建测试用聊天路由 API。
 * @returns 聊天路由 API
 */
function createRouteApi(): ReturnType<typeof useChatRoute> {
  return useChatRoute({
    openDraftSession: openDraftSessionMock,
    switchSession: switchSessionMock,
    syncDeletedSession: syncDeletedSessionMock
  });
}

describe('useChatRoute', (): void => {
  beforeEach((): void => {
    setActivePinia(createPinia());
    routerPushMock.mockReset();
    routerPushMock.mockResolvedValue(undefined);
    switchSessionMock.mockReset();
    switchSessionMock.mockResolvedValue();
    openDraftSessionMock.mockReset();
    openDraftSessionMock.mockResolvedValue();
    syncDeletedSessionMock.mockReset();
    removeRecentMock.mockReset();
    removeRecentMock.mockResolvedValue(undefined);
    routeMock.fullPath = '/welcome';
  });

  it('normalizes a persisted chat tab', (): void => {
    useTabsStore().tabs = [createTab('chat:session-a', '/chat/session-a')];

    expect(createRouteApi().resolveRoute('session-a')).toEqual({
      tabId: 'chat:session-a',
      path: '/chat/session-a',
      sessionId: 'session-a'
    });
  });

  it('normalizes a runtime-owned draft session', (): void => {
    useTabsStore().tabs = [createTab('chat:new', '/chat')];
    useChatTabStore().ensureTab('chat:new', 'session-a');

    expect(createRouteApi().resolveRoute('session-a')).toEqual({
      tabId: 'chat:new',
      path: '/chat',
      sessionId: 'session-a'
    });
  });

  it('does not treat a detached runtime record as a visible page owner', (): void => {
    useChatTabStore().ensureTab('chat:session-a', 'session-a');

    expect(createRouteApi().resolveRoute('session-a')).toBeUndefined();
  });

  it('finds the unique blank draft without inventing a session id', (): void => {
    useTabsStore().tabs = [createTab('chat:new', '/chat')];

    expect(createRouteApi().resolveRoute()).toEqual({
      tabId: 'chat:new',
      path: '/chat'
    });
  });

  it('returns undefined when no chat owner exists', (): void => {
    expect(createRouteApi().resolveRoute('missing')).toBeUndefined();
  });

  it('opens the current side session in a chat page and resets the side draft', async (): Promise<void> => {
    useSettingStore().setChatSidebarActiveSessionId('session-a');

    await createRouteApi().openChatPage();

    expect(routerPushMock).toHaveBeenCalledWith('/chat/session-a');
    expect(openDraftSessionMock).toHaveBeenCalledOnce();
  });

  it('requests focus for an already-owned chat page after opening it', async (): Promise<void> => {
    useSettingStore().setChatSidebarActiveSessionId('session-a');
    useTabsStore().tabs = [createTab('chat:session-a', '/chat/session-a')];
    const runtimeStore = useChatTabStore();
    runtimeStore.ensureTab('chat:session-a', 'session-a');

    await createRouteApi().openChatPage();

    expect(routerPushMock).toHaveBeenCalledWith('/chat/session-a');
    expect(runtimeStore.records['chat:session-a']?.focusRequestId).toBe(1);
    expect(openDraftSessionMock).toHaveBeenCalledOnce();
  });

  it('keeps the side session when opening a chat page fails', async (): Promise<void> => {
    useSettingStore().setChatSidebarActiveSessionId('session-a');
    routerPushMock.mockResolvedValue(routeFailureMock);

    await createRouteApi().openChatPage();

    expect(openDraftSessionMock).not.toHaveBeenCalled();
  });

  it('navigates to an already-owned session instead of switching the side chat', async (): Promise<void> => {
    useTabsStore().tabs = [createTab('chat:session-a', '/chat/session-a')];

    await createRouteApi().handleSwitchSession('session-a');

    expect(routerPushMock).toHaveBeenCalledWith('/chat/session-a');
    expect(switchSessionMock).not.toHaveBeenCalled();
  });

  it('requests focus after switching to an already-owned chat page', async (): Promise<void> => {
    useTabsStore().tabs = [createTab('chat:session-a', '/chat/session-a')];
    const runtimeStore = useChatTabStore();
    runtimeStore.ensureTab('chat:session-a', 'session-a');

    await createRouteApi().handleSwitchSession('session-a');

    expect(routerPushMock).toHaveBeenCalledWith('/chat/session-a');
    expect(runtimeStore.records['chat:session-a']?.focusRequestId).toBe(1);
    expect(switchSessionMock).not.toHaveBeenCalled();
  });

  it('delegates to the side session switch when no chat page owns the session', async (): Promise<void> => {
    await createRouteApi().handleSwitchSession('session-a');

    expect(routerPushMock).not.toHaveBeenCalled();
    expect(switchSessionMock).toHaveBeenCalledWith('session-a');
  });

  it('switches a detached running session into ChatSider instead of navigating', async (): Promise<void> => {
    const runtimeStore = useChatTabStore();
    runtimeStore.ensureTab('chat:session-a', 'session-a');
    runtimeStore.setStatus('chat:session-a', 'running');

    await createRouteApi().handleSwitchSession('session-a');

    expect(routerPushMock).not.toHaveBeenCalled();
    expect(switchSessionMock).toHaveBeenCalledWith('session-a');
  });

  it('syncs deleted side state and closes the owning chat tab', async (): Promise<void> => {
    routeMock.fullPath = '/chat/session-a';
    const tabsStore = useTabsStore();
    tabsStore.tabs = [createTab('chat:session-a', '/chat/session-a'), createTab('welcome', '/welcome')];
    useChatTabStore().ensureTab('chat:session-a', 'session-a');

    await createRouteApi().handleDeletedSession('session-a');

    expect(syncDeletedSessionMock).toHaveBeenCalledWith('session-a');
    expect(tabsStore.tabs.map((tab: Tab): string => tab.id)).toEqual(['welcome']);
    expect(useChatTabStore().records['chat:session-a']).toBeUndefined();
    expect(routerPushMock).toHaveBeenCalledWith('/welcome');
  });

  it('removes the matching chat recent record after deleting a session', async (): Promise<void> => {
    await createRouteApi().handleDeletedSession('session-a');

    expect(removeRecentMock).toHaveBeenCalledWith('chat:session-a');
    expect(syncDeletedSessionMock).toHaveBeenCalledWith('session-a');
  });

  it('removes a sidebar-only runtime owner after deleting a session', async (): Promise<void> => {
    const runtimeStore = useChatTabStore();
    runtimeStore.ensureTab('chat:session-a', 'session-a');

    await createRouteApi().handleDeletedSession('session-a');

    expect(runtimeStore.findOwner('session-a')).toBeUndefined();
  });

  it('clears the deleted-session tab and Runtime owner when fallback navigation is blocked', async (): Promise<void> => {
    routeMock.fullPath = '/chat/session-a';
    const tabsStore = useTabsStore();
    const runtimeStore = useChatTabStore();
    tabsStore.tabs = [createTab('chat:session-a', '/chat/session-a')];
    runtimeStore.ensureTab('chat:session-a', 'session-a');
    routerPushMock.mockResolvedValue(routeFailureMock);

    await createRouteApi().handleDeletedSession('session-a');

    expect(syncDeletedSessionMock).toHaveBeenCalledWith('session-a');
    expect(routerPushMock).toHaveBeenCalledWith('/welcome');
    expect(tabsStore.tabs).toHaveLength(0);
    expect(runtimeStore.records['chat:session-a']).toBeUndefined();
  });
});
