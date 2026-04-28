<template>
  <div :class="bem({ error: isErrorMessage })">
    <BBubble :placement="bubblePlacement" :loading="message.loading" :size="message.role === 'user' ? 'auto' : 'fill'">
      <template v-if="showHeader" #header>
        <div :class="bem('header')">
          <div v-if="imageFiles.length" :class="bem('images')">
            <img v-for="file in imageFiles" :key="file.id" :src="file.url || file.path" :alt="file.name" :class="bem('image')" />
          </div>
          <div v-if="otherFiles.length" :class="bem('files')">
            <div v-for="file in otherFiles" :key="file.id" :class="bem('file')">
              <Icon icon="lucide:file" width="14" height="14" />
              <span :class="bem('file-name')">{{ file.name }}</span>
            </div>
          </div>
        </div>
      </template>

      <div :class="bem('parts')">
        <template v-for="(part, index) in message.parts" :key="`${part.type}-${index}`">
          <BubblePartText
            v-if="part.type === 'text'"
            :part="part"
            :loading="isLastPart(index) && !!message.loading"
            :enable-file-reference-chips="isUserMessage"
            :references="message.references"
          />

          <BubblePartThinking v-else-if="part.type === 'thinking'" :part="part" />

          <BubblePartToolCall v-else-if="part.type === 'tool-call'" :part="part" />

          <ConfirmationCard
            v-else-if="part.type === 'confirmation'"
            :part="part"
            @confirmation-action="$emit('confirmation-action', $event.confirmationId, $event.action)"
          />

          <AskUserChoiceCard v-else-if="isAwaitingUserChoicePart(part)" :question="part.result.data" @submit-choice="$emit('user-choice-submit', $event)" />
          <BubblePartToolResult v-else :part="part" />
        </template>
      </div>
    </BBubble>

    <!-- 助手消息工具栏 -->
    <div v-if="message.finished && isAssistantMessage" :class="bem('toolbar')">
      <BButton type="text" size="small" square icon="lucide:copy" @click="handleCopy(message)" />
      <BButton v-if="isAssistantMessage" square type="text" size="small" icon="lucide:refresh-cw" @click="$emit('regenerate', message)" />
    </div>

    <!-- 用户消息底部：时间戳 + 复制按钮（hover 可见） -->
    <div v-if="isUserMessage && message.finished" :class="bem('toolbar', { right: isUserMessage })">
      <span :class="bem('time')">{{ formatMessageTime(message.createdAt) }}</span>
      <BButton type="text" size="small" square icon="lucide:copy" @click="handleCopy(message)" />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * @file MessageBubble.vue
 * @description 聊天气泡组件，按结构化消息片段渲染文本、思考、工具调用和工具结果。
 */
import type { Message } from '../utils/types';
import type { AIToolExecutionAwaitingUserInputResult } from 'types/ai';
import type { AIUserChoiceAnswerData, ChatMessageConfirmationAction, ChatMessagePart, ChatMessageToolResultPart } from 'types/chat';
import { computed } from 'vue';
import { Icon } from '@iconify/vue';
import BBubble from '@/components/BBubble/index.vue';
import BButton from '@/components/BButton/index.vue';
import { useClipboard } from '@/hooks/useClipboard';
import { createNamespace } from '@/utils/namespace';
import { formatMessageTime } from '../utils/timeFormat';
import AskUserChoiceCard from './AskUserChoiceCard.vue';
import ConfirmationCard from './ConfirmationCard.vue';
import BubblePartText from './MessageBubble/BubblePartText.vue';
import BubblePartThinking from './MessageBubble/BubblePartThinking.vue';
import BubblePartToolCall from './MessageBubble/BubblePartToolCall.vue';
import BubblePartToolResult from './MessageBubble/BubblePartToolResult.vue';

defineOptions({ name: 'MessageBubble' });

const { clipboard } = useClipboard();

const [, bem] = createNamespace('', 'message-bubble');

const props = defineProps<{ message: Message }>();

defineEmits<{
  (e: 'edit', message: Message): void;
  (e: 'regenerate', message: Message): void;
  (e: 'confirmation-action', confirmationId: string, action: ChatMessageConfirmationAction): void;
  (e: 'user-choice-submit', answer: AIUserChoiceAnswerData): void;
}>();

/** 图片文件列表（有 url 或 path 的图片类型文件） */
const imageFiles = computed(() => props.message.files?.filter((file) => file.type === 'image' && (file.url || file.path)) ?? []);
/** 非图片文件列表（非图片类型或无 url/path 的文件） */
const otherFiles = computed(() => props.message.files?.filter((file) => file.type !== 'image' || (!file.url && !file.path)) ?? []);
/** 是否为用户消息 */
const isUserMessage = computed(() => props.message.role === 'user');
/** 是否为助手消息 */
const isAssistantMessage = computed(() => props.message.role === 'assistant');
/** 是否为错误消息 */
const isErrorMessage = computed(() => props.message.role === 'error');
/** 气泡位置：助手和错误消息靠左，用户消息靠右 */
const bubblePlacement = computed(() => (isAssistantMessage.value || isErrorMessage.value ? 'left' : 'right'));
/** 是否显示头部（用户消息且有文件时显示） */
const showHeader = computed(() => isUserMessage.value && (imageFiles.value.length || otherFiles.value.length));

/**
 * 判断消息片段是否为最后一个片段。
 * @param index - 片段索引
 */
function isLastPart(index: number): boolean {
  return index === props.message.parts.length - 1;
}

/**
 * 判断片段是否为等待用户选择的工具结果。
 * @param part - 消息片段
 */
function isAwaitingUserChoicePart(part: ChatMessagePart): part is ChatMessageToolResultPart & { result: AIToolExecutionAwaitingUserInputResult } {
  return part.type === 'tool-result' && part.toolName === 'ask_user_choice' && part.result.status === 'awaiting_user_input';
}

/**
 * 复制消息内容
 * @param message - 待复制的聊天消息
 */
function handleCopy(message: Message): void {
  clipboard(message.content, { successMessage: '已复制到剪贴板' });
}
</script>

<style scoped lang="less">
.message-bubble {
  display: flex;
  flex-direction: column;
  margin-bottom: 16px;

  &:hover {
    .message-bubble__toolbar {
      opacity: 1;
    }
  }
}

.message-bubble:last-child {
  margin-bottom: 0;
}

.message-bubble__header {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.message-bubble__images {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.message-bubble__image {
  max-width: 200px;
  max-height: 200px;
  object-fit: cover;
  border-radius: 8px;
}

.message-bubble__files {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.message-bubble__file {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  max-width: 220px;
  padding: 6px 10px;
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: 999px;
}

.message-bubble__file-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.message-bubble__parts {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.message-bubble__toolbar {
  display: flex;
  gap: 6px;
  align-items: center;
  margin-top: 6px;

  &.message-bubble__toolbar--right {
    justify-content: flex-end;
    opacity: 0;
    transition: opacity 0.15s ease;
  }
}

.message-bubble__time {
  font-size: 11px;
  color: var(--text-disabled);
  user-select: none;
}
</style>
