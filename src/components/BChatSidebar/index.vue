<template>
  <div class="editor-sidebar">
    <div class="sidebar-header">
      <div class="sidebar-header__title truncate">{{ currentSession?.title || '新会话' }}</div>
      <BButton square size="small" type="text" :disabled="chatBusy" @click="handleNewSession">
        <Icon icon="lucide:message-circle-plus" width="16" height="16" />
      </BButton>
      <SessionHistory
        :sessions="sessions"
        :active-session-id="settingStore.chatSidebarActiveSessionId"
        :disabled="chatBusy"
        @delete-session="handleDeleteSession"
        @switch-session="handleSwitchSession"
      />
    </div>
    <div class="chat-sidebar-container">
      <ChatPanel
        ref="chatRef"
        v-model:messages="messages"
        v-model:input-value="inputValue"
        placeholder="输入消息..."
        :on-before-send="handleBeforeSend"
        :on-before-regenerate="handleBeforeRegenerate"
        :on-load-history="handleLoadHistory"
        :on-confirmation-action="handleConfirmationAction"
        :tools="tools"
        :get-tool-context="editorToolContextRegistry.getCurrentContext"
        @busy-change="handleChatBusyChange"
        @complete="handleComplete"
      >
        <template #empty>
          <div class="chat-sidebar-empty">
            <div class="chat-sidebar-empty__art" aria-hidden="true">
              <div class="chat-sidebar-empty__card chat-sidebar-empty__card--back"></div>
              <div class="chat-sidebar-empty__card chat-sidebar-empty__card--front">
                <Icon icon="lucide:messages-square" width="26" height="26" />
              </div>
            </div>
            <div class="chat-sidebar-empty__title">开始对话</div>
            <div class="chat-sidebar-empty__text">输入你的问题，跟助手聊聊吧</div>
          </div>
        </template>
      </ChatPanel>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * @file BChatSidebar/index.vue
 * @description 聊天侧边栏组件，负责会话列表切换、会话持久化和聊天面板接入。
 *              支持多会话管理、历史消息加载、流式输出和工具调用确认。
 */
import type { ChatMessageConfirmationAction, ChatMessageHistoryCursor, ChatReferenceSnapshot, ChatSession } from 'types/chat';
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { Icon } from '@iconify/vue';
import { nanoid } from 'nanoid';
import { createBuiltinTools } from '@/ai/tools/builtin';
import { editorToolContextRegistry } from '@/ai/tools/editor-context';
import { getDefaultChatToolNames } from '@/ai/tools/policy';
import { userChoice } from '@/components/BChatSidebar/utils/message';
import type { Message } from '@/components/BChatSidebar/utils/types';
import type { FileReferenceChip } from '@/components/BPromptEditor/hooks/useVariableEncoder';
import { onChatFileReferenceInsert, type ChatFileReferenceInsertPayload } from '@/shared/chat/fileReference';
import { chatStorage } from '@/shared/storage';
import { useChatStore } from '@/stores/chat';
import { useSettingStore } from '@/stores/setting';
import ChatPanel from './components/ChatPanel.vue';
import SessionHistory from './components/SessionHistory.vue';
import { createChatConfirmationController } from './utils/confirmationController';

/** 聊天会话类型标识 */
const CHAT_SESSION_TYPE = 'assistant';

/** 聊天数据存储 */
const chatStore = useChatStore();
/** 应用设置存储 */
const settingStore = useSettingStore();

/** 聊天输入框内容 */
const inputValue = ref('');
/** 当前会话的消息列表 */
const messages = ref<Message[]>([]);
/** 所有会话列表 */
const sessions = ref<ChatSession[]>([]);
/** 会话加载状态 */
const loading = ref(false);
/** 历史消息加载状态 */
const historyLoading = ref(false);
/** 是否还有更多历史消息可加载 */
const hasMoreHistory = ref(false);
/** 聊天是否正在输出（流式响应中） */
const chatBusy = ref(false);
/** 聊天组件引用，用于调用组件方法 */
const chatRef = ref<{ focusInput: () => void; captureInputCursor: () => void; insertFileReference: (reference: FileReferenceChip) => void } | null>(null);
/** 确认控制器，管理工具调用的用户确认流程 */
const confirmationController = createChatConfirmationController({
  getMessages: () => messages.value
});

let unregisterFileReferenceInsert: (() => void) | null = null;
/**
 * 当前激活的会话对象
 * 根据设置中存储的激活会话 ID 从会话列表中查找对应会话
 */
const currentSession = computed<ChatSession | undefined>(() => {
  const activeSessionId = settingStore.chatSidebarActiveSessionId;
  if (!activeSessionId) {
    return undefined;
  }

  return sessions.value.find((session) => session.id === activeSessionId);
});

/**
 * 聊天工具列表
 * 创建内置工具并过滤出默认允许的低风险工具，避免暴露替换类操作
 */
const tools = createBuiltinTools({
  confirm: confirmationController.createAdapter(),
  getPendingQuestion: () => {
    const pendingQuestion = userChoice.findPending(messages.value);
    if (!pendingQuestion) {
      return null;
    }

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
 * 根据当前已加载消息计算更早历史的加载游标。
 * @returns 历史加载游标，没有消息时返回 undefined
 */
function getHistoryCursor(): ChatMessageHistoryCursor | undefined {
  const firstMessage = messages.value[0];
  if (!firstMessage) {
    return undefined;
  }

  return { beforeCreatedAt: firstMessage.createdAt, beforeId: firstMessage.id };
}

/**
 * 用一段消息刷新当前会话的历史加载状态。
 * @param loadedMessages - 已加载消息
 */
function setLoadedMessages(loadedMessages: Message[]): void {
  messages.value = loadedMessages;
  hasMoreHistory.value = loadedMessages.length > 0;
}

/**
 * 读取当前可见消息之前的所有持久化历史，避免重新生成时覆盖未加载消息。
 * @param sessionId - 会话 ID
 * @returns 当前可见消息之前的历史消息
 */
async function loadPersistedMessagesBeforeVisible(sessionId: string): Promise<Message[]> {
  const historyMessages: Message[] = [];
  let cursor = getHistoryCursor();

  while (cursor) {
    // 顺序读取上一段历史，下一轮游标依赖本轮返回的最早消息。
    // eslint-disable-next-line no-await-in-loop
    const batchMessages = await chatStore.getSessionMessages(sessionId, cursor);
    if (!batchMessages.length) {
      break;
    }

    historyMessages.unshift(...batchMessages);
    const firstMessage = batchMessages[0];
    cursor = { beforeCreatedAt: firstMessage.createdAt, beforeId: firstMessage.id };
  }

  return historyMessages;
}

/**
 * Persists per-send document snapshots and binds snapshot ids back onto message references.
 * @param message - Pending user message.
 */
async function persistReferenceSnapshots(message: Message): Promise<void> {
  const toolContext = editorToolContextRegistry.getCurrentContext();
  if (!toolContext || !message.references?.length) {
    return;
  }

  const matchedReferences = message.references.filter((reference) => reference.documentId === toolContext.document.id);
  if (!matchedReferences.length) {
    return;
  }

  const snapshot: ChatReferenceSnapshot = {
    id: nanoid(),
    documentId: toolContext.document.id,
    title: toolContext.document.title,
    content: toolContext.document.getContent(),
    createdAt: new Date().toISOString()
  };

  matchedReferences.forEach((reference) => {
    reference.snapshotId = snapshot.id;
    reference.path = reference.path ?? toolContext.document.path;
  });

  await chatStorage.upsertReferenceSnapshots([snapshot]);
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
    // 没有激活会话时创建新会话，使用消息内容作为标题。
    const session = await chatStore.createSession(CHAT_SESSION_TYPE, { title: message.content });

    settingStore.setChatSidebarActiveSessionId(session.id);
    sessions.value.unshift(session);
  }

  await chatStore.addSessionMessage(settingStore.chatSidebarActiveSessionId, message);
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

  // 加载当前可见消息之前的历史，避免重新生成时覆盖未加载的消息
  const historyMessages = await loadPersistedMessagesBeforeVisible(sessionId);
  await chatStore.setSessionMessages(sessionId, [...historyMessages, ...nextMessages]);
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
 * 同步聊天组件的流式输出状态。
 * @param busy - 是否正在输出
 */
function handleChatBusyChange(busy: boolean): void {
  chatBusy.value = busy;
}

/**
 * 处理编辑器文件引用插入请求。
 * @param reference - 共享事件总线发出的文件引用插入载荷
 */
async function handleFileReferenceInsert(reference: ChatFileReferenceInsertPayload): Promise<void> {
  const toolContext = editorToolContextRegistry.getCurrentContext();
  const enrichedReference: FileReferenceChip = {
    referenceId: nanoid(),
    documentId: toolContext?.document.id || reference.filePath || reference.fileName,
    filePath: reference.filePath ?? toolContext?.document.path ?? null,
    fileName: reference.fileName,
    line: reference.line
  };

  // 先锁定聊天输入框最近一次有效插入位置，再处理侧边栏聚焦与引用插入。
  chatRef.value?.captureInputCursor();
  settingStore.setSidebarVisible(true);

  await nextTick();
  chatRef.value?.insertFileReference(enrichedReference);
  chatRef.value?.focusInput();
}

/**
 * 创建新会话
 * 1. 检查是否正在输出，是则中断
 * 2. 清理确认控制器状态
 * 3. 重置会话相关状态
 * 4. 自动聚焦输入框
 */
async function handleNewSession(): Promise<void> {
  if (chatBusy.value) return;

  confirmationController.dispose();
  settingStore.setChatSidebarActiveSessionId(null);
  messages.value = [];
  hasMoreHistory.value = false;
  historyLoading.value = false;
  // 新会话创建后自动聚焦输入框，提升用户体验
  await nextTick();
  chatRef.value?.focusInput();
}

/**
 * 加载所有会话列表
 * 1. 从存储获取会话列表
 * 2. 如果有激活会话 ID，验证并加载该会话的消息
 */
async function loadSessions(): Promise<void> {
  sessions.value = await chatStore.getSessions(CHAT_SESSION_TYPE);

  if (!settingStore.chatSidebarActiveSessionId) {
    return;
  }

  // 验证激活会话是否存在于列表中
  const activeSession = sessions.value.find((session) => session.id === settingStore.chatSidebarActiveSessionId);
  if (!activeSession) {
    settingStore.setChatSidebarActiveSessionId(null);
    return;
  }

  setLoadedMessages(await chatStore.getSessionMessages(activeSession.id));
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
  if (chatBusy.value) return;
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

/**
 * 删除会话
 * 1. 检查是否正在输出，是则中断
 * 2. 从会话列表中移除
 * 3. 如果删除的是当前激活会话，则创建新会话
 * @param sessionId - 要删除的会话 ID
 */
async function handleDeleteSession(sessionId: string): Promise<void> {
  if (chatBusy.value) return;

  const index = sessions.value.findIndex((session) => session.id === sessionId);
  if (index === -1) return;

  sessions.value.splice(index, 1);

  // 如果删除的是当前激活会话，清理状态并创建新会话
  if (settingStore.chatSidebarActiveSessionId === sessionId) {
    confirmationController.dispose();
    await handleNewSession();
  }
}

/**
 * 处理聊天流中的确认卡片操作。
 * @param confirmationId - 确认项 ID
 * @param action - 用户操作
 */
async function handleConfirmationAction(confirmationId: string, action: ChatMessageConfirmationAction): Promise<void> {
  if (action === 'approve') {
    confirmationController.approveConfirmation(confirmationId);
    return;
  }

  if (action === 'approve-session') {
    confirmationController.approveConfirmation(confirmationId, 'session');
    return;
  }

  if (action === 'approve-always') {
    confirmationController.approveConfirmation(confirmationId, 'always');
    return;
  }

  confirmationController.cancelConfirmation(confirmationId);
}

/** 组件挂载时加载会话列表并监听编辑器引用插入事件 */
onMounted(() => {
  loadSessions();
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

<style scoped lang="less">
.editor-sidebar {
  display: flex;
  flex-shrink: 0;
  flex-direction: column;
  height: 100%;
  margin-right: 6px;
  overflow: hidden;
  background: var(--bg-primary);
  border-radius: 8px;
}

.sidebar-header {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 8px 8px 8px 12px;
  border-bottom: 1px solid var(--border-color);
}

.sidebar-header__title {
  flex: 1;
  width: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
}

.chat-sidebar-container {
  flex: 1;
  height: 0;
}

.chat-sidebar-empty {
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 24px;
  text-align: center;
}

.chat-sidebar-empty__art {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 136px;
  height: 136px;
}

.chat-sidebar-empty__card {
  position: absolute;
  border: 1px solid var(--border-primary);
  border-radius: 24px;
  box-shadow: 0 18px 38px rgb(53 43 33 / 8%);
  backdrop-filter: blur(12px);
}

.chat-sidebar-empty__card--back {
  width: 66px;
  height: 82px;
  background: linear-gradient(180deg, var(--bg-elevated), var(--bg-secondary));
  transform: translate(-24px, 8px) rotate(-10deg);
}

.chat-sidebar-empty__card--front {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 82px;
  height: 98px;
  color: var(--color-primary);
  background: linear-gradient(180deg, var(--bg-elevated), var(--bg-tertiary));
  transform: translate(18px, -6px) rotate(8deg);
}

.chat-sidebar-empty__title {
  font-size: 16px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--text-primary);
}

.chat-sidebar-empty__text {
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-secondary);
}
</style>
