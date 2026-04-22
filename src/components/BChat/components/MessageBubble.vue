<template>
  <div :class="['b-message-bubble', { 'b-message-bubble--error': isErrorMessage }]">
    <BBubble :placement="bubblePlacement" :loading="message.loading" :size="message.role === 'user' ? 'auto' : 'fill'">
      <template v-if="showHeader" #header>
        <div class="b-message-bubble__header">
          <div v-if="imageFiles.length" class="b-message-bubble__images">
            <img v-for="file in imageFiles" :key="file.id" :src="file.url || file.path" :alt="file.name" class="b-message-bubble__image" />
          </div>
          <div v-if="otherFiles.length" class="b-message-bubble__files">
            <div v-for="file in otherFiles" :key="file.id" class="b-message-bubble__file">
              <Icon icon="lucide:file" width="14" height="14" />
              <span class="b-message-bubble__file-name">{{ file.name }}</span>
            </div>
          </div>
        </div>
      </template>
      <div class="b-message-bubble__parts">
        <template v-for="(part, index) in message.parts" :key="`${part.type}-${index}`">
          <BMessage v-if="part.type === 'text'" :content="part.text" type="markdown" :loading="isLastPart(index) && message.loading" />
          <div v-else-if="part.type === 'thinking'" class="b-message-bubble__part b-message-bubble__part--thinking">
            <div class="b-message-bubble__part-title b-message-bubble__part-title--clickable" @click="toggleThinkingCollapse(index)">
              <Icon :icon="isThinkingCollapsed(index) ? 'lucide:chevron-down' : 'lucide:chevron-up'" width="14" height="14" />
              <span>深度思考</span>
            </div>
            <BMessage v-show="!isThinkingCollapsed(index)" :content="part.thinking" type="markdown" class="b-message-bubble__part-content" />
          </div>
          <div v-else-if="part.type === 'tool-call'" class="b-message-bubble__part b-message-bubble__part--tool-call">
            <div class="b-message-bubble__part-title">
              <Icon icon="lucide:wrench" width="14" height="14" />
              <span>调用工具：{{ part.toolName }}</span>
            </div>
            <pre v-if="hasValueContent(part.input)" class="b-message-bubble__part-code">{{ formatValue(part.input) }}</pre>
          </div>
          <div v-else class="b-message-bubble__part" :class="getToolResultClass(part.result.status)">
            <div class="b-message-bubble__part-title b-message-bubble__part-title--clickable" @click="toggleToolResultCollapse(index)">
              <Icon :icon="isToolResultCollapsed(index) ? 'lucide:chevron-down' : 'lucide:chevron-up'" width="14" height="14" />
              <Icon :icon="part.result.status === 'success' ? 'lucide:check-circle-2' : 'lucide:circle-alert'" width="14" height="14" />
              <span>工具结果：{{ part.toolName }}</span>
            </div>
            <pre v-show="!isToolResultCollapsed(index)" class="b-message-bubble__part-code">{{ formatValue(part.result) }}</pre>
          </div>
        </template>
      </div>
      <template v-if="message.finished && message.role === 'assistant'" #toolbar>
        <div class="b-message-bubble__toolbar" :class="toolbarClass">
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
import type { Message } from '../types';
import { computed, ref } from 'vue';
import { Icon } from '@iconify/vue';
import BBubble from '@/components/BBubble/index.vue';
import BButton from '@/components/BButton/index.vue';
import BMessage from '@/components/BMessage/index.vue';
import { useClipboard } from '@/hooks/useClipboard';

defineOptions({ name: 'BMessageBubble' });

const { clipboard } = useClipboard();

const props = defineProps<{ message: Message }>();
const collapsedThinkingIndexes = ref<Set<number>>(new Set());
const collapsedToolResultIndexes = ref<Set<number>>(new Set());

defineEmits<{
  (e: 'edit', message: Message): void;
  (e: 'regenerate', message: Message): void;
}>();

/** 图片文件列表 */
const imageFiles = computed(() => props.message.files?.filter((file) => file.type === 'image' && (file.url || file.path)) ?? []);
/** 其他文件列表 */
const otherFiles = computed(() => props.message.files?.filter((file) => file.type !== 'image' || (!file.url && !file.path)) ?? []);
/** 是否为用户消息 */
const isUserMessage = computed(() => props.message.role === 'user');
/** 是否为助手消息 */
const isAssistantMessage = computed(() => props.message.role === 'assistant');
/** 是否为错误消息 */
const isErrorMessage = computed(() => props.message.role === 'error');
/** 气泡位置 */
const bubblePlacement = computed(() => (isAssistantMessage.value || isErrorMessage.value ? 'left' : 'right'));
/** 是否显示头部（仅用户消息且有附件时显示） */
const showHeader = computed(() => isUserMessage.value && (imageFiles.value.length || otherFiles.value.length));
/** 工具栏样式类 */
const toolbarClass = computed(() => ({ 'b-message-bubble__toolbar--right': isUserMessage.value }));

/**
 * 判断消息片段是否为最后一个片段。
 * @param index - 片段索引
 */
function isLastPart(index: number): boolean {
  return index === props.message.parts.length - 1;
}

/**
 * 判断思考片段是否已折叠。
 * @param index - 片段索引
 */
function isThinkingCollapsed(index: number): boolean {
  return collapsedThinkingIndexes.value.has(index);
}

/**
 * 切换思考片段折叠状态。
 * @param index - 片段索引
 */
function toggleThinkingCollapse(index: number): void {
  const nextIndexes = new Set(collapsedThinkingIndexes.value);
  if (nextIndexes.has(index)) {
    nextIndexes.delete(index);
  } else {
    nextIndexes.add(index);
  }

  collapsedThinkingIndexes.value = nextIndexes;
}

/**
 * 判断工具结果片段是否已折叠。
 * @param index - 片段索引
 */
function isToolResultCollapsed(index: number): boolean {
  // 默认折叠工具结果；仅当用户主动展开后，才在集合中记录该片段索引。
  return !collapsedToolResultIndexes.value.has(index);
}

/**
 * 切换工具结果片段折叠状态。
 * @param index - 片段索引
 */
function toggleToolResultCollapse(index: number): void {
  const nextIndexes = new Set(collapsedToolResultIndexes.value);
  if (nextIndexes.has(index)) {
    nextIndexes.delete(index);
  } else {
    nextIndexes.add(index);
  }

  collapsedToolResultIndexes.value = nextIndexes;
}

/**
 * 判断结构化值是否有可展示内容。
 * @param value - 待判断的值
 */
function hasValueContent(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>).length > 0;
  }

  return true;
}

/**
 * 将结构化值格式化为稳定的可读文本。
 * @param value - 待格式化的值
 */
function formatValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  return JSON.stringify(value, null, 2) ?? '';
}

/**
 * 获取工具结果状态样式。
 * @param status - 工具执行状态
 */
function getToolResultClass(status: string): string {
  return `b-message-bubble__part--tool-result-${status}`;
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

.b-message-bubble__part--tool-call {
  border-style: dashed;
}

.b-message-bubble__part--tool-result-success {
  border-color: var(--color-success);
}

.b-message-bubble__part--tool-result-failure,
.b-message-bubble__part--tool-result-cancelled {
  border-color: var(--color-error);
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
