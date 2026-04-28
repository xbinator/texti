<template>
  <div class="b-chat-sidebar">
    <div class="b-chat-sidebar__header">
      <div class="b-chat-sidebar__title truncate">{{ currentSession?.title || '新会话' }}</div>
      <BButton square size="small" type="text" :disabled="chatStream.loading.value" @click="handleNewSession">
        <Icon icon="lucide:message-circle-plus" width="16" height="16" />
      </BButton>
      <SessionHistory
        ref="sessionHistoryRef"
        v-model:current-session="currentSession"
        :active-session-id="settingStore.chatSidebarActiveSessionId"
        :disabled="chatStream.loading.value"
        @switch-session="handleSwitchSession"
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
        :loading="chatStream.loading.value"
        :on-load-history="handleLoadHistory"
        @edit="handleChatEdit"
        @regenerate="handleChatRegenerate"
        @confirmation-action="handleConfirmationAction"
        @user-choice-submit="handleChatUserChoiceSubmit"
      />

      <div class="b-chat-sidebar__input">
        <div class="b-chat-sidebar__input-container">
          <BPromptEditor
            ref="promptEditorRef"
            v-model:value="inputValue"
            placeholder="输入消息..."
            :max-height="200"
            :chip-resolver="chipResolver"
            :on-paste-files="onPasteFiles"
            submit-on-enter
            @submit="handleChatSubmit"
          />

          <InputToolbar
            :loading="chatStream.loading.value"
            :input-value="inputValue"
            :selected-model="selectedModel"
            @submit="handleChatSubmit"
            @abort="chatStream.abort"
            @model-change="handleModelChange"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { FileReferenceChip } from './types';
import type { ChatMessageConfirmationAction, ChatMessageFileReference, ChatSession } from 'types/chat';
import { nextTick, onMounted, onUnmounted, ref } from 'vue';
import { Icon } from '@iconify/vue';
import { nanoid } from 'nanoid';
import { createBuiltinTools } from '@/ai/tools/builtin';
import { editorToolContextRegistry } from '@/ai/tools/editor-context';
import { getDefaultChatToolNames } from '@/ai/tools/policy';
import BButton from '@/components/BButton/index.vue';
import { chipResolver } from '@/components/BChatSidebar/utils/chipResolver';
import { create, userChoice } from '@/components/BChatSidebar/utils/messageHelper';
import { persistReferenceSnapshots } from '@/components/BChatSidebar/utils/referenceSnapshot';
import type { Message } from '@/components/BChatSidebar/utils/types';
import BPromptEditor from '@/components/BPromptEditor/index.vue';
import { onChatFileReferenceInsert, type ChatFileReferenceInsertPayload } from '@/shared/chat/fileReference';
import { serviceModelsStorage } from '@/shared/storage';
import { useChatStore } from '@/stores/chat';
import { useSettingStore } from '@/stores/setting';
import ConversationView from './components/ConversationView.vue';
import InputToolbar from './components/InputToolbar.vue';
import SessionHistory from './components/SessionHistory.vue';
import { useChatHistory } from './hooks/useChatHistory';
import { useChatStream } from './hooks/useChatStream';
import { createChatConfirmationController } from './utils/confirmationController';

/**
 * 文件粘贴/拖拽回调，将文件列表转换为 file-ref token（无选区，startLine/endLine 均为 0）。
 */
const onPasteFiles = (files: File[]): string => {
  return Array.from(files)
    .map((file) => `{{file-ref:${encodeURIComponent(file.name)}|${file.name}|0|0}} `)
    .join('');
};

/** 聊天数据存储 */
const chatStore = useChatStore();
/** 应用设置存储 */
const settingStore = useSettingStore();

/** 聊天输入框内容 */
const inputValue = ref('');
/** 当前会话信息 */
const currentSession = ref<ChatSession | undefined>(undefined);
/** 会话加载状态 */
const loading = ref(false);
/** 历史消息加载状态 */
const historyLoading = ref(false);
/** 是否还有更多历史消息可加载 */
const hasMoreHistory = ref(false);
/** 输入框编辑器引用 */
const promptEditorRef = ref<InstanceType<typeof BPromptEditor>>();
/** 对话视图引用 */
const conversationRef = ref<InstanceType<typeof ConversationView>>();
/** 草稿文件引用列表 */
const draftReferences = ref<ChatMessageFileReference[]>([]);
/** 当前选中的模型 */
const selectedModel = ref<string>();

/** 聊天历史加载状态和方法 */
const { getHistoryCursor, setLoadedMessages, fetchAllPriorHistory, messages } = useChatHistory();

/** 确认控制器，管理工具调用的用户确认流程 */
const confirmationController = createChatConfirmationController({
  getMessages: () => messages.value
});

let unregisterFileReferenceInsert: (() => void) | null = null;

/**
 * 加载当前选中的模型配置
 */
async function loadSelectedModel(): Promise<void> {
  const config = await serviceModelsStorage.getConfig('chat');
  selectedModel.value = config?.providerId && config?.modelId ? `${config.providerId}:${config.modelId}` : undefined;
}

/**
 * 聊天工具列表
 * 创建内置工具并过滤出默认允许的低风险工具，避免暴露替换类操作
 */
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
 * @param action - 用户操作
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
 * 消息重新生成前的处理函数
 * 1. 清理待处理的确认状态
 * 2. 加载当前可见消息之前的所有持久化历史
 * 3. 合并历史消息和新的消息列表并持久化
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
 * 消息发送前的处理函数
 * 1. 清理待处理的确认状态
 * 2. 如果没有激活会话则创建新会话
 * 3. 将消息持久化到存储
 * @param message - 待发送的消息
 */
async function handleBeforeSend(message: Message): Promise<void> {
  confirmationController.expirePendingConfirmation();
  await persistReferenceSnapshots(message);

  if (!settingStore.chatSidebarActiveSessionId) {
    const session = await chatStore.createSession('assistant', { title: message.content });

    settingStore.setChatSidebarActiveSessionId(session.id);
  }

  await chatStore.addSessionMessage(settingStore.chatSidebarActiveSessionId, message);
}

/**
 * 消息完成后的处理函数
 * 将 AI 回复的消息持久化到存储
 * @param message - 完成的消息
 */
async function handleComplete(message: Message): Promise<void> {
  await chatStore.addSessionMessage(settingStore.chatSidebarActiveSessionId, message);
}

/**
 * 聊天流式处理 hook
 */
const chatStream = useChatStream({
  messages,
  tools,
  getToolContext: editorToolContextRegistry.getCurrentContext,
  onBeforeRegenerate: handleBeforeRegenerate,
  onComplete: handleComplete,
  onConfirmationAction: handleConfirmationAction
});

/**
 * 获取内容中活跃的草稿文件引用
 * @param content - 输入内容
 * @returns 活跃的引用列表
 */
function getActiveDraftReferences(content: string) {
  const references = draftReferences.value.filter((reference) => content.includes(reference.token));

  return references.length ? references : undefined;
}

async function handleChatSubmit(): Promise<void> {
  const content = inputValue.value.trim();
  if (!content) return;

  const config = await chatStream.resolveServiceConfig();
  if (!config) return;

  const references = getActiveDraftReferences(content);
  const message = create.userMessage(content, references);

  await handleBeforeSend(message);
  messages.value.push(message);
  conversationRef.value?.scrollToBottom({ behavior: 'auto' });
  promptEditorRef.value?.focus();
  inputValue.value = '';
  draftReferences.value = [];

  await chatStream.streamMessages(messages.value, config);
}

function handleChatEdit(message: Message): void {
  inputValue.value = message.content;
  draftReferences.value = [...(message.references ?? [])];
}

async function handleChatRegenerate(message: Message): Promise<void> {
  await chatStream.regenerate(message);
}

async function handleChatUserChoiceSubmit(answer: import('types/chat').AIUserChoiceAnswerData): Promise<void> {
  await chatStream.submitUserChoice(answer);
}

function handleFocusInput(): void {
  promptEditorRef.value?.focus();
}

function handleCaptureInputCursor(): void {
  promptEditorRef.value?.saveCursorPosition();
}

/**
 * 将 startLine/endLine 转换为 ChatMessageFileReference.line 字符串格式。
 * @param startLine - 起始行号
 * @param endLine - 结束行号
 */
function formatLineRange(startLine: number, endLine: number): string {
  if (startLine <= 0) {
    return '';
  }

  return startLine === endLine ? String(startLine) : `${startLine}-${endLine}`;
}

function handleChatInsertFileReference(reference: FileReferenceChip): void {
  const token = `{{file-ref:${reference.referenceId}|${reference.fileName}|${reference.startLine}|${reference.endLine}}} `;
  draftReferences.value = [
    ...draftReferences.value.filter((item) => item.id !== reference.referenceId),
    {
      id: reference.referenceId,
      token,
      documentId: reference.documentId,
      fileName: reference.fileName,
      line: formatLineRange(reference.startLine, reference.endLine),
      path: reference.filePath,
      snapshotId: ''
    }
  ];
  promptEditorRef.value?.insertTextAtCursor(token);
}

async function handleFileReferenceInsert(reference: ChatFileReferenceInsertPayload): Promise<void> {
  const toolContext = editorToolContextRegistry.getCurrentContext();
  const enrichedReference: FileReferenceChip = {
    referenceId: nanoid(),
    documentId: toolContext?.document.id || reference.filePath || reference.fileName,
    filePath: reference.filePath ?? toolContext?.document.path ?? null,
    fileName: reference.fileName,
    startLine: reference.startLine,
    endLine: reference.endLine
  };

  // 先锁定聊天输入框最近一次有效插入位置，再处理侧边栏聚焦与引用插入。
  handleCaptureInputCursor();
  settingStore.setSidebarVisible(true);

  await nextTick();
  handleChatInsertFileReference(enrichedReference);
  handleFocusInput();
}

function handleModelChange(value: string): void {
  selectedModel.value = value;
}

/**
 * 创建新会话
 * 1. 检查是否正在输出，是则中断
 * 2. 清理确认控制器状态
 * 3. 重置会话相关状态
 * 4. 自动聚焦输入框
 */
async function handleNewSession(): Promise<void> {
  if (chatStream.loading.value) return;

  confirmationController.dispose();
  settingStore.setChatSidebarActiveSessionId(null);
  messages.value = [];
  hasMoreHistory.value = false;
  historyLoading.value = false;
  // 新会话创建后自动聚焦输入框，提升用户体验
  await nextTick();
  promptEditorRef.value?.focus();
}

/**
 * 切换会话
 * 1. 检查是否正在输出或加载中，是则中断
 * 2. 清理确认控制器状态
 * 3. 更新激活会话 ID
 * 4. 加载新会话的消息列表
 * @param sessionId - 目标会话 ID
 */
async function handleSwitchSession(sessionId: string): Promise<void> {
  if (chatStream.loading.value) return;
  if (loading.value) return;

  loading.value = true;
  confirmationController.dispose();
  settingStore.setChatSidebarActiveSessionId(sessionId);
  hasMoreHistory.value = false;

  try {
    setLoadedMessages(await chatStore.getSessionMessages(sessionId));
  } finally {
    loading.value = false;
  }
}

/**
 * 加载当前会话中更早的一段历史消息。
 */
async function handleLoadHistory(): Promise<void> {
  if (historyLoading.value || !hasMoreHistory.value) return;

  const sessionId = settingStore.chatSidebarActiveSessionId;
  const cursor = getHistoryCursor();
  if (!sessionId || !cursor) return;

  historyLoading.value = true;

  try {
    const historyMessages = await chatStore.getSessionMessages(sessionId, cursor);
    hasMoreHistory.value = historyMessages.length > 0;
    if (!historyMessages.length) return;

    messages.value = [...historyMessages, ...messages.value];
  } finally {
    historyLoading.value = false;
  }
}

onMounted(async () => {
  loadSelectedModel();
  if (settingStore.chatSidebarActiveSessionId) {
    setLoadedMessages(await chatStore.getSessionMessages(settingStore.chatSidebarActiveSessionId));
  }

  unregisterFileReferenceInsert = onChatFileReferenceInsert((reference) => {
    handleFileReferenceInsert(reference);
  });
});

/** 组件卸载时清理确认控制器 */
onUnmounted(() => {
  unregisterFileReferenceInsert?.();
  unregisterFileReferenceInsert = null;
  confirmationController.dispose();
});
</script>

<style lang="less">
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

  .b-prompt-editor {
    flex: 1;
    min-width: 0;
    padding: 0;
    background-color: transparent;
    border: none;
    border-radius: 0;

    &:focus-within {
      box-shadow: none;
    }
  }
}
</style>
