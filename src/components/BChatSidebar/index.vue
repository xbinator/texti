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
          <div v-if="draftInput.draftImages.value.length" class="b-chat-sidebar__image-preview">
            <div v-for="image in draftInput.draftImages.value" :key="image.id" class="b-chat-sidebar__image-preview-item">
              <img :src="image.url" :alt="image.name" class="b-chat-sidebar__image-preview-image" />
              <BButton class="b-chat-sidebar__image-preview-remove" size="small" square type="text" @click="draftInput.removeImage(image.id)">
                <Icon icon="lucide:x" width="14" height="14" />
              </BButton>
            </div>
          </div>
          <div v-if="imagesBlockedByModel" class="b-chat-sidebar__image-warning">当前模型不支持图片，请切换到支持视觉识别的模型后发送</div>

          <BPromptEditor
            ref="promptEditorRef"
            v-model:value="draftInput.inputValue.value"
            placeholder="输入消息..."
            :max-height="200"
            :chip-resolver="chipResolver"
            :on-paste-files="fileReference.onPasteFiles"
            :on-paste-images="handlePasteImages"
            :can-accept-images="canAcceptImages"
            :slash-commands="chatSlashCommands"
            submit-on-enter
            @slash-command="handleSlashCommand"
            @submit="handleChatSubmit"
          />

          <InputToolbar
            ref="modelSelectorRef"
            :loading="loading"
            :input-value="draftInput.inputValue.value"
            :selected-model="selectedModel"
            :supports-vision="supportsVision"
            :can-submit="canSubmit"
            @submit="handleChatSubmit"
            @abort="handleAbort"
            @image-select="appendImagesToDraft"
            @model-change="handleModelChange"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ChatMessageConfirmationAction, ChatMessageFile } from 'types/chat';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { Icon } from '@iconify/vue';
import { message } from 'ant-design-vue';
import { createBuiltinTools } from '@/ai/tools/builtin';
import { editorToolContextRegistry } from '@/ai/tools/editor-context';
import { getDefaultChatToolNames, getModelVisionSupport } from '@/ai/tools/policy';
import BButton from '@/components/BButton/index.vue';
import { chipResolver } from '@/components/BChatSidebar/utils/chipResolver';
import { createChatImageFile, isImageFile } from '@/components/BChatSidebar/utils/imageUtils';
import { create, userChoice } from '@/components/BChatSidebar/utils/messageHelper';
import { persistReferenceSnapshots } from '@/components/BChatSidebar/utils/referenceSnapshot';
import { chatSlashCommands } from '@/components/BChatSidebar/utils/slashCommands';
import type { Message } from '@/components/BChatSidebar/utils/types';
import BPromptEditor from '@/components/BPromptEditor/index.vue';
import type { PasteImageContext, SlashCommandOption } from '@/components/BPromptEditor/types';
import { serviceModelsStorage } from '@/shared/storage';
import { useChatStore } from '@/stores/chat';
import { useSettingStore } from '@/stores/setting';
import ConversationView from './components/ConversationView.vue';
import InputToolbar from './components/InputToolbar.vue';
import SessionHistory from './components/SessionHistory.vue';
import UsagePanel from './components/UsagePanel.vue';
import { useAutoName } from './hooks/useAutoName';
import { useChatHistory } from './hooks/useChatHistory';
import { useChatStream } from './hooks/useChatStream';
import { useDraftInput } from './hooks/useDraftInput';
import { useFileReference } from './hooks/useFileReference';
import { useSession } from './hooks/useSession';
import { useUsagePanel } from './hooks/useUsagePanel';
import { createChatConfirmationController } from './utils/confirmationController';

/** 单张图片大小限制。 */
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
/** 图片数量限制。 */
const MAX_IMAGE_COUNT = 6;
/** 图片总大小限制。 */
const MAX_TOTAL_IMAGE_SIZE = 15 * 1024 * 1024;

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
/** 当前选中的模型 */
const selectedModel = ref<string>();
/** 当前模型是否支持视觉识别 */
const supportsVision = ref(false);
/** 模型视觉能力检查版本号 */
let visionCheckVersion = 0;

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
const draftInput = useDraftInput({
  focusInput
});

/** 当前是否允许提交消息 */
const canSubmit = computed<boolean>(() => !draftInput.isEmpty() || draftInput.hasImages());
/** 当前是否因模型能力限制而阻止发送图片 */
const imagesBlockedByModel = computed<boolean>(() => draftInput.hasImages() && !supportsVision.value);

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
 * 解析选中的模型标识。
 * @param value - providerId:modelId 格式的模型值
 * @returns 解析结果，无效时返回 null
 */
function parseSelectedModel(value: string | undefined): { providerId: string; modelId: string } | null {
  if (!value) return null;
  const index = value.indexOf(':');
  if (index <= 0 || index === value.length - 1) return null;

  return {
    providerId: value.slice(0, index),
    modelId: value.slice(index + 1)
  };
}

/**
 * 为纯图片消息创建文本摘要。
 * @param count - 图片数量
 * @returns 纯图片摘要文本
 */
function createImageOnlySummary(count: number): string {
  return count === 1 ? '用户上传了一张图片，请结合图片内容回答。' : `用户上传了 ${count} 张图片，请结合这些图片内容回答。`;
}

/**
 * 判断当前是否允许接收图片。
 * @returns 是否允许接收图片
 */
function canAcceptImages(): boolean {
  return supportsVision.value;
}

/**
 * 校验待追加图片列表。
 * @param incomingFiles - 待追加文件列表
 */
function validateIncomingImages(incomingFiles: File[]): void {
  const nextCount = draftInput.draftImages.value.length + incomingFiles.length;
  if (nextCount > MAX_IMAGE_COUNT) {
    throw new Error(`最多只能上传 ${MAX_IMAGE_COUNT} 张图片`);
  }

  const nextTotalSize = draftInput.draftImages.value.reduce((sum, item) => sum + (item.size ?? 0), 0) + incomingFiles.reduce((sum, file) => sum + file.size, 0);
  if (nextTotalSize > MAX_TOTAL_IMAGE_SIZE) {
    throw new Error('图片总大小不能超过 15MB');
  }

  for (const file of incomingFiles) {
    if (!isImageFile(file)) {
      throw new Error('只能上传图片文件');
    }
    if (file.size > MAX_IMAGE_SIZE) {
      throw new Error('单张图片不能超过 5MB');
    }
  }
}

/**
 * 将图片追加到草稿区。
 * @param files - 待处理文件列表
 */
async function appendImagesToDraft(files: File[]): Promise<void> {
  if (!supportsVision.value) {
    message.error('当前模型不支持图片，请切换到支持视觉识别的模型后发送');
    return;
  }

  const imageFiles = files.filter((file) => isImageFile(file));
  if (imageFiles.length === 0) return;

  try {
    validateIncomingImages(imageFiles);
    const nextImages: ChatMessageFile[] = await Promise.all(imageFiles.map((file) => createChatImageFile(file)));
    draftInput.addImages(nextImages);
  } catch (error) {
    message.error(error instanceof Error ? error.message : '图片处理失败');
  }
}

/**
 * 处理图片粘贴/拖拽接管。
 * @param context - 图片接管上下文
 */
async function handlePasteImages(context: PasteImageContext): Promise<void> {
  await appendImagesToDraft(context.imageFiles);
}

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
 * 加载当前选中的模型配置。
 */
async function loadSelectedModel(): Promise<void> {
  const config = await serviceModelsStorage.getConfig('chat');
  selectedModel.value = config?.providerId && config?.modelId ? `${config.providerId}:${config.modelId}` : undefined;
}

/**
 * 处理聊天消息提交。
 */
async function handleChatSubmit(): Promise<void> {
  const content = draftInput.inputValue.value.trim();
  const images = draftInput.draftImages.value;
  const summaryText = content || createImageOnlySummary(images.length);

  if (!canSubmit.value) return;
  if (images.length > 0 && !supportsVision.value) {
    message.error('当前模型不支持图片，请切换到支持视觉识别的模型后发送');
    return;
  }

  const config = await stream.resolveServiceConfig();
  if (!config) return;

  const references = draftInput.getActiveReferences(content);
  const nextMessage = create.userMessage(summaryText, references);
  nextMessage.content = content || summaryText;
  nextMessage.parts = [{ type: 'text', text: nextMessage.content }];
  if (images.length > 0) {
    nextMessage.files = [...images];
  }

  await handleBeforeSend(nextMessage);
  messages.value.push(nextMessage);
  conversationRef.value?.scrollToBottom({ behavior: 'auto' });
  focusInput();
  draftInput.clear();

  await stream.streamMessages(messages.value, config);
}

/**
 * 处理消息编辑。
 * @param nextMessage - 要编辑的消息
 */
function handleChatEdit(nextMessage: Message): void {
  draftInput.restoreFromMessage(nextMessage);
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
 * 处理模型变更。
 * @param value - 新选中的模型标识
 */
function handleModelChange(value: string): void {
  selectedModel.value = value;
}

/** 清空当前草稿输入 */
function handleClearDraft(): void {
  draftInput.clear();
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
    handleClearDraft();
  }
}

/** 加载历史消息 */
async function handleLoadHistory(): Promise<void> {
  const sessionId = settingStore.chatSidebarActiveSessionId;
  if (!sessionId) return;

  await loadHistory(sessionId);
}

watch(
  () => selectedModel.value,
  async (value) => {
    const version = ++visionCheckVersion;
    const parsed = parseSelectedModel(value);

    if (!parsed) {
      supportsVision.value = false;
      return;
    }

    const supported = await getModelVisionSupport(parsed.providerId, parsed.modelId);

    if (version === visionCheckVersion) {
      supportsVision.value = supported;
    }
  },
  { immediate: true }
);

/** 组件挂载时初始化 */
onMounted(async () => {
  await loadSelectedModel();
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
  align-items: flex-end;
  padding: 12px;
  background: var(--input-bg);
  border: 1px solid var(--border-primary);
  border-radius: 6px;
}

.b-chat-sidebar__image-preview {
  display: flex;
  gap: 8px;
  width: 100%;
  overflow-x: auto;
}

.b-chat-sidebar__image-preview-item {
  position: relative;
  flex: 0 0 auto;
  width: 60px;
  height: 60px;
  overflow: hidden;
  border-radius: 8px;
}

.b-chat-sidebar__image-preview-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.b-chat-sidebar__image-preview-remove {
  position: absolute;
  top: 2px;
  right: 2px;
}

.b-chat-sidebar__image-warning {
  width: 100%;
  font-size: 12px;
  color: var(--color-danger, #d14343);
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
