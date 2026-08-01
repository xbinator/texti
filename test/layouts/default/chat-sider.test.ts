/**
 * @file chat-sider.test.ts
 * @description 默认布局 ChatSider 组件测试。
 * @vitest-environment jsdom
 */
/* eslint-disable vue/one-component-per-file */
import { readFileSync } from 'node:fs';
import type { ChatSession } from 'types/chat';
import { defineComponent, h, nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ChatSider from '@/layouts/default/components/ChatSider.vue';
import { useChatSessionStore } from '@/stores/chat/session';
import { useChatTabStore } from '@/stores/chat/tab';
import { useSettingStore } from '@/stores/ui/setting';
import { useTabsStore } from '@/stores/workspace/tabs';

const chatSiderSource = readFileSync('src/layouts/default/components/ChatSider.vue', 'utf8');

const bChatResetDraftMock = vi.hoisted(() => vi.fn<(options?: { focus?: boolean }) => Promise<void>>());
const bChatFocusInputMock = vi.hoisted(() => vi.fn<() => void>());
const routerPushMock = vi.hoisted(() => vi.fn<(path: string) => Promise<unknown>>());
const routeFailureMock = vi.hoisted(() => ({ type: 'aborted' }));
const routeMock = vi.hoisted(() => ({ fullPath: '/welcome' }));
const removeActorSessionMock = vi.hoisted(() => vi.fn<(sessionId: string) => void>());
const expireSessionConfirmationsMock = vi.hoisted(() => vi.fn<(sessionId: string) => void>());

vi.mock('vue-router', () => ({
  useRoute: (): typeof routeMock => routeMock,
  useRouter: (): { push: typeof routerPushMock } => ({ push: routerPushMock })
}));

vi.mock('@/router/navigation', () => ({
  isBlockingNavigationFailure: (result: unknown): boolean => result === routeFailureMock
}));

vi.mock('@/hooks/useChat/useActorSystem', () => ({
  useActorSystem: () => ({ removeSession: removeActorSessionMock })
}));

vi.mock('@/components/BChat/utils/confirmationController', () => ({
  expireSessionConfirmations: expireSessionConfirmationsMock
}));

vi.mock('@/components/BButton/index.vue', () => ({
  default: {
    name: 'BButton',
    props: ['disabled', 'tooltip'],
    emits: ['click'],
    template: '<button v-bind="$attrs" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>'
  }
}));

vi.mock('@/components/BChat/index.vue', () => ({
  __esModule: true,
  __isKeepAlive: false,
  __isTeleport: false,
  default: {
    name: 'BChat',
    props: ['sessionId'],
    emits: ['session-created', 'session-title-persisted', 'new-session', 'loading-change', 'runtime-status-change'],
    setup(
      _props: unknown,
      { expose }: { expose: (exposed: { focusInput: () => void; resetDraft: (options?: { focus?: boolean }) => Promise<void> }) => void }
    ) {
      expose({
        focusInput: bChatFocusInputMock,
        resetDraft: bChatResetDraftMock
      });
      return {};
    },
    template: '<div class="b-chat-stub" :data-session-id="sessionId || \'\'"></div>'
  }
}));

vi.mock('@/components/BChat/components/SessionHistory.vue', () => ({
  default: {
    name: 'SessionHistory',
    props: ['activeSessionId'],
    emits: ['switch-session', 'delete-session', 'load-more'],
    template: '<button class="session-history-stub"></button>'
  }
}));

/**
 * 创建测试会话。
 * @param id - 会话 ID
 * @param title - 会话标题
 * @returns 测试会话
 */
function createSession(id: string, title: string): ChatSession {
  return {
    id,
    type: 'assistant',
    title,
    createdAt: '2026-06-15T00:00:00.000Z',
    updatedAt: '2026-06-15T00:00:00.000Z',
    lastMessageAt: '2026-06-15T00:00:00.000Z'
  };
}

const BPanelSplitterStub = defineComponent({
  name: 'BPanelSplitter',
  props: {
    disabled: Boolean
  },
  emits: ['close'],
  setup(_props, { attrs, slots }) {
    return () =>
      h(
        'div',
        {
          class: ['b-panel-splitter', attrs.class],
          style: attrs.style,
          inert: attrs.inert
        },
        slots.default?.()
      );
  }
});

/** AInput 测试替身，保留 v-model、blur、keydown 与原生聚焦节点。 */
const AInputStub = defineComponent({
  name: 'AInput',
  inheritAttrs: false,
  props: {
    value: {
      type: String,
      default: ''
    }
  },
  emits: ['update:value', 'blur', 'keydown'],
  setup(props, { attrs, emit }) {
    /** 将原生输入值转发为 AInput 的受控值事件。 */
    function handleInput(event: Event): void {
      emit('update:value', (event.target as HTMLInputElement).value);
    }

    return () =>
      h('input', {
        class: attrs.class,
        'aria-label': attrs['aria-label'],
        value: props.value,
        onInput: handleInput,
        onBlur: (event: FocusEvent): void => emit('blur', event),
        onKeydown: (event: KeyboardEvent): void => emit('keydown', event)
      });
  }
});

/**
 * ChatSider 测试挂载属性。
 */
interface ChatSiderMountProps {
  /** 是否启用按钮显隐动画 */
  motionEnabled?: boolean;
}

/**
 * 挂载 ChatSider。
 * @param props - 组件挂载属性
 * @returns 组件包装器
 */
function mountChatSider(props: ChatSiderMountProps = {}): ReturnType<typeof mount> {
  return mount(ChatSider, {
    props,
    global: {
      stubs: {
        AInput: AInputStub,
        BIcon: true,
        BPanelSplitter: BPanelSplitterStub
      }
    }
  });
}

/** 当前测试使用的真实响应式聊天会话 Store。 */
let chatStore: ReturnType<typeof useChatSessionStore>;

describe('ChatSider', (): void => {
  afterEach((): void => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  beforeEach((): void => {
    setActivePinia(createPinia());
    localStorage.clear();
    chatStore = useChatSessionStore();
    vi.spyOn(chatStore, 'ensureSessions').mockResolvedValue();
    vi.spyOn(chatStore, 'loadMoreSessions').mockResolvedValue();
    vi.spyOn(chatStore, 'updateSessionTitle').mockImplementation(async (sessionId: string, title: string): Promise<void> => {
      const session = chatStore.findSession(sessionId);
      if (session) session.title = title;
    });
    bChatResetDraftMock.mockReset();
    bChatResetDraftMock.mockResolvedValue();
    bChatFocusInputMock.mockReset();
    routerPushMock.mockReset();
    routerPushMock.mockResolvedValue(undefined);
    removeActorSessionMock.mockReset();
    expireSessionConfirmationsMock.mockReset();
    routeMock.fullPath = '/welcome';
  });

  it('keeps the sider mounted while using an animated visibility class', async (): Promise<void> => {
    const settingStore = useSettingStore();
    settingStore.setSidebarVisible(false);
    settingStore.setSidebarWidth(420);
    const wrapper = mountChatSider();
    await flushPromises();
    await nextTick();

    const sider = wrapper.find('.b-panel-splitter');
    expect(sider.classes()).toContain('chat-sider');
    expect(sider.classes()).not.toContain('chat-sider--visible');
    expect(sider.attributes('style')).toContain('--chat-sider-width: 420px;');
    expect(sider.attributes('aria-hidden')).toBeUndefined();
    expect(sider.attributes('inert')).toBeDefined();

    settingStore.setSidebarVisible(true);
    await nextTick();

    expect(sider.classes()).toContain('chat-sider--visible');
    expect(sider.attributes('aria-hidden')).toBeUndefined();
    expect(sider.attributes('inert')).toBeUndefined();

    wrapper.unmount();
  });

  it('only adds the motion class when motion is explicitly enabled', async (): Promise<void> => {
    const settingStore = useSettingStore();
    settingStore.setSidebarVisible(false);
    const wrapper = mountChatSider();
    const sider = wrapper.find('.b-panel-splitter');

    settingStore.setSidebarVisible(true);
    await nextTick();
    expect(sider.classes()).toContain('chat-sider--visible');
    expect(sider.classes()).not.toContain('chat-sider--motion');

    const closeButton = wrapper
      .findAllComponents({ name: 'BButton' })
      .find((button) => button.findComponent({ name: 'BIcon' }).attributes('icon') === 'lucide:x');
    await closeButton?.trigger('click');
    await nextTick();
    expect(sider.classes()).toContain('chat-sider--motion');
  });

  it('scopes transitions to motion and leaves the splitter handle unclipped', (): void => {
    const rootStyle = chatSiderSource.match(/\.chat-sider \{(?<body>[\s\S]*?)\n\}/u)?.groups?.body ?? '';
    const contentStyle = chatSiderSource.match(/\.chat-sider__content \{(?<body>[\s\S]*?)\n\}/u)?.groups?.body ?? '';

    expect(chatSiderSource).toContain(':class="bem({ motion: motionEnabled, visible: settingStore.sidebarVisible })"');
    expect(chatSiderSource).toContain('.chat-sider--motion {');
    expect(rootStyle).not.toContain('overflow: hidden;');
    expect(rootStyle).not.toContain('transition:');
    expect(contentStyle).toContain('overflow: hidden;');
    expect(chatSiderSource).toContain('transition: width var(--motion-duration-slow) var(--motion-easing-standard)');
    expect(chatSiderSource).toContain('opacity var(--motion-duration-base) var(--motion-easing-standard)');
    expect(chatSiderSource).toContain('transform var(--motion-duration-slow) var(--motion-easing-standard)');
    expect(chatSiderSource).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('removes hidden idle splitter overflow sources from horizontal layout', (): void => {
    expect(chatSiderSource).toContain('.chat-sider:not(.chat-sider--visible, .chat-sider--motion) {');
    expect(chatSiderSource).toContain('transform: none;');
    expect(chatSiderSource).toContain('.chat-sider:not(.chat-sider--visible, .chat-sider--motion) .b-panel-splitter__section,');
    expect(chatSiderSource).toContain('.chat-sider:not(.chat-sider--visible, .chat-sider--motion) .b-panel-splitter__line {');
    expect(chatSiderSource).toContain('display: none;');
  });

  it('keeps the visible sidebar gap inside the panel width', (): void => {
    const visibleStyle = chatSiderSource.match(/\.chat-sider--visible \{(?<body>[\s\S]*?)\n\}/u)?.groups?.body ?? '';
    const contentStyle = chatSiderSource.match(/\.chat-sider__content \{(?<body>[\s\S]*?)\n\}/u)?.groups?.body ?? '';

    expect(visibleStyle).toContain('margin-left: 6px;');
    expect(contentStyle).not.toContain('margin-left: 6px;');
  });

  it('renders BChat with the active session id and displays the SessionHistory current session', async (): Promise<void> => {
    const latestSession = createSession('session-latest', '最近会话');
    chatStore.sessions = [latestSession];
    const settingStore = useSettingStore();
    settingStore.setSidebarVisible(true);
    settingStore.setChatSidebarActiveSessionId('session-latest');

    const wrapper = mountChatSider();
    await flushPromises();
    await nextTick();

    expect(wrapper.find('.b-chat-stub').attributes('data-session-id')).toBe('session-latest');
    expect(wrapper.text()).toContain('最近会话');
    expect(chatStore.ensureSessions).toHaveBeenCalledTimes(1);
  });

  it('uses animated close only for the internal close button', async (): Promise<void> => {
    const settingStore = useSettingStore();
    settingStore.setSidebarVisible(true);
    const wrapper = mountChatSider();
    await flushPromises();
    await nextTick();

    const closeButton = wrapper
      .findAllComponents({ name: 'BButton' })
      .find((button) => button.findComponent({ name: 'BIcon' }).attributes('icon') === 'lucide:x');
    expect(closeButton?.props('tooltip')).toBeUndefined();
    await closeButton?.trigger('click');
    await nextTick();

    expect(settingStore.sidebarVisible).toBe(false);
    expect(wrapper.find('.b-panel-splitter').classes()).toContain('chat-sider--motion');

    settingStore.setSidebarVisible(true);
    await nextTick();

    wrapper.findComponent({ name: 'BPanelSplitter' }).vm.$emit('close');
    await nextTick();

    expect(settingStore.sidebarVisible).toBe(false);
    expect(wrapper.find('.b-panel-splitter').classes()).not.toContain('chat-sider--motion');
  });

  it('loads the next shared session page when history requests more data', async (): Promise<void> => {
    const wrapper = mountChatSider();

    wrapper.findComponent({ name: 'SessionHistory' }).vm.$emit('load-more');
    await flushPromises();

    expect(chatStore.loadMoreSessions).toHaveBeenCalledTimes(1);
  });

  it('uses a session created through the shared Store without refreshing history', async (): Promise<void> => {
    const settingStore = useSettingStore();
    settingStore.setSidebarVisible(true);
    const wrapper = mountChatSider();
    await flushPromises();
    await nextTick();
    const createdSession = createSession('session-created', '首条消息');
    chatStore.sessions = [createdSession];

    wrapper.findComponent({ name: 'BChat' }).vm.$emit('session-created', createdSession);
    await nextTick();

    expect(settingStore.chatSidebarActiveSessionId).toBe('session-created');
    expect(wrapper.text()).toContain('首条消息');
  });

  it('projects a persisted sidebar session runtime without disabling controls', async (): Promise<void> => {
    const settingStore = useSettingStore();
    settingStore.setSidebarVisible(true);
    settingStore.setChatSidebarActiveSessionId('session-running');
    chatStore.sessions = [createSession('session-running', '运行会话')];
    const wrapper = mountChatSider();
    await flushPromises();

    wrapper.findComponent({ name: 'BChat' }).vm.$emit('runtime-status-change', { status: 'running' });
    await nextTick();

    expect(useChatTabStore().findOwner('session-running')).toMatchObject({
      tabId: 'chat:session-running',
      status: 'running'
    });
    expect(wrapper.find('[disabled]').exists()).toBe(false);
  });

  it('binds the first running status after the sidebar creates its session', async (): Promise<void> => {
    const settingStore = useSettingStore();
    settingStore.setSidebarVisible(true);
    const wrapper = mountChatSider();
    await flushPromises();
    const createdSession = createSession('session-created', '首条消息');
    chatStore.sessions = [createdSession];

    wrapper.findComponent({ name: 'BChat' }).vm.$emit('runtime-status-change', { status: 'running' });
    wrapper.findComponent({ name: 'BChat' }).vm.$emit('session-created', createdSession);
    await nextTick();

    expect(useChatTabStore().findOwner('session-created')).toMatchObject({
      tabId: 'chat:session-created',
      status: 'running'
    });
  });

  it('projects completion to the matching background sidebar owner', async (): Promise<void> => {
    const settingStore = useSettingStore();
    settingStore.setSidebarVisible(true);
    settingStore.setChatSidebarActiveSessionId('session-b');
    chatStore.sessions = [createSession('session-a', '会话 A'), createSession('session-b', '会话 B')];
    const runtimeStore = useChatTabStore();
    runtimeStore.ensureTab('chat:session-a', 'session-a');
    runtimeStore.setStatus('chat:session-a', 'running');
    const wrapper = mountChatSider();
    await flushPromises();

    wrapper.findComponent({ name: 'BChat' }).vm.$emit('runtime-status-change', { status: 'completed', sessionId: 'session-a' });
    await nextTick();

    expect(runtimeStore.getStatus('chat:session-a')).toBe('completed');
  });

  it('projects an abandoned preparation status to its original background Session', async (): Promise<void> => {
    const settingStore = useSettingStore();
    settingStore.setSidebarVisible(true);
    settingStore.setChatSidebarActiveSessionId('session-b');
    chatStore.sessions = [createSession('session-a', '会话 A'), createSession('session-b', '会话 B')];
    const runtimeStore = useChatTabStore();
    runtimeStore.ensureTab('chat:session-a', 'session-a');
    runtimeStore.ensureTab('chat:session-b', 'session-b');
    runtimeStore.setStatus('chat:session-a', 'running');
    runtimeStore.setStatus('chat:session-b', 'running');
    const wrapper = mountChatSider();
    await flushPromises();

    wrapper.findComponent({ name: 'BChat' }).vm.$emit('runtime-status-change', { status: 'idle', sessionId: 'session-a' });
    await nextTick();

    expect(runtimeStore.getStatus('chat:session-a')).toBe('idle');
    expect(runtimeStore.getStatus('chat:session-b')).toBe('running');
  });

  it('displays the title already synchronized by the shared Store', async (): Promise<void> => {
    const latestSession = createSession('session-latest', '首条消息');
    chatStore.sessions = [latestSession];
    const settingStore = useSettingStore();
    settingStore.setSidebarVisible(true);
    settingStore.setChatSidebarActiveSessionId('session-latest');
    const wrapper = mountChatSider();
    await flushPromises();
    await nextTick();
    chatStore.sessions[0].title = '生成标题';
    await nextTick();

    wrapper.findComponent({ name: 'BChat' }).vm.$emit('session-title-persisted', 'session-latest', '生成标题');
    await flushPromises();
    await nextTick();

    expect(wrapper.text()).toContain('生成标题');
  });

  it('focuses and selects the title input before saving with Enter', async (): Promise<void> => {
    const latestSession = createSession('session-latest', '原标题');
    chatStore.sessions = [latestSession];
    const settingStore = useSettingStore();
    settingStore.setSidebarVisible(true);
    settingStore.setChatSidebarActiveSessionId('session-latest');
    const wrapper = mountChatSider();
    await flushPromises();
    await nextTick();

    vi.useFakeTimers();
    const focusSpy = vi.spyOn(HTMLInputElement.prototype, 'focus');
    const selectSpy = vi.spyOn(HTMLInputElement.prototype, 'select');
    await wrapper.find('.chat-sider__title').trigger('dblclick');
    await nextTick();
    await vi.advanceTimersByTimeAsync(100);
    const input = wrapper.find<HTMLInputElement>('.chat-sider__title-input');
    expect(focusSpy).toHaveBeenCalledOnce();
    expect(selectSpy).toHaveBeenCalledOnce();
    focusSpy.mockRestore();
    selectSpy.mockRestore();

    const titleInput = wrapper.findComponent({ name: 'AInput' });
    titleInput.vm.$emit('update:value', '  手动标题  ');
    await nextTick();
    expect(titleInput.props('value')).toBe('  手动标题  ');
    await input.trigger('keydown', { key: 'Enter' });
    await flushPromises();

    expect(chatStore.updateSessionTitle).toHaveBeenCalledWith('session-latest', '手动标题');
    expect(wrapper.text()).toContain('手动标题');
  });

  it('saves the edited title when the input loses focus', async (): Promise<void> => {
    const latestSession = createSession('session-latest', '原标题');
    chatStore.sessions = [latestSession];
    const settingStore = useSettingStore();
    settingStore.setSidebarVisible(true);
    settingStore.setChatSidebarActiveSessionId('session-latest');
    const wrapper = mountChatSider();
    await flushPromises();
    await nextTick();

    await wrapper.find('.chat-sider__title').trigger('dblclick');
    const titleInput = wrapper.findComponent({ name: 'AInput' });
    titleInput.vm.$emit('update:value', '失焦标题');
    await nextTick();
    expect(titleInput.props('value')).toBe('失焦标题');
    titleInput.vm.$emit('blur', new FocusEvent('blur'));
    await flushPromises();

    expect(chatStore.updateSessionTitle).toHaveBeenCalledWith('session-latest', '失焦标题');
    expect(wrapper.text()).toContain('失焦标题');
  });

  it('clears active session when BChat requests a new draft session', async (): Promise<void> => {
    const latestSession = createSession('session-old', '旧会话');
    chatStore.sessions = [latestSession];
    const settingStore = useSettingStore();
    settingStore.setSidebarVisible(true);
    const wrapper = mountChatSider();
    await flushPromises();
    await nextTick();

    wrapper.findComponent({ name: 'BChat' }).vm.$emit('new-session');
    await flushPromises();

    expect(settingStore.chatSidebarActiveSessionId).toBeNull();
    expect(wrapper.text()).toContain('新会话');
    expect(bChatResetDraftMock).toHaveBeenCalledWith({ focus: false });
    expect(bChatFocusInputMock).not.toHaveBeenCalled();
  });

  it('keeps every session control enabled while chat and session history are loading', async (): Promise<void> => {
    const settingStore = useSettingStore();
    settingStore.setSidebarVisible(true);
    settingStore.setChatSidebarActiveSessionId('session-running');
    chatStore.sessions = [createSession('session-running', '运行会话')];
    chatStore.sessionsLoading = true;
    const wrapper = mountChatSider();
    await flushPromises();
    await nextTick();

    wrapper.findComponent({ name: 'BChat' }).vm.$emit('loading-change', true);
    await nextTick();

    expect(wrapper.findAllComponents({ name: 'BButton' })[0].attributes('disabled')).toBeUndefined();
    expect(wrapper.findAllComponents({ name: 'BButton' })[0].props('tooltip')).toBeUndefined();
    expect(wrapper.findComponent({ name: 'SessionHistory' }).props('disabled')).toBeUndefined();
    expect(wrapper.find('.session-history-stub').attributes('disabled')).toBeUndefined();
    const openButton = wrapper
      .findAllComponents({ name: 'BButton' })
      .find((button) => button.findComponent({ name: 'BIcon' }).attributes('icon') === 'lucide:square-arrow-out-up-right');
    expect(openButton?.attributes('disabled')).toBeUndefined();

    await wrapper.find('.chat-sider__title').trigger('dblclick');
    expect(wrapper.find('.chat-sider__title-input').exists()).toBe(true);
    await wrapper.findAllComponents({ name: 'BButton' })[0].trigger('click');
    await flushPromises();
    expect(settingStore.chatSidebarActiveSessionId).toBeNull();
  });

  it('opens the side session in a chat tab and resets the side to draft', async (): Promise<void> => {
    const sideSession = createSession('session-a', '会话 A');
    chatStore.sessions = [sideSession];
    const settingStore = useSettingStore();
    settingStore.setSidebarVisible(true);
    settingStore.setChatSidebarActiveSessionId('session-a');
    const wrapper = mountChatSider();
    await flushPromises();

    const openButton = wrapper
      .findAllComponents({ name: 'BButton' })
      .find((button) => button.findComponent({ name: 'BIcon' }).attributes('icon') === 'lucide:square-arrow-out-up-right');
    expect(openButton?.findComponent({ name: 'BIcon' }).attributes('icon')).toBe('lucide:square-arrow-out-up-right');
    await openButton?.trigger('click');
    await flushPromises();

    expect(routerPushMock).toHaveBeenCalledWith('/chat/session-a');
    expect(settingStore.chatSidebarActiveSessionId).toBeNull();
    expect(bChatResetDraftMock).toHaveBeenCalledWith({ focus: false });
    expect(bChatFocusInputMock).not.toHaveBeenCalled();
  });

  it('opens or reuses the unique draft tab from an empty ChatSider', async (): Promise<void> => {
    const settingStore = useSettingStore();
    settingStore.setSidebarVisible(true);
    useTabsStore().tabs = [{ id: 'chat:new', path: '/chat', title: '新会话', cacheKey: 'chat:new' }];
    const wrapper = mountChatSider();
    await flushPromises();

    const openButton = wrapper
      .findAllComponents({ name: 'BButton' })
      .find((button) => button.findComponent({ name: 'BIcon' }).attributes('icon') === 'lucide:square-arrow-out-up-right');
    await openButton?.trigger('click');
    await flushPromises();

    expect(routerPushMock).toHaveBeenCalledWith('/chat');
    expect(settingStore.chatSidebarActiveSessionId).toBeNull();
    expect(bChatResetDraftMock).toHaveBeenCalledWith({ focus: false });
    expect(bChatFocusInputMock).not.toHaveBeenCalled();
  });

  it('preserves the side session when opening the page route fails', async (): Promise<void> => {
    const sideSession = createSession('session-a', '会话 A');
    chatStore.sessions = [sideSession];
    routerPushMock.mockRejectedValue(new Error('navigation failed'));
    const settingStore = useSettingStore();
    settingStore.setSidebarVisible(true);
    settingStore.setChatSidebarActiveSessionId('session-a');
    const wrapper = mountChatSider();
    await flushPromises();

    const openButton = wrapper
      .findAllComponents({ name: 'BButton' })
      .find((button) => button.findComponent({ name: 'BIcon' }).attributes('icon') === 'lucide:square-arrow-out-up-right');
    await openButton?.trigger('click');
    await flushPromises();

    expect(settingStore.chatSidebarActiveSessionId).toBe('session-a');
    expect(bChatResetDraftMock).not.toHaveBeenCalled();
  });

  it('preserves the side session when the page route resolves with a navigation failure', async (): Promise<void> => {
    const sideSession = createSession('session-a', '会话 A');
    chatStore.sessions = [sideSession];
    routerPushMock.mockResolvedValue(routeFailureMock);
    const settingStore = useSettingStore();
    settingStore.setSidebarVisible(true);
    settingStore.setChatSidebarActiveSessionId('session-a');
    const wrapper = mountChatSider();
    await flushPromises();

    const openButton = wrapper
      .findAllComponents({ name: 'BButton' })
      .find((button) => button.findComponent({ name: 'BIcon' }).attributes('icon') === 'lucide:square-arrow-out-up-right');
    await openButton?.trigger('click');
    await flushPromises();

    expect(settingStore.chatSidebarActiveSessionId).toBe('session-a');
    expect(bChatResetDraftMock).not.toHaveBeenCalled();
  });

  it('navigates to an owned history session without replacing the side session', async (): Promise<void> => {
    const settingStore = useSettingStore();
    settingStore.setSidebarVisible(true);
    settingStore.setChatSidebarActiveSessionId('session-b');
    const tabsStore = useTabsStore();
    tabsStore.tabs = [{ id: 'chat:session-a', path: '/chat/session-a', title: '会话 A', cacheKey: 'chat:session-a' }];
    useChatTabStore().ensureTab('chat:session-a', 'session-a');
    const wrapper = mountChatSider();
    await flushPromises();

    wrapper.findComponent({ name: 'SessionHistory' }).vm.$emit('switch-session', 'session-a');
    await flushPromises();

    expect(routerPushMock).toHaveBeenCalledWith('/chat/session-a');
    expect(settingStore.chatSidebarActiveSessionId).toBe('session-b');
    expect(useChatTabStore().records['chat:session-a']?.focusRequestId).toBe(1);
  });

  it('navigates to chat:new when it temporarily owns a history session', async (): Promise<void> => {
    const settingStore = useSettingStore();
    settingStore.setSidebarVisible(true);
    settingStore.setChatSidebarActiveSessionId('session-b');
    useTabsStore().tabs = [{ id: 'chat:new', path: '/chat', title: '新会话', cacheKey: 'chat:new' }];
    useChatTabStore().ensureTab('chat:new', 'session-a');
    const wrapper = mountChatSider();
    await flushPromises();

    wrapper.findComponent({ name: 'SessionHistory' }).vm.$emit('switch-session', 'session-a');
    await flushPromises();

    expect(routerPushMock).toHaveBeenCalledWith('/chat');
    expect(settingStore.chatSidebarActiveSessionId).toBe('session-b');
  });

  it('keeps the ordinary history switch behavior when no page owns the session', async (): Promise<void> => {
    const settingStore = useSettingStore();
    settingStore.setSidebarVisible(true);
    settingStore.setChatSidebarActiveSessionId('session-b');
    const wrapper = mountChatSider();
    await flushPromises();

    wrapper.findComponent({ name: 'SessionHistory' }).vm.$emit('switch-session', 'session-a');
    await flushPromises();

    expect(routerPushMock).not.toHaveBeenCalled();
    expect(settingStore.chatSidebarActiveSessionId).toBe('session-a');
  });

  it('removes the owning chat tab after successful session deletion', async (): Promise<void> => {
    const tabsStore = useTabsStore();
    tabsStore.tabs = [{ id: 'chat:session-a', path: '/chat/session-a', title: '会话 A', cacheKey: 'chat:session-a' }];
    useChatTabStore().ensureTab('chat:session-a', 'session-a');
    const wrapper = mountChatSider();
    await flushPromises();

    wrapper.findComponent({ name: 'SessionHistory' }).vm.$emit('delete-session', 'session-a');
    await flushPromises();

    expect(tabsStore.tabs).toEqual([]);
    expect(useChatTabStore().records['chat:session-a']).toBeUndefined();
  });

  it('clears application Runtime ownership after successful session deletion', async (): Promise<void> => {
    const wrapper = mountChatSider();
    await flushPromises();

    wrapper.findComponent({ name: 'SessionHistory' }).vm.$emit('delete-session', 'session-a');
    await flushPromises();

    expect(expireSessionConfirmationsMock).toHaveBeenCalledWith('session-a');
    expect(removeActorSessionMock).toHaveBeenCalledWith('session-a');
  });

  it('removes chat:new when the deleted session is its temporary owner', async (): Promise<void> => {
    const tabsStore = useTabsStore();
    tabsStore.tabs = [{ id: 'chat:new', path: '/chat', title: '新会话', cacheKey: 'chat:new' }];
    useChatTabStore().ensureTab('chat:new', 'session-a');
    const wrapper = mountChatSider();
    await flushPromises();

    wrapper.findComponent({ name: 'SessionHistory' }).vm.$emit('delete-session', 'session-a');
    await flushPromises();

    expect(tabsStore.tabs).toEqual([]);
    expect(useChatTabStore().records['chat:new']).toBeUndefined();
  });

  it('navigates to a surviving tab when the deleted chat page is active', async (): Promise<void> => {
    routeMock.fullPath = '/chat/session-a';
    const tabsStore = useTabsStore();
    tabsStore.tabs = [
      { id: 'chat:session-a', path: '/chat/session-a', title: '会话 A', cacheKey: 'chat:session-a' },
      { id: 'welcome', path: '/welcome', title: '欢迎', cacheKey: 'welcome' }
    ];
    useChatTabStore().ensureTab('chat:session-a', 'session-a');
    const wrapper = mountChatSider();
    await flushPromises();

    wrapper.findComponent({ name: 'SessionHistory' }).vm.$emit('delete-session', 'session-a');
    await flushPromises();

    expect(tabsStore.tabs.map((tab) => tab.id)).toEqual(['welcome']);
    expect(routerPushMock).toHaveBeenCalledWith('/welcome');
  });
});
