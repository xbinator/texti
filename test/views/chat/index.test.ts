/**
 * @file index.test.ts
 * @description 独立聊天页的标签归属、草稿晋升与后台状态测试。
 * @vitest-environment jsdom
 */
import type { ChatSession } from 'types/chat';
import type { ComponentPublicInstance } from 'vue';
import { defineComponent, nextTick, ref } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatTabStore } from '@/stores/chat/tab';
import { useSettingStore } from '@/stores/ui/setting';
import { useTabsStore } from '@/stores/workspace/tabs';
import ChatPage from '@/views/chat/index.vue';

const routerMocks = vi.hoisted(() => ({
  push: vi.fn<(path: string) => Promise<unknown>>(),
  replace: vi.fn<(path: string) => Promise<unknown>>(),
  route: {
    path: '/chat',
    fullPath: '/chat',
    params: {} as Record<string, string | string[] | undefined>
  }
}));

const routeFailureMock = vi.hoisted(() => ({ type: 'aborted' }));
const abortRuntimeMock = vi.hoisted(() => vi.fn<() => Promise<void>>());
const resetDraftMock = vi.hoisted(() => vi.fn<() => Promise<void>>());
const focusInputMock = vi.hoisted(() => vi.fn<() => void>());
const ensureSessionsMock = vi.hoisted(() => vi.fn<() => Promise<void>>());
const loadSessionByIdMock = vi.hoisted(() => vi.fn<(sessionId: string) => Promise<ChatSession | undefined>>());
const findSessionMock = vi.hoisted(() => vi.fn<(sessionId: string | null | undefined) => ChatSession | undefined>());
const addChatRecordMock = vi.hoisted(() => vi.fn<(_sessionId: string, _title: string) => Promise<unknown>>());
const touchChatRecordMock = vi.hoisted(() => vi.fn<(_id: string) => Promise<unknown>>());
const messageErrorMock = vi.hoisted(() => vi.fn());

vi.mock('ant-design-vue', () => ({
  message: {
    error: messageErrorMock
  }
}));

vi.mock('vue-router', () => ({
  useRoute: (): typeof routerMocks.route => routerMocks.route,
  useRouter: (): Pick<typeof routerMocks, 'push' | 'replace'> => routerMocks
}));

vi.mock('@/router/navigation', () => ({
  isBlockingNavigationFailure: (result: unknown): boolean => result === routeFailureMock
}));

vi.mock('@/stores/chat/session', () => ({
  useChatSessionStore: (): { ensureSessions: typeof ensureSessionsMock; loadSessionById: typeof loadSessionByIdMock; findSession: typeof findSessionMock } => ({
    ensureSessions: ensureSessionsMock,
    loadSessionById: loadSessionByIdMock,
    findSession: findSessionMock
  })
}));

vi.mock('@/stores/workspace/recent', () => ({
  useRecentStore: (): { addChatRecord: typeof addChatRecordMock; touchChatRecord: typeof touchChatRecordMock } => ({
    addChatRecord: addChatRecordMock,
    touchChatRecord: touchChatRecordMock
  })
}));

vi.mock('@/components/BChat/index.vue', () => ({
  default: {
    name: 'BChat',
    props: {
      sessionId: {
        type: String,
        default: null
      },
      workspaceControlEnabled: {
        type: Boolean,
        default: false
      }
    },
    emits: ['session-created', 'session-title-persisted', 'new-session', 'runtime-status-change', 'navigate-to-provider'],
    setup(
      _props: unknown,
      { expose }: { expose: (value: { abortRuntime: () => Promise<void>; focusInput: () => void; resetDraft: () => Promise<void> }) => void }
    ) {
      expose({ abortRuntime: abortRuntimeMock, focusInput: focusInputMock, resetDraft: resetDraftMock });
      return {};
    },
    template: '<div class="b-chat-page-stub"></div>'
  }
}));

/**
 * 创建测试聊天会话。
 * @param id - 会话 ID
 * @param title - 会话标题
 * @returns 会话数据
 */
function createSession(id: string, title: string): ChatSession {
  return {
    id,
    type: 'assistant',
    title,
    createdAt: '2026-07-21T00:00:00.000Z',
    updatedAt: '2026-07-21T00:00:00.000Z',
    lastMessageAt: '2026-07-21T00:00:00.000Z'
  };
}

/**
 * 挂载独立聊天页。
 * @param sessionId - 当前路由会话 ID
 * @returns 页面包装器
 */
function mountPage(sessionId: string | null): ReturnType<typeof mount> {
  routerMocks.route.params = sessionId ? { sessionId } : {};
  return mount(ChatPage);
}

/** 读取页面中的 BChat 实例。 */
function findBChat(wrapper: ReturnType<typeof mount>): ComponentPublicInstance {
  return wrapper.findComponent({ name: 'BChat' }).vm;
}

/**
 * 挂载 KeepAlive 包裹的独立聊天页。
 * @param sessionId - 当前路由会话 ID
 * @returns 页面可见状态
 */
function mountKeepAlivePage(sessionId: string | null): { visible: { value: boolean } } {
  const visible = ref<boolean>(true);
  routerMocks.route.params = sessionId ? { sessionId } : {};
  routerMocks.route.path = sessionId ? `/chat/${sessionId}` : '/chat';
  routerMocks.route.fullPath = routerMocks.route.path;
  mount(
    defineComponent({
      name: 'ChatPageKeepAliveHarness',
      components: { ChatPage },
      setup(): { visible: typeof visible } {
        return { visible };
      },
      template: '<KeepAlive><ChatPage v-if="visible" /></KeepAlive>'
    })
  );

  return { visible };
}

describe('chat page', (): void => {
  beforeEach((): void => {
    setActivePinia(createPinia());
    localStorage.clear();
    routerMocks.push.mockReset();
    routerMocks.replace.mockReset();
    routerMocks.push.mockResolvedValue(undefined);
    routerMocks.replace.mockResolvedValue(undefined);
    routerMocks.route.path = '/chat';
    routerMocks.route.fullPath = '/chat';
    routerMocks.route.params = {};
    abortRuntimeMock.mockReset();
    abortRuntimeMock.mockResolvedValue();
    resetDraftMock.mockReset();
    resetDraftMock.mockResolvedValue();
    focusInputMock.mockReset();
    ensureSessionsMock.mockReset();
    ensureSessionsMock.mockResolvedValue();
    loadSessionByIdMock.mockReset();
    loadSessionByIdMock.mockImplementation(async (sessionId: string): Promise<ChatSession | undefined> => findSessionMock(sessionId));
    findSessionMock.mockReset();
    addChatRecordMock.mockReset();
    addChatRecordMock.mockResolvedValue(undefined);
    touchChatRecordMock.mockReset();
    touchChatRecordMock.mockResolvedValue(undefined);
    messageErrorMock.mockReset();
  });

  it('ensures the shared session collection on mount', async (): Promise<void> => {
    mountPage('session-a');
    await flushPromises();

    expect(ensureSessionsMock).toHaveBeenCalledTimes(1);
  });

  it('keeps shared session initialization silent when loading fails', async (): Promise<void> => {
    ensureSessionsMock.mockRejectedValue(new Error('load failed'));

    mountPage('session-a');
    await flushPromises();

    expect(messageErrorMock).not.toHaveBeenCalled();
  });

  it('records the route session when shared session collection loading fails but direct session loading succeeds', async (): Promise<void> => {
    ensureSessionsMock.mockRejectedValue(new Error('load failed'));
    loadSessionByIdMock.mockResolvedValue(createSession('session-a', '会话 A'));

    mountPage('session-a');
    await flushPromises();

    expect(loadSessionByIdMock).toHaveBeenCalledWith('session-a');
    expect(addChatRecordMock).toHaveBeenCalledWith('session-a', '会话 A');
  });

  it('captures the route session for draft and persisted pages', (): void => {
    const draftWrapper = mountPage(null);
    const persistedWrapper = mountPage('session-a');

    expect(draftWrapper.findComponent({ name: 'BChat' }).props()).toEqual({ sessionId: null, workspaceControlEnabled: true });
    expect(persistedWrapper.findComponent({ name: 'BChat' }).props()).toEqual({ sessionId: 'session-a', workspaceControlEnabled: true });
  });

  it('releases a matching sidebar session when the chat page claims it', (): void => {
    const settingStore = useSettingStore();
    settingStore.setChatSidebarActiveSessionId('session-a');

    mountPage('session-a');

    expect(settingStore.chatSidebarActiveSessionId).toBeNull();
  });

  it('keeps an unrelated sidebar session when the chat page opens', (): void => {
    const settingStore = useSettingStore();
    settingStore.setChatSidebarActiveSessionId('session-b');

    mountPage('session-a');

    expect(settingStore.chatSidebarActiveSessionId).toBe('session-b');
  });

  it('keeps the captured session when the global route changes', async (): Promise<void> => {
    const wrapper = mountPage('session-a');

    routerMocks.route.params.sessionId = 'session-b';
    await nextTick();

    expect(wrapper.findComponent({ name: 'BChat' }).props('sessionId')).toBe('session-a');
  });

  it('focuses the smart editor when the page opens and activates again', async (): Promise<void> => {
    const { visible } = mountKeepAlivePage('session-a');
    await nextTick();

    expect(focusInputMock).toHaveBeenCalledTimes(1);

    visible.value = false;
    await nextTick();
    visible.value = true;
    await nextTick();
    await nextTick();

    expect(focusInputMock).toHaveBeenCalledTimes(2);
  });

  it('focuses the smart editor when the page mounts outside KeepAlive', async (): Promise<void> => {
    routerMocks.route.path = '/chat/session-a';
    routerMocks.route.fullPath = '/chat/session-a';

    mountPage('session-a');
    await nextTick();

    expect(focusInputMock).toHaveBeenCalledTimes(1);
  });

  it('focuses the smart editor when its active chat tab receives a focus request', async (): Promise<void> => {
    routerMocks.route.path = '/chat/session-a';
    routerMocks.route.fullPath = '/chat/session-a';
    const wrapper = mountPage('session-a');
    await nextTick();
    focusInputMock.mockClear();

    useChatTabStore().requestFocus('chat:session-a');
    await nextTick();
    await nextTick();

    expect(focusInputMock).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it('restores an existing runtime status when a background page is created', (): void => {
    routerMocks.route.path = '/welcome';
    routerMocks.route.fullPath = '/welcome';
    const runtimeStore = useChatTabStore();
    const tabsStore = useTabsStore();
    runtimeStore.ensureTab('chat:session-a', 'session-a');
    runtimeStore.setStatus('chat:session-a', 'running');
    tabsStore.tabs = [{ id: 'chat:session-a', path: '/chat/session-a', title: '会话 A', cacheKey: 'chat:session-a' }];

    mountPage('session-a');

    expect(tabsStore.tabs[0]?.status).toBe('loading');
  });

  it('syncs the persisted session title to the owning chat tab', async (): Promise<void> => {
    const tabsStore = useTabsStore();
    tabsStore.tabs = [{ id: 'chat:session-a', path: '/chat/session-a', title: '聊天', cacheKey: 'chat:session-a' }];
    findSessionMock.mockReturnValue(createSession('session-a', '会话 A'));

    mountPage('session-a');
    await flushPromises();

    expect(tabsStore.tabs[0]?.title).toBe('会话 A');
  });

  it('records persisted chat sessions in recent records after shared sessions load', async (): Promise<void> => {
    findSessionMock.mockReturnValue(createSession('session-a', '会话 A'));

    mountPage('session-a');
    await flushPromises();

    expect(addChatRecordMock).toHaveBeenCalledWith('session-a', '会话 A');
  });

  it('records a persisted chat session resolved outside the shared session list', async (): Promise<void> => {
    findSessionMock.mockReturnValue(undefined);
    loadSessionByIdMock.mockResolvedValue(createSession('session-a', '会话 A'));

    mountPage('session-a');
    await flushPromises();

    expect(loadSessionByIdMock).toHaveBeenCalledWith('session-a');
    expect(addChatRecordMock).toHaveBeenCalledWith('session-a', '会话 A');
  });

  it('does not record recent entries for missing persisted chat sessions', async (): Promise<void> => {
    findSessionMock.mockReturnValue(undefined);
    loadSessionByIdMock.mockResolvedValue(undefined);

    mountPage('missing-session');
    await flushPromises();

    expect(loadSessionByIdMock).toHaveBeenCalledWith('missing-session');
    expect(addChatRecordMock).not.toHaveBeenCalled();
    expect(touchChatRecordMock).not.toHaveBeenCalled();
  });

  it('does not record draft chat pages in recent records', async (): Promise<void> => {
    mountPage(null);
    await flushPromises();

    expect(addChatRecordMock).not.toHaveBeenCalled();
  });

  it('touches the chat recent record when the persisted title has not changed', async (): Promise<void> => {
    findSessionMock.mockReturnValue(createSession('session-a', '会话 A'));
    const wrapper = mountPage('session-a');
    await flushPromises();
    addChatRecordMock.mockClear();

    findBChat(wrapper).$emit('session-title-persisted', 'session-a', '会话 A');
    await flushPromises();

    expect(addChatRecordMock).not.toHaveBeenCalled();
    expect(touchChatRecordMock).toHaveBeenCalledWith('chat:session-a');
  });

  it('recreates a chat recent record when touching the existing record fails', async (): Promise<void> => {
    findSessionMock.mockReturnValue(createSession('session-a', '会话 A'));
    const wrapper = mountPage('session-a');
    await flushPromises();
    addChatRecordMock.mockClear();
    touchChatRecordMock.mockRejectedValueOnce(new Error('missing recent'));

    findBChat(wrapper).$emit('session-title-persisted', 'session-a', '会话 A');
    await flushPromises();

    expect(touchChatRecordMock).toHaveBeenCalledWith('chat:session-a');
    expect(addChatRecordMock).toHaveBeenCalledWith('session-a', '会话 A');
  });

  it('binds a draft session immediately but promotes only after runtime becomes idle', async (): Promise<void> => {
    const tabsStore = useTabsStore();
    const runtimeStore = useChatTabStore();
    tabsStore.tabs = [{ id: 'chat:new', path: '/chat', title: '新会话', cacheKey: 'chat:new' }];
    const wrapper = mountPage(null);

    findBChat(wrapper).$emit('runtime-status-change', { status: 'running' });
    findBChat(wrapper).$emit('session-created', createSession('session-a', '会话 A'));
    await flushPromises();

    expect(runtimeStore.findOwner('session-a')?.tabId).toBe('chat:new');
    expect(tabsStore.tabs[0]?.id).toBe('chat:new');
    expect(routerMocks.replace).not.toHaveBeenCalled();

    findBChat(wrapper).$emit('runtime-status-change', { status: 'idle' });
    await flushPromises();

    expect(tabsStore.tabs[0]).toMatchObject({ id: 'chat:session-a', path: '/chat/session-a', title: '会话 A' });
    expect(runtimeStore.findOwner('session-a')?.tabId).toBe('chat:session-a');
    expect(routerMocks.replace).toHaveBeenCalledWith('/chat/session-a');
  });

  it('promotes an inactive draft without replacing the unrelated active route', async (): Promise<void> => {
    routerMocks.route.path = '/welcome';
    routerMocks.route.fullPath = '/welcome';
    const tabsStore = useTabsStore();
    tabsStore.tabs = [
      { id: 'chat:new', path: '/chat', title: '新会话', cacheKey: 'chat:new' },
      { id: 'welcome', path: '/welcome', title: '欢迎', cacheKey: 'welcome' }
    ];
    const wrapper = mountPage(null);

    findBChat(wrapper).$emit('session-created', createSession('session-a', '会话 A'));
    findBChat(wrapper).$emit('runtime-status-change', { status: 'idle' });
    await flushPromises();

    expect(tabsStore.tabs[0]).toMatchObject({ id: 'chat:session-a', path: '/chat/session-a' });
    expect(routerMocks.replace).not.toHaveBeenCalled();
  });

  it('rolls back draft promotion when route replacement resolves with a navigation failure', async (): Promise<void> => {
    const tabsStore = useTabsStore();
    const runtimeStore = useChatTabStore();
    tabsStore.tabs = [{ id: 'chat:new', path: '/chat', title: '新会话', cacheKey: 'chat:new' }];
    routerMocks.replace.mockResolvedValue(routeFailureMock);
    const wrapper = mountPage(null);

    findBChat(wrapper).$emit('session-created', createSession('session-a', '会话 A'));
    findBChat(wrapper).$emit('runtime-status-change', { status: 'idle' });
    await flushPromises();

    expect(tabsStore.tabs[0]).toMatchObject({ id: 'chat:new', path: '/chat' });
    expect(runtimeStore.findOwner('session-a')?.tabId).toBe('chat:new');
  });

  it('defers draft promotion while its tab is closing and resumes after cancellation', async (): Promise<void> => {
    const tabsStore = useTabsStore();
    const runtimeStore = useChatTabStore();
    tabsStore.tabs = [{ id: 'chat:new', path: '/chat', title: '新会话', cacheKey: 'chat:new' }];
    const wrapper = mountPage(null);
    findBChat(wrapper).$emit('session-created', createSession('session-a', '会话 A'));
    runtimeStore.markClosing(['chat:new']);

    findBChat(wrapper).$emit('runtime-status-change', { status: 'idle' });
    await flushPromises();

    expect(tabsStore.tabs[0]?.id).toBe('chat:new');
    expect(routerMocks.replace).not.toHaveBeenCalled();

    runtimeStore.clearClosing(['chat:new']);
    await flushPromises();

    expect(tabsStore.tabs[0]?.id).toBe('chat:session-a');
    expect(routerMocks.replace).toHaveBeenCalledWith('/chat/session-a');
  });

  it('keeps the promoted draft identifiable as active until route replacement finishes', async (): Promise<void> => {
    let finishNavigation: ((result: unknown) => void) | undefined;
    routerMocks.replace.mockImplementationOnce(
      (): Promise<unknown> =>
        new Promise((resolve): void => {
          finishNavigation = resolve;
        })
    );
    const tabsStore = useTabsStore();
    tabsStore.tabs = [{ id: 'chat:new', path: '/chat', title: '新会话', cacheKey: 'chat:new' }];
    const wrapper = mountPage(null);

    findBChat(wrapper).$emit('session-created', createSession('session-a', '会话 A'));
    findBChat(wrapper).$emit('runtime-status-change', { status: 'idle' });
    await nextTick();

    expect(tabsStore.tabs[0]).toMatchObject({ id: 'chat:session-a', path: '/chat' });
    expect(tabsStore.tabs.find((tab): boolean => tab.path === routerMocks.route.fullPath)?.id).toBe('chat:session-a');
    expect(useChatTabStore().isPromoting('chat:session-a')).toBe(true);

    finishNavigation?.(undefined);
    await flushPromises();
    expect(tabsStore.tabs[0]?.path).toBe('/chat/session-a');
    expect(useChatTabStore().isPromoting('chat:session-a')).toBe(false);
  });

  it('opens a branch as a separate persisted chat tab', async (): Promise<void> => {
    routerMocks.route.path = '/chat/session-a';
    routerMocks.route.fullPath = '/chat/session-a';
    const wrapper = mountPage('session-a');

    findBChat(wrapper).$emit('session-created', createSession('session-c', '分支 C'));
    await flushPromises();

    expect(routerMocks.push).toHaveBeenCalledWith('/chat/session-c');
  });

  it('opens or reuses the unique draft route for a new-session request', async (): Promise<void> => {
    routerMocks.route.path = '/chat/session-a';
    routerMocks.route.fullPath = '/chat/session-a';
    const tabsStore = useTabsStore();
    tabsStore.tabs = [{ id: 'chat:new', path: '/chat', title: '新会话', cacheKey: 'chat:new' }];
    const wrapper = mountPage('session-a');

    findBChat(wrapper).$emit('new-session');
    await flushPromises();

    expect(routerMocks.push).toHaveBeenCalledWith('/chat');
  });

  it('resets the active draft without navigating', async (): Promise<void> => {
    const wrapper = mountPage(null);

    findBChat(wrapper).$emit('new-session');
    await flushPromises();

    expect(resetDraftMock).toHaveBeenCalledTimes(1);
    expect(routerMocks.push).not.toHaveBeenCalled();
  });

  it('updates only the inactive owner status when chat waits for user input', async (): Promise<void> => {
    routerMocks.route.path = '/welcome';
    routerMocks.route.fullPath = '/welcome';
    const runtimeStore = useChatTabStore();
    const wrapper = mountPage('session-a');

    findBChat(wrapper).$emit('runtime-status-change', { status: 'waiting' });
    await flushPromises();

    expect(runtimeStore.getStatus('chat:session-a')).toBe('waiting');
    expect(routerMocks.push).not.toHaveBeenCalled();
  });

  it('marks a background completion unread and clears it when mounted as active', async (): Promise<void> => {
    routerMocks.route.path = '/welcome';
    routerMocks.route.fullPath = '/welcome';
    const runtimeStore = useChatTabStore();
    const wrapper = mountPage('session-a');

    findBChat(wrapper).$emit('runtime-status-change', { status: 'completed', sessionId: 'session-a' });
    await flushPromises();
    expect(runtimeStore.getStatus('chat:session-a')).toBe('completed');
    wrapper.unmount();

    routerMocks.route.path = '/chat/session-a';
    routerMocks.route.fullPath = '/chat/session-a';
    const activeWrapper = mountPage('session-a');
    await flushPromises();

    expect(runtimeStore.getStatus('chat:session-a')).toBe('idle');
    activeWrapper.unmount();
  });

  it('treats a matching full path with query as the active chat tab', async (): Promise<void> => {
    routerMocks.route.path = '/chat/session-a';
    routerMocks.route.fullPath = '/chat/session-a?source=history';
    const runtimeStore = useChatTabStore();
    const tabsStore = useTabsStore();
    tabsStore.tabs = [
      {
        id: 'chat:session-a',
        path: '/chat/session-a?source=history',
        title: '会话 A',
        cacheKey: 'chat:session-a'
      }
    ];
    const wrapper = mountPage('session-a');

    findBChat(wrapper).$emit('runtime-status-change', { status: 'completed', sessionId: 'session-a' });
    await flushPromises();

    expect(runtimeStore.getStatus('chat:session-a')).toBe('idle');
  });

  it('registers a controller that aborts through the mounted BChat instance', async (): Promise<void> => {
    const runtimeStore = useChatTabStore();
    mountPage('session-a');
    runtimeStore.setStatus('chat:session-a', 'running');

    await runtimeStore.abortTabs(['chat:session-a']);

    expect(abortRuntimeMock).toHaveBeenCalledTimes(1);
  });
});
