/* @vitest-environment jsdom */
/**
 * @file chat-slash-commands.test.ts
 * @description BChatSidebar slash command registry and runtime /model open-path tests.
 */
import { nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import BChatSidebar from '@/components/BChatSidebar/index.vue';
import { chatSlashCommands } from '@/components/BChatSidebar/utils/slashCommands';
import type { Message } from '@/components/BChatSidebar/utils/types';

const chatStreamLoadingState = {
  value: false
};

interface ChatStreamHookOptions {
  onBeforeRegenerate: (nextMessages: Message[]) => Promise<void>;
  onComplete: (message: Message) => Promise<void>;
  onConfirmationAction: (confirmationId: string, action: string) => Promise<void>;
}

const chatStreamHookState: {
  options: ChatStreamHookOptions | null;
} = {
  options: null
};

const {
  insertTextAtCursorMock,
  focusMock,
  saveCursorPositionMock,
  modelSelectorOpenMock,
  getSessionUsageMock,
  loadProvidersMock,
  getServiceModelConfigMock,
  getSessionMessagesMock,
  createSessionMock,
  addSessionMessageMock,
  setSessionMessagesMock,
  setChatSidebarActiveSessionIdMock,
  setSidebarVisibleMock,
  onChatFileReferenceInsertMock
} = vi.hoisted(() => ({
  insertTextAtCursorMock: vi.fn(),
  focusMock: vi.fn(),
  saveCursorPositionMock: vi.fn(),
  modelSelectorOpenMock: vi.fn(),
  getSessionUsageMock: vi.fn(async () => undefined),
  loadProvidersMock: vi.fn(async () => undefined),
  getServiceModelConfigMock: vi.fn(async () => undefined),
  getSessionMessagesMock: vi.fn(async () => []),
  createSessionMock: vi.fn(async () => undefined),
  addSessionMessageMock: vi.fn(async () => undefined),
  setSessionMessagesMock: vi.fn(async () => undefined),
  setChatSidebarActiveSessionIdMock: vi.fn(),
  setSidebarVisibleMock: vi.fn(),
  onChatFileReferenceInsertMock: vi.fn(() => vi.fn())
}));

vi.mock('@/components/BPromptEditor/index.vue', async () => {
  const { defineComponent, h } = await import('vue');

  return {
    default: defineComponent({
      name: 'BPromptEditor',
      props: {
        value: {
          type: String,
          default: ''
        }
      },
      emits: ['slash-command', 'submit', 'change'],
      setup(props, { expose }) {
        expose({
          focus: focusMock,
          saveCursorPosition: saveCursorPositionMock,
          insertTextAtCursor: insertTextAtCursorMock,
          getText: () => props.value
        });

        return () => h('div', { 'data-testid': 'prompt-editor-stub' }, props.value);
      }
    })
  };
});

vi.mock('@/components/BButton/index.vue', async () => {
  const { defineComponent, h } = await import('vue');

  return {
    default: defineComponent({
      name: 'BButton',
      emits: ['click'],
      setup(_props, { slots }) {
        return () => h('button', { type: 'button' }, slots.default?.());
      }
    })
  };
});

vi.mock('@/components/BChatSidebar/components/ConversationView.vue', async () => {
  const { defineComponent, h } = await import('vue');

  return {
    default: defineComponent({
      name: 'ConversationView',
      props: {
        messages: {
          type: Array,
          default: () => []
        },
        loading: {
          type: Boolean,
          default: false
        }
      },
      emits: ['edit', 'regenerate', 'load-history', 'confirmation-action', 'user-choice-submit'],
      setup(_props, { slots }) {
        return () => h('div', { 'data-testid': 'conversation-view-stub' }, slots.default?.());
      }
    })
  };
});

vi.mock('@/components/BChatSidebar/components/InputToolbar.vue', async () => {
  const { defineComponent, h } = await import('vue');

  return {
    default: defineComponent({
      name: 'InputToolbar',
      emits: ['submit', 'abort', 'model-change'],
      setup(_props, { expose }) {
        expose({
          open: modelSelectorOpenMock
        });

        return () => h('div', { 'data-testid': 'input-toolbar-stub' });
      }
    })
  };
});

vi.mock('@/components/BChatSidebar/components/SessionHistory.vue', async () => {
  const { defineComponent, h } = await import('vue');

  return {
    default: defineComponent({
      name: 'SessionHistory',
      props: {
        currentSession: {
          type: Object,
          default: undefined
        }
      },
      emits: ['update:current-session', 'switch-session'],
      setup() {
        return () => h('div', { 'data-testid': 'session-history-stub' });
      }
    })
  };
});

vi.mock('@/components/BChatSidebar/components/InputToolbar/ModelSelector.vue', async () => {
  const { defineComponent, h } = await import('vue');

  return {
    default: defineComponent({
      name: 'ModelSelector',
      props: {
        model: {
          type: String,
          default: undefined
        }
      },
      emits: ['update:model'],
      setup(_props, { expose }) {
        expose({
          open: modelSelectorOpenMock
        });

        return () => h('div', { 'data-testid': 'model-selector-stub' });
      }
    })
  };
});

vi.mock('@/stores/provider', () => ({
  useProviderStore: () => ({
    providers: [],
    loadProviders: loadProvidersMock
  })
}));

vi.mock('@/shared/storage', () => ({
  serviceModelsStorage: {
    getConfig: getServiceModelConfigMock,
    saveConfig: vi.fn()
  }
}));

vi.mock('@/stores/chat', () => ({
  useChatStore: () => ({
    getSessionMessages: getSessionMessagesMock,
    getSessionUsage: getSessionUsageMock,
    createSession: createSessionMock,
    addSessionMessage: addSessionMessageMock,
    setSessionMessages: setSessionMessagesMock
  })
}));

const settingStoreState = {
  chatSidebarActiveSessionId: 'session-usage'
};

vi.mock('@/stores/setting', () => ({
  useSettingStore: () => ({
    chatSidebarActiveSessionId: settingStoreState.chatSidebarActiveSessionId,
    setChatSidebarActiveSessionId: (sessionId: string | null) => {
      settingStoreState.chatSidebarActiveSessionId = sessionId;
      setChatSidebarActiveSessionIdMock(sessionId);
    },
    setSidebarVisible: (visible: boolean) => {
      setSidebarVisibleMock(visible);
    }
  })
}));

vi.mock('@/ai/tools/builtin', () => ({
  createBuiltinTools: () => []
}));

vi.mock('@/ai/tools/editor-context', () => ({
  editorToolContextRegistry: {
    getCurrentContext: vi.fn(() => undefined)
  }
}));

vi.mock('@/ai/tools/policy', () => ({
  getDefaultChatToolNames: () => []
}));

vi.mock('@/components/BChatSidebar/hooks/useChatHistory', async () => {
  const { ref } = await import('vue');

  return {
    useChatHistory: () => ({
      getHistoryCursor: vi.fn(() => null),
      setLoadedMessages: vi.fn(),
      fetchAllPriorHistory: vi.fn(async () => []),
      messages: ref([])
    })
  };
});

vi.mock('@/components/BChatSidebar/hooks/useChatStream', async () => {
  return {
    useChatStream: (options: ChatStreamHookOptions) => {
      chatStreamHookState.options = options;

      return {
        loading: chatStreamLoadingState,
        abort: vi.fn(),
        resolveServiceConfig: vi.fn(async () => null),
        streamMessages: vi.fn(async () => undefined),
        regenerate: vi.fn(async () => undefined),
        submitUserChoice: vi.fn(async () => undefined)
      };
    }
  };
});

vi.mock('@/components/BChatSidebar/hooks/useAutoName', () => ({
  useAutoName: () => ({
    captureSnapshot: vi.fn(() => null),
    scheduleAutoName: vi.fn()
  })
}));

vi.mock('@/components/BChatSidebar/utils/confirmationController', () => ({
  createChatConfirmationController: () => ({
    createAdapter: vi.fn(),
    approveConfirmation: vi.fn(),
    cancelConfirmation: vi.fn(),
    expirePendingConfirmation: vi.fn(),
    dispose: vi.fn()
  })
}));

vi.mock('@/shared/chat/fileReference', () => ({
  onChatFileReferenceInsert: onChatFileReferenceInsertMock
}));

/**
 * Mounts the chat sidebar with lightweight child stubs while preserving the real slash-command wiring.
 * @returns Mounted sidebar wrapper.
 */
function mountChatSidebar() {
  return mount(BChatSidebar, {
    global: {
      stubs: {
        Icon: true,
        BButton: true,
        ConversationView: true,
        SessionHistory: true
      }
    }
  });
}

describe('chatSlashCommands', () => {
  beforeEach(() => {
    insertTextAtCursorMock.mockReset();
    focusMock.mockReset();
    saveCursorPositionMock.mockReset();
    modelSelectorOpenMock.mockReset();
    getSessionUsageMock.mockReset();
    loadProvidersMock.mockClear();
    getServiceModelConfigMock.mockClear();
    getSessionMessagesMock.mockClear();
    createSessionMock.mockClear();
    addSessionMessageMock.mockClear();
    setSessionMessagesMock.mockClear();
    setChatSidebarActiveSessionIdMock.mockClear();
    setSidebarVisibleMock.mockClear();
    onChatFileReferenceInsertMock.mockClear();
    settingStoreState.chatSidebarActiveSessionId = 'session-usage';
    chatStreamLoadingState.value = false;
    chatStreamHookState.options = null;
  });

  test('exports first-version commands with the shared metadata contract', () => {
    expect(chatSlashCommands).toEqual([
      {
        id: 'model',
        trigger: '/model',
        title: '模型',
        description: '切换当前使用的模型。',
        type: 'action'
      },
      {
        id: 'usage',
        trigger: '/usage',
        title: '使用情况',
        description: '显示当前会话的 token 使用情况。',
        type: 'action'
      },
      {
        id: 'new',
        trigger: '/new',
        title: '新建聊天',
        description: '开始一个新的聊天会话。',
        type: 'action'
      },
      {
        id: 'clear',
        trigger: '/clear',
        title: '清空输入',
        description: '清除当前聊天输入内容。',
        type: 'action'
      }
    ]);
  });

  test('opens the shared model selector surface at runtime when the editor emits /model', async () => {
    const wrapper = mountChatSidebar();

    wrapper.getComponent({ name: 'BPromptEditor' }).vm.$emit('slash-command', chatSlashCommands[0]);
    await nextTick();

    expect(modelSelectorOpenMock).toHaveBeenCalledTimes(1);
  });

  test('clears only the current draft input and draft references when the editor emits /clear', async () => {
    const wrapper = mountChatSidebar();
    const promptEditor = wrapper.getComponent({ name: 'BPromptEditor' });
    const draftReference = {
      id: 'ref-1',
      token: '{{file-ref:ref-1}}',
      documentId: 'doc-1',
      fileName: 'draft.md',
      line: '12-18',
      path: null,
      snapshotId: 'snapshot-1',
      excerpt: '## Heading'
    };

    wrapper.getComponent({ name: 'ConversationView' }).vm.$emit('edit', {
      id: 'message-1',
      role: 'user',
      content: 'Draft text',
      parts: [{ type: 'text', text: 'Draft text' }],
      references: [draftReference],
      createdAt: '2026-04-29T00:00:00.000Z'
    });
    await nextTick();

    expect(promptEditor.text()).toContain('Draft text');

    wrapper.getComponent({ name: 'BPromptEditor' }).vm.$emit('slash-command', chatSlashCommands[3]);
    await nextTick();

    expect(promptEditor.text()).not.toContain('Draft text');
    expect(focusMock).toHaveBeenCalledTimes(1);
    expect(setChatSidebarActiveSessionIdMock).not.toHaveBeenCalled();
  });

  test('does not start a new chat while the stream is still loading', async () => {
    chatStreamLoadingState.value = true;
    const wrapper = mountChatSidebar();

    wrapper.getComponent({ name: 'BPromptEditor' }).vm.$emit('slash-command', chatSlashCommands[2]);
    await nextTick();

    expect(createSessionMock).not.toHaveBeenCalled();
    expect(setChatSidebarActiveSessionIdMock).not.toHaveBeenCalled();
    expect(focusMock).not.toHaveBeenCalled();
  });

  test('opens usage immediately and shows loading before the usage request resolves', async () => {
    let resolveUsage: ((value: { inputTokens: number; outputTokens: number; totalTokens: number } | undefined) => void) | null = null;
    getSessionUsageMock.mockImplementation(
      async () =>
        new Promise<{ inputTokens: number; outputTokens: number; totalTokens: number } | undefined>((resolve) => {
          resolveUsage = resolve;
        })
    );

    const wrapper = mountChatSidebar();

    wrapper.getComponent({ name: 'BPromptEditor' }).vm.$emit('slash-command', chatSlashCommands[1]);
    await nextTick();

    expect(wrapper.findComponent({ name: 'UsagePanel' }).exists()).toBe(true);
    expect(wrapper.text()).toContain('加载用量中');
    expect(getSessionUsageMock).toHaveBeenCalledWith('session-usage');

    resolveUsage?.({ inputTokens: 12, outputTokens: 8, totalTokens: 20 });
    await Promise.resolve();
    await nextTick();
    await nextTick();

    expect(wrapper.text()).toContain('12');
    expect(wrapper.text()).toContain('8');
    expect(wrapper.text()).toContain('20');
  });

  test('opens usage and shows the empty state when there is no active session', async () => {
    settingStoreState.chatSidebarActiveSessionId = null;
    const wrapper = mountChatSidebar();

    wrapper.getComponent({ name: 'BPromptEditor' }).vm.$emit('slash-command', chatSlashCommands[1]);
    await nextTick();

    expect(wrapper.findComponent({ name: 'UsagePanel' }).exists()).toBe(true);
    expect(getSessionUsageMock).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="usage-panel-empty"]').exists()).toBe(true);
  });

  test('opens usage and shows the error state when reading persisted usage fails', async () => {
    getSessionUsageMock.mockRejectedValue(new Error('usage unavailable'));
    const wrapper = mountChatSidebar();

    wrapper.getComponent({ name: 'BPromptEditor' }).vm.$emit('slash-command', chatSlashCommands[1]);
    await Promise.resolve();
    await nextTick();
    await nextTick();

    expect(getSessionUsageMock).toHaveBeenCalledWith('session-usage');
    expect(wrapper.find('[data-testid="usage-panel-error"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('usage unavailable');
  });

  test('refreshes visible usage totals after an assistant completion persists new usage for the active session', async () => {
    getSessionUsageMock
      .mockResolvedValueOnce({ inputTokens: 12, outputTokens: 8, totalTokens: 20 })
      .mockResolvedValueOnce({ inputTokens: 15, outputTokens: 9, totalTokens: 24 });
    const wrapper = mountChatSidebar();

    wrapper.getComponent({ name: 'BPromptEditor' }).vm.$emit('slash-command', chatSlashCommands[1]);
    await Promise.resolve();
    await nextTick();
    await nextTick();

    expect(wrapper.text()).toContain('20');

    await chatStreamHookState.options?.onComplete({
      id: 'assistant-1',
      role: 'assistant',
      content: 'Updated usage reply',
      parts: [{ type: 'text', text: 'Updated usage reply' }],
      usage: { inputTokens: 3, outputTokens: 1, totalTokens: 4 },
      createdAt: '2026-04-29T00:00:00.000Z'
    });
    await Promise.resolve();
    await nextTick();
    await nextTick();

    expect(getSessionUsageMock).toHaveBeenNthCalledWith(1, 'session-usage');
    expect(getSessionUsageMock).toHaveBeenNthCalledWith(2, 'session-usage');
    expect(wrapper.text()).toContain('24');
  });
});
