/**
 * @file index.test.ts
 * @description 验证 BCommandPanel 弹窗、输入路由、键盘导航和选择行为。
 * @vitest-environment jsdom
 */
import type { ChatSession } from 'types/chat';
import { defineComponent, nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BCommandPanel from '@/components/BCommandPanel/index.vue';
import type { CommandPanelModelContext, CommandPanelScope } from '@/components/BCommandPanel/types';
import type { RecentRecord } from '@/shared/storage';
import { useCommandPanelStore } from '@/stores/ui/commandPanel';

/**
 * 最近记录 store 测试替身。
 */
interface RecentStoreMock {
  /** 最近记录。 */
  recentRecords: RecentRecord[];
  /** 加载最近记录。 */
  ensureLoaded: ReturnType<typeof vi.fn>;
  /** 删除最近记录。 */
  removeFile: ReturnType<typeof vi.fn>;
}

/**
 * 聊天会话 store 测试替身。
 */
interface ChatSessionStoreMock {
  /** 当前已加载会话。 */
  sessions: ChatSession[];
  /** 确保会话已加载。 */
  ensureSessions: ReturnType<typeof vi.fn>;
  /** 按 ID 加载会话。 */
  loadSessionById: ReturnType<typeof vi.fn>;
}

const recentStoreMock = vi.hoisted<RecentStoreMock>(() => ({
  recentRecords: [],
  ensureLoaded: vi.fn(),
  removeFile: vi.fn()
}));
const routerPushMock = vi.hoisted(() => vi.fn<(_path: string) => Promise<void>>());
const loadSessionByIdMock = vi.hoisted(() => vi.fn<(_sessionId: string) => Promise<unknown>>());
const ensureSessionsMock = vi.hoisted(() => vi.fn<() => Promise<void>>());
const removeTabMock = vi.hoisted(() => vi.fn<(_id: string) => void>());
const openDocumentMock = vi.hoisted(() => vi.fn<(_record: Extract<RecentRecord, { type: 'file' }>) => Promise<unknown>>());
const openFileByPathMock = vi.hoisted(() => vi.fn<(_path: string) => Promise<void>>());
const openWebviewMock = vi.hoisted(() => vi.fn<(_url: URL) => void>());
const getPathStatusMock = vi.hoisted(() => vi.fn<(_path: string) => Promise<{ exists: boolean; isFile: boolean }>>());
const loadProvidersMock = vi.hoisted(() => vi.fn<() => Promise<void>>());
const loadChatModelMock = vi.hoisted(() => vi.fn<() => Promise<void>>());
const setChatModelMock = vi.hoisted(() => vi.fn<(_model: { providerId: string; modelId: string }) => Promise<void>>());
const scrollIntoViewMock = vi.hoisted(() => vi.fn<(_arg?: boolean | ScrollIntoViewOptions) => void>());
const providerStoreMock = vi.hoisted(() => ({
  availableModels: [
    {
      providerId: 'openai',
      providerName: 'OpenAI',
      models: [
        { value: 'openai:gpt-4o', modelId: 'gpt-4o', modelName: 'GPT 4o' },
        { value: 'openai:gpt-4.1', modelId: 'gpt-4.1', modelName: 'GPT 4.1' }
      ]
    }
  ],
  loadProviders: loadProvidersMock
}));
const serviceModelStoreMock = vi.hoisted(() => ({
  chatModel: { providerId: 'openai', modelId: 'gpt-4o' } as { providerId: string; modelId: string } | undefined,
  loadChatModel: loadChatModelMock,
  setChatModel: setChatModelMock
}));
const chatSessionStoreMock = vi.hoisted<ChatSessionStoreMock>(() => ({
  sessions: [],
  ensureSessions: ensureSessionsMock,
  loadSessionById: loadSessionByIdMock
}));

vi.mock('@/stores/workspace/recent', () => ({
  useRecentStore: () => recentStoreMock
}));

vi.mock('vue-router', () => ({
  useRouter: () => ({
    push: routerPushMock
  })
}));

vi.mock('@/stores/chat/session', () => ({
  useChatSessionStore: () => chatSessionStoreMock
}));

vi.mock('@/stores/workspace/tabs', () => ({
  useTabsStore: () => ({
    removeTab: removeTabMock
  })
}));

vi.mock('@/hooks/useNavigate', () => ({
  useNavigate: () => ({
    openDocument: openDocumentMock,
    openFileByPath: openFileByPathMock,
    openWebview: openWebviewMock
  })
}));

vi.mock('@/shared/platform', () => ({
  native: {
    getPathStatus: getPathStatusMock
  }
}));

vi.mock('@/stores/ai/provider', () => ({
  useProviderStore: () => providerStoreMock
}));

vi.mock('@/stores/ai/serviceModel', () => ({
  useServiceModelStore: () => serviceModelStoreMock
}));

vi.mock('@/components/BRecent/Icon.vue', () => ({
  default: {
    name: 'BRecentIcon',
    template: '<span class="recent-icon-stub"></span>'
  }
}));

vi.mock('@/components/BModel/Icon.vue', () => ({
  default: {
    name: 'BModelIcon',
    template: '<span class="model-icon-stub"></span>'
  }
}));

vi.mock('@/components/BIcon/index.vue', () => ({
  default: {
    name: 'BIcon',
    props: {
      icon: {
        type: String,
        required: true
      }
    },
    template: '<i class="icon-stub" :data-icon="icon"></i>'
  }
}));

/** BModal 测试替身，仅在 open=true 时渲染默认插槽。 */
const BModalStub = defineComponent({
  name: 'BModal',
  props: {
    open: {
      type: Boolean,
      default: false
    }
  },
  emits: ['update:open', 'close'],
  template: '<div v-if="open" class="b-modal-stub"><slot /></div>'
});

/** BScrollbar 测试替身，直接渲染默认插槽。 */
const BScrollbarStub = defineComponent({
  name: 'BScrollbar',
  template: '<div class="b-scrollbar-stub"><slot /></div>'
});

/** AInput 测试替身，保留 value 双向绑定和 keydown 事件。 */
const AInputStub = defineComponent({
  name: 'AInput',
  props: {
    value: {
      type: String,
      default: ''
    }
  },
  emits: ['update:value', 'keydown'],
  setup(_props, { emit }) {
    /**
     * 将原生 input 事件转换为 AInput 的 value 更新事件。
     * @param event - 原生输入事件
     */
    function handleInput(event: Event): void {
      const target = event.target as HTMLInputElement | null;
      emit('update:value', target?.value ?? '');
    }

    return {
      handleInput
    };
  },
  template: '<input class="a-input-stub" :value="value" @input="handleInput" @keydown="$emit(\'keydown\', $event)" />'
});

/**
 * 创建文件最近记录。
 * @param overrides - 覆盖字段
 * @returns 文件最近记录
 */
function createFileRecord(overrides: Partial<Extract<RecentRecord, { type: 'file' }>> = {}): Extract<RecentRecord, { type: 'file' }> {
  return {
    type: 'file',
    id: 'file-1',
    path: '/tmp/alpha.md',
    content: '',
    name: 'alpha',
    ext: 'md',
    url: '/editor/file-1',
    title: 'alpha.md',
    description: '/tmp/alpha.md',
    ...overrides
  };
}

/**
 * 创建聊天最近记录。
 * @param overrides - 覆盖字段
 * @returns 聊天最近记录
 */
function createChatRecord(overrides: Partial<Extract<RecentRecord, { type: 'chat' }>> = {}): Extract<RecentRecord, { type: 'chat' }> {
  return {
    type: 'chat',
    id: 'session-a',
    url: '/chat/session-a',
    title: '会话 A',
    description: '聊天会话',
    createdAt: 1,
    openedAt: 2,
    ...overrides
  };
}

/**
 * 创建聊天会话。
 * @param overrides - 覆盖字段
 * @returns 聊天会话
 */
function createChatSession(overrides: Partial<ChatSession> = {}): ChatSession {
  const now = new Date().toISOString();

  return {
    id: 'session-command',
    type: 'assistant',
    title: '重构计划',
    createdAt: now,
    updatedAt: now,
    lastMessageAt: now,
    ...overrides
  };
}

/**
 * 挂载命令面板。
 * @returns 组件包装器
 */
function mountCommandPanel(): VueWrapper {
  return mount(BCommandPanel, {
    global: {
      stubs: {
        AInput: AInputStub,
        BModal: BModalStub,
        BScrollbar: BScrollbarStub
      }
    }
  });
}

/**
 * 打开命令面板并等待刷新。
 * @param scope - 命令面板范围
 * @param onClose - 关闭回调
 * @param modelContext - 模型范围的调用方上下文
 */
async function openPanel(scope: CommandPanelScope, onClose?: () => void, modelContext?: CommandPanelModelContext): Promise<void> {
  const commandPanelStore = useCommandPanelStore();
  if (scope === 'model') {
    commandPanelStore.openModel({ onClose, modelContext });
  } else {
    commandPanelStore.openRecent({ onClose });
  }

  await nextTick();
  await flushPromises();
}

describe('BCommandPanel', (): void => {
  beforeEach((): void => {
    setActivePinia(createPinia());
    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoViewMock
    });
    recentStoreMock.recentRecords = [
      createFileRecord({ id: 'file-1', name: 'alpha', path: '/tmp/alpha.md', url: '/editor/file-1', title: 'alpha.md', description: '/tmp/alpha.md' }),
      createFileRecord({ id: 'file-2', name: 'beta', path: '/tmp/beta.md', url: '/editor/file-2', title: 'beta.md', description: '/tmp/beta.md' })
    ];
    recentStoreMock.ensureLoaded.mockResolvedValue(undefined);
    recentStoreMock.removeFile.mockReset();
    recentStoreMock.removeFile.mockResolvedValue(undefined);
    routerPushMock.mockReset();
    routerPushMock.mockResolvedValue(undefined);
    chatSessionStoreMock.sessions = [createChatSession()];
    ensureSessionsMock.mockReset();
    ensureSessionsMock.mockResolvedValue(undefined);
    loadSessionByIdMock.mockReset();
    loadSessionByIdMock.mockResolvedValue({ id: 'session-a' });
    removeTabMock.mockClear();
    openDocumentMock.mockResolvedValue(undefined);
    openFileByPathMock.mockResolvedValue(undefined);
    openWebviewMock.mockClear();
    getPathStatusMock.mockResolvedValue({ exists: false, isFile: false });
    loadProvidersMock.mockResolvedValue(undefined);
    loadChatModelMock.mockResolvedValue(undefined);
    setChatModelMock.mockResolvedValue(undefined);
    serviceModelStoreMock.chatModel = { providerId: 'openai', modelId: 'gpt-4o' };
    scrollIntoViewMock.mockClear();
  });

  it('opens recent scope with recent records', async (): Promise<void> => {
    const wrapper = mountCommandPanel();
    await openPanel('recent');

    expect(recentStoreMock.ensureLoaded).toHaveBeenCalled();
    expect(wrapper.find('.b-modal-stub').exists()).toBe(true);
    expect(wrapper.text()).toContain('alpha');
    expect(wrapper.text()).toContain('/tmp/alpha.md');
  });

  it('routes ? command menu selection to model list with a plain prefix', async (): Promise<void> => {
    const wrapper = mountCommandPanel();
    await openPanel('recent');
    const input = wrapper.find('input.a-input-stub');

    await input.setValue('?');
    await flushPromises();
    expect(wrapper.text()).toContain('model');
    expect(wrapper.text()).toContain('chat');
    expect(wrapper.text()).not.toContain('> model');

    await wrapper.findAll('.b-command-panel__item')[0].trigger('click');
    await flushPromises();
    expect((input.element as HTMLInputElement).value).toBe('model ');
    expect((input.element as HTMLInputElement).selectionStart).toBe('model '.length);
    expect((input.element as HTMLInputElement).selectionEnd).toBe('model '.length);
    expect(wrapper.text()).toContain('GPT 4o');

    await input.setValue('model');
    await flushPromises();
    expect(wrapper.text()).not.toContain('GPT 4o');
    expect(wrapper.text()).toContain('没有匹配的最近记录');

    await input.setValue('model ');
    await flushPromises();
    expect(wrapper.text()).toContain('GPT 4o');
  });

  it('routes direct chat prefix input to chat session search', async (): Promise<void> => {
    const wrapper = mountCommandPanel();
    await openPanel('recent');
    const input = wrapper.find('input.a-input-stub');

    await input.setValue('chat');
    await flushPromises();
    expect(ensureSessionsMock).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('没有匹配的最近记录');

    await input.setValue('chat 重构');
    await flushPromises();
    expect(ensureSessionsMock).toHaveBeenCalled();
    expect(wrapper.text()).toContain('重构计划');

    await wrapper.find('.b-command-panel__item').trigger('click');
    await flushPromises();
    expect(routerPushMock).toHaveBeenCalledWith('/chat/session-command');
  });

  it('locks model scope to model source', async (): Promise<void> => {
    const wrapper = mountCommandPanel();
    await openPanel('model');

    expect(wrapper.text()).toContain('GPT 4o');

    await wrapper.find('input.a-input-stub').setValue('>');
    await flushPromises();
    expect(wrapper.text()).not.toContain('> model');
    expect(wrapper.text()).toContain('未找到匹配的模型');
  });

  it('cycles keyboard highlight through rows', async (): Promise<void> => {
    const wrapper = mountCommandPanel();
    await openPanel('recent');
    const input = wrapper.find('input.a-input-stub');

    await input.trigger('keydown', { key: 'ArrowDown' });
    await nextTick();
    expect(wrapper.findAll('.b-command-panel__item')[0].classes()).toContain('b-command-panel__item--active');

    await input.trigger('keydown', { key: 'ArrowUp' });
    await nextTick();
    expect(wrapper.findAll('.b-command-panel__item')[1].classes()).toContain('b-command-panel__item--active');
    expect(scrollIntoViewMock).toHaveBeenLastCalledWith({ block: 'center' });
  });

  it('removes recent items without closing the panel', async (): Promise<void> => {
    const wrapper = mountCommandPanel();
    await openPanel('recent');

    await wrapper.find('.b-command-panel__item-delete').trigger('click');
    await flushPromises();

    expect(recentStoreMock.removeFile).toHaveBeenCalledWith('file:file-1');
    expect(removeTabMock).toHaveBeenCalledWith('file-1');
    expect(wrapper.find('.b-modal-stub').exists()).toBe(true);
  });

  it('opens chat recent records from the panel without reloading the session', async (): Promise<void> => {
    recentStoreMock.recentRecords = [createChatRecord()];
    const wrapper = mountCommandPanel();
    await openPanel('recent');

    await wrapper.find('.b-command-panel__item').trigger('click');
    await flushPromises();

    expect(loadSessionByIdMock).not.toHaveBeenCalled();
    expect(routerPushMock).toHaveBeenCalledWith('/chat/session-a');
  });

  it('keeps chat recent opening route-only when the backing session is absent', async (): Promise<void> => {
    recentStoreMock.recentRecords = [createChatRecord()];
    loadSessionByIdMock.mockResolvedValue(undefined);
    const wrapper = mountCommandPanel();
    await openPanel('recent');

    await wrapper.find('.b-command-panel__item').trigger('click');
    await flushPromises();

    expect(recentStoreMock.removeFile).not.toHaveBeenCalledWith('chat:session-a');
    expect(routerPushMock).toHaveBeenCalledWith('/chat/session-a');
  });

  it('selects a model and restores focus callback', async (): Promise<void> => {
    const onCloseFocus = vi.fn();
    const wrapper = mountCommandPanel();
    await openPanel('model', onCloseFocus);

    await wrapper.findAll('.b-command-panel__item')[0].trigger('click');
    await flushPromises();

    expect(setChatModelMock).toHaveBeenCalledWith({ providerId: 'openai', modelId: 'gpt-4o' });
    expect(onCloseFocus).toHaveBeenCalled();
    expect(wrapper.find('.b-modal-stub').exists()).toBe(false);
  });

  it('uses a caller model context instead of the global service model store', async (): Promise<void> => {
    const onModelChange = vi.fn<(_model: { providerId: string; modelId: string }) => Promise<void>>().mockResolvedValue(undefined);
    setChatModelMock.mockClear();
    const wrapper = mountCommandPanel();
    await openPanel('model', undefined, {
      getCurrentModel: (): { providerId: string; modelId: string } => ({ providerId: 'openai', modelId: 'gpt-4.1' }),
      onModelChange
    });

    const items = wrapper.findAll('.b-command-panel__item');
    expect(items[1].classes()).toContain('b-command-panel__item--current');
    await items[0].trigger('click');
    await flushPromises();

    expect(onModelChange).toHaveBeenCalledWith({ providerId: 'openai', modelId: 'gpt-4o' });
    expect(setChatModelMock).not.toHaveBeenCalled();
  });

  it('contains mouse selection errors without Vue error handler noise', async (): Promise<void> => {
    const errorHandler = vi.fn();
    setChatModelMock.mockRejectedValueOnce(new Error('select failed'));
    const wrapper = mount(BCommandPanel, {
      global: {
        config: {
          errorHandler
        },
        stubs: {
          AInput: AInputStub,
          BModal: BModalStub,
          BScrollbar: BScrollbarStub
        }
      }
    });
    await openPanel('model');

    await wrapper.findAll('.b-command-panel__item')[0].trigger('click');
    await flushPromises();

    expect(errorHandler).not.toHaveBeenCalled();
    expect(wrapper.find('.b-modal-stub').exists()).toBe(true);
  });

  it('clears stale results when source load throws synchronously', async (): Promise<void> => {
    const wrapper = mountCommandPanel();
    await openPanel('recent');
    expect(wrapper.text()).toContain('alpha');

    recentStoreMock.ensureLoaded.mockImplementationOnce((): void => {
      throw new Error('sync load failed');
    });
    await wrapper.find('input.a-input-stub').setValue('beta');
    await flushPromises();

    expect(wrapper.text()).toContain('没有匹配的最近记录');
    expect(wrapper.text()).not.toContain('alpha');
  });

  it('closes through BModal close event and restores focus callback', async (): Promise<void> => {
    const onClose = vi.fn();
    const wrapper = mountCommandPanel();
    await openPanel('model', onClose);

    wrapper.findComponent(BModalStub).vm.$emit('close');
    await nextTick();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(wrapper.find('.b-modal-stub').exists()).toBe(false);
  });

  it('treats removed > command input as recent search text', async (): Promise<void> => {
    const wrapper = mountCommandPanel();
    await openPanel('recent');

    await wrapper.find('input.a-input-stub').setValue('> models');
    await flushPromises();

    expect(wrapper.text()).toContain('没有匹配的最近记录');
    expect(wrapper.text()).not.toContain('model');
  });
});
