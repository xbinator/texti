<!--
  @file ConversationView.vue
  @description 聊天消息列表视图，负责消息气泡渲染、滚动到底部和空态展示。
-->
<template>
  <div class="conversation-view">
    <div class="conversation-view__main">
      <div ref="container" class="conversation-view__container">
        <div class="conversation-view__placeholder"></div>
        <div class="conversation-view__content">
          <MessageBubble
            v-for="item in messages"
            :key="item.id"
            :session-id="sessionId"
            :message="item"
            :disabled="disabled"
            :can-rollback="canRollback"
            :submit-action="submitAction"
            @edit="$emit('edit', item)"
            @branch="handleBranch"
            @regenerate="$emit('regenerate', item)"
            @rollback="$emit('rollback', item)"
          />

          <slot name="footer"></slot>
        </div>
      </div>
    </div>

    <div
      class="to-bottom"
      :class="{ 'to-bottom--visible': isBackBottom }"
      @click="() => scrollToBottom()"
      @mouseenter="pauseBackBottomHideTimer"
      @mouseleave="resumeBackBottomHideTimer"
    >
      <BIcon icon="lucide:arrow-down" />
      <div v-if="loading" class="to-bottom__loading"></div>
    </div>

    <div v-if="!messages.length" class="conversation-view__empty">
      <div class="conversation-view__title">开始对话</div>
      <div class="conversation-view__text">输入你的问题，跟助手聊聊吧</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { SubmitAction } from '../utils/submitAction';
import type { Message } from '../utils/types';
import { toRef } from 'vue';
import { useChatScroll } from '../hooks/useChatScroll';
import MessageBubble from './MessageBubble.vue';

defineOptions({ name: 'ConversationView' });

/** ConversationView 组件属性。 */
interface Props {
  /** 当前权威 Session 身份。 */
  sessionId: string | null;
  // 对话消息列表
  messages: Message[];
  // 是否正在加载历史记录
  loading?: boolean;
  // 加载历史记录的回调函数
  onLoadHistory?: () => Promise<void> | void;
  // 会话已结束时禁用交互（如 QuestionCard）
  disabled?: boolean;
  /** 判断消息是否可回退 */
  canRollback?: (message: Message) => boolean;
  /** 可 await 的统一提交函数，用于让运行态组件等待宿主提交完成。 */
  submitAction?: (action: SubmitAction) => Promise<void> | void;
}

const props = withDefaults(defineProps<Props>(), {
  loading: false,
  onLoadHistory: undefined,
  disabled: false,
  canRollback: undefined,
  submitAction: undefined
});

const emit = defineEmits<{
  (e: 'edit', message: Message): void;
  (e: 'branch', message: Message): void;
  (e: 'regenerate', message: Message): void;
  (e: 'load-history'): void;
  (e: 'rollback', message: Message): void;
}>();

/**
 * 将消息气泡的分支请求传递给聊天容器。
 * @param message - 目标助手消息
 */
function handleBranch(message: Message): void {
  emit('branch', message);
}

const { isBackBottom, scrollToBottom, pauseBackBottomHideTimer, resumeBackBottomHideTimer } = useChatScroll({
  keepBackBottomVisible: toRef(props, 'loading'),
  onLoadHistory: props.onLoadHistory
});

defineExpose({ scrollToBottom });
</script>

<style scoped lang="less">
@import url('@/assets/styles/scrollbar.less');

.conversation-view {
  position: relative;
  flex: 1;
  height: 0;
}

.conversation-view__main {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.conversation-view__container {
  display: flex;
  flex-direction: column-reverse;
  height: 100%;
  padding: 12px 6px 12px 12px;
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
  user-select: none;
  transform: translate(-50%, -50%);
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
  white-space: nowrap;
}

/* 使用悬浮指示器主题变量，保证亮暗主题下都有清晰层次。 */
.to-bottom {
  position: absolute;
  bottom: 20px;
  left: 50%;
  z-index: 2;
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
  background: var(--hover-indicator-bg);
  border: 1px solid var(--hover-indicator-border);
  border-radius: 50%;
  box-shadow: var(--shadow-md);
  opacity: 0;
  backdrop-filter: blur(8px);
  transform: translateX(-50%);
  transition: opacity 0.2s ease, border-color 0.2s ease, transform 0.2s ease;

  &:hover {
    border-color: var(--hover-indicator-hover-border);
    transform: translateX(-50%) translateY(-1px);
  }
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
