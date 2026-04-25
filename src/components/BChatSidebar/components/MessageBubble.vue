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
          <MessageBubblePartText
            v-if="part.type === 'text'"
            :part="part"
            :loading="isLastPart(index) && !!message.loading"
            :enable-file-reference-chips="isUserMessage"
            :references="message.references"
          />

          <MessageBubblePartThinking v-else-if="part.type === 'thinking'" :part="part" />

          <MessageBubblePartToolCall v-else-if="part.type === 'tool-call'" :part="part" />

          <ConfirmationCard
            v-else-if="part.type === 'confirmation'"
            :part="part"
            @confirmation-action="$emit('confirmation-action', $event.confirmationId, $event.action)"
          />

          <AskUserChoiceCard v-else-if="isAwaitingUserChoicePart(part)" :question="part.result.data" @submit-choice="$emit('user-choice-submit', $event)" />
          <MessageBubblePartToolResult v-else :part="part" />
        </template>
      </div>

      <template v-if="message.finished && message.role === 'assistant'" #toolbar>
        <div :class="bem('toolbar', { right: isUserMessage })">
          <BButton type="text" size="small" square icon="lucide:copy" @click="handleCopy(message)" />
          <BButton v-if="isUserMessage" square type="text" size="small" icon="lucide:edit-2" @click="$emit('edit', message)" />
          <BButton v-if="isAssistantMessage" square type="text" size="small" icon="lucide:refresh-cw" @click="$emit('regenerate', message)" />
        </div>
      </template>
    </BBubble>
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
import AskUserChoiceCard from './AskUserChoiceCard.vue';
import ConfirmationCard from './ConfirmationCard.vue';
import MessageBubblePartText from './MessageBubblePartText.vue';
import MessageBubblePartThinking from './MessageBubblePartThinking.vue';
import MessageBubblePartToolCall from './MessageBubblePartToolCall.vue';
import MessageBubblePartToolResult from './MessageBubblePartToolResult.vue';

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

const imageFiles = computed(() => props.message.files?.filter((file) => file.type === 'image' && (file.url || file.path)) ?? []);
const otherFiles = computed(() => props.message.files?.filter((file) => file.type !== 'image' || (!file.url && !file.path)) ?? []);
const isUserMessage = computed(() => props.message.role === 'user');
const isAssistantMessage = computed(() => props.message.role === 'assistant');
const isErrorMessage = computed(() => props.message.role === 'error');
const bubblePlacement = computed(() => (isAssistantMessage.value || isErrorMessage.value ? 'left' : 'right'));
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

.message-bubble__toolbar {
  display: flex;
  gap: 4px;
}

.message-bubble__toolbar--right {
  justify-content: flex-end;
}

.message-bubble__parts {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
</style>
