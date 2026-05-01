<!--
  @file index.vue
  @description 聊天侧边栏组件，包含会话管理、消息列表、输入框和模型选择功能。
-->
<template>
  <div class="b-chat-sidebar">
    <div class="b-chat-sidebar__header">
      <div class="b-chat-sidebar__title truncate">{{ currentSession?.title || '新会话' }}</div>
      <BButton square size="small" type="text" :disabled="loading" @click="createNewSession">
        <Icon icon="lucide:message-circle-plus" width="16" height="16" />
      </BButton>
      <SessionHistory
        ref="sessionHistoryRef"
        v-model:current-session="currentSession"
        :active-session-id="settingStore.chatSidebarActiveSessionId"
        :disabled="loading"
        @switch-session="switchSession"
      />

      <div class="divider"></div>
      <BButton square size="small" type="text" @click="settingStore.setSidebarVisible(false)">
        <Icon icon="lucide:x" width="16" height="16" />
      </BButton>
    </div>
    <div class="b-chat-sidebar__container">
      <ConversationView
        ref="conversationRef"
        v-model:messages="messages"
        :loading="loading"
        :on-load-history="handleLoadHistory"
        @edit="handleChatEdit"
        @regenerate="handleChatRegenerate"
        @confirmation-action="handleConfirmationAction"
        @user-choice-submit="handleChatUserChoiceSubmit"
      />

      <UsagePanel
        v-if="usagePanel.open.value"
        :loading="usagePanel.loading.value"
        :usage="usagePanel.usage.value"
        :error="usagePanel.error.value"
        :on-close="usagePanel.close"
      />

      <div class="b-chat-sidebar__input">
        <div class="b-chat-sidebar__input-container">
          <ImagePreview :images="inputImages" :supports-vision="supportsVision" :on-remove-image="inputEvents.removeImage" />

          <BPromptEditor
            ref="promptEditorRef"
            v-model:value="inputContent"
            placeholder="输入消息..."
            :max-height="200"
            :chip-resolver="chipResolver"
            :on-paste-files="fileReference.onPasteFiles"
            :on-paste-images="imageUpload.onPasteImages"
            :can-accept-images="imageUpload.canAcceptImages"
            :slash-commands="chatSlashCommands"
            :on-cancel="handleCancel"
            submit-on-enter
            @slash-command="handleSlashCommand"
            @submit="handleChatSubmit"
          />

          <InputToolbar
            ref="modelSelectorRef"
            :loading="loading"
            :input-value="inputContent"
            :selected-model="selectedModel"
            :supports-vision="supportsVision"
            :can-submit="canSubmit"
            @submit="handleChatSubmit"
            @abort="handleAbort"
            @image-select="imageUpload.appendImages"
            @model-change="handleModelChange"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ChatMessageConfirmationAction } from 'types/chat';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { Icon } from '@iconify/vue';
import { createBuiltinTools } from '@/ai/tools/builtin';
import { editorToolContextRegistry } from '@/ai/tools/editor-context';
import { getDefaultChatToolNames } from '@/ai/tools/policy';
import BButton from '@/components/BButton/index.vue';
import { chipResolver } from '@/components/BChatSidebar/utils/chipResolver';
import { create, userChoice } from '@/components/BChatSidebar/utils/messageHelper';
import { persistReferenceSnapshots } from '@/components/BChatSidebar/utils/referenceSnapshot';
import { chatSlashCommands } from '@/components/BChatSidebar/utils/slashCommands';
import type { Message } from '@/components/BChatSidebar/utils/types';
import BPromptEditor from '@/components/BPromptEditor/index.vue';
import type { SlashCommandOption } from '@/components/BPromptEditor/types';
import { useChatStore } from '@/stores/chat';
import { useSettingStore } from '@/stores/setting';
import ConversationView from './components/ConversationView.vue';
import ImagePreview from './components/ImagePreview.vue';
import InputToolbar from './components/InputToolbar.vue';
import SessionHistory from './components/SessionHistory.vue';
import UsagePanel from './components/UsagePanel.vue';
import { useAutoName } from './hooks/useAutoName';
import { useChatHistory } from './hooks/useChatHistory';
import { useChatInput } from './hooks/useChatInput';
import { useChatStream } from './hooks/useChatStream';
import { useFileReference } from './hooks/useFileReference';
import { useImageUpload } from './hooks/useImageUpload';
import { useModelSelection } from './hooks/useModelSelection';
import { useSession } from './hooks/useSession';
import { useUsagePanel } from './hooks/useUsagePanel';
import { createChatConfirmationController } from './utils/confirmationController';

/** 聊天数据存储 */
const chatStore = useChatStore();
/** 应用设置存储 */
const settingStore = useSettingStore();

/** 输入框编辑器引用 */
const promptEditorRef = ref<InstanceType<typeof BPromptEditor>>();
/** 模型选择器程序化打开入口 */
const modelSelectorRef = ref<InstanceType<typeof InputToolbar>>();
/** 对话视图引用 */
const conversationRef = ref<InstanceType<typeof ConversationView>>();
/** 会话历史组件引用 */
const sessionHistoryRef = ref<InstanceType<typeof SessionHistory>>();

/** 聊天历史加载状态和方法 */
const { setLoadedMessages, fetchAllPriorHistory, messages, hasMoreHistory, loadHistory } = useChatHistory();

/** 确认控制器，管理工具调用的用户确认流程 */
const confirmationController = createChatConfirmationController({
  getMessages: () => messages.value
});

/** 聚焦输入框 */
function focusInput(): void {
  promptEditorRef.value?.focus();
}

/** 保存输入框光标位置 */
function saveCursorPosition(): void {
  promptEditorRef.value?.saveCursorPosition();
}

/** 插入文本到光标位置 */
function insertTextAtCursor(text: string): void {
  promptEditorRef.value?.insertTextAtCursor(text);
}

/** 用量面板 hook */
const usagePanel = useUsagePanel();

/** 草稿输入 hook */
const { inputContent, inputImages, ...inputEvents } = useChatInput({ focusInput });

/** 模型选择 hook */
const { selectedModel, supportsVision, ...modelSelectionEvents } = useModelSelection();

/** 图片上传 hook */
const imageUpload = useImageUpload({ supportsVision, inputEvents: { ...inputEvents, inputImages } });

/** 当前是否允许提交消息（文本非空 或 有图片） */
const canSubmit = computed<boolean>(() => !inputEvents.isEmpty() || inputEvents.hasImages());

/** 文件引用 hook */
const fileReference = useFileReference({
  insertTextAtCursor,
  saveCursorPosition,
  focusInput
});

/** 聊天工具列表 */
const tools = createBuiltinTools({
  confirm: confirmationController.createAdapter(),
  getPendingQuestion: () => {
    const pendingQuestion = userChoice.findPending(messages.value);
    if (!pendingQuestion) return null;

    return {
      questionId: pendingQuestion.questionId,
      toolCallId: pendingQuestion.toolCallId
    };
  }
}).filter((tool) => {
  // MVP 阶段聊天侧边栏只开放低风险工具，避免默认暴露替换类操作
  return getDefaultChatToolNames().includes(tool.definition.name);
});

/**
 * 处理聊天流中的确认卡片操作。
 * @param confirmationId - 确认项 ID
 * @param action - 用户操作（approve/approve-session/approve-always/cancel）
 */
async function handleConfirmationAction(confirmationId: string, action: ChatMessageConfirmationAction): Promise<void> {
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
 * 消息重新生成前的处理函数。
 * @param nextMessages - 重新生成后的消息列表
 */
async function handleBeforeRegenerate(nextMessages: Message[]): Promise<void> {
  confirmationController.expirePendingConfirmation();
  const sessionId = settingStore.chatSidebarActiveSessionId;
  if (!sessionId) return;

  const historyMessages = await fetchAllPriorHistory(sessionId);
  await chatStore.setSessionMessages(sessionId, [...historyMessages, ...nextMessages]);
}

/**
 * 消息发送前的处理函数。
 * @param nextMessage - 待发送的消息
 */
async function handleBeforeSend(nextMessage: Message): Promise<void> {
  confirmationController.expirePendingConfirmation();
  await persistReferenceSnapshots(nextMessage);

  if (!settingStore.chatSidebarActiveSessionId) {
    const session = await chatStore.createSession('assistant', { title: nextMessage.content });
    settingStore.setChatSidebarActiveSessionId(session.id);
  }

  await chatStore.addSessionMessage(settingStore.chatSidebarActiveSessionId, nextMessage);
}

/** 聊天流式处理 hook */
const { stream, loading } = useChatStream({
  messages,
  tools,
  getToolContext: editorToolContextRegistry.getCurrentContext,
  onBeforeRegenerate: handleBeforeRegenerate,
  onComplete: async (nextMessage: Message) => {
    // eslint-disable-next-line no-use-before-define
    await handleComplete(nextMessage);
  },
  onConfirmationAction: handleConfirmationAction
});

/** 会话 hook */
const { currentSession, createNewSession, switchSession, initializeActiveSession } = useSession({
  resetUsagePanel: usagePanel.reset,
  setLoadedMessages,
  focusInput,
  isStreamLoading: () => loading.value,
  disposeConfirmationController: () => confirmationController.dispose(),
  resetHistoryState: () => {
    hasMoreHistory.value = false;
  }
});

/**
 * 自动命名 Hook。
 */
const { captureSnapshot, scheduleAutoName } = useAutoName({
  getCurrentSession: () => currentSession.value,
  getFirstRoundContent: (nextMessage) => {
    // 首轮如果仍在等待用户补充输入，则不应提前触发自动命名
    if (userChoice.findPending(messages.value)) {
      return null;
    }

    // 仅在首轮恰好形成一问一答时才参与自动命名
    const userMessages = messages.value.filter((item) => item.role === 'user');
    const assistantMessages = messages.value.filter((item) => item.role === 'assistant');
    if (userMessages.length !== 1 || assistantMessages.length !== 1) return null;

    return {
      userMessage: userMessages[0].content,
      aiResponse: nextMessage.content
    };
  },
  onTitlePersisted: async () => {
    await sessionHistoryRef.value?.refreshSessions();
  }
});

/**
 * 消息完成后的处理函数。
 * @param nextMessage - 完成的消息
 */
async function handleComplete(nextMessage: Message): Promise<void> {
  const sessionId = settingStore.chatSidebarActiveSessionId;
  const snapshot = captureSnapshot(nextMessage, sessionId);

  await chatStore.addSessionMessage(sessionId, nextMessage);
  if (sessionId) {
    await usagePanel.refresh(sessionId, currentSession.value?.id);
  }
  if (!snapshot) return;

  scheduleAutoName(snapshot, () => loading.value);
}

/**
 * 处理聊天消息提交。
 */
async function handleChatSubmit(): Promise<void> {
  const content = inputContent.value.trim();
  const images = inputImages.value;

  if (!canSubmit.value) return;

  const config = await stream.resolveServiceConfig();
  if (!config) return;

  const references = inputEvents.getActiveReferences(content);
  const nextMessage = create.userMessage(content, references);
  if (images.length && supportsVision.value) {
    nextMessage.files = [...images];
  }

  await handleBeforeSend(nextMessage);
  messages.value.push(nextMessage);
  conversationRef.value?.scrollToBottom({ behavior: 'auto' });
  focusInput();
  inputEvents.clear();

  await stream.streamMessages(messages.value, config);
}

/**
 * 处理消息编辑。
 * @param nextMessage - 要编辑的消息
 */
function handleChatEdit(nextMessage: Message): void {
  inputEvents.restoreFromMessage(nextMessage);
}

/**
 * 处理消息重新生成。
 * @param nextMessage - 要重新生成的消息
 */
async function handleChatRegenerate(nextMessage: Message): Promise<void> {
  await stream.regenerate(nextMessage);
}

/**
 * 处理用户选择提交。
 * @param answer - 用户选择的答案数据
 */
async function handleChatUserChoiceSubmit(answer: import('types/chat').AIUserChoiceAnswerData): Promise<void> {
  await stream.submitUserChoice(answer);
}

/**
 * 处理中止流式输出。
 */
function handleAbort(): void {
  stream.abort?.();
}

/**
 * 处理 ESC 取消操作：流式输出中则中止。
 */
function handleCancel(): void {
  if (loading.value) {
    handleAbort();
  }
}

/**
 * 处理模型变更（委托给 modelSelection hook）。
 * @param value - 新选中的模型标识
 */
function handleModelChange(model: { providerId: string; modelId: string }): void {
  modelSelectionEvents.onModelChange(model);
}

/** 清空当前草稿输入 */
function handleClearInput(): void {
  inputEvents.clear();
}

/**
 * 处理斜杠命令。
 * @param command - 斜杠命令项
 */
function handleSlashCommand(command: SlashCommandOption): void {
  if (command.id === 'model') {
    modelSelectorRef.value?.open();
    return;
  }

  if (command.id === 'usage') {
    usagePanel.openPanel(currentSession.value?.id);
    return;
  }

  if (command.id === 'new') {
    createNewSession();
    return;
  }

  if (command.id === 'clear') {
    handleClearInput();
  }
}

/** 加载历史消息 */
async function handleLoadHistory(): Promise<void> {
  const sessionId = settingStore.chatSidebarActiveSessionId;
  if (!sessionId) return;

  await loadHistory(sessionId);
}

/** 组件挂载时初始化 */
onMounted(async () => {
  await modelSelectionEvents.loadSelectedModel();
  initializeActiveSession();
});

/** 组件卸载时清理 */
onUnmounted(() => {
  confirmationController.dispose();
});
</script>

<style>
.b-chat-sidebar {
  display: flex;
  flex-shrink: 0;
  flex-direction: column;
  height: 100%;
  margin-right: 6px;
  overflow: hidden;
  background: var(--bg-primary);
  border-radius: 8px;
}

.b-chat-sidebar__header {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 8px 8px 8px 12px;
  border-bottom: 1px solid var(--border-color);
}

.b-chat-sidebar__title {
  flex: 1;
  width: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
}

.divider {
  width: 1px;
  height: 16px;
  background-color: var(--border-secondary);
}

.b-chat-sidebar__container {
  display: flex;
  flex: 1;
  flex-direction: column;
  height: 0;
}

.b-chat-sidebar__input {
  padding: 12px;
  border-top: 1px solid var(--border-primary);
}

.b-chat-sidebar__input-container {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  background: var(--input-bg);
  border: 1px solid var(--border-primary);
  border-radius: 6px;
}

.b-chat-sidebar__input-container .b-prompt-editor {
  flex: 1;
  min-width: 0;
  padding: 0;
  background-color: transparent;
  border: none;
  border-radius: 0;
}

.b-chat-sidebar__input-container .b-prompt-editor:focus-within {
  box-shadow: none;
}
</style>
