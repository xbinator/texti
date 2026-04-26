<template>
  <div class="conversation-view">
    <div ref="container" class="conversation-view__container">
      <div class="conversation-view__placeholder"></div>
      <div class="conversation-view__content">
        <MessageBubble
          v-for="item in messages"
          :key="item.id"
          :message="item"
          @edit="$emit('edit', item)"
          @regenerate="$emit('regenerate', item)"
          @confirmation-action="(confirmationId, action) => $emit('confirmation-action', confirmationId, action)"
          @user-choice-submit="$emit('user-choice-submit', $event)"
        />
      </div>
    </div>

    <div class="to-bottom" :class="{ 'to-bottom--visible': isBackBottom }" @click="() => scrollToBottom()">
      <Icon icon="lucide:arrow-down" />
      <div v-if="loading" class="to-bottom__loading"></div>
    </div>

    <div v-if="!messages.length" class="conversation-view__empty">
      <div class="conversation-view__art" aria-hidden="true">
        <div class="conversation-view__card conversation-view__card--back"></div>
        <div class="conversation-view__card conversation-view__card--front">
          <Icon icon="lucide:messages-square" width="26" height="26" />
        </div>
      </div>
      <div class="conversation-view__title">开始对话</div>
      <div class="conversation-view__text">输入你的问题，跟助手聊聊吧</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Message } from '../utils/types';
import type { ChatMessageConfirmationAction, AIUserChoiceAnswerData } from 'types/chat';
import { Icon } from '@iconify/vue';
import { useChatScroll } from '../hooks/useChatScroll';
import MessageBubble from './MessageBubble.vue';

defineOptions({ name: 'ConversationView' });

const props = defineProps<{
  messages: Message[];
  loading?: boolean;
  onLoadHistory?: () => Promise<void> | void;
}>();

defineEmits<{
  (e: 'edit', message: Message): void;
  (e: 'regenerate', message: Message): void;
  (e: 'load-history'): void;
  (e: 'confirmation-action', confirmationId: string, action: ChatMessageConfirmationAction): void;
  (e: 'user-choice-submit', answer: AIUserChoiceAnswerData): void;
}>();

const { isBackBottom, scrollToBottom } = useChatScroll({ onLoadHistory: props.onLoadHistory });

defineExpose({ scrollToBottom });
</script>

<style scoped lang="less">
@import url('@/assets/styles/scrollbar.less');

.conversation-view {
  position: relative;
  flex: 1;
  height: 0;
}

.conversation-view__container {
  display: flex;
  flex-direction: column-reverse;
  height: 100%;
  padding: var(--b-chat-padding, 16px);
  overflow-y: auto;
  scrollbar-gutter: stable;

  .scrollbar-style();
}

.conversation-view__content {
  width: 100%;
  max-width: var(--b-chat-max-width, 800px);
  margin: 0 auto;
}

.conversation-view__placeholder {
  flex: 1;
  pointer-events: none;
}

.conversation-view__empty {
  position: absolute;
  top: 50%;
  left: 50%;
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: center;
  justify-content: center;
  text-align: center;
  transform: translate(-50%, -50%);
}

.conversation-view__art {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 136px;
  height: 136px;
}

.conversation-view__card {
  position: absolute;
  border: 1px solid var(--border-primary);
  border-radius: 24px;
  box-shadow: 0 18px 38px rgb(53 43 33 / 8%);
  backdrop-filter: blur(12px);
}

.conversation-view__card--back {
  width: 66px;
  height: 82px;
  background: linear-gradient(180deg, var(--bg-elevated), var(--bg-secondary));
  transform: translate(-24px, 8px) rotate(-10deg);
}

.conversation-view__card--front {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 82px;
  height: 98px;
  color: var(--color-primary);
  background: linear-gradient(180deg, var(--bg-elevated), var(--bg-tertiary));
  transform: translate(18px, -6px) rotate(8deg);
}

.conversation-view__title {
  font-size: 16px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--text-primary);
}

.conversation-view__text {
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-secondary);
}

.to-bottom {
  position: absolute;
  bottom: 20px;
  left: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  font-size: 18px;
  color: var(--color-primary);
  pointer-events: none;
  cursor: pointer;
  user-select: none;
  background: var(--bg-primary);
  border-radius: 50%;
  box-shadow: 0 0 4px 0 rgb(0 0 0 / 2%), 0 6px 10px 0 rgb(47 53 64 / 10%);
  opacity: 0;
  transform: translateX(-50%);
  transition: opacity 0.2s ease;
}

.to-bottom--visible {
  pointer-events: auto;
  opacity: 1;
}

.to-bottom__loading {
  position: absolute;
  width: 44px;
  height: 44px;
  border: 2px solid var(--border-secondary);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: to-bottom-loading 1s linear infinite;
}

@keyframes to-bottom-loading {
  0% {
    transform: rotate(0deg);
  }

  100% {
    transform: rotate(360deg);
  }
}
</style>
