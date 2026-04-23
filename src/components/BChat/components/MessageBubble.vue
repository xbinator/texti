<template>
  <div :class="bem({ error: isErrorMessage })">
    <BBubble :placement="bubblePlacement" :loading="message.loading" :size="message.role === 'user' ? 'auto' : 'fill'">
      <!-- 头部区域：展示用户上传的图片和文件 -->
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

      <!-- 消息内容区域：按片段类型渲染不同内容 -->
      <div :class="bem('parts')">
        <template v-for="(part, index) in message.parts" :key="`${part.type}-${index}`">
          <!-- 文本片段：渲染 Markdown 内容 -->
          <MessageBubblePartText v-if="part.type === 'text'" :part="part" :loading="isLastPart(index) && !!message.loading" />

          <!-- 思考片段：可折叠的深度思考内容 -->
          <MessageBubblePartThinking v-else-if="part.type === 'thinking'" :part="part" />

          <!-- 工具调用片段：展示工具名称和输入参数 -->
          <MessageBubblePartToolCall v-else-if="part.type === 'tool-call'" :part="part" />

          <!-- 确认片段：需要用户确认的操作卡片 -->
          <ConfirmationCard
            v-else-if="part.type === 'confirmation'"
            :part="part"
            @confirmation-action="$emit('confirmation-action', $event.confirmationId, $event.action)"
          />

          <!-- 工具结果片段：展示工具执行结果 -->
          <AskUserChoiceCard v-else-if="isAwaitingUserChoicePart(part)" :question="part.result.data" @submit-choice="$emit('user-choice-submit', $event)" />
          <MessageBubblePartToolResult v-else :part="part" />
        </template>
      </div>

      <!-- 工具栏：复制、编辑、重新生成按钮 -->
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
import type { Message } from '../types';
import type { AIToolExecutionAwaitingUserInputResult } from 'types/ai';
import type { AIUserChoiceAnswerData, ChatMessagePart, ChatMessageToolResultPart } from 'types/chat';
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

defineOptions({ name: 'BMessageBubble' });

const { clipboard } = useClipboard();

/** BEM 类名生成器 */
const [, bem] = createNamespace('message-bubble');

/** 聊天消息数据 */
const props = defineProps<{ message: Message }>();

defineEmits<{
  /** 编辑消息事件 */
  (e: 'edit', message: Message): void;
  /** 重新生成消息事件 */
  (e: 'regenerate', message: Message): void;
  /** 确认操作事件 */
  (e: 'confirmation-action', confirmationId: string, action: 'approve' | 'cancel'): void;
  /** 用户选择题提交事件 */
  (e: 'user-choice-submit', answer: AIUserChoiceAnswerData): void;
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
/* 消息气泡容器 */
.b-message-bubble {
  display: flex;
  flex-direction: column;
  margin-bottom: 16px;
}

/* 最后一个气泡移除底部间距 */
.b-message-bubble:last-child {
  margin-bottom: 0;
}

/* 错误消息样式 */
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

/* 头部区域：图片和文件列表容器 */
.b-message-bubble__header {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* 图片预览列表 */
.b-message-bubble__images {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

/* 单张图片样式 */
.b-message-bubble__image {
  max-width: 200px;
  max-height: 200px;
  object-fit: cover;
  border-radius: 8px;
}

/* 其他文件列表 */
.b-message-bubble__files {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

/* 单个文件项样式 */
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

/* 文件名：超出省略 */
.b-message-bubble__file-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 工具栏容器 */
.b-message-bubble__toolbar {
  display: flex;
  gap: 4px;
}

/* 工具栏右对齐 */
.b-message-bubble__toolbar--right {
  justify-content: flex-end;
}

/* 消息片段容器 */
.b-message-bubble__parts {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* 消息片段基础样式 */
.b-message-bubble__part {
  padding: 10px 12px;
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: 8px;
}

/* 思考片段样式 */
.b-message-bubble__part--thinking {
  background: var(--bg-tertiary);
}

/* 工具调用片段样式 */
.b-message-bubble__part--tool-call {
  border-style: dashed;
}

/* 工具结果成功样式 */
.b-message-bubble__part--tool-result-success {
  border-color: var(--color-success);
}

/* 工具结果失败/取消样式 */
.b-message-bubble__part--tool-result-failure,
.b-message-bubble__part--tool-result-cancelled {
  border-color: var(--color-error);
}

/* 片段标题样式 */
.b-message-bubble__part-title {
  display: flex;
  gap: 6px;
  align-items: center;
  font-weight: 500;
  color: var(--text-primary);
}

/* 可点击的片段标题 */
.b-message-bubble__part-title--clickable {
  width: fit-content;
  cursor: pointer;
  user-select: none;
}

/* 片段内容区域 */
.b-message-bubble__part-content {
  margin-top: 8px;
}

/* 代码块样式 */
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
