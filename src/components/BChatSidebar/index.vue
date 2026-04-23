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
      <BChat
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
      </BChat>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * @file BChatSidebar/index.vue
 * @description 聊天侧边栏，负责会话列表切换、会话持久化和聊天面板接入。
 */
import type { ChatMessageConfirmationAction, ChatMessageHistoryCursor, ChatSession } from 'types/chat';
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { Icon } from '@iconify/vue';
import { createBuiltinTools } from '@/ai/tools/builtin';
import { editorToolContextRegistry } from '@/ai/tools/editor-context';
import { getDefaultChatToolNames } from '@/ai/tools/policy';
import { findPendingUserChoiceQuestion } from '@/components/BChat/message';
import type { Message } from '@/components/BChat/types';
import { useChatStore } from '@/stores/chat';
import { useSettingStore } from '@/stores/setting';
import SessionHistory from './components/SessionHistory.vue';
import { createChatConfirmationController } from './utils/confirmationController';

const CHAT_SESSION_TYPE = 'assistant';

const chatStore = useChatStore();
const settingStore = useSettingStore();

const inputValue = ref('');
const messages = ref<Message[]>([]);
const sessions = ref<ChatSession[]>([]);
const loading = ref(false);
const historyLoading = ref(false);
const hasMoreHistory = ref(false);
const chatBusy = ref(false);
const chatRef = ref<{ focusInput: () => void } | null>(null);
const confirmationController = createChatConfirmationController({
  getMessages: () => messages.value
});
const currentSession = computed<ChatSession | undefined>(() => {
  const activeSessionId = settingStore.chatSidebarActiveSessionId;
  if (!activeSessionId) {
    return undefined;
  }

  return sessions.value.find((session) => session.id === activeSessionId);
});
const tools = createBuiltinTools({
  confirm: confirmationController.createAdapter(),
  getPendingQuestion: () => {
    const pendingQuestion = findPendingUserChoiceQuestion(messages.value);
    if (!pendingQuestion) {
      return null;
    }

    return {
      questionId: pendingQuestion.questionId,
      toolCallId: pendingQuestion.toolCallId
    };
  }
}).filter((tool) => {
  // MVP 聊天侧先只开放低风险工具，避免默认暴露替换类操作。
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

async function handleBeforeSend(message: Message): Promise<void> {
  confirmationController.expirePendingConfirmation();

  if (!settingStore.chatSidebarActiveSessionId) {
    const session = await chatStore.createSession(CHAT_SESSION_TYPE, { title: message.content });

    settingStore.setChatSidebarActiveSessionId(session.id);
    sessions.value.unshift(session);
  }

  await chatStore.addSessionMessage(settingStore.chatSidebarActiveSessionId, message);
}

async function handleBeforeRegenerate(nextMessages: Message[]): Promise<void> {
  confirmationController.expirePendingConfirmation();
  const sessionId = settingStore.chatSidebarActiveSessionId;
  if (!sessionId) return;

  const historyMessages = await loadPersistedMessagesBeforeVisible(sessionId);
  await chatStore.setSessionMessages(sessionId, [...historyMessages, ...nextMessages]);
}

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

async function handleNewSession(): Promise<void> {
  if (chatBusy.value) return;

  confirmationController.dispose();
  settingStore.setChatSidebarActiveSessionId(null);
  messages.value = [];
  hasMoreHistory.value = false;
  historyLoading.value = false;
  inputValue.value = '';
  // 新会话创建后自动聚焦输入框，提升用户体验。
  await nextTick();
  chatRef.value?.focusInput();
}

async function loadSessions(): Promise<void> {
  sessions.value = await chatStore.getSessions(CHAT_SESSION_TYPE);

  if (!settingStore.chatSidebarActiveSessionId) {
    return;
  }

  const activeSession = sessions.value.find((session) => session.id === settingStore.chatSidebarActiveSessionId);
  if (!activeSession) {
    settingStore.setChatSidebarActiveSessionId(null);
    return;
  }

  setLoadedMessages(await chatStore.getSessionMessages(activeSession.id));
}

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

async function handleDeleteSession(sessionId: string): Promise<void> {
  if (chatBusy.value) return;

  const index = sessions.value.findIndex((session) => session.id === sessionId);
  if (index === -1) return;

  sessions.value.splice(index, 1);

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

onMounted(loadSessions);
onUnmounted(() => {
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
