<!--
  @file index.vue
  @description 聊天侧边栏组件，包含会话管理、消息列表、输入框和模型选择功能。
-->
<template>
  <div ref="containerRef" :class="bem('container')">
    <div :class="bem('conversation-container')">
      <AgentTaskProjectionNotice :session-id="activeSessionId" />
      <ConversationView
        ref="conversationRef"
        v-model:messages="messages"
        :session-id="activeSessionId"
        :loading="loading"
        :disabled="messageInteractionDisabled"
        :on-load-history="handleLoadHistory"
        :can-rollback="rollbackController.canRollback"
        :submit-action="chatSubmitter.submit"
        @edit="handleChatEdit"
        @branch="handleBranch"
        @regenerate="handleChatRegenerate"
        @rollback="handleRollback"
      >
        <template #footer>
          <ConfirmationSheet :confirmation="confirmationController.currentConfirmation.value" @action="handleConfirmationSheetAction" />
        </template>
      </ConversationView>

      <div :class="bem('floating-container')">
        <InteractionContainer :toast-queue="toastQueue" @remove-toast="removeToast" />
      </div>
    </div>

    <div :class="bem('toolbar')">
      <TodoPanel v-if="currentSessionTodos.length > 0 && !todoPanelDismissed" v-model:visible="todoPanelVisible" :todos="currentSessionTodos" />
    </div>

    <div :class="bem('input')">
      <div :class="bem('input-container', { dragover: isContainerDragActive })">
        <ImagePreview :images="inputImages" :supports-vision="supportsVision" :on-remove-image="inputEvents.removeImage" />

        <BSmartEditor
          ref="promptEditorRef"
          v-model:value="inputContent"
          placeholder="输入消息..."
          :max-height="200"
          :chip-resolver="promptChipResolver"
          :on-paste-files="fileReference.onPasteFiles"
          :on-paste-images="imageUpload.onPasteImages"
          :can-accept-images="imageUpload.canAcceptImages"
          :slash-commands="slashCommandOptions"
          :file-mentions="fileMentionOptions"
          :on-cancel="handleCancel"
          submit-on-enter
          @slash-command="handleSlashCommand"
          @file-mention-select="handleFileMentionSelect"
          @submit="handleChatSubmit"
        />

        <InputToolbar
          :loading="loading"
          :input-value="inputContent"
          :selected-model="selectedModel"
          :context-used-tokens="contextUsage?.usedTokens ?? 0"
          :context-window="contextWindow"
          :supports-vision="supportsVision"
          :can-submit="canSubmit"
          :workspace-label="workspaceLabel"
          :has-workspace-override="workspaceOverride !== undefined"
          :workspace-disabled="loading"
          :show-workspace-control="props.workspaceControlEnabled && activeSessionId === null"
          @submit="handleChatSubmit"
          @abort="handleAbort"
          @image-select="imageUpload.appendImages"
          @model-change="handleModelChange"
          @workspace-select="handleWorkspaceSelect"
          @workspace-clear="handleWorkspaceClear"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ConfirmationSheetActionPayload } from './components/ConfirmationSheet.vue';
import type { BChatProps, BChatResetDraftOptions, BChatRuntimeSourceStatus, BChatRuntimeStatusChange, Message } from './utils/types';
import type { ChatSession, ChatSessionModelMetadata } from 'types/chat';
import type { ChatRuntimeContextUsageSnapshot } from 'types/chat-runtime';
import { computed, h, onUnmounted, provide, ref, toRef, watch } from 'vue';
import { useRouter } from 'vue-router';
import { findPendingInteraction } from '@/ai/chat/policies/pendingInteraction';
import type { ChatSessionUIEvent } from '@/ai/chat/sessionEvents';
import type BSmartEditor from '@/components/BSmart/Editor.vue';
import type { BSmartEditorExpose, SlashCommandOption } from '@/components/BSmart/types';
import { useActorSystem } from '@/hooks/useChat/useActorSystem';
import { useAgentConfirmationEvents } from '@/hooks/useChat/useAgentConfirmationEvents';
import { useNavigate } from '@/hooks/useNavigate';
import { useWorkspaceRoot } from '@/hooks/useWorkspaceRoot';
import { getElectronAPI } from '@/shared/platform/electron-api';
import { useProviderStore } from '@/stores/ai/provider';
import type { SelectedModel } from '@/stores/ai/serviceModel';
import { useSkillStore } from '@/stores/ai/skill';
import { useChatAgentTaskStore } from '@/stores/chat/agentTask';
import { useChatConfirmationQueueStore } from '@/stores/chat/confirmationQueue';
import { useChatSessionStore } from '@/stores/chat/session';
import { useCommandPanelStore } from '@/stores/ui/commandPanel';
import { asyncTo } from '@/utils/asyncTo';
import { createNamespace } from '@/utils/namespace';
import AgentTaskProjectionNotice from './components/AgentTaskProjectionNotice.vue';
import ConfirmationSheet from './components/ConfirmationSheet.vue';
import ConversationView from './components/ConversationView.vue';
import ImagePreview from './components/ImagePreview.vue';
import InputToolbar from './components/InputToolbar.vue';
import InteractionContainer from './components/InteractionContainer/index.vue';
import TodoPanel from './components/TodoPanel.vue';
import { useChatComposer } from './hooks/useChatComposer';
import { useChatServiceConfig } from './hooks/useChatServiceConfig';
import { useChatSessionActor } from './hooks/useChatSessionActor';
import { useChatSessionRuntime } from './hooks/useChatSessionRuntime';
import { useChatWorkflow } from './hooks/useChatWorkflow';
import { useInteractionState } from './hooks/useInteractionState';
import { useRuntimeBridgeHandler } from './hooks/useRuntimeBridgeHandler';
import { useRuntimeConfig } from './hooks/useRuntimeConfig';
import { useRuntimeRequestConfig } from './hooks/useRuntimeRequestConfig';
import { useRuntimeTools } from './hooks/useRuntimeTools';
import { useSessionWorkspace } from './hooks/useSessionWorkspace';
import { createSkillSlashCommands, useSlashCommands, chatSlashCommands } from './hooks/useSlashCommands';
import { useTodoPanel } from './hooks/useTodoPanel';
import { createChatConfirmationController } from './utils/confirmationController';
import { userChoice } from './utils/messageHelper';

/**
 * 输入编辑器组件实例与对外公开方法。
 */
type EditorInstance = InstanceType<typeof BSmartEditor> & BSmartEditorExpose;

const [, bem] = createNamespace('chat');

const props = withDefaults(defineProps<BChatProps>(), {
  sessionId: null,
  workspaceControlEnabled: false
});

const emit = defineEmits<{
  (e: 'session-created', session: ChatSession): void;
  (e: 'session-title-persisted', sessionId: string, title: string): void;
  (e: 'new-session'): void;
  (e: 'loading-change', loading: boolean): void;
  (e: 'runtime-status-change', status: BChatRuntimeStatusChange): void;
  (e: 'navigate-to-provider'): void;
}>();

/** 聊天数据存储 */
const chatStore = useChatSessionStore();

/** 全局默认的 Tibis 工作区根目录。 */
const { workspaceRoot: defaultWorkspaceRoot } = useWorkspaceRoot();

const router = useRouter();

/** 交互容器状态 */
const { api: interactionAPI, toastQueue, removeToast } = useInteractionState();

/** 提供交互 API */
provide('interaction', interactionAPI);

/** 文件、Skill 与 Webview 的通用导航能力 */
const { openFile, openSkill, openWebview } = useNavigate();
/** 输入编辑器实例。 */
const promptEditorRef = ref<EditorInstance>();
/** 文件拖拽容器引用。 */
const containerRef = ref<HTMLElement | null>(null);
/** 模型选择使用的活动会话 ID，包含首轮发送后创建但尚未由宿主回写的会话。 */
const modelSessionId = ref<string | null>(props.sessionId);
/** 输入区域状态与交互能力。 */
const composer = useChatComposer({
  activeSessionId: modelSessionId,
  containerRef,
  promptEditorRef,
  interactionAPI,
  openFile,
  openSkill
});
const { focusInput, imageUpload, fileReference, canSubmit, isContainerDragActive, fileMentionOptions, promptChipResolver, handleFileMentionSelect } = composer;
/** 草稿输入状态与操作。 */
const { inputContent, inputImages, ...inputEvents } = composer.input;
/** 模型选择状态与操作。 */
const { selectedModel, supportsVision, contextWindow, ...modelSelectionEvents } = composer.model;
/** 当前会话最近一次模型投影得到的上下文用量。 */
const contextUsage = ref<ChatRuntimeContextUsageSnapshot>();
/** 空闲估算请求序号，用于阻止旧会话结果覆盖实时 Runtime 快照。 */
let contextUsageEstimateSequence = 0;
/** 全局命令面板 Store。 */
const commandPanelStore = useCommandPanelStore();
/** Provider 数据源。 */
const providerStore = useProviderStore();
/** Skill 候选数据源。 */
const skillStore = useSkillStore();
/** 命令与可用 Skill 组成的响应式斜杠菜单。 */
const slashCommandOptions = computed<SlashCommandOption[]>((): SlashCommandOption[] => [
  ...chatSlashCommands,
  ...createSkillSlashCommands(skillStore.skills ?? [])
]);
/** 是否存在至少一个已启用的模型，用于「去配置」点击分支。 */
const hasAvailableModels = computed<boolean>((): boolean => providerStore.availableModels.length > 0);
/** 对话视图引用 */
const conversationRef = ref<InstanceType<typeof ConversationView>>();
/** 当前正在创建会话分支的助手消息 ID，用于底层拦截重复请求。 */
const branchingMessageId = ref<string>();
/** 应用级 Runtime/Agent confirmation queue。 */
const confirmationQueue = useChatConfirmationQueueStore();
/** 订阅 Main 持久化 confirmation 事实并恢复 Renderer 队列。 */
useAgentConfirmationEvents();
/** 提供给早期初始化回调的工作流忙碌镜像。 */
const workflowLoading = ref<boolean>(false);
/** 会话 ID、历史消息与自动命名运行时态。 */
const sessionRuntime = useChatSessionRuntime({
  sessionId: toRef(props, 'sessionId'),
  focusInput,
  hasPendingUserChoice: (sourceMessages: Message[]): boolean => Boolean(userChoice.findPending(sourceMessages)),
  onSessionCreated: (session: ChatSession): void => emit('session-created', session),
  onSessionTitlePersisted: (sessionId: string, title: string): void => emit('session-title-persisted', sessionId, title)
});
const {
  activeSessionId,
  createdSessionId,
  setLoadedMessages,
  upsertLiveMessage,
  removeLiveMessage,
  fetchAllPriorHistory,
  messages,
  ensureActiveSession: ensureSession,
  resetDraftState,
  handleLoadHistory,
  captureAutoNameSnapshot,
  scheduleAutoName
} = sessionRuntime;
/** 按当前会话投影 application-level Runtime confirmation。 */
const confirmationController = createChatConfirmationController(activeSessionId);
/** 当前会话的工作区覆盖、默认回退和目录预检能力。 */
const { workspaceRoot, workspaceOverride, workspaceLabel, selectWorkspace, clearWorkspace, assertWorkspaceAvailable } = useSessionWorkspace({
  activeSessionId,
  defaultWorkspaceRoot
});
/** 首轮会话创建时将草稿选择的工作区一并持久化。 */
function ensureActiveSession(title: string, model: ChatSessionModelMetadata): Promise<string> {
  return ensureSession(title, model, workspaceOverride.value);
}
/** 应用级 Child Task Renderer 投影。 */
const agentTaskStore = useChatAgentTaskStore();
watch(
  activeSessionId,
  (sessionId: string | null): void => {
    modelSessionId.value = sessionId;
  },
  { immediate: true }
);
watch(
  activeSessionId,
  (sessionId: string | null): void => {
    if (!sessionId) return;
    // 只使用运行时权威 activeSessionId，覆盖内部首轮创建但宿主尚未回写的窗口。
    agentTaskStore.ensureSession(sessionId);
  },
  { immediate: true }
);
/** 应用级 Chat Actor system。 */
const chatActorSystem = useActorSystem();
/** Workflow 创建前收到的待重放 Session UI 事件。 */
const pendingSessionUIEvents: ChatSessionUIEvent[] = [];
/** 当前 Session UI 事件处理器，Workflow 创建前先暂存事件。 */
let handleSessionUIEvent = (event: ChatSessionUIEvent): void => {
  pendingSessionUIEvents.push(event);
};
/** 当前会话 Actor 状态与领域事件 API。 */
const chatSessionActor = useChatSessionActor({
  activeSessionId,
  actorSystem: chatActorSystem,
  onUIEvent: (event: ChatSessionUIEvent): void => handleSessionUIEvent(event)
});
watch(messages, (loadedMessages: Message[]): void => {
  const sessionId = activeSessionId.value;
  if (!sessionId) return;
  const interaction = findPendingInteraction(loadedMessages, sessionId);
  if (interaction) chatSessionActor.recoverInteraction(interaction);
});
/** Todo 面板状态和回退恢复能力。 */
const { currentSessionTodos, todoPanelVisible, todoPanelDismissed, restoreTodoSnapshotsForMessages } = useTodoPanel({ activeSessionId });
/** Runtime 内置工具能力。 */
const { getActiveTools, syncAIResources, getSkillContentHashes, resolveSkillSnapshots, openDraft, openFileByPath } = useRuntimeTools({
  createConfirmationAdapter: (binding): ReturnType<typeof confirmationController.createAdapter> => confirmationController.createAdapter(binding),
  getSessionId: (): string | undefined => activeSessionId.value ?? undefined,
  workspaceRoot,
  getWorkspaceRoot: (): string | null => workspaceRoot.value,
  getPendingQuestion: (sessionId: string): { questionId: string; toolCallId: string } | null => {
    const pendingInteraction = chatActorSystem.getSession(sessionId)?.getSnapshot().context.pendingInteraction;
    if (!pendingInteraction || pendingInteraction.type !== 'userChoice' || pendingInteraction.status !== 'pending') return null;
    return {
      questionId: pendingInteraction.questionId,
      toolCallId: pendingInteraction.toolCallId
    };
  },
  openWebview
});

/**
 * 处理底部确认弹窗操作。
 * @param payload - 绑定点击时实际展示项的用户操作
 */
async function handleConfirmationSheetAction(payload: ConfirmationSheetActionPayload): Promise<void> {
  const confirmation = confirmationQueue.items[payload.confirmationId];
  const currentConfirmation = confirmationController.currentConfirmation.value;
  if (
    !confirmation ||
    !currentConfirmation ||
    currentConfirmation.confirmationId !== payload.confirmationId ||
    currentConfirmation.source !== payload.source ||
    confirmation.source !== payload.source ||
    confirmation.confirmationId !== payload.confirmationId
  ) {
    return;
  }
  const { action } = payload;

  if (confirmation.source === 'agent') {
    if (
      payload.expectedVersion === undefined ||
      confirmation.snapshot.confirmationId !== payload.confirmationId ||
      confirmation.snapshot.status !== 'pending' ||
      confirmation.snapshot.version !== payload.expectedVersion
    ) {
      return;
    }
    const [requestError, response] = await asyncTo(
      getElectronAPI().chatAgentResolveConfirmation({
        confirmationId: confirmation.confirmationId,
        expectedVersion: confirmation.snapshot.version,
        decision: action === 'cancel' ? 'rejected' : 'approved'
      })
    );
    const responseError = response?.ok === false ? response.error : undefined;
    if (requestError || !response?.ok) {
      interactionAPI.showToast({
        type: 'error',
        content: requestError?.message ?? responseError ?? '提交 Child Agent 确认失败'
      });
      return;
    }
    // IPC response 本身也是权威投影；event 丢失时仍可立即收敛当前窗口。
    confirmationQueue.applyAgent(response.data);
    return;
  }

  const { confirmationId } = confirmation;

  if (action === 'approve') {
    confirmationController.approveConfirmation(confirmationId);
  } else if (action === 'approve-session') {
    confirmationController.approveConfirmation(confirmationId, 'session');
  } else if (action === 'approve-always') {
    confirmationController.approveConfirmation(confirmationId, 'always');
  } else {
    confirmationController.cancelConfirmation(confirmationId);
  }
}

/**
 * 处理主进程 ChatRuntime 完成事件。
 * Runtime 已在主进程完成消息持久化，这里只做 UI 状态和自动命名。
 * @param nextMessage - runtime 完成的 assistant 消息
 */
async function handleRuntimeComplete(nextMessage: Message): Promise<void> {
  const sessionId = activeSessionId.value;
  if (!sessionId) return;

  emit('runtime-status-change', { status: 'completed', sessionId });
  const snapshot = captureAutoNameSnapshot(nextMessage, sessionId);

  if (!snapshot) return;

  scheduleAutoName(snapshot, (): boolean => workflowLoading.value);
}

/**
 * 打开模型范围的命令面板。
 */
function openModelCommandPanel(): void {
  commandPanelStore.openModel({
    modelContext: {
      getCurrentModel: (): SelectedModel | undefined => selectedModel.value,
      onModelChange: modelSelectionEvents.onModelChange
    },
    onClose: (): void => promptEditorRef.value?.focus()
  });
}

/**
 * 显示"未找到模型配置"的 Toast 提示，引导用户去配置页。
 */
function showNoModelToast(): void {
  interactionAPI.showToast({
    id: 'no-model-config-toast',
    content: h('div', [
      '未找到可用的模型配置，',
      h(
        'span',
        {
          class: 'text-primary underline cursor-pointer',
          onClick: (): void => {
            // 始终先关闭当前 Toast，避免与后续打开的对话框视觉堆叠
            removeToast('no-model-config-toast');
            if (hasAvailableModels.value) {
              // 已配置过模型，直接打开模型范围的命令面板让用户挑选
              openModelCommandPanel();
            } else {
              // 没有任何可用模型，跳转配置页
              emit('navigate-to-provider');
              router.push('/settings/provider');
            }
          }
        },
        '去配置'
      )
    ]),
    type: 'error',
    duration: 6000
  });
}

/** Chat 服务配置解析 hook。 */
const chatServiceConfig = useChatServiceConfig(modelSelectionEvents.resolveSelectedModel);
/** Runtime 请求配置解析 hook。 */
const { resolveRuntimeSystemPrompt, resolveRuntimeTavilyConfig, resolveRuntimeMcpRequestConfig } = useRuntimeConfig();
/** Runtime 请求准备与纯策略适配 hook。 */
const { prepareRuntimeRequest, resolveRuntimeRequestConfig } = useRuntimeRequestConfig({
  contextWindow,
  workspaceRoot,
  assertWorkspaceAvailable,
  resolveServiceConfig: chatServiceConfig.resolveServiceConfig,
  syncAIResources,
  getActiveTools,
  getSkillContentHashes,
  resolveSkillSnapshots,
  resolveRuntimeSystemPrompt,
  resolveRuntimeTavilyConfig,
  resolveRuntimeMcpRequestConfig,
  onMissingServiceConfig: showNoModelToast
});

/** 按不可变 Runtime 身份创建 Bridge 请求处理器。 */
const createRuntimeBridgeHandler = useRuntimeBridgeHandler({ openDraft, openFileByPath, openWebview });
/** Session 状态机与 Runtime IPC 工作流。 */
const workflow = useChatWorkflow({
  messages,
  activeSessionId,
  isDraftPromotion: (sessionId: string): boolean => createdSessionId.value === sessionId,
  contextWindow,
  workspaceRoot,
  supportsVision,
  actorSystem: chatActorSystem,
  sessionActor: chatSessionActor,
  getActiveTools,
  prepareRuntimeRequest,
  resolveRuntimeRequestConfig,
  createBridgeHandler: createRuntimeBridgeHandler,
  confirmationController,
  ensureActiveSession,
  fetchAllPriorHistory,
  setLoadedMessages,
  upsertLiveMessage,
  removeLiveMessage,
  restoreInput: inputEvents.restoreFromMessage,
  clearInput: inputEvents.clear,
  focusInput,
  scrollToBottom: (): void => conversationRef.value?.scrollToBottom({ behavior: 'auto' }),
  onRuntimeComplete: handleRuntimeComplete,
  onContextUsageUpdated: (snapshot: ChatRuntimeContextUsageSnapshot): void => {
    contextUsageEstimateSequence += 1;
    contextUsage.value = snapshot;
  },
  onModelNotFound: showNoModelToast,
  showRuntimeError: (message: string): void => interactionAPI.showToast({ type: 'error', content: message }),
  onPreparationCancelled: (sessionId: string, status: 'idle' | 'waiting'): void => emit('runtime-status-change', { status, sessionId }),
  restoreTodoSnapshots: restoreTodoSnapshotsForMessages
});

/**
 * 读取空闲会话的持久化上下文投影，避免已有会话在首次发送前显示为零。
 */
async function refreshContextUsage(): Promise<void> {
  const requestSequence = contextUsageEstimateSequence + 1;
  contextUsageEstimateSequence = requestSequence;
  contextUsage.value = undefined;
  const sessionId = activeSessionId.value;
  if (!sessionId) return;

  const [error, result] = await asyncTo(
    getElectronAPI().chatRuntimeEstimateContext({
      sessionId,
      contextWindow: contextWindow.value
    })
  );
  if (error || requestSequence !== contextUsageEstimateSequence || activeSessionId.value !== sessionId) return;
  if (result.ok && result.data) contextUsage.value = result.data;
}

watch([activeSessionId, () => selectedModel.value?.providerId, () => selectedModel.value?.modelId], async (): Promise<void> => refreshContextUsage(), {
  immediate: true
});
handleSessionUIEvent = (event: ChatSessionUIEvent): void => {
  workflow.handleSessionUIEvent(event).catch((error: unknown): void => {
    interactionAPI.showToast({ type: 'error', content: error instanceof Error ? error.message : '处理确认请求失败' });
  });
};
for (const event of pendingSessionUIEvents.splice(0)) {
  handleSessionUIEvent(event);
}
const {
  loading,
  chatSubmitter,
  rollbackController,
  handleRegenerate: handleChatRegenerate,
  abort: handleAbort,
  cancel: handleCancel,
  rollback: handleRollback
} = workflow;
/** 本地消息回退只用于锁住当前交互，不应映射为顶部标签的 Runtime 加载态。 */
const rollbackBusy = computed<boolean>((): boolean => chatSessionActor.snapshot.value?.matches('rollingBack') === true);
/** 页面标签使用的稳定运行状态投影。 */
const runtimeStatus = computed<BChatRuntimeSourceStatus>((): BChatRuntimeSourceStatus => {
  if (rollbackBusy.value) return 'idle';
  if (confirmationController.currentConfirmation.value) return 'waiting';
  if (chatSessionActor.waitingForUser.value) return 'waiting';
  if (loading.value) return 'running';
  if (chatSessionActor.snapshot.value?.context.error) return 'error';
  return 'idle';
});
/** 消息级交互仅在对应领域状态允许时开放。 */
const messageInteractionDisabled = computed<boolean>((): boolean => {
  const sessionId = activeSessionId.value;
  const pendingInteraction = sessionId ? findPendingInteraction(messages.value, sessionId) : null;
  return pendingInteraction ? !chatSessionActor.waitingForUser.value : !loading.value;
});

watch(
  loading,
  (value: boolean): void => {
    workflowLoading.value = value;
    emit('loading-change', value);
  },
  { immediate: true }
);

watch(runtimeStatus, (status: BChatRuntimeSourceStatus): void => emit('runtime-status-change', { status }), { immediate: true });

/** 恢复指定消息到输入编辑器。 */
function handleChatEdit(nextMessage: Message): void {
  inputEvents.restoreFromMessage(nextMessage);
}

/**
 * 从目标助手消息创建独立会话分支。
 * @param message - 目标助手消息
 */
async function handleBranch(message: Message): Promise<void> {
  const sourceSessionId = activeSessionId.value;
  if (!sourceSessionId || loading.value || branchingMessageId.value) return;

  branchingMessageId.value = message.id;
  const [error, session] = await asyncTo(chatStore.branchSession(sourceSessionId, message.id));
  branchingMessageId.value = undefined;

  if (error) {
    interactionAPI.showToast({ type: 'error', content: error.message || '创建会话分支失败' });
    return;
  }

  // 用户已主动切换会话时保留新分支，但不再抢回当前会话焦点。
  if (activeSessionId.value !== sourceSessionId) return;
  emit('session-created', session);
}

/**
 * 处理聊天消息提交。
 */
async function handleChatSubmit(): Promise<void> {
  const content = inputContent.value.trim();

  if (loading.value || !canSubmit.value) return;

  await workflow.submitUserTextMessage(content, inputImages.value);
}

/**
 * 清空输入与消息并进入新的草稿会话。
 * 该能力供顶部草稿标签复用时显式调用。
 */
async function resetDraft(options: BChatResetDraftOptions = {}): Promise<void> {
  if (loading.value) {
    // 新建入口保持可用时，先使尚未进入 Main 的异步预检失效；真实 Runtime 或等待交互仍由领域状态阻止清空。
    workflow.dispose();
    if (loading.value) return;
  }
  inputEvents.clear(options);
  await resetDraftState(options);
}

/**
 * 处理模型变更（委托给 modelSelection hook）。
 * @param value - 新选中的模型标识
 */
async function handleModelChange(model: { providerId: string; modelId: string }): Promise<void> {
  const [error] = await asyncTo(modelSelectionEvents.onModelChange(model));
  if (error) interactionAPI.showToast({ type: 'error', content: error.message || '保存会话模型失败' });
}

/**
 * 选择并保存当前会话的工作区覆盖目录。
 */
async function handleWorkspaceSelect(): Promise<void> {
  if (loading.value) return;

  const [error] = await asyncTo(selectWorkspace());
  if (error) interactionAPI.showToast({ type: 'error', content: `选择工作区失败：${error.message}` });
}

/**
 * 清除当前会话的工作区覆盖并恢复默认工作区。
 */
async function handleWorkspaceClear(): Promise<void> {
  if (loading.value) return;

  const [error] = await asyncTo(clearWorkspace());
  if (error) interactionAPI.showToast({ type: 'error', content: `恢复默认工作区失败：${error.message}` });
}

/** 斜杠命令处理 hook */
const { handleSlashCommand } = useSlashCommands({
  openModelSelector: openModelCommandPanel,
  createNewSession: (): void => emit('new-session'),
  clearInput: inputEvents.clear,
  compactContext: workflow.compactContext,
  isBusy: (): boolean => loading.value
});

/** 组件卸载时清理 */
onUnmounted((): void => {
  workflow.dispose();
  confirmationController.dispose();
});

/** 暴露页面宿主管理会话所需的最小控制面。 */
defineExpose({ focusInput, resetDraft });
</script>

<style lang="less">
@import url('./utils/chipResolver/index.less');

.b-chat__container {
  display: flex;
  flex: 1;
  flex-direction: column;
  height: 0;
}

.b-chat__toolbar {
  padding: 8px 12px 12px;

  &:empty {
    display: none;
  }
}

.b-chat__conversation-container {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  height: 0;
}

.b-chat__floating-container {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 12px 16px;
  pointer-events: none;

  &:empty {
    display: none;
  }

  & > * {
    pointer-events: auto;
  }
}

.b-chat__input {
  padding: 12px;
  border-top: 1px solid var(--border-primary);
}

.b-chat__input-container {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: var(--b-chat-max-width, 800px);
  padding: 12px;
  margin: 0 auto;
  background: var(--bg-primary);
  border: 1px solid var(--border-primary);
  border-radius: 6px;
  transition: background 0.3s ease-in-out, border-color 0.2s ease-in-out, box-shadow 0.2s ease-in-out;

  &.b-chat__input-container--dragover {
    background: var(--color-primary-bg);
    border-color: var(--input-focus-border);
    box-shadow: inset 0 0 0 1px var(--color-control-outline);
  }
}

.b-chat__input-container .b-smart-editor {
  flex: 1;
  min-width: 0;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 0;
}

.b-chat__input-container .b-smart-editor:focus-within {
  box-shadow: none;
}
</style>
