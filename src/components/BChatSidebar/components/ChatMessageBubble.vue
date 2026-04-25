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
          <ChatMessageBubblePartText
            v-if="part.type === 'text'"
            :part="part"
            :loading="isLastPart(index) && !!message.loading"
            :enable-file-reference-chips="isUserMessage"
            :references="message.references"
          />

          <ChatMessageBubblePartThinking v-else-if="part.type === 'thinking'" :part="part" />

          <ChatMessageBubblePartToolCall v-else-if="part.type === 'tool-call'" :part="part" />

          <ChatConfirmationCard
            v-else-if="part.type === 'confirmation'"
            :part="part"
            @confirmation-action="$emit('confirmation-action', $event.confirmationId, $event.action)"
          />

          <ChatAskUserChoiceCard v-else-if="isAwaitingUserChoicePart(part)" :question="part.result.data" @submit-choice="$emit('user-choice-submit', $event)" />
          <ChatMessageBubblePartToolResult v-else :part="part" />
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
 * @file ChatMessageBubble.vue
 * @description 聊天气泡组件，按结构化消息片段渲染文本、思考、工具调用和工具结果。
 */
import type { Message } from '../../BChat/types';
import type { AIToolExecutionAwaitingUserInputResult } from 'types/ai';
import type { AIUserChoiceAnswerData, ChatMessageConfirmationAction, ChatMessagePart, ChatMessageToolResultPart } from 'types/chat';
import { computed } from 'vue';
import { Icon } from '@iconify/vue';
import BBubble from '@/components/BBubble/index.vue';
import BButton from '@/components/BButton/index.vue';
import { useClipboard } from '@/hooks/useClipboard';
import { createNamespace } from '@/utils/namespace';
import ChatAskUserChoiceCard from './ChatAskUserChoiceCard.vue';
import ChatConfirmationCard from './ChatConfirmationCard.vue';
import ChatMessageBubblePartText from './ChatMessageBubblePartText.vue';
import ChatMessageBubblePartThinking from './ChatMessageBubblePartThinking.vue';
import ChatMessageBubblePartToolCall from './ChatMessageBubblePartToolCall.vue';
import ChatMessageBubblePartToolResult from './ChatMessageBubblePartToolResult.vue';

defineOptions({ name: 'ChatMessageBubble' });

const { clipboard } = useClipboard();

const [, bem] = createNamespace('message-bubble');

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
 * @param msg - 待复制的聊天消息
 */
function handleCopy(msg: Message): void {
  clipboard(msg.content, { successMessage: '已复制到剪贴板' });
}
</script>

<style lang="less">
.b-message-bubble {
  display: flex;
  flex-direction: column;
  margin-bottom: 16px;
}

.b-message-bubble:last-child {
  margin-bottom: 0;
}

.b-message-bubble--error {
  .bubble__container {
    padding: 10px 14px;
    font-size: 12px;
    color: var(--color-error);
    background: var(--color-error-bg);
    border: 1px solid var(--color-error);
    border-radius: 12px;
  }
}

.b-message-bubble__header {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.b-message-bubble__images {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.b-message-bubble__image {
  max-width: 200px;
  max-height: 200px;
  object-fit: cover;
  border-radius: 8px;
}

.b-message-bubble__files {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.b-message-bubble__file {
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

.b-message-bubble__file-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.b-message-bubble__toolbar {
  display: flex;
  gap: 4px;
}

.b-message-bubble__toolbar--right {
  justify-content: flex-end;
}

.b-message-bubble__parts {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.b-message-bubble__part {
  padding: 10px 12px;
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: 8px;
}

.b-message-bubble__part--thinking {
  background: var(--bg-tertiary);
}

.b-message-bubble__part--tool-call,
.b-message-bubble__part--tool-result {
  border-style: dashed;
}

.b-message-bubble__part-title {
  display: flex;
  gap: 6px;
  align-items: center;
  font-weight: 500;
  color: var(--text-primary);
}

.b-message-bubble__part-title--clickable {
  width: fit-content;
  cursor: pointer;
  user-select: none;
}

.b-message-bubble__part-title--tool-result {
  width: 100%;
}

.b-message-bubble__part-name {
  flex: 1;
}

.b-message-bubble__part-status {
  padding: 1px 6px;
  font-size: 11px;
  line-height: 1.4;
  border-radius: 999px;
}

.b-message-bubble__part-status--failure {
  color: var(--color-error);
  background: var(--color-error-bg);
}

.b-message-bubble__part-content {
  margin-top: 8px;
}

.b-message-bubble__part-code {
  max-height: 180px;
  padding: 8px;
  margin: 0;
  margin-top: 8px;
  overflow: auto;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace);
  font-size: 11px;
  line-height: 1.5;
  white-space: pre-wrap;
  background: var(--bg-primary);
  border-radius: 6px;
}
</style>
