<template>
  <div class="editor-sidebar">
    <div class="sidebar-header">
      <BButton square size="small" type="text" @click="handleNewSession">
        <Icon icon="lucide:message-circle-plus" width="16" height="16" />
      </BButton>
      <SessionHistory :sessions="sessions" :active-session-id="activeSessionId" @delete-session="handleDeleteSession" @switch-session="handleSwitchSession" />
    </div>
    <div class="chat-sidebar-container">
      <BChat
        v-model:messages="messages"
        v-model:input-value="inputValue"
        placeholder="输入消息..."
        :on-before-send="handleBeforeSend"
        :on-before-regenerate="handleBeforeRegenerate"
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
import type { ChatSession } from 'types/chat';
import { onMounted, ref } from 'vue';
import { Icon } from '@iconify/vue';
import type { Message } from '@/components/BChat/types';
import { useChatStore } from '@/stores/chat';
import SessionHistory from './components/SessionHistory.vue';

const CHAT_SESSION_TYPE = 'assistant';

const chatStore = useChatStore();

const inputValue = ref('');
const activeSessionId = ref<string | null>(null);
const messages = ref<Message[]>([]);
const sessions = ref<ChatSession[]>([]);
const loading = ref(false);

async function handleBeforeSend(message: Message): Promise<void> {
  if (!activeSessionId.value) {
    const session = await chatStore.createSession(CHAT_SESSION_TYPE, { title: message.content });

    activeSessionId.value = session.id;
    sessions.value.unshift(session);
  }

  await chatStore.addSessionMessage(activeSessionId.value, message);
}

async function handleBeforeRegenerate(nextMessages: Message[]): Promise<void> {
  await chatStore.setSessionMessages(activeSessionId.value, nextMessages);
}

async function handleComplete(message: Message): Promise<void> {
  await chatStore.addSessionMessage(activeSessionId.value, message);
}

async function handleNewSession(): Promise<void> {
  activeSessionId.value = null;
  messages.value = [];
}

async function loadSessions(): Promise<void> {
  sessions.value = await chatStore.getSessions(CHAT_SESSION_TYPE);
}

async function handleSwitchSession(sessionId: string): Promise<void> {
  if (loading.value) return;

  loading.value = true;
  activeSessionId.value = sessionId;

  messages.value = await chatStore.getSessionMessages(sessionId);
  loading.value = false;
}

async function handleDeleteSession(sessionId: string): Promise<void> {
  const index = sessions.value.findIndex((session) => session.id === sessionId);
  if (index === -1) return;

  sessions.value.splice(index, 1);

  if (activeSessionId.value === sessionId) {
    await handleNewSession();
  }
}

onMounted(loadSessions);
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

  :deep(.b-bubble--left .b-bubble__container) {
    padding: 12px 0 0;
  }
}

.sidebar-header {
  display: flex;
  gap: 4px;
  justify-content: flex-end;
  padding: 8px;
  border-bottom: 1px solid var(--border-color);
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
