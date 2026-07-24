/**
 * @file session-id-runtime.test.ts
 * @description BChat 基于 sessionId 的会话运行时测试。
 * @vitest-environment jsdom
 */
/* eslint-disable vue/one-component-per-file */
import type { AIProvider, AIToolExecutor } from 'types/ai';
import type {
  AIUserChoiceAnswerData,
  ChatMessageFilePartInput,
  ChatMessageRecord,
  ChatMessageToolPart,
  ChatMessageWidgetResultPart,
  ChatSession
} from 'types/chat';
import type {
  ChatRuntimeCompactInput,
  ChatRuntimeContinueInput,
  ChatRuntimeHandlerResult,
  ChatRuntimeSendInput,
  ChatRuntimeStartResult,
  ChatRuntimeSubmitUserChoiceInput
} from 'types/chat-runtime';
import { defineComponent, h, type PropType } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, shallowMount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BuildMemoryContextOptions } from '@/ai/memory/types';
import type { ToastItem } from '@/components/BChat/components/InteractionContainer/types';
import BChat from '@/components/BChat/index.vue';
import { type AdaptedUserMessageInput, type SubmitAction, createUserChoice } from '@/components/BChat/utils/submitAction';
import type { Message } from '@/components/BChat/utils/types';
import type { FileMentionOption } from '@/components/BSmart/types';
import { emitChatFileReferenceInsert } from '@/shared/chat/fileReference';
import { native } from '@/shared/platform';
import type { StoredFile } from '@/shared/storage';
import { useChatPermissionStore } from '@/stores/chat/permission';
import type { TodoItem } from '@/stores/chat/todo';
import { useSettingStore } from '@/stores/ui/setting';
import { emitRuntimeEvent, resetRuntimeEventListeners, type RuntimeEventListeners } from './runtime-event-test-utils';

const chatStoreMock = vi.hoisted(() => ({
  createSession: vi.fn<(type: 'assistant', options: { title: string; model?: { providerId: string; modelId: string } }) => Promise<ChatSession>>(),
  branchSession: vi.fn<(sourceSessionId: string, targetMessageId: string) => Promise<ChatSession>>(),
  addSessionMessage: vi.fn<(sessionId: string | null, message: Message) => Promise<void>>(),
  updateSessionMessage: vi.fn<(sessionId: string | null | undefined, message: Message) => Promise<void>>(),
  setSessionMessages: vi.fn<(sessionId: string | null | undefined, messages: Message[]) => Promise<void>>(),
  getSessionMessages: vi.fn<(sessionId: string) => Promise<Message[]>>(),
  loadSessionById: vi.fn<(sessionId: string) => Promise<ChatSession | undefined>>(),
  findSession: vi.fn<(sessionId?: string | null) => ChatSession | undefined>(),
  updateSessionModel: vi.fn<(sessionId: string, model: { providerId: string; modelId: string }) => Promise<ChatSession>>(),
  ensureSessionModel: vi.fn<(sessionId: string, model: { providerId: string; modelId: string }) => Promise<ChatSession>>(),
  getSessions: vi.fn()
}));

const promptEditorMockState = vi.hoisted(() => ({
  focus: vi.fn(),
  saveCursorPosition: vi.fn(),
  insertTextAtCursor: vi.fn<(text: string) => void>(),
  getCursorPosition: vi.fn<() => number>(() => 0),
  replaceTextRange: vi.fn()
}));
const getPathForFileMock = vi.hoisted(() => vi.fn<(_file: File) => string | null>().mockReturnValue('/workspace/My Notes/note.md'));
const getModelToolSupportMock = vi.hoisted(() => vi.fn());
const runtimeListeners = vi.hoisted<RuntimeEventListeners>(() => ({}));
const electronAPIMock = vi.hoisted(() => ({
  chatRuntimeEstimateContext: vi.fn(),
  chatRuntimeSend: vi.fn(),
  chatRuntimeContinue: vi.fn(),
  chatRuntimeCompact: vi.fn(),
  chatRuntimeSubmitUserChoice: vi.fn(),
  chatRuntimeAbort: vi.fn(),
  chatRuntimeSubmitToolResult: vi.fn(),
  chatRuntimeSubmitConfirmation: vi.fn(),
  chatRuntimeSubmitBridgeResponse: vi.fn(),
  chatRuntimeOnMessageCreated: vi.fn((callback: NonNullable<typeof runtimeListeners.messageCreated>) => {
    runtimeListeners.messageCreated = callback;
    return vi.fn();
  }),
  chatRuntimeOnMessageUpdated: vi.fn((callback: NonNullable<typeof runtimeListeners.messageUpdated>) => {
    runtimeListeners.messageUpdated = callback;
    return vi.fn();
  }),
  chatRuntimeOnMessageDeleted: vi.fn((callback: NonNullable<typeof runtimeListeners.messageDeleted>) => {
    runtimeListeners.messageDeleted = callback;
    return vi.fn();
  }),
  chatRuntimeOnContextUsageUpdated: vi.fn((callback: NonNullable<typeof runtimeListeners.contextUsage>) => {
    runtimeListeners.contextUsage = callback;
    return vi.fn();
  }),
  chatRuntimeOnToolRequest: vi.fn(() => vi.fn()),
  chatRuntimeOnToolCancelled: vi.fn(() => vi.fn()),
  onShellRunEvent: vi.fn(() => vi.fn()),
  chatRuntimeOnConfirmationRequested: vi.fn((callback: NonNullable<typeof runtimeListeners.confirmationRequest>) => {
    runtimeListeners.confirmationRequest = callback;
    return vi.fn();
  }),
  chatRuntimeOnBridgeRequested: vi.fn(() => vi.fn()),
  chatRuntimeOnError: vi.fn((callback: NonNullable<typeof runtimeListeners.error>) => {
    runtimeListeners.error = callback;
    return vi.fn();
  }),
  chatRuntimeOnComplete: vi.fn((callback: NonNullable<typeof runtimeListeners.complete>) => {
    runtimeListeners.complete = callback;
    return vi.fn();
  })
}));
const actorSystemMockState = vi.hoisted(() => ({
  registerRuntime: vi.fn()
}));

const autoNameMockState = vi.hoisted(() => ({
  options: undefined as
    | {
        onTitlePersisted?: (sessionId: string, title: string) => Promise<void> | void;
      }
    | undefined
}));

const toolSettingsMockState = vi.hoisted(() => ({
  tavily: undefined as { enabled: boolean; apiKey: string } | undefined,
  mcp: {
    servers: [] as Array<{
      id: string;
      name: string;
      enabled: boolean;
      transport: 'stdio' | 'streamableHTTP' | 'sse';
      url?: string;
      command: string;
      args: string[];
      env: Record<string, string>;
      headers: Record<string, string>;
      toolAllowlist: string[];
    }>
  }
}));

const builtinToolsMockState = vi.hoisted(() => ({
  tools: [] as AIToolExecutor[]
}));

const loggerMockState = vi.hoisted(() => ({
  info: vi.fn<(_message: string) => Promise<void>>(() => Promise.resolve()),
  warn: vi.fn<(_message: string) => Promise<void>>(() => Promise.resolve()),
  error: vi.fn<(_message: string) => Promise<void>>(() => Promise.resolve())
}));

const memoryStoreMock = vi.hoisted(() => ({
  loaded: true,
  loadMemory: vi.fn<() => Promise<void>>(),
  buildSystemPromptContext: vi.fn<(_options?: BuildMemoryContextOptions) => string>(() => '')
}));

const skillStoreMock = vi.hoisted(() => ({
  initialized: true,
  getEnabledSkills: vi.fn(() => [] as Array<{ name: string; contentHash?: string }>),
  resolveLatestSkill: vi.fn<(_name: string) => Promise<undefined>>(),
  resolveLatestEnabledSkill: vi.fn<(_name: string) => Promise<undefined>>(),
  waitForInit: vi.fn<() => Promise<void>>(() => Promise.resolve()),
  syncFromDisk: vi.fn<() => Promise<void>>(() => Promise.resolve()),
  // syncDirtyFromDisk 在 useRuntimeTools.syncAIResources 中被调用，需与 syncFromDisk 一并 mock
  syncDirtyFromDisk: vi.fn<() => Promise<void>>(() => Promise.resolve()),
  initialize: vi.fn<() => Promise<void>>(() => Promise.resolve()),
  handleSkillChange: vi.fn()
}));

const recentStoreMock = vi.hoisted(() => ({
  recentFiles: [] as StoredFile[],
  ensureLoaded: vi.fn<() => Promise<void>>(() => Promise.resolve()),
  getFileByPath: vi.fn()
}));

const modalMock = vi.hoisted(() => ({
  confirm: vi.fn<(title: string, content: string, options?: unknown) => Promise<[boolean]>>()
}));

const todoStoreMock = vi.hoisted(
  (): {
    todosBySession: Map<string, TodoItem[]>;
    clearTodos: ReturnType<typeof vi.fn<(sessionId: string) => void>>;
    getTodos: ReturnType<typeof vi.fn<(sessionId: string) => TodoItem[]>>;
    restoreBeforeRuntimeIds: ReturnType<typeof vi.fn<(sessionId: string, runtimeIds: string[]) => boolean>>;
  } => {
    const todosBySession = new Map<string, TodoItem[]>();

    return {
      todosBySession,
      clearTodos: vi.fn<(sessionId: string) => void>((sessionId: string): void => {
        todosBySession.delete(sessionId);
      }),
      getTodos: vi.fn<(sessionId: string) => TodoItem[]>((sessionId: string) => todosBySession.get(sessionId) ?? []),
      restoreBeforeRuntimeIds: vi.fn<(sessionId: string, runtimeIds: string[]) => boolean>(() => false)
    };
  }
);

const conversationViewMockState = vi.hoisted(() => ({
  scrollToBottom: vi.fn<() => void>()
}));

/** 可手动完成的测试 Promise。 */
interface DeferredPromise<T> {
  /** 被测试代码等待的 Promise。 */
  promise: Promise<T>;
  /** 手动完成 Promise 的回调。 */
  resolve: (value: T | PromiseLike<T>) => void;
}

/**
 * 创建可手动完成的测试 Promise。
 * @returns Deferred Promise 控制器
 */
function createDeferred<T>(): DeferredPromise<T> {
  let resolveDeferred: DeferredPromise<T>['resolve'] = (): void => undefined;
  const promise = new Promise<T>((resolve): void => {
    resolveDeferred = resolve;
  });

  return { promise, resolve: resolveDeferred };
}

vi.mock('vue-router', () => ({
  useRouter: vi.fn(() => ({
    push: vi.fn()
  }))
}));

vi.mock('@/hooks/useChat/useActorSystem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useChat/useActorSystem')>();

  return {
    ...actual,
    useActorSystem: () => {
      const actorSystem = actual.useActorSystem();
      const registerRuntime = actorSystem.registerRuntime.bind(actorSystem);
      actorSystem.registerRuntime = (address, capabilities): void => {
        actorSystemMockState.registerRuntime(address, capabilities);
        registerRuntime(address, capabilities);
      };
      return actorSystem;
    }
  };
});

vi.mock('@/components/BButton/index.vue', () => ({
  default: {
    name: 'BButton',
    props: ['disabled'],
    emits: ['click'],
    template: '<button v-bind="$attrs" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>'
  }
}));

vi.mock('@/ai/tools/builtin', () => ({
  createBuiltinTools: vi.fn(() => builtinToolsMockState.tools),
  isBuiltinToolName: vi.fn(() => true),
  EDIT_MEMORY_TOOL_NAME: 'edit_memory',
  OPEN_RESOURCE_TOOL_NAME: 'open_resource',
  OPEN_WIDGET_TOOL_NAME: 'open_widget',
  OPERATE_WEBPAGE_TOOL_NAME: 'operate_webpage',
  READ_CURRENT_WEBPAGE_TOOL_NAME: 'read_current_webpage',
  READ_DIRECTORY_TOOL_NAME: 'read_directory',
  SKILL_TOOL_NAME: 'skill',
  WIDGET_TOOL_NAME: 'widget'
}));

vi.mock('@/shared/logger', () => ({
  logger: loggerMockState
}));

vi.mock('@/ai/tools/builtin/SkillTool', () => ({
  createSkillTool: vi.fn()
}));

vi.mock('@/shared/platform', () => ({
  native: {
    onShellCommandOutput: vi.fn(() => vi.fn()),
    onShellRunEvent: vi.fn(() => vi.fn()),
    openExternal: vi.fn(),
    getHomeDir: vi.fn(() => '/Users/test'),
    readFile: vi.fn(() => ({ content: '' })),
    readWorkspaceDirectory: vi.fn(() => []),
    getPathStatus: vi.fn(),
    trashFile: vi.fn(),
    watchDirectory: vi.fn(),
    unwatchDirectory: vi.fn(),
    onSkillChanged: vi.fn(() => vi.fn()),
    getPathForFile: getPathForFileMock
  }
}));

vi.mock('@/shared/platform/electron-api', () => ({
  getElectronAPI: vi.fn(() => electronAPIMock),
  hasElectronAPI: vi.fn(() => false),
  unwrap: vi.fn((value: unknown) => value)
}));

vi.mock('@/hooks/useWorkspaceRoot', () => ({
  useWorkspaceRoot: vi.fn(() => ({
    workspaceRoot: { value: '/workspace' },
    getWorkspaceRoot: vi.fn(() => '/workspace')
  }))
}));

vi.mock('@/hooks/useNavigate', () => ({
  useNavigate: vi.fn(() => ({
    openDraft: vi.fn(),
    openFile: vi.fn(),
    openFileByPath: vi.fn(),
    openSkill: vi.fn(),
    openWebview: vi.fn()
  }))
}));

vi.mock('@/stores/workspace/recent', () => ({
  useRecentStore: vi.fn(() => recentStoreMock)
}));

vi.mock('@/stores/chat/session', () => ({
  useChatSessionStore: vi.fn(() => chatStoreMock)
}));

vi.mock('@/stores/chat/todo', () => ({
  useTodoStore: vi.fn(() => todoStoreMock)
}));

vi.mock('@/stores/ai/serviceModel', () => ({
  useServiceModelStore: vi.fn(() => ({
    chatModel: { providerId: 'provider-1', modelId: 'model-1' },
    loadChatModel: vi.fn(() => Promise.resolve()),
    setChatModel: vi.fn()
  }))
}));

vi.mock('@/ai/tools/policy', () => ({
  getModelToolSupport: getModelToolSupportMock
}));

vi.mock('@/stores/ai/provider', () => ({
  useProviderStore: vi.fn(() => ({
    providers: [
      {
        id: 'provider-1',
        name: 'Provider 1',
        description: 'Provider for BChat runtime tests',
        type: 'openai',
        isEnabled: true,
        models: [{ id: 'model-1', name: 'Model 1', type: 'chat', isEnabled: true, supportsVision: false, contextWindow: 200000 }]
      } satisfies AIProvider
    ],
    availableModels: [],
    loadProviders: vi.fn((): Promise<void> => Promise.resolve())
  }))
}));

vi.mock('@/stores/ai/toolSettings', () => ({
  useToolSettingsStore: vi.fn(() => toolSettingsMockState)
}));

vi.mock('@/stores/ai/memory', () => ({
  useMemoryStore: vi.fn(() => memoryStoreMock)
}));

vi.mock('@/stores/ai/skill', () => ({
  useSkillStore: vi.fn(() => skillStoreMock)
}));

vi.mock('@/components/BChat/hooks/useAutoName', () => ({
  useAutoName: vi.fn((options: { onTitlePersisted?: (sessionId: string, title: string) => Promise<void> | void }) => {
    autoNameMockState.options = options;

    return {
      captureSnapshot: vi.fn(() => null),
      scheduleAutoName: vi.fn()
    };
  })
}));

vi.mock('@/utils/modal', () => ({
  Modal: modalMock
}));

const BSmartEditorStub = defineComponent({
  name: 'BSmartEditor',
  props: {
    value: {
      type: String,
      default: ''
    },
    fileMentions: {
      type: Array as PropType<FileMentionOption[]>,
      default: () => []
    }
  },
  emits: ['update:value', 'submit', 'slash-command', 'file-mention-select'],
  setup(_props, { expose }) {
    expose({
      focus: promptEditorMockState.focus,
      saveCursorPosition: promptEditorMockState.saveCursorPosition,
      insertTextAtCursor: promptEditorMockState.insertTextAtCursor,
      getCursorPosition: promptEditorMockState.getCursorPosition,
      replaceTextRange: promptEditorMockState.replaceTextRange
    });

    return () => h('div', { class: 'prompt-editor-stub' });
  }
});

const InputToolbarStub = defineComponent({
  name: 'InputToolbar',
  props: {
    loading: {
      type: Boolean,
      default: false
    },
    contextUsedTokens: {
      type: Number,
      default: 0
    },
    contextWindow: {
      type: Number,
      default: 0
    }
  },
  emits: ['submit', 'abort', 'image-select', 'model-change'],
  setup(_props, { emit }) {
    return () =>
      h(
        'button',
        {
          class: 'input-submit-stub',
          onClick: () => emit('submit')
        },
        'submit'
      );
  }
});

const ConversationViewStub = defineComponent({
  name: 'ConversationView',
  props: {
    messages: {
      type: Array,
      default: () => []
    },
    submitAction: {
      type: Function,
      default: undefined
    },
    disabled: {
      type: Boolean,
      default: false
    },
    loading: {
      type: Boolean,
      default: false
    }
  },
  emits: ['branch', 'regenerate', 'rollback'],
  setup(_props, { expose, slots }) {
    expose({
      scrollToBottom: conversationViewMockState.scrollToBottom
    });

    return () => h('div', { class: 'conversation-view-stub' }, slots.footer?.());
  }
});

/**
 * 通过 ConversationView 的 submitAction prop 提交消息级动作。
 * @param wrapper - BChat 组件包装器
 * @param action - 提交动作
 */
async function submitConversationAction(wrapper: ReturnType<typeof shallowMount>, action: SubmitAction): Promise<void> {
  const submitAction = wrapper.findComponent(ConversationViewStub).props('submitAction') as ((nextAction: SubmitAction) => Promise<void> | void) | undefined;
  if (!submitAction) throw new Error('Expected ConversationView submitAction prop');

  await submitAction(action);
}

const CommandPanelStub = defineComponent({
  name: 'BCommandPanel',
  setup(_props, { expose }) {
    expose({
      open: vi.fn()
    });

    return () => h('div', { class: 'command-panel-stub' });
  }
});

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

/**
 * 创建测试消息。
 * @param id - 消息 ID
 * @param content - 消息内容
 * @returns 测试消息
 */
function createMessage(id: string, content: string): Message {
  return {
    id,
    role: 'user',
    content,
    parts: [{ id: 'part0035', type: 'text', text: content }],
    createdAt: '2026-06-15T00:00:00.000Z'
  };
}

/**
 * 创建测试用 AI 工具。
 * @param name - 工具名称
 * @returns 工具执行器
 */
function createRuntimeTool(name: string): AIToolExecutor {
  return {
    definition: {
      name,
      description: `${name} description`,
      source: 'builtin',
      riskLevel: name === 'edit_memory' ? 'write' : 'read',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false
      },
      requiresActiveDocument: false
    },
    execute: async (): Promise<{ toolName: string; status: 'success'; data: null }> => ({ toolName: name, status: 'success', data: null })
  };
}

/**
 * 创建测试用助手消息。
 * @param overrides - 需要覆盖的消息字段。
 * @returns 测试助手消息。
 */
function createAssistantMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'assistant-1',
    role: 'assistant',
    content: 'assistant content',
    parts: [{ id: 'part0036', type: 'text', text: 'assistant content' }],
    createdAt: '2026-06-15T00:00:01.000Z',
    loading: false,
    finished: true,
    ...overrides
  };
}

/**
 * 创建测试用运行态用户消息提交动作。
 * @param input - 已适配的用户消息提交输入
 * @returns 统一提交动作
 */
function createRuntimeUserMessageTestSubmitAction(input: AdaptedUserMessageInput): SubmitAction {
  return {
    async run(context): Promise<void> {
      await context.sendAdaptedUserMessage(input);
    }
  };
}

/**
 * 创建带文件拖拽数据的 DOM 事件。
 * @param type - 事件类型
 * @param files - 拖拽文件列表
 * @returns 拖拽事件
 */
function createFileDragEvent(type: 'dragenter' | 'dragover' | 'dragleave' | 'drop', files: File[]): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', {
    value: {
      files,
      types: ['Files'],
      dropEffect: 'none'
    }
  });
  return event;
}

/**
 * 创建最近文件记录。
 * @param overrides - 需要覆盖的字段
 * @returns 最近文件记录
 */
function createStoredFile(overrides: Partial<StoredFile> = {}): StoredFile {
  return {
    type: 'file',
    id: 'file-1',
    url: '/editor/file-1',
    title: 'note.md',
    description: '/workspace/note.md',
    path: '/workspace/note.md',
    content: '',
    name: 'note.md',
    ext: 'md',
    ...overrides
  };
}

/**
 * 挂载 BChat。
 * @param sessionId - 当前会话 ID
 * @returns 组件包装器
 */
function mountBChat(sessionId: string | null = null): ReturnType<typeof shallowMount> {
  return shallowMount(BChat, {
    props: { sessionId },
    global: {
      stubs: {
        BIcon: true,
        BCommandPanel: CommandPanelStub,
        BPanelSplitter: {
          template: '<div><slot /></div>'
        },
        BSmartEditor: BSmartEditorStub,
        ConfirmationSheet: true,
        ConversationView: ConversationViewStub,
        ImagePreview: true,
        InputToolbar: InputToolbarStub,
        InteractionContainer: true,
        SessionHistory: true,
        TodoPanel: true,
        UsagePanel: true
      }
    }
  });
}

/**
 * 发送文本并读取 renderer 分配的 Runtime ID。
 * @param wrapper - BChat wrapper
 * @param content - 输入文本
 * @returns Runtime ID
 */
async function submitTextAndReadRuntimeId(wrapper: ReturnType<typeof shallowMount>, content: string): Promise<string> {
  wrapper.findComponent(BSmartEditorStub).vm.$emit('update:value', content);
  wrapper.findComponent(InputToolbarStub).vm.$emit('submit');
  await flushPromises();
  const [input] = electronAPIMock.chatRuntimeSend.mock.calls.at(-1) as [ChatRuntimeSendInput];
  return input.runtimeId;
}

describe('BChat sessionId runtime', (): void => {
  beforeEach((): void => {
    setActivePinia(createPinia());
    localStorage.clear();
    chatStoreMock.createSession.mockReset();
    chatStoreMock.branchSession.mockReset();
    chatStoreMock.addSessionMessage.mockReset();
    chatStoreMock.updateSessionMessage.mockReset();
    chatStoreMock.setSessionMessages.mockReset();
    chatStoreMock.getSessionMessages.mockReset();
    chatStoreMock.loadSessionById.mockReset();
    chatStoreMock.findSession.mockReset();
    chatStoreMock.updateSessionModel.mockReset();
    chatStoreMock.ensureSessionModel.mockReset();
    chatStoreMock.getSessions.mockReset();
    electronAPIMock.chatRuntimeSend.mockReset();
    electronAPIMock.chatRuntimeEstimateContext.mockReset();
    electronAPIMock.chatRuntimeContinue.mockReset();
    electronAPIMock.chatRuntimeCompact.mockReset();
    electronAPIMock.chatRuntimeSubmitUserChoice.mockReset();
    electronAPIMock.chatRuntimeAbort.mockReset();
    electronAPIMock.chatRuntimeSubmitToolResult.mockReset();
    electronAPIMock.chatRuntimeSubmitConfirmation.mockReset();
    electronAPIMock.chatRuntimeSubmitBridgeResponse.mockReset();
    electronAPIMock.chatRuntimeOnMessageCreated.mockClear();
    electronAPIMock.chatRuntimeOnMessageUpdated.mockClear();
    electronAPIMock.chatRuntimeOnMessageDeleted.mockClear();
    electronAPIMock.chatRuntimeOnContextUsageUpdated.mockClear();
    electronAPIMock.chatRuntimeOnToolRequest.mockClear();
    electronAPIMock.chatRuntimeOnToolCancelled.mockClear();
    electronAPIMock.chatRuntimeOnConfirmationRequested.mockClear();
    electronAPIMock.chatRuntimeOnBridgeRequested.mockClear();
    electronAPIMock.chatRuntimeOnError.mockClear();
    electronAPIMock.chatRuntimeOnComplete.mockClear();
    getModelToolSupportMock.mockReset();
    promptEditorMockState.focus.mockReset();
    promptEditorMockState.saveCursorPosition.mockReset();
    promptEditorMockState.insertTextAtCursor.mockReset();
    promptEditorMockState.getCursorPosition.mockReset();
    promptEditorMockState.getCursorPosition.mockReturnValue(0);
    promptEditorMockState.replaceTextRange.mockReset();
    getPathForFileMock.mockReset();
    getPathForFileMock.mockReturnValue('/workspace/My Notes/note.md');
    vi.mocked(native.watchDirectory).mockClear();
    todoStoreMock.todosBySession.clear();
    todoStoreMock.clearTodos.mockReset();
    todoStoreMock.getTodos.mockClear();
    todoStoreMock.restoreBeforeRuntimeIds.mockReset();
    todoStoreMock.restoreBeforeRuntimeIds.mockReturnValue(false);
    modalMock.confirm.mockReset();
    modalMock.confirm.mockResolvedValue([false]);
    autoNameMockState.options = undefined;
    toolSettingsMockState.tavily = undefined;
    toolSettingsMockState.mcp.servers = [];
    builtinToolsMockState.tools = [];
    loggerMockState.info.mockReset();
    loggerMockState.info.mockResolvedValue();
    loggerMockState.warn.mockReset();
    loggerMockState.warn.mockResolvedValue();
    loggerMockState.error.mockReset();
    loggerMockState.error.mockResolvedValue();
    memoryStoreMock.loaded = true;
    memoryStoreMock.loadMemory.mockReset();
    memoryStoreMock.loadMemory.mockResolvedValue();
    memoryStoreMock.buildSystemPromptContext.mockReset();
    memoryStoreMock.buildSystemPromptContext.mockReturnValue('');
    skillStoreMock.initialized = true;
    skillStoreMock.getEnabledSkills.mockReset();
    skillStoreMock.getEnabledSkills.mockReturnValue([]);
    skillStoreMock.resolveLatestSkill.mockReset();
    skillStoreMock.resolveLatestSkill.mockResolvedValue(undefined);
    skillStoreMock.resolveLatestEnabledSkill.mockReset();
    skillStoreMock.resolveLatestEnabledSkill.mockResolvedValue(undefined);
    skillStoreMock.waitForInit.mockClear();
    skillStoreMock.syncFromDisk.mockClear();
    skillStoreMock.syncDirtyFromDisk.mockClear();
    recentStoreMock.recentFiles = [];
    recentStoreMock.ensureLoaded.mockReset();
    recentStoreMock.ensureLoaded.mockResolvedValue();
    recentStoreMock.getFileByPath.mockReset();
    resetRuntimeEventListeners(runtimeListeners);
    conversationViewMockState.scrollToBottom.mockReset();
    actorSystemMockState.registerRuntime.mockReset();
    chatStoreMock.getSessionMessages.mockResolvedValue([]);
    chatStoreMock.loadSessionById.mockResolvedValue(undefined);
    chatStoreMock.findSession.mockReturnValue(undefined);
    chatStoreMock.getSessions.mockResolvedValue({ items: [], hasMore: false });
    chatStoreMock.addSessionMessage.mockResolvedValue();
    chatStoreMock.updateSessionMessage.mockResolvedValue();
    chatStoreMock.setSessionMessages.mockResolvedValue();
    chatStoreMock.ensureSessionModel.mockImplementation(
      async (sessionId, model): Promise<ChatSession> => ({
        ...createSession(sessionId, sessionId),
        metadata: { model }
      })
    );
    electronAPIMock.chatRuntimeSend.mockImplementation((input: ChatRuntimeSendInput) =>
      Promise.resolve({ ok: true, data: { runtimeId: input.runtimeId, sessionId: input.sessionId ?? 'session-created' } })
    );
    electronAPIMock.chatRuntimeContinue.mockImplementation((input: ChatRuntimeContinueInput) =>
      Promise.resolve({ ok: true, data: { runtimeId: input.runtimeId, sessionId: input.sessionId } })
    );
    electronAPIMock.chatRuntimeCompact.mockImplementation((input: ChatRuntimeCompactInput) =>
      Promise.resolve({ ok: true, data: { runtimeId: input.runtimeId, sessionId: input.sessionId } })
    );
    electronAPIMock.chatRuntimeSubmitUserChoice.mockImplementation((input: ChatRuntimeSubmitUserChoiceInput) =>
      Promise.resolve({ ok: true, data: { runtimeId: input.runtimeId, sessionId: input.sessionId } })
    );
    electronAPIMock.chatRuntimeAbort.mockResolvedValue({ ok: true, data: {} });
    electronAPIMock.chatRuntimeSubmitToolResult.mockResolvedValue({ ok: true });
    electronAPIMock.chatRuntimeSubmitConfirmation.mockResolvedValue({ ok: true });
    electronAPIMock.chatRuntimeSubmitBridgeResponse.mockResolvedValue({ ok: true });
    electronAPIMock.chatRuntimeEstimateContext.mockResolvedValue({
      ok: true,
      data: {
        usedTokens: 12_300,
        contextWindow: 200_000
      }
    });
    getModelToolSupportMock.mockResolvedValue({ supported: true });
    useSettingStore().setSidebarVisible(true);
  });

  it('loads a directly opened session before resolving its runtime model', async (): Promise<void> => {
    const session = { ...createSession('session-active', 'Active'), metadata: { model: { providerId: 'provider-1', modelId: 'model-1' } } };
    chatStoreMock.loadSessionById.mockResolvedValue(session);
    chatStoreMock.findSession.mockReturnValue(session);
    const wrapper = mountBChat('session-active');
    await flushPromises();

    wrapper.findComponent(BSmartEditorStub).vm.$emit('update:value', 'hello');
    wrapper.findComponent(InputToolbarStub).vm.$emit('submit');
    await flushPromises();

    expect(chatStoreMock.loadSessionById).toHaveBeenCalledWith('session-active');
    expect(chatStoreMock.loadSessionById.mock.invocationCallOrder[0]).toBeLessThan(getModelToolSupportMock.mock.invocationCallOrder[0]);
    wrapper.unmount();
  });

  it('passes only markdown recent files to prompt editor file mentions', async (): Promise<void> => {
    recentStoreMock.recentFiles = [
      createStoredFile({ id: 'md-1', name: 'note.md', path: '/workspace/note.md', ext: 'md' }),
      createStoredFile({ id: 'json-1', name: 'config.json', path: '/workspace/config.json', ext: 'json' }),
      createStoredFile({ id: 'txt-1', name: 'notes.txt', path: '/workspace/notes.txt', ext: 'txt' })
    ];

    const wrapper = mountBChat(null);
    await flushPromises();

    expect(wrapper.findComponent(BSmartEditorStub).props('fileMentions')).toEqual([
      {
        id: 'md-1',
        name: 'note.md',
        path: '/workspace/note.md',
        ext: 'md'
      }
    ]);

    wrapper.unmount();
  });

  it('consumes a pending selection reference emitted before BChat is mounted', async (): Promise<void> => {
    const settingStore = useSettingStore();
    settingStore.setSidebarVisible(false);

    emitChatFileReferenceInsert({
      id: 'doc-1',
      ext: 'md',
      filePath: '/workspace/note.md',
      fileName: 'note',
      startLine: 2,
      endLine: 4
    });
    expect(promptEditorMockState.insertTextAtCursor).not.toHaveBeenCalled();

    const wrapper = mountBChat(null);
    await flushPromises();

    expect(settingStore.sidebarVisible).toBe(true);
    expect(promptEditorMockState.saveCursorPosition).toHaveBeenCalledTimes(1);
    expect(promptEditorMockState.insertTextAtCursor).toHaveBeenCalledWith('{{@/workspace/note.md#L2-4}} ');
    expect(promptEditorMockState.focus).toHaveBeenCalled();

    wrapper.unmount();
  });

  it('creates a session on first submit when sessionId is empty and starts runtime with the new id', async (): Promise<void> => {
    const createdSession = createSession('session-created', 'hello');
    chatStoreMock.createSession.mockResolvedValue(createdSession);
    const wrapper = mountBChat(null);
    await flushPromises();

    wrapper.findComponent(BSmartEditorStub).vm.$emit('update:value', 'hello');
    await flushPromises();
    wrapper.findComponent(InputToolbarStub).vm.$emit('submit');
    await flushPromises();

    expect(chatStoreMock.createSession).toHaveBeenCalledWith('assistant', {
      title: 'hello',
      model: { providerId: 'provider-1', modelId: 'model-1' }
    });
    expect(wrapper.emitted('session-created')?.[0]).toEqual([createdSession]);
    expect(electronAPIMock.chatRuntimeSend).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'session-created', content: 'hello' }));
    expect(wrapper.emitted('loading-change')).toContainEqual([true]);
  });

  it('registers a complete runtime address before sending the request', async (): Promise<void> => {
    const wrapper = mountBChat('session-active');
    await flushPromises();

    await submitTextAndReadRuntimeId(wrapper, 'addressed request');

    expect(actorSystemMockState.registerRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-active',
        turnId: expect.any(String),
        agentId: 'primary',
        runtimeId: expect.any(String),
        rootRuntimeId: expect.any(String)
      }),
      expect.any(Object)
    );
    expect(actorSystemMockState.registerRuntime.mock.invocationCallOrder[0]).toBeLessThan(electronAPIMock.chatRuntimeSend.mock.invocationCallOrder[0]);
    expect(electronAPIMock.chatRuntimeSend).toHaveBeenCalledWith(
      expect.objectContaining({
        turnId: expect.any(String),
        rootRuntimeId: expect.any(String)
      })
    );

    wrapper.unmount();
  });

  it('publishes runtime status and completion through one event from the existing workflow', async (): Promise<void> => {
    const wrapper = mountBChat('session-active');
    await flushPromises();
    const runtimeId = await submitTextAndReadRuntimeId(wrapper, 'status events');

    expect(wrapper.emitted('runtime-status-change')).toContainEqual([{ status: 'idle' }]);
    expect(wrapper.emitted('runtime-status-change')).toContainEqual([{ status: 'running' }]);

    emitRuntimeEvent(runtimeListeners, 'messageCreated', {
      runtimeId,
      sessionId: 'session-active',
      turnId: 'session-active:turn:1',
      clientId: 'bchat',
      agentId: 'primary',
      rootRuntimeId: runtimeId,
      message: {
        id: 'assistant-complete',
        sessionId: 'session-active',
        role: 'assistant',
        content: 'done',
        parts: [{ id: 'part-complete', type: 'text', text: 'done' }],
        createdAt: '2026-07-21T00:00:00.000Z',
        runtimeId,
        loading: false,
        finished: true
      }
    });
    emitRuntimeEvent(runtimeListeners, 'complete', {
      runtimeId,
      sessionId: 'session-active',
      turnId: 'session-active:turn:1',
      clientId: 'bchat',
      agentId: 'primary',
      rootRuntimeId: runtimeId,
      reason: 'completed'
    });
    await flushPromises();

    expect(wrapper.emitted('runtime-completed')).toBeUndefined();
    expect(wrapper.emitted('runtime-status-change')).toContainEqual([{ status: 'completed', sessionId: 'session-active' }]);
    expect(wrapper.emitted('runtime-status-change')).toContainEqual([{ status: 'idle' }]);
  });

  it('emits waiting and error runtime statuses', async (): Promise<void> => {
    const wrapper = mountBChat('session-active');
    await flushPromises();
    const runtimeId = await submitTextAndReadRuntimeId(wrapper, 'wait for user');

    emitRuntimeEvent(runtimeListeners, 'confirmationRequest', {
      runtimeId,
      sessionId: 'session-active',
      turnId: 'session-active:turn:1',
      clientId: 'bchat',
      agentId: 'primary',
      rootRuntimeId: runtimeId,
      confirmationId: 'confirmation-status',
      request: {
        toolName: 'write_file',
        title: '写入文件',
        description: '确认写入',
        riskLevel: 'write'
      }
    });
    await flushPromises();
    expect(wrapper.emitted('runtime-status-change')).toContainEqual([{ status: 'waiting' }]);

    emitRuntimeEvent(runtimeListeners, 'error', {
      runtimeId,
      sessionId: 'session-active',
      turnId: 'session-active:turn:1',
      clientId: 'bchat',
      agentId: 'primary',
      rootRuntimeId: runtimeId,
      error: { code: 'REQUEST_FAILED', message: 'failed' }
    });
    await flushPromises();
    expect(wrapper.emitted('runtime-status-change')).toContainEqual([{ status: 'error' }]);
  });

  it('exposes abort and reset controls for parent hosts', async (): Promise<void> => {
    const wrapper = mountBChat('session-active');
    await flushPromises();
    const runtimeId = await submitTextAndReadRuntimeId(wrapper, 'abort from host');
    const exposed = wrapper.vm as unknown as {
      abortRuntime: () => Promise<void>;
      resetDraft: () => Promise<void>;
    };

    await exposed.abortRuntime();
    expect(electronAPIMock.chatRuntimeAbort).toHaveBeenCalledWith({ runtimeId });

    await wrapper.setProps({ sessionId: null });
    wrapper.findComponent(BSmartEditorStub).vm.$emit('update:value', 'discard me');
    await flushPromises();
    await exposed.resetDraft();
    await flushPromises();

    expect(wrapper.findComponent(BSmartEditorStub).props('value')).toBe('');
    expect(wrapper.emitted('new-session')).toBeUndefined();
  });

  it('does not abort Runtime A or announce local cancellation while waiting for Child checkpoint persistence', async (): Promise<void> => {
    const wrapper = mountBChat('session-active');
    await flushPromises();
    const runtimeId = await submitTextAndReadRuntimeId(wrapper, 'delegate work');

    emitRuntimeEvent(runtimeListeners, 'complete', {
      runtimeId,
      sessionId: 'session-active',
      turnId: 'session-active:turn:1',
      clientId: 'bchat',
      agentId: 'primary',
      rootRuntimeId: runtimeId,
      reason: 'waiting_children',
      checkpointId: 'checkpoint-1'
    });
    await flushPromises();
    electronAPIMock.chatRuntimeAbort.mockClear();

    wrapper.findComponent(InputToolbarStub).vm.$emit('abort');
    await flushPromises();

    expect(electronAPIMock.chatRuntimeAbort).not.toHaveBeenCalled();
    expect(wrapper.findComponent(InputToolbarStub).props('loading')).toBe(true);
    expect(wrapper.emitted('runtime-status-change')?.at(-1)).not.toEqual([{ status: 'idle' }]);
    wrapper.unmount();
  });

  it('applies the trusted Main cancellation update after Runtime A route is removed', async (): Promise<void> => {
    const wrapper = mountBChat('session-active');
    await flushPromises();
    const runtimeId = await submitTextAndReadRuntimeId(wrapper, 'delegate then cancel');
    const pendingToolPart: ChatMessageToolPart = {
      id: 'delegate-part',
      type: 'tool',
      toolCallId: 'delegate-call',
      toolName: 'delegate_task',
      status: 'executing',
      input: { task: 'read files' }
    };
    const pendingAssistant = {
      ...createAssistantMessage({
        id: 'assistant-delegated',
        content: '',
        parts: [pendingToolPart],
        runtimeId,
        loading: true,
        finished: false
      }),
      sessionId: 'session-active'
    } satisfies ChatMessageRecord;
    emitRuntimeEvent(runtimeListeners, 'messageCreated', {
      runtimeId,
      sessionId: 'session-active',
      turnId: 'session-active:turn:1',
      clientId: 'bchat',
      agentId: 'primary',
      rootRuntimeId: runtimeId,
      message: pendingAssistant
    });
    emitRuntimeEvent(runtimeListeners, 'complete', {
      runtimeId,
      sessionId: 'session-active',
      turnId: 'session-active:turn:1',
      clientId: 'bchat',
      agentId: 'primary',
      rootRuntimeId: runtimeId,
      reason: 'waiting_children',
      checkpointId: 'checkpoint-1'
    });
    const cancelledAssistant = {
      ...pendingAssistant,
      loading: false,
      finished: true,
      parts: [
        {
          ...pendingToolPart,
          status: 'done' as const,
          result: {
            toolName: 'delegate_task',
            status: 'cancelled' as const,
            error: { code: 'USER_CANCELLED' as const, message: '任务已取消' }
          }
        }
      ]
    } satisfies ChatMessageRecord;

    emitRuntimeEvent(runtimeListeners, 'messageUpdated', {
      runtimeId,
      sessionId: 'session-active',
      turnId: 'session-active:turn:1',
      clientId: 'agent-continuation',
      agentId: 'primary',
      rootRuntimeId: runtimeId,
      message: cancelledAssistant
    });
    await flushPromises();

    const visibleMessages = wrapper.findComponent(ConversationViewStub).props('messages') as Message[];
    expect(visibleMessages.find((message: Message): boolean => message.id === 'assistant-delegated')).toMatchObject({
      loading: false,
      finished: true,
      parts: [
        expect.objectContaining({
          type: 'tool',
          status: 'done',
          result: expect.objectContaining({ status: 'cancelled' })
        })
      ]
    });
    expect(wrapper.findComponent(InputToolbarStub).props('loading')).toBe(true);
    wrapper.unmount();
  });

  it('requests a new session from the host without clearing persisted messages', async (): Promise<void> => {
    const loadedMessage = createMessage('message-a', 'keep A');
    chatStoreMock.getSessionMessages.mockResolvedValue([loadedMessage]);
    const wrapper = mountBChat('session-active');
    await flushPromises();

    wrapper.findComponent(BSmartEditorStub).vm.$emit('slash-command', {
      id: 'new',
      trigger: '/new',
      title: '新建会话',
      description: '开始一个新的聊天会话',
      group: 'command',
      selectAction: { type: 'emit' }
    });
    await flushPromises();

    expect(wrapper.emitted('new-session')).toHaveLength(1);
    expect(wrapper.emitted('draft-session-created')).toBeUndefined();
    expect(wrapper.findComponent(ConversationViewStub).props('messages')).toEqual([loadedMessage]);
  });

  it('sends new user messages through main process ChatRuntime', async (): Promise<void> => {
    const createdSession = createSession('session-created', 'hello');
    chatStoreMock.createSession.mockResolvedValue(createdSession);
    const wrapper = mountBChat(null);
    await flushPromises();

    wrapper.findComponent(BSmartEditorStub).vm.$emit('update:value', 'hello');
    await flushPromises();
    wrapper.findComponent(InputToolbarStub).vm.$emit('submit');
    await flushPromises();

    expect(electronAPIMock.chatRuntimeSend).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-created',
        clientId: 'bchat',
        agentId: 'primary',
        content: 'hello',
        contextWindow: 200000,
        userMessageId: expect.any(String),
        userMessageCreatedAt: expect.any(String)
      })
    );
    expect(wrapper.findComponent(ConversationViewStub).props('messages')).toEqual([]);
    expect(chatStoreMock.addSessionMessage).not.toHaveBeenCalledWith('session-created', expect.objectContaining({ role: 'user', content: 'hello' }));
  });

  it('persists a legacy session model before sending a runtime request', async (): Promise<void> => {
    const order: string[] = [];
    chatStoreMock.ensureSessionModel.mockImplementation(async (sessionId, model): Promise<ChatSession> => {
      order.push('persist-model');
      return { ...createSession(sessionId, sessionId), metadata: { model } };
    });
    electronAPIMock.chatRuntimeSend.mockImplementation(async (input: ChatRuntimeSendInput): Promise<ChatRuntimeHandlerResult<ChatRuntimeStartResult>> => {
      order.push('runtime-send');
      return { ok: true, data: { runtimeId: input.runtimeId, sessionId: input.sessionId ?? 'session-active' } };
    });
    const wrapper = mountBChat('session-active');
    await flushPromises();

    wrapper.findComponent(BSmartEditorStub).vm.$emit('update:value', 'hello');
    wrapper.findComponent(InputToolbarStub).vm.$emit('submit');
    await flushPromises();

    expect(order).toEqual(['persist-model', 'runtime-send']);
    wrapper.unmount();
  });

  it('blocks a send when legacy session model persistence fails', async (): Promise<void> => {
    chatStoreMock.ensureSessionModel.mockRejectedValue(new Error('metadata failed'));
    const wrapper = mountBChat('session-active');
    await flushPromises();

    wrapper.findComponent(BSmartEditorStub).vm.$emit('update:value', 'hello');
    wrapper.findComponent(InputToolbarStub).vm.$emit('submit');
    await flushPromises();

    expect(electronAPIMock.chatRuntimeSend).not.toHaveBeenCalled();
    const toastQueue = wrapper.findComponent({ name: 'InteractionContainer' }).props('toastQueue') as ToastItem[];
    expect(toastQueue).toContainEqual(expect.objectContaining({ type: 'error', content: 'metadata failed' }));
    wrapper.unmount();
  });

  it('persists the session model before manual context compaction', async (): Promise<void> => {
    const order: string[] = [];
    chatStoreMock.ensureSessionModel.mockImplementation(async (sessionId, model): Promise<ChatSession> => {
      order.push('persist-model');
      return { ...createSession(sessionId, sessionId), metadata: { model } };
    });
    electronAPIMock.chatRuntimeCompact.mockImplementation(async (input: ChatRuntimeCompactInput) => {
      order.push('runtime-compact');
      return { ok: true, data: { runtimeId: input.runtimeId, sessionId: input.sessionId } };
    });
    const wrapper = mountBChat('session-active');
    await flushPromises();

    wrapper.findComponent(BSmartEditorStub).vm.$emit('slash-command', {
      id: 'compact',
      trigger: '/compact',
      title: '压缩上下文',
      description: '压缩当前长会话上下文',
      group: 'command',
      selectAction: { type: 'emit' }
    });
    await flushPromises();

    expect(order).toEqual(['persist-model', 'runtime-compact']);
    wrapper.unmount();
  });

  it('blocks manual compaction when session model persistence fails', async (): Promise<void> => {
    chatStoreMock.ensureSessionModel.mockRejectedValue(new Error('metadata failed'));
    const wrapper = mountBChat('session-active');
    await flushPromises();

    wrapper.findComponent(BSmartEditorStub).vm.$emit('slash-command', {
      id: 'compact',
      trigger: '/compact',
      title: '压缩上下文',
      description: '压缩当前长会话上下文',
      group: 'command',
      selectAction: { type: 'emit' }
    });
    await flushPromises();

    expect(electronAPIMock.chatRuntimeCompact).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('loads persisted context usage before an existing session sends again', async (): Promise<void> => {
    const wrapper = mountBChat('session-1');
    await flushPromises();

    expect(electronAPIMock.chatRuntimeEstimateContext).toHaveBeenCalledWith({
      sessionId: 'session-1',
      contextWindow: 200_000
    });
    expect(wrapper.findComponent(InputToolbarStub).props('contextUsedTokens')).toBe(12_300);
    wrapper.unmount();
  });

  it('shows the latest projected context usage in the input toolbar', async (): Promise<void> => {
    const wrapper = mountBChat('session-1');
    await flushPromises();
    const runtimeId = await submitTextAndReadRuntimeId(wrapper, 'hello');

    emitRuntimeEvent(runtimeListeners, 'contextUsage', {
      runtimeId,
      sessionId: 'session-1',
      turnId: 'session-1:turn:1',
      clientId: 'bchat',
      agentId: 'primary',
      rootRuntimeId: runtimeId,
      snapshot: {
        usedTokens: 54_700,
        contextWindow: 200_000
      }
    });
    await flushPromises();

    expect(wrapper.findComponent(InputToolbarStub).props()).toMatchObject({
      contextUsedTokens: 54_700,
      contextWindow: 200_000
    });
    wrapper.unmount();
  });

  it('routes Runtime events emitted before the start IPC resolves', async (): Promise<void> => {
    let resolveStart: ((result: ChatRuntimeHandlerResult<ChatRuntimeStartResult>) => void) | undefined;
    electronAPIMock.chatRuntimeSend.mockImplementation((input: ChatRuntimeSendInput): Promise<ChatRuntimeHandlerResult<ChatRuntimeStartResult>> => {
      runtimeListeners.messageCreated?.({
        runtimeId: input.runtimeId,
        sessionId: input.sessionId,
        turnId: input.turnId,
        clientId: input.clientId,
        agentId: input.agentId,
        parentAgentId: input.parentAgentId,
        parentRuntimeId: input.parentRuntimeId,
        rootRuntimeId: input.rootRuntimeId,
        continuationOfRuntimeId: input.continuationOfRuntimeId,
        message: {
          id: input.userMessageId ?? 'user-early',
          sessionId: input.sessionId,
          role: 'user',
          content: input.content,
          parts: [{ id: 'part-early', type: 'text', text: input.content }],
          createdAt: input.userMessageCreatedAt ?? '2026-07-11T00:00:00.000Z',
          finished: true
        }
      });
      return new Promise((resolve) => {
        resolveStart = resolve;
      });
    });
    const wrapper = mountBChat('session-active');
    await flushPromises();

    wrapper.findComponent(BSmartEditorStub).vm.$emit('update:value', 'early event');
    wrapper.findComponent(InputToolbarStub).vm.$emit('submit');
    await flushPromises();

    expect(wrapper.findComponent(ConversationViewStub).props('messages')).toEqual([expect.objectContaining({ role: 'user', content: 'early event' })]);
    const [input] = electronAPIMock.chatRuntimeSend.mock.calls[0] as [ChatRuntimeSendInput];
    resolveStart?.({ ok: true, data: { runtimeId: input.runtimeId, sessionId: 'session-active' } });
    await flushPromises();
    wrapper.unmount();
  });

  it('remembers confirmation grants resolved through the global Runtime listener', async (): Promise<void> => {
    const wrapper = mountBChat('session-active');
    await flushPromises();
    const runtimeId = await submitTextAndReadRuntimeId(wrapper, 'write file');

    emitRuntimeEvent(runtimeListeners, 'confirmationRequest', {
      runtimeId,
      sessionId: 'session-active',
      turnId: 'session-active:turn:1',
      clientId: 'bchat',
      agentId: 'primary',
      rootRuntimeId: runtimeId,
      confirmationId: 'confirmation-1',
      request: {
        toolName: 'write_file',
        title: '写入文件',
        description: '是否写入？',
        riskLevel: 'write',
        allowRemember: true,
        rememberScopes: ['session', 'always']
      }
    });
    await flushPromises();
    wrapper.findComponent({ name: 'ConfirmationSheet' }).vm.$emit('action', 'approve-session');
    await flushPromises();

    expect(useChatPermissionStore().sessionToolPermissionGrants.write_file).toBe(true);
    expect(electronAPIMock.chatRuntimeSubmitConfirmation).toHaveBeenCalledWith({
      runtimeId,
      confirmationId: 'confirmation-1',
      decision: { approved: true, grantScope: 'session' }
    });
    wrapper.unmount();
  });

  it('sends widget-like input through ChatRuntime when no widget data source is configured', async (): Promise<void> => {
    const createdSession = createSession('session-created', '查天气 上海');
    chatStoreMock.createSession.mockResolvedValue(createdSession);
    const wrapper = mountBChat(null);
    await flushPromises();

    wrapper.findComponent(BSmartEditorStub).vm.$emit('update:value', '查天气 上海');
    await flushPromises();
    wrapper.findComponent(InputToolbarStub).vm.$emit('submit');
    await flushPromises();

    const visibleMessages = wrapper.findComponent(ConversationViewStub).props('messages') as Message[];

    expect(chatStoreMock.createSession).toHaveBeenCalledWith('assistant', {
      title: '查天气 上海',
      model: { providerId: 'provider-1', modelId: 'model-1' }
    });
    expect(visibleMessages).toEqual([]);
    expect(getModelToolSupportMock).toHaveBeenCalledWith('provider-1', 'model-1');
    expect(electronAPIMock.chatRuntimeSend).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'session-created', content: '查天气 上海' }));
  });

  it('sends parsed file input parts to ChatRuntime', async (): Promise<void> => {
    const createdSession = createSession('session-created', 'fix {{@src/foo.ts}}');
    chatStoreMock.createSession.mockResolvedValue(createdSession);
    const wrapper = mountBChat(null);
    await flushPromises();

    wrapper.findComponent(BSmartEditorStub).vm.$emit('update:value', 'fix {{@src/foo.ts}}');
    await flushPromises();
    wrapper.findComponent(InputToolbarStub).vm.$emit('submit');
    await flushPromises();

    expect(electronAPIMock.chatRuntimeSend).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-created',
        content: 'fix {{@src/foo.ts}}',
        parts: [expect.objectContaining({ type: 'text', text: 'fix ' }), expect.objectContaining({ type: 'file', path: 'src/foo.ts' })]
      })
    );
  });

  it('sends current Skill content versions with the runtime request', async (): Promise<void> => {
    skillStoreMock.initialized = false;
    skillStoreMock.getEnabledSkills.mockReturnValue([
      {
        name: 'weather',
        contentHash: 'weather-hash'
      }
    ]);
    const createdSession = createSession('session-created', '查天气');
    chatStoreMock.createSession.mockResolvedValue(createdSession);
    const wrapper = mountBChat(null);
    await flushPromises();

    wrapper.findComponent(BSmartEditorStub).vm.$emit('update:value', '查天气');
    await flushPromises();
    wrapper.findComponent(InputToolbarStub).vm.$emit('submit');
    await flushPromises();

    expect(electronAPIMock.chatRuntimeSend).toHaveBeenCalledWith(
      expect.objectContaining({
        skillContentHashes: {
          weather: 'weather-hash'
        }
      })
    );
  });

  it('does not own application-level Skill or Widget directory watchers', async (): Promise<void> => {
    mountBChat(null);
    await flushPromises();

    expect(native.watchDirectory).not.toHaveBeenCalled();
  });

  it('uses relevant memory selection and filters edit_memory for normal sends', async (): Promise<void> => {
    builtinToolsMockState.tools = [createRuntimeTool('edit_memory'), createRuntimeTool('read_file')];
    memoryStoreMock.buildSystemPromptContext.mockImplementation((options?: BuildMemoryContextOptions): string => {
      options?.onSelectionDebug?.({
        mode: 'relevant',
        maxChars: 4000,
        finalChars: 36,
        keywords: ['fix', 'src', 'foo'],
        selectedItems: [{ category: 'Projects', preview: 'foo project', score: 3 }],
        droppedItems: [{ category: 'Habits', preview: 'unrelated habit', score: 0 }]
      });
      return '<user_memory>relevant</user_memory>';
    });
    const createdSession = createSession('session-created', 'fix {{@src/foo.ts}}');
    chatStoreMock.createSession.mockResolvedValue(createdSession);
    const wrapper = mountBChat(null);
    await flushPromises();

    wrapper.findComponent(BSmartEditorStub).vm.$emit('update:value', 'fix {{@src/foo.ts}}');
    await flushPromises();
    wrapper.findComponent(InputToolbarStub).vm.$emit('submit');
    await flushPromises();

    expect(memoryStoreMock.buildSystemPromptContext).toHaveBeenCalledWith(
      expect.objectContaining({
        selection: {
          userMessage: 'fix {{@src/foo.ts}}',
          references: ['src/foo.ts'],
          workspaceRoot: '/workspace',
          mode: 'relevant'
        }
      })
    );
    expect(electronAPIMock.chatRuntimeSend).toHaveBeenCalledWith(
      expect.objectContaining({
        system: '<user_memory>relevant</user_memory>',
        tools: [expect.objectContaining({ name: 'read_file' })]
      })
    );
    expect(electronAPIMock.chatRuntimeSend).not.toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.arrayContaining([expect.objectContaining({ name: 'edit_memory' })])
      })
    );
    expect(loggerMockState.info).toHaveBeenCalledWith(expect.stringContaining('"editMemoryExposed":false'));
    expect(loggerMockState.info).toHaveBeenCalledWith(expect.stringContaining('"selectedItems":[{"category":"Projects","preview":"foo project","score":3}]'));
  });

  it('uses full memory and keeps edit_memory for explicit memory edit requests', async (): Promise<void> => {
    builtinToolsMockState.tools = [createRuntimeTool('edit_memory'), createRuntimeTool('read_file')];
    memoryStoreMock.buildSystemPromptContext.mockImplementation((options?: BuildMemoryContextOptions): string => {
      options?.onSelectionDebug?.({
        mode: 'full',
        maxChars: 4000,
        finalChars: 32,
        keywords: ['整理', '记忆'],
        selectedItems: [{ category: 'Preferences', preview: '用户叫张三', score: 1 }],
        droppedItems: []
      });
      return '<user_memory>full</user_memory>';
    });
    const createdSession = createSession('session-created', '请整理记忆：以后叫我张三');
    chatStoreMock.createSession.mockResolvedValue(createdSession);
    const wrapper = mountBChat(null);
    await flushPromises();

    wrapper.findComponent(BSmartEditorStub).vm.$emit('update:value', '请整理记忆：以后叫我张三');
    await flushPromises();
    wrapper.findComponent(InputToolbarStub).vm.$emit('submit');
    await flushPromises();

    expect(memoryStoreMock.buildSystemPromptContext).toHaveBeenCalledWith(
      expect.objectContaining({
        selection: {
          userMessage: '请整理记忆：以后叫我张三',
          references: [],
          workspaceRoot: '/workspace',
          mode: 'full'
        }
      })
    );
    expect(electronAPIMock.chatRuntimeSend).toHaveBeenCalledWith(
      expect.objectContaining({
        system: '<user_memory>full</user_memory>',
        tools: expect.arrayContaining([expect.objectContaining({ name: 'edit_memory' }), expect.objectContaining({ name: 'read_file' })])
      })
    );
    expect(loggerMockState.info).toHaveBeenCalledWith(expect.stringContaining('"editMemoryExposed":true'));
  });

  it('combines message references with file input parts for memory selection', async (): Promise<void> => {
    const filePart: ChatMessageFilePartInput = {
      id: 'file-part-union',
      type: 'file',
      filename: 'part.ts',
      mime: 'text/plain',
      url: 'file:///workspace/src/part.ts',
      path: 'src/part.ts',
      sourceText: {
        start: 0,
        end: 0,
        value: '@src/part.ts'
      }
    };
    const userMessage: Message = {
      ...createMessage('user-union', 'fix related files'),
      references: [
        {
          token: '@src/message.ts',
          path: 'src/message.ts',
          startLine: 0,
          endLine: 0,
          selectedContent: '',
          fullContent: ''
        }
      ]
    };
    const wrapper = mountBChat('session-active');
    await flushPromises();

    await submitConversationAction(
      wrapper,
      createRuntimeUserMessageTestSubmitAction({
        userMessage,
        parts: [filePart]
      })
    );
    await flushPromises();

    expect(memoryStoreMock.buildSystemPromptContext).toHaveBeenCalledWith(
      expect.objectContaining({
        selection: {
          userMessage: 'fix related files',
          references: ['src/message.ts', 'src/part.ts'],
          workspaceRoot: '/workspace',
          mode: 'relevant'
        }
      })
    );
  });

  it('renders a send startup error as a conversation error message', async (): Promise<void> => {
    const createdSession = createSession('session-created', 'read {{@/Users/zhangbin/Desktop/Markdown 语法全量渲染测试.md}}');
    const missingFilePath = '/Users/zhangbin/Desktop/Markdown 语法全量渲染测试.md';
    chatStoreMock.createSession.mockResolvedValue(createdSession);
    electronAPIMock.chatRuntimeSend.mockResolvedValueOnce({
      ok: false,
      code: 'ENOENT',
      error: `ENOENT: no such file or directory, stat '${missingFilePath}'`
    });
    const wrapper = mountBChat(null);
    await flushPromises();

    wrapper.findComponent(BSmartEditorStub).vm.$emit('update:value', `read {{@${missingFilePath}}}`);
    await flushPromises();
    wrapper.findComponent(InputToolbarStub).vm.$emit('submit');
    await flushPromises();

    const visibleMessages = wrapper.findComponent(ConversationViewStub).props('messages') as Message[];
    expect(visibleMessages).toHaveLength(2);
    expect(visibleMessages[0]).toMatchObject({
      role: 'user',
      content: `read {{@${missingFilePath}}}`,
      parts: [{ type: 'text', text: `read {{@${missingFilePath}}}` }]
    });
    expect(visibleMessages[1]).toMatchObject({
      role: 'error',
      content: `文件不存在或已被移动：${missingFilePath}`,
      parts: [{ type: 'error', text: `文件不存在或已被移动：${missingFilePath}` }],
      loading: false,
      finished: true
    });
    expect(chatStoreMock.setSessionMessages).toHaveBeenCalledWith('session-created', [
      expect.objectContaining({ role: 'user', content: `read {{@${missingFilePath}}}` }),
      expect.objectContaining({ role: 'error', content: `文件不存在或已被移动：${missingFilePath}` })
    ]);
  });

  it('renders runtime error events as conversation error messages', async (): Promise<void> => {
    const wrapper = mountBChat('session-active');
    await flushPromises();
    const runtimeId = await submitTextAndReadRuntimeId(wrapper, 'trigger runtime error');

    emitRuntimeEvent(runtimeListeners, 'error', {
      runtimeId,
      sessionId: 'session-active',
      turnId: 'session-active:turn:1',
      clientId: 'bchat',
      agentId: 'primary',
      rootRuntimeId: runtimeId,
      error: { code: 'REQUEST_FAILED', message: '模型调用失败' }
    });
    await flushPromises();

    const visibleMessages = wrapper.findComponent(ConversationViewStub).props('messages') as Message[];
    expect(visibleMessages).toHaveLength(1);
    expect(visibleMessages[0]).toMatchObject({
      role: 'error',
      content: '模型调用失败',
      parts: [{ type: 'error', text: '模型调用失败' }],
      loading: false,
      finished: true
    });
    expect(chatStoreMock.setSessionMessages).toHaveBeenCalledWith('session-active', [expect.objectContaining({ role: 'error', content: '模型调用失败' })]);
  });

  it('does not append runtime error message when latest assistant tool part already shows the same failure', async (): Promise<void> => {
    const failedToolPart: ChatMessageToolPart = {
      id: 'tool-part-1',
      type: 'tool',
      toolCallId: 'tool-call-1',
      toolName: 'run_shell_command',
      status: 'done',
      input: { command: 'python query.py' },
      result: {
        toolName: 'run_shell_command',
        status: 'failure',
        error: { code: 'EXECUTION_FAILED', message: '模型调用失败' }
      }
    };
    const assistantMessage: Message = {
      id: 'assistant-message-1',
      role: 'assistant',
      content: '模型调用失败',
      parts: [failedToolPart],
      createdAt: '2026-06-15T00:00:00.000Z',
      loading: false,
      finished: true
    };
    chatStoreMock.getSessionMessages.mockResolvedValue([assistantMessage]);

    const wrapper = mountBChat('session-active');
    await flushPromises();
    chatStoreMock.setSessionMessages.mockClear();

    emitRuntimeEvent(runtimeListeners, 'error', {
      runtimeId: 'runtime-1',
      sessionId: 'session-active',
      turnId: 'session-active:turn:1',
      clientId: 'bchat',
      agentId: 'primary',
      rootRuntimeId: 'runtime-1',
      error: { code: 'REQUEST_FAILED', message: '模型调用失败' }
    });
    await flushPromises();

    const visibleMessages = wrapper.findComponent(ConversationViewStub).props('messages') as Message[];
    expect(visibleMessages).toHaveLength(1);
    expect(visibleMessages[0]).toMatchObject({
      role: 'assistant',
      parts: [
        {
          type: 'tool',
          result: {
            status: 'failure',
            error: { message: '模型调用失败' }
          }
        }
      ]
    });
    expect(chatStoreMock.setSessionMessages).not.toHaveBeenCalled();
  });

  it('does not append a renderer-side interrupt message when aborting a chat runtime', async (): Promise<void> => {
    const wrapper = mountBChat('session-active');
    await flushPromises();

    wrapper.findComponent(BSmartEditorStub).vm.$emit('update:value', 'stop me');
    await flushPromises();
    wrapper.findComponent(InputToolbarStub).vm.$emit('submit');
    await flushPromises();
    wrapper.findComponent(InputToolbarStub).vm.$emit('abort');
    await flushPromises();

    const [sendInput] = electronAPIMock.chatRuntimeSend.mock.calls[0] as [ChatRuntimeSendInput];
    expect(electronAPIMock.chatRuntimeAbort).toHaveBeenCalledWith({ runtimeId: sendInput.runtimeId });
    expect(chatStoreMock.addSessionMessage).not.toHaveBeenCalledWith('session-active', expect.objectContaining({ role: 'interrupt' }));
  });

  it('projects an abort result when no Runtime event arrives', async (): Promise<void> => {
    const wrapper = mountBChat('session-active');
    await flushPromises();
    const runtimeId = await submitTextAndReadRuntimeId(wrapper, 'stop before output');
    const emptyAssistantMessage = {
      ...createAssistantMessage({
        id: 'assistant-empty',
        content: '',
        parts: [],
        runtimeId,
        loading: true,
        finished: false
      }),
      sessionId: 'session-active'
    } satisfies ChatMessageRecord;
    const interruptMessage = {
      id: 'interrupt-zero-output',
      sessionId: 'session-active',
      runtimeId,
      role: 'interrupt',
      content: '已中断',
      parts: [],
      createdAt: '2026-07-20T00:00:00.000Z',
      loading: false,
      finished: true
    } satisfies ChatMessageRecord;
    emitRuntimeEvent(runtimeListeners, 'messageCreated', {
      runtimeId,
      sessionId: 'session-active',
      turnId: 'session-active:turn:1',
      clientId: 'bchat',
      agentId: 'primary',
      rootRuntimeId: runtimeId,
      message: emptyAssistantMessage
    });
    electronAPIMock.chatRuntimeAbort.mockResolvedValueOnce({
      ok: true,
      data: { deletedMessageId: emptyAssistantMessage.id, interruptMessage }
    });

    wrapper.findComponent(InputToolbarStub).vm.$emit('abort');
    await flushPromises();

    const visibleMessages = wrapper.findComponent(ConversationViewStub).props('messages') as Message[];
    expect(visibleMessages).not.toContainEqual(expect.objectContaining({ id: emptyAssistantMessage.id }));
    expect(visibleMessages.filter((message: Message): boolean => message.role === 'interrupt')).toEqual([
      expect.objectContaining({ id: interruptMessage.id, content: '已中断' })
    ]);
  });

  it('keeps partial output and deduplicates the abort result after its Runtime event', async (): Promise<void> => {
    const wrapper = mountBChat('session-active');
    await flushPromises();
    const runtimeId = await submitTextAndReadRuntimeId(wrapper, 'stop after partial output');
    const partialMessage = {
      ...createAssistantMessage({
        id: 'assistant-partial',
        content: 'partial answer',
        parts: [{ id: 'part-partial', type: 'text', text: 'partial answer' }],
        runtimeId,
        loading: true,
        finished: false
      }),
      sessionId: 'session-active'
    } satisfies ChatMessageRecord;
    const finishedMessage = { ...partialMessage, loading: false, finished: true } satisfies ChatMessageRecord;
    const interruptMessage = {
      id: 'interrupt-partial',
      sessionId: 'session-active',
      runtimeId,
      role: 'interrupt',
      content: '已中断',
      parts: [],
      createdAt: '2026-07-20T00:00:01.000Z',
      loading: false,
      finished: true
    } satisfies ChatMessageRecord;
    emitRuntimeEvent(runtimeListeners, 'messageUpdated', {
      runtimeId,
      sessionId: 'session-active',
      turnId: 'session-active:turn:1',
      clientId: 'bchat',
      agentId: 'primary',
      rootRuntimeId: runtimeId,
      message: partialMessage
    });
    electronAPIMock.chatRuntimeAbort.mockImplementationOnce(async () => {
      emitRuntimeEvent(runtimeListeners, 'messageCreated', {
        runtimeId,
        sessionId: 'session-active',
        turnId: 'session-active:turn:1',
        clientId: 'bchat',
        agentId: 'primary',
        rootRuntimeId: runtimeId,
        message: interruptMessage
      });
      return { ok: true, data: { assistantMessage: finishedMessage, interruptMessage } };
    });

    wrapper.findComponent(InputToolbarStub).vm.$emit('abort');
    await flushPromises();

    const visibleMessages = wrapper.findComponent(ConversationViewStub).props('messages') as Message[];
    expect(visibleMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: partialMessage.id, content: 'partial answer', loading: false, finished: true }),
        expect.objectContaining({ id: interruptMessage.id, role: 'interrupt', content: '已中断' })
      ])
    );
    expect(visibleMessages.filter((message: Message): boolean => message.id === interruptMessage.id)).toHaveLength(1);
  });

  it('can abort the renderer-allocated runtime while the start IPC is still pending', async (): Promise<void> => {
    let resolveStart: ((result: ChatRuntimeHandlerResult<ChatRuntimeStartResult>) => void) | undefined;
    let startInput: ChatRuntimeSendInput | undefined;
    electronAPIMock.chatRuntimeSend.mockImplementation((input: ChatRuntimeSendInput): Promise<ChatRuntimeHandlerResult<ChatRuntimeStartResult>> => {
      startInput = input;
      return new Promise((resolve) => {
        resolveStart = resolve;
      });
    });
    const wrapper = mountBChat('session-active');
    await flushPromises();

    wrapper.findComponent(BSmartEditorStub).vm.$emit('update:value', 'stop during start');
    wrapper.findComponent(InputToolbarStub).vm.$emit('submit');
    await flushPromises();

    expect(startInput?.runtimeId).toMatch(/^runtime-/);
    wrapper.findComponent(InputToolbarStub).vm.$emit('abort');
    await flushPromises();
    expect(electronAPIMock.chatRuntimeAbort).toHaveBeenCalledWith({ runtimeId: startInput?.runtimeId });

    resolveStart?.({ ok: true, data: { runtimeId: startInput?.runtimeId ?? 'missing-runtime', sessionId: 'session-active' } });
    await flushPromises();
    wrapper.unmount();
  });

  it('does not abort a main-process runtime when BChat unmounts', async (): Promise<void> => {
    const wrapper = mountBChat('session-active');
    await flushPromises();
    wrapper.findComponent(BSmartEditorStub).vm.$emit('update:value', 'continue in background');
    wrapper.findComponent(InputToolbarStub).vm.$emit('submit');
    await flushPromises();

    wrapper.unmount();
    await flushPromises();

    expect(electronAPIMock.chatRuntimeAbort).not.toHaveBeenCalled();
  });

  it('marks a pending question as cancelled and appends interrupt when aborting after runtime waits for user input', async (): Promise<void> => {
    const pendingToolPart: ChatMessageToolPart = {
      id: 'part0037',
      type: 'tool',
      toolCallId: 'tool-call-1',
      toolName: 'ask_user_choice',
      status: 'done',
      input: {},
      result: {
        toolName: 'ask_user_choice',
        status: 'awaiting_user_input',
        data: {
          questionId: 'question-1',
          toolCallId: 'tool-call-1',
          mode: 'single',
          question: '继续吗？',
          options: [{ label: '继续', value: 'yes' }]
        }
      }
    };
    const userMessage = createMessage('user-choice', '需要选择');
    const assistantMessage = createAssistantMessage({
      id: 'assistant-choice',
      content: '需要补充信息',
      parts: [pendingToolPart],
      runtimeId: 'runtime-1',
      loading: false,
      finished: false
    });
    chatStoreMock.getSessionMessages.mockResolvedValueOnce([userMessage, assistantMessage]).mockResolvedValueOnce([]);
    const wrapper = mountBChat('session-active');
    await flushPromises();

    wrapper.findComponent(InputToolbarStub).vm.$emit('abort');
    await flushPromises();

    const lastPersistCall = chatStoreMock.setSessionMessages.mock.calls.at(-1);
    expect(lastPersistCall?.[0]).toBe('session-active');
    const persistedMessages = lastPersistCall?.[1] ?? [];
    const persistedAssistant = persistedMessages.find((message) => message.id === 'assistant-choice');
    expect(persistedAssistant?.parts[0]).toMatchObject({
      type: 'tool',
      result: expect.objectContaining({ status: 'cancelled' })
    });
    expect(persistedMessages.at(-1)).toMatchObject({
      role: 'interrupt',
      content: '已中断',
      loading: false,
      finished: true
    });
    expect(electronAPIMock.chatRuntimeAbort).not.toHaveBeenCalled();
  });

  it('does not scroll to bottom when runtime streams message updates', async (): Promise<void> => {
    const wrapper = mountBChat('session-active');
    await flushPromises();
    conversationViewMockState.scrollToBottom.mockReset();

    emitRuntimeEvent(runtimeListeners, 'messageUpdated', {
      runtimeId: 'runtime-1',
      sessionId: 'session-active',
      turnId: 'session-active:turn:1',
      clientId: 'bchat',
      agentId: 'primary',
      rootRuntimeId: 'runtime-1',
      message: {
        ...createAssistantMessage({
          id: 'assistant-streaming',
          content: 'streaming',
          parts: [{ id: 'part0038', type: 'text', text: 'streaming' }],
          loading: true,
          finished: false,
          runtimeId: 'runtime-1'
        }),
        sessionId: 'session-active'
      }
    });
    await flushPromises();

    expect(wrapper.findComponent(ConversationViewStub).exists()).toBe(true);
    expect(conversationViewMockState.scrollToBottom).not.toHaveBeenCalled();
  });

  it('continues user choice answers through main process ChatRuntime', async (): Promise<void> => {
    const pendingToolPart: ChatMessageToolPart = {
      id: 'part0039',
      type: 'tool',
      toolCallId: 'tool-call-1',
      toolName: 'ask_user_choice',
      status: 'done',
      input: {},
      result: {
        toolName: 'ask_user_choice',
        status: 'awaiting_user_input',
        data: {
          questionId: 'question-1',
          toolCallId: 'tool-call-1',
          mode: 'single',
          question: '继续吗？',
          options: [{ label: '继续', value: 'yes' }]
        }
      }
    };
    const userMessage = createMessage('user-choice', '需要选择');
    const assistantMessage = createAssistantMessage({
      id: 'assistant-choice',
      content: '',
      parts: [pendingToolPart]
    });
    const answer: AIUserChoiceAnswerData = {
      questionId: 'question-1',
      toolCallId: 'tool-call-1',
      answers: ['yes'],
      otherText: ''
    };
    chatStoreMock.getSessionMessages.mockResolvedValueOnce([userMessage, assistantMessage]).mockResolvedValueOnce([]);
    const wrapper = mountBChat('session-active');
    await flushPromises();

    const visibleAssistant = (wrapper.findComponent(ConversationViewStub).props('messages') as Message[]).find((message) => message.id === 'assistant-choice');
    expect(visibleAssistant).toMatchObject({ loading: true, finished: false });
    expect(wrapper.findComponent(ConversationViewStub).props('disabled')).toBe(false);
    expect(wrapper.findComponent(InputToolbarStub).props('loading')).toBe(true);

    await submitConversationAction(wrapper, createUserChoice(answer));
    await flushPromises();

    expect(electronAPIMock.chatRuntimeSubmitUserChoice).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-active',
        clientId: 'bchat',
        agentId: 'primary',
        contextWindow: 200000,
        answer
      })
    );
    expect(electronAPIMock.chatRuntimeSubmitUserChoice.mock.calls[0]?.[0]).not.toHaveProperty('messages');
    expect(electronAPIMock.chatRuntimeContinue).not.toHaveBeenCalled();
  });

  it('shows unavailable Skill errors while preparing a user choice continuation', async (): Promise<void> => {
    const errorMessage = '技能“weather”已删除或解析失败，无法发送本轮消息';
    const userMessage: Message = {
      ...createMessage('user-choice-skill', '{{$weather}} 需要选择'),
      parts: [
        {
          id: 'skill-reference-choice',
          type: 'skill_reference',
          name: 'weather',
          sourceText: { start: 0, end: 12, value: '{{$weather}}' }
        },
        { id: 'skill-choice-text', type: 'text', text: ' 需要选择' }
      ]
    };
    const assistantMessage = createAssistantMessage({
      id: 'assistant-choice-skill',
      content: '',
      parts: [
        {
          id: 'skill-choice-question',
          type: 'tool',
          toolCallId: 'skill-choice-tool-call',
          toolName: 'ask_user_choice',
          status: 'done',
          input: {},
          result: {
            toolName: 'ask_user_choice',
            status: 'awaiting_user_input',
            data: {
              questionId: 'skill-choice-question',
              toolCallId: 'skill-choice-tool-call',
              mode: 'single',
              question: '继续吗？',
              options: [{ label: '继续', value: 'yes' }]
            }
          }
        }
      ]
    });
    const answer: AIUserChoiceAnswerData = {
      questionId: 'skill-choice-question',
      toolCallId: 'skill-choice-tool-call',
      answers: ['yes'],
      otherText: ''
    };
    chatStoreMock.getSessionMessages.mockResolvedValueOnce([userMessage, assistantMessage]).mockResolvedValueOnce([]);
    const wrapper = mountBChat('session-active');
    await flushPromises();

    await expect(submitConversationAction(wrapper, createUserChoice(answer))).rejects.toThrow(errorMessage);
    await flushPromises();

    const toastQueue = wrapper.findComponent({ name: 'InteractionContainer' }).props('toastQueue') as ToastItem[];
    expect(toastQueue).toContainEqual(expect.objectContaining({ type: 'error', content: errorMessage }));
    expect(wrapper.findComponent(ConversationViewStub).props('disabled')).toBe(false);
    expect(electronAPIMock.chatRuntimeSubmitUserChoice).not.toHaveBeenCalled();
    expect(wrapper.emitted('runtime-status-change')?.at(-1)).toEqual([{ status: 'waiting' }]);
  });

  it('sends runtime user message submit actions through main process ChatRuntime', async (): Promise<void> => {
    const resultPart: ChatMessageWidgetResultPart = {
      id: 'part0040',
      type: 'widget_result',
      sessionId: 'widget-session-1',
      widgetId: 'weather',
      submittedAt: '2026-07-01T00:00:00.000Z',
      result: {
        status: 'success',
        data: {
          city: '上海'
        }
      }
    };
    const userMessage: Message = {
      id: 'user-widget-result',
      role: 'user',
      content: '小组件提交结果',
      parts: [resultPart],
      createdAt: '2026-07-01T00:00:00.000Z',
      loading: false,
      finished: true
    };
    const wrapper = mountBChat('session-active');
    await flushPromises();

    await submitConversationAction(
      wrapper,
      createRuntimeUserMessageTestSubmitAction({
        userMessage,
        parts: [resultPart]
      })
    );
    await flushPromises();

    expect(electronAPIMock.chatRuntimeSend).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-active',
        content: '小组件提交结果',
        userMessageId: 'user-widget-result',
        userMessageCreatedAt: '2026-07-01T00:00:00.000Z',
        parts: [resultPart]
      })
    );
  });

  it('submits cancelled user choices while the chat task is waiting for the answer', async (): Promise<void> => {
    const wrapper = mountBChat('session-active');
    await flushPromises();
    wrapper.findComponent(BSmartEditorStub).vm.$emit('update:value', '需要选择');
    await flushPromises();
    wrapper.findComponent(InputToolbarStub).vm.$emit('submit');
    await flushPromises();
    const answer: AIUserChoiceAnswerData = {
      questionId: 'question-1',
      toolCallId: 'tool-call-1',
      answers: [],
      questionAnswers: [],
      otherText: ''
    };

    await submitConversationAction(wrapper, createUserChoice(answer));
    await flushPromises();

    expect(electronAPIMock.chatRuntimeSubmitUserChoice).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-active',
        answer
      })
    );
  });

  it('regenerates assistant messages through main process ChatRuntime', async (): Promise<void> => {
    const order: string[] = [];
    const userMessage = createMessage('user-regenerate', '重新回答');
    const assistantMessage = createAssistantMessage({
      id: 'assistant-old',
      content: '旧回答',
      parts: [{ id: 'part0041', type: 'text', text: '旧回答' }]
    });
    chatStoreMock.ensureSessionModel.mockImplementation(async (sessionId, model): Promise<ChatSession> => {
      order.push('persist-model');
      return { ...createSession(sessionId, sessionId), metadata: { model } };
    });
    electronAPIMock.chatRuntimeContinue.mockImplementation(async (input: ChatRuntimeContinueInput) => {
      order.push('runtime-continue');
      return { ok: true, data: { runtimeId: input.runtimeId, sessionId: input.sessionId } };
    });
    chatStoreMock.getSessionMessages.mockResolvedValueOnce([userMessage, assistantMessage]).mockResolvedValueOnce([]);
    const wrapper = mountBChat('session-active');
    await flushPromises();

    wrapper.findComponent(ConversationViewStub).vm.$emit('regenerate', assistantMessage);
    await flushPromises();

    expect(chatStoreMock.setSessionMessages).toHaveBeenCalledWith('session-active', [userMessage]);
    expect(chatStoreMock.addSessionMessage).not.toHaveBeenCalledWith(
      'session-active',
      expect.objectContaining({ role: 'assistant', content: '', loading: true, finished: false })
    );
    expect(electronAPIMock.chatRuntimeContinue).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-active',
        clientId: 'bchat',
        agentId: 'primary',
        contextWindow: 200000
      })
    );
    const [continueInput] = electronAPIMock.chatRuntimeContinue.mock.calls[0] as [ChatRuntimeContinueInput];
    expect(continueInput.messages).toEqual([expect.objectContaining({ id: 'user-regenerate', role: 'user' })]);
    expect(order).toEqual(['persist-model', 'runtime-continue']);
  });

  it('blocks regeneration when session model persistence fails', async (): Promise<void> => {
    const userMessage = createMessage('user-regenerate', '重新回答');
    const assistantMessage = createAssistantMessage({
      id: 'assistant-old',
      content: '旧回答',
      parts: [{ id: 'part-regenerate-old', type: 'text', text: '旧回答' }]
    });
    chatStoreMock.getSessionMessages.mockResolvedValueOnce([userMessage, assistantMessage]).mockResolvedValueOnce([]);
    chatStoreMock.ensureSessionModel.mockRejectedValue(new Error('metadata failed'));
    const wrapper = mountBChat('session-active');
    await flushPromises();

    wrapper.findComponent(ConversationViewStub).vm.$emit('regenerate', assistantMessage);
    await flushPromises();

    expect(electronAPIMock.chatRuntimeContinue).not.toHaveBeenCalled();
    expect(chatStoreMock.setSessionMessages).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('creates a branch from the target assistant message and switches through the existing session event', async (): Promise<void> => {
    const assistantMessage = createAssistantMessage();
    const branchedSession = createSession('session-branch', '原标题（2）');
    chatStoreMock.branchSession.mockResolvedValue(branchedSession);
    const wrapper = mountBChat('session-active');
    await flushPromises();

    wrapper.findComponent(ConversationViewStub).vm.$emit('branch', assistantMessage);
    await flushPromises();

    expect(chatStoreMock.branchSession).toHaveBeenCalledWith('session-active', assistantMessage.id);
    expect(wrapper.emitted('session-created')?.[0]?.[0]).toEqual(branchedSession);
  });

  it('ignores branch and regenerate actions while the current runtime is busy', async (): Promise<void> => {
    const userMessage = createMessage('user-busy-history', '原始任务');
    const assistantMessage = createAssistantMessage({ id: 'assistant-busy-history' });
    chatStoreMock.getSessionMessages.mockResolvedValueOnce([userMessage, assistantMessage]).mockResolvedValueOnce([]);
    const wrapper = mountBChat('session-active');
    await flushPromises();
    await submitTextAndReadRuntimeId(wrapper, '继续执行');
    const conversationView = wrapper.findComponent(ConversationViewStub);

    expect(conversationView.props('loading')).toBe(true);
    conversationView.vm.$emit('branch', assistantMessage);
    conversationView.vm.$emit('regenerate', assistantMessage);
    wrapper.findComponent(BSmartEditorStub).vm.$emit('update:value', '压缩期间继续编辑的草稿');
    await flushPromises();

    expect(wrapper.findComponent(BSmartEditorStub).props('value')).toBe('压缩期间继续编辑的草稿');
    expect(chatStoreMock.branchSession).not.toHaveBeenCalled();
    expect(chatStoreMock.setSessionMessages).not.toHaveBeenCalled();
    expect(electronAPIMock.chatRuntimeContinue).not.toHaveBeenCalled();
    expect(electronAPIMock.chatRuntimeAbort).not.toHaveBeenCalled();
  });

  it('aborts the current runtime before applying rollback while busy', async (): Promise<void> => {
    const userMessage = { ...createMessage('user-busy-rollback', '原始任务'), finished: true };
    const assistantMessage = createAssistantMessage({ id: 'assistant-busy-rollback' });
    chatStoreMock.getSessionMessages.mockResolvedValueOnce([userMessage, assistantMessage]).mockResolvedValueOnce([]);
    const wrapper = mountBChat('session-active');
    await flushPromises();
    const runtimeId = await submitTextAndReadRuntimeId(wrapper, '继续执行');
    const conversationView = wrapper.findComponent(ConversationViewStub);

    expect(conversationView.props('loading')).toBe(true);
    conversationView.vm.$emit('rollback', userMessage);
    await flushPromises();

    expect(electronAPIMock.chatRuntimeAbort).toHaveBeenCalledWith({ runtimeId });
    expect(chatStoreMock.setSessionMessages).toHaveBeenCalledWith('session-active', []);
    expect(electronAPIMock.chatRuntimeAbort.mock.invocationCallOrder[0]).toBeLessThan(chatStoreMock.setSessionMessages.mock.invocationCallOrder[0]);
    expect(wrapper.findComponent(BSmartEditorStub).props('value')).toBe('原始任务');
  });

  it('keeps local rollback out of published Runtime running status', async (): Promise<void> => {
    const userMessage = { ...createMessage('user-idle-rollback', '原始任务'), finished: true };
    const assistantMessage = createAssistantMessage({ id: 'assistant-idle-rollback' });
    const persistDeferred = createDeferred<void>();
    chatStoreMock.getSessionMessages.mockResolvedValueOnce([userMessage, assistantMessage]).mockResolvedValueOnce([]);
    chatStoreMock.setSessionMessages.mockReturnValueOnce(persistDeferred.promise);
    const wrapper = mountBChat('session-active');
    await flushPromises();
    const emittedBeforeRollback = wrapper.emitted('runtime-status-change')?.length ?? 0;
    const conversationView = wrapper.findComponent(ConversationViewStub);

    conversationView.vm.$emit('rollback', userMessage);
    await wrapper.vm.$nextTick();

    const emittedDuringRollback = wrapper.emitted('runtime-status-change')?.slice(emittedBeforeRollback) ?? [];
    expect(conversationView.props('loading')).toBe(true);
    expect(emittedDuringRollback).not.toContainEqual([{ status: 'running' }]);

    persistDeferred.resolve(undefined);
    await flushPromises();

    expect(conversationView.props('loading')).toBe(false);
  });

  it('ignores duplicate branch events while the request is pending', async (): Promise<void> => {
    const assistantMessage = createAssistantMessage();
    const branchedSession = createSession('session-branch', '原标题');
    let resolveBranch: ((session: ChatSession) => void) | undefined;
    chatStoreMock.branchSession.mockReturnValue(
      new Promise<ChatSession>((resolve): void => {
        resolveBranch = resolve;
      })
    );
    const wrapper = mountBChat('session-active');
    await flushPromises();
    const conversationView = wrapper.findComponent(ConversationViewStub);

    conversationView.vm.$emit('branch', assistantMessage);
    conversationView.vm.$emit('branch', assistantMessage);
    await wrapper.vm.$nextTick();

    expect(chatStoreMock.branchSession).toHaveBeenCalledTimes(1);

    resolveBranch?.(branchedSession);
    await flushPromises();
  });

  it('does not switch to a completed branch after the active session changes', async (): Promise<void> => {
    const assistantMessage = createAssistantMessage();
    const branchedSession = createSession('session-branch', '原标题');
    let resolveBranch: ((session: ChatSession) => void) | undefined;
    chatStoreMock.branchSession.mockReturnValue(
      new Promise<ChatSession>((resolve): void => {
        resolveBranch = resolve;
      })
    );
    const wrapper = mountBChat('session-active');
    await flushPromises();

    wrapper.findComponent(ConversationViewStub).vm.$emit('branch', assistantMessage);
    await wrapper.setProps({ sessionId: 'session-other' });
    await flushPromises();
    resolveBranch?.(branchedSession);
    await flushPromises();

    expect(wrapper.emitted('session-created')).toBeUndefined();
  });

  it('shows an error without switching when branch creation fails', async (): Promise<void> => {
    const assistantMessage = createAssistantMessage();
    chatStoreMock.branchSession.mockRejectedValue(new Error('分支创建失败'));
    const wrapper = mountBChat('session-active');
    await flushPromises();

    wrapper.findComponent(ConversationViewStub).vm.$emit('branch', assistantMessage);
    await flushPromises();

    const toastQueue = wrapper.findComponent({ name: 'InteractionContainer' }).props('toastQueue') as ToastItem[];
    expect(wrapper.emitted('session-created')).toBeUndefined();
    expect(toastQueue).toEqual([expect.objectContaining({ type: 'error', content: '分支创建失败' })]);
  });

  it('does not create a branch when there is no active session', async (): Promise<void> => {
    const assistantMessage = createAssistantMessage();
    const wrapper = mountBChat(null);
    await flushPromises();

    wrapper.findComponent(ConversationViewStub).vm.$emit('branch', assistantMessage);
    await flushPromises();

    expect(chatStoreMock.branchSession).not.toHaveBeenCalled();
  });

  it('uses the last source user message as memory selection when regenerating', async (): Promise<void> => {
    memoryStoreMock.buildSystemPromptContext.mockReturnValue('<user_memory>regen</user_memory>');
    const userMessage = {
      ...createMessage('user-regenerate', '重新回答 {{@src/ai/memory/injector.ts}}'),
      references: [
        {
          token: '@src/ai/memory/injector.ts',
          path: 'src/ai/memory/injector.ts',
          startLine: 0,
          endLine: 0,
          selectedContent: '',
          fullContent: ''
        }
      ]
    };
    const assistantMessage = createAssistantMessage({
      id: 'assistant-regenerate',
      content: '旧回答',
      parts: [{ id: 'part0042', type: 'text', text: '旧回答' }]
    });
    chatStoreMock.getSessionMessages.mockResolvedValueOnce([userMessage, assistantMessage]).mockResolvedValueOnce([]);
    const wrapper = mountBChat('session-active');
    await flushPromises();

    wrapper.findComponent(ConversationViewStub).vm.$emit('regenerate', assistantMessage);
    await flushPromises();

    expect(memoryStoreMock.buildSystemPromptContext).toHaveBeenCalledWith(
      expect.objectContaining({
        selection: {
          userMessage: '重新回答 {{@src/ai/memory/injector.ts}}',
          references: ['src/ai/memory/injector.ts'],
          workspaceRoot: '/workspace',
          mode: 'relevant'
        }
      })
    );
    expect(electronAPIMock.chatRuntimeContinue).toHaveBeenCalledWith(
      expect.objectContaining({
        system: '<user_memory>regen</user_memory>'
      })
    );
  });

  it('restores todo snapshots for runtime ids removed by rollback', async (): Promise<void> => {
    const firstUserMessage = { ...createMessage('user-1', '第一轮'), runtimeId: 'runtime-1', finished: true };
    const firstAssistantMessage = createAssistantMessage({
      id: 'assistant-1',
      content: '第一轮回答',
      runtimeId: 'runtime-1'
    });
    const secondUserMessage = { ...createMessage('user-2', '第二轮'), runtimeId: 'runtime-2', finished: true };
    const secondAssistantMessage = createAssistantMessage({
      id: 'assistant-2',
      content: '第二轮回答',
      runtimeId: 'runtime-2'
    });
    chatStoreMock.getSessionMessages
      .mockResolvedValueOnce([firstUserMessage, firstAssistantMessage, secondUserMessage, secondAssistantMessage])
      .mockResolvedValueOnce([]);
    const wrapper = mountBChat('session-active');
    await flushPromises();

    wrapper.findComponent(ConversationViewStub).vm.$emit('rollback', secondUserMessage);
    await flushPromises();

    expect(chatStoreMock.setSessionMessages).toHaveBeenCalledWith('session-active', [firstUserMessage, firstAssistantMessage]);
    expect(todoStoreMock.restoreBeforeRuntimeIds).toHaveBeenCalledWith('session-active', ['runtime-2']);
  });

  it('passes main-process executable context options to runtime send', async (): Promise<void> => {
    memoryStoreMock.loaded = false;
    memoryStoreMock.buildSystemPromptContext.mockReturnValue('Remember user prefers concise answers.');
    toolSettingsMockState.tavily = { enabled: true, apiKey: 'tvly-test' };
    toolSettingsMockState.mcp.servers = [
      {
        id: 'server-1',
        name: 'Docs',
        enabled: true,
        transport: 'stdio',
        command: 'node',
        args: ['server.js'],
        env: { TOKEN: 'secret' },
        headers: {},
        toolAllowlist: ['search_docs']
      }
    ];
    const wrapper = mountBChat('session-active');
    await flushPromises();

    wrapper.findComponent(BSmartEditorStub).vm.$emit('update:value', 'use tools');
    await flushPromises();
    wrapper.findComponent(InputToolbarStub).vm.$emit('submit');
    await flushPromises();

    expect(memoryStoreMock.loadMemory).toHaveBeenCalled();
    expect(electronAPIMock.chatRuntimeSend).toHaveBeenCalledWith(
      expect.objectContaining({
        system: 'Remember user prefers concise answers.',
        capabilities: {
          rendererToolNames: expect.any(Array)
        },
        tavily: { enabled: true, apiKey: 'tvly-test' },
        mcp: {
          servers: [
            expect.objectContaining({
              id: 'server-1',
              args: ['server.js'],
              env: { TOKEN: 'secret' },
              headers: {},
              toolAllowlist: ['search_docs']
            })
          ],
          enabledServerIds: ['server-1'],
          enabledTools: [],
          toolInstructions: ''
        }
      })
    );
  });

  it('loads history when sessionId changes to an external session', async (): Promise<void> => {
    const loadedMessage = createMessage('message-loaded', 'history message');
    const wrapper = mountBChat(null);
    await flushPromises();
    chatStoreMock.getSessionMessages.mockResolvedValue([loadedMessage]);

    await wrapper.setProps({ sessionId: 'session-external' });
    await flushPromises();

    expect(chatStoreMock.getSessionMessages).toHaveBeenCalledWith('session-external');
  });

  it('skips history reload when an internally created session id is written back', async (): Promise<void> => {
    const createdSession = createSession('session-created', 'hello');
    chatStoreMock.createSession.mockResolvedValue(createdSession);
    const wrapper = mountBChat(null);
    await flushPromises();

    wrapper.findComponent(BSmartEditorStub).vm.$emit('update:value', 'hello');
    await flushPromises();
    wrapper.findComponent(InputToolbarStub).vm.$emit('submit');
    await flushPromises();
    chatStoreMock.getSessionMessages.mockClear();

    await wrapper.setProps({ sessionId: 'session-created' });
    await flushPromises();

    expect(chatStoreMock.getSessionMessages).not.toHaveBeenCalled();
  });

  it('emits session title persisted after auto name callback runs', async (): Promise<void> => {
    const wrapper = mountBChat('session-1');
    await flushPromises();

    await autoNameMockState.options?.onTitlePersisted?.('session-1', '生成标题');
    await flushPromises();

    expect(wrapper.emitted('session-title-persisted')?.[0]).toEqual(['session-1', '生成标题']);
  });

  it('clears finished todos immediately after session change', async (): Promise<void> => {
    todoStoreMock.todosBySession.set('session-active', [{ content: '执行任务', status: 'in_progress', priority: 'high' }]);
    todoStoreMock.todosBySession.set('session-finished', [{ content: '完成任务', status: 'completed', priority: 'medium' }]);
    const wrapper = mountBChat('session-active');
    await flushPromises();

    await wrapper.setProps({ sessionId: 'session-finished' });
    await flushPromises();

    expect(todoStoreMock.clearTodos).toHaveBeenCalledWith('session-finished');
    expect(wrapper.findComponent({ name: 'TodoPanel' }).exists()).toBe(false);
  });

  it('keeps active todo panel collapsed by default for unfinished todos', async (): Promise<void> => {
    todoStoreMock.todosBySession.set('session-active', [{ content: '执行任务', status: 'in_progress', priority: 'high' }]);
    const wrapper = mountBChat('session-active');
    await flushPromises();

    expect(wrapper.findComponent({ name: 'TodoPanel' }).props('visible')).toBe(false);
    expect(todoStoreMock.clearTodos).not.toHaveBeenCalled();
  });

  it('clears finished todos on mount so refresh does not restore the panel', async (): Promise<void> => {
    todoStoreMock.todosBySession.set('session-finished', [{ content: '完成任务', status: 'completed', priority: 'medium' }]);
    const wrapper = mountBChat('session-finished');
    await flushPromises();

    expect(todoStoreMock.clearTodos).toHaveBeenCalledWith('session-finished');
    expect(wrapper.findComponent({ name: 'TodoPanel' }).exists()).toBe(false);
  });

  it('highlights the input container while dragging files over the chat container', async (): Promise<void> => {
    const wrapper = mountBChat(null);
    await flushPromises();
    const chatContainer = wrapper.find('.b-chat__container');
    const inputContainer = wrapper.find('.b-chat__input-container');

    await chatContainer.element.dispatchEvent(createFileDragEvent('dragenter', [new File(['hello'], 'note.md', { type: 'text/markdown' })]));
    await wrapper.vm.$nextTick();

    expect(inputContainer.classes()).toContain('b-chat__input-container--dragover');

    await chatContainer.element.dispatchEvent(createFileDragEvent('dragleave', [new File(['hello'], 'note.md', { type: 'text/markdown' })]));
    await wrapper.vm.$nextTick();

    expect(inputContainer.classes()).not.toContain('b-chat__input-container--dragover');
  });

  it('inserts file reference tokens when non-image files are dropped on the chat container', async (): Promise<void> => {
    const wrapper = mountBChat(null);
    await flushPromises();

    await wrapper.find('.b-chat__container').element.dispatchEvent(createFileDragEvent('drop', [new File(['hello'], 'note.md', { type: 'text/markdown' })]));
    await flushPromises();

    expect(promptEditorMockState.insertTextAtCursor).toHaveBeenCalledWith('{{@/workspace/My Notes/note.md}}');
  });

  it('adds image files when images are dropped on the chat container', async (): Promise<void> => {
    const wrapper = mountBChat(null);
    await flushPromises();

    await wrapper.find('.b-chat__container').element.dispatchEvent(createFileDragEvent('drop', [new File(['image'], 'photo.png', { type: 'image/png' })]));
    await flushPromises();

    expect(promptEditorMockState.insertTextAtCursor).not.toHaveBeenCalled();
  });

  it('processes mixed dropped files with image upload and file reference insertion', async (): Promise<void> => {
    const wrapper = mountBChat(null);
    await flushPromises();

    await wrapper
      .find('.b-chat__container')
      .element.dispatchEvent(
        createFileDragEvent('drop', [new File(['image'], 'photo.png', { type: 'image/png' }), new File(['hello'], 'note.md', { type: 'text/markdown' })])
      );
    await flushPromises();

    expect(promptEditorMockState.insertTextAtCursor).toHaveBeenCalledWith('{{@/workspace/My Notes/note.md}}');
  });

  it('falls back to filename token when dropped file path cannot be resolved', async (): Promise<void> => {
    getPathForFileMock.mockReturnValue(null);
    const wrapper = mountBChat(null);
    await flushPromises();

    await wrapper.find('.b-chat__container').element.dispatchEvent(createFileDragEvent('drop', [new File(['hello'], 'note.md', { type: 'text/markdown' })]));
    await flushPromises();

    expect(promptEditorMockState.insertTextAtCursor).toHaveBeenCalledWith('{{@note.md}}');
  });

  it('clears input drag state without duplicate processing when an inner editor already handled the drop', async (): Promise<void> => {
    const wrapper = mountBChat(null);
    await flushPromises();
    const chatContainer = wrapper.find('.b-chat__container');
    const inputContainer = wrapper.find('.b-chat__input-container');

    await chatContainer.element.dispatchEvent(createFileDragEvent('dragenter', [new File(['hello'], 'note.md', { type: 'text/markdown' })]));
    await wrapper.vm.$nextTick();

    const dropEvent = createFileDragEvent('drop', [new File(['hello'], 'note.md', { type: 'text/markdown' })]);
    dropEvent.preventDefault();
    await chatContainer.element.dispatchEvent(dropEvent);
    await flushPromises();

    expect(inputContainer.classes()).not.toContain('b-chat__input-container--dragover');
    expect(promptEditorMockState.insertTextAtCursor).not.toHaveBeenCalled();
  });
});
