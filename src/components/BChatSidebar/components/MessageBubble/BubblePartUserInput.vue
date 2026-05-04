<template>
  <div :class="bem()">
    <div :class="bem('text')">
      <template v-for="(segment, index) in segments" :key="`${segment.type}-${index}`">
        <span v-if="segment.type === 'text'">{{ segment.text }}</span>
        <span v-else :class="bem('tag')" data-value="file-reference">
          {{ segment.label }}
        </span>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * @file BubblePartUserInput.vue
 * @description 渲染用户输入消息，处理文件引用标签解析和显示。
 */
import type { ChatMessageFileReferencePart, ChatMessageTextPart } from 'types/chat';
import { computed } from 'vue';
import { createNamespace } from '@/utils/namespace';

defineOptions({ name: 'BubblePartUserInput' });

/**
 * 用户气泡内的可渲染文本片段。
 */
interface TextDisplaySegment {
  /** 片段类型标识 */
  type: 'text';
  /** 纯文本内容 */
  text: string;
}

/**
 * 用户气泡内的可渲染文件引用标签片段。
 */
interface FileReferenceDisplaySegment {
  /** 片段类型标识 */
  type: 'file-reference';
  /** 展示给用户的标签文本 */
  label: string;
}

/**
 * 气泡文本渲染片段的联合类型。
 */
type MessageBubbleTextSegment = TextDisplaySegment | FileReferenceDisplaySegment;

interface Props {
  /** 要渲染的消息片段 */
  part: ChatMessageTextPart | ChatMessageFileReferencePart;
}

const props = defineProps<Props>();

const FILE_REFERENCE_TOKEN_PATTERN = /\{\{@([^\s:}]+)(?::(\d+)(?:-(\d+))?)?\}\}/g;

const [, bem] = createNamespace('', 'message-bubble-user-input');

/**
 * 将原始文本拆分为纯文本和文件引用标签片段。
 */
const segments = computed<MessageBubbleTextSegment[]>(() => {
  if (props.part.type === 'file-reference') {
    const lineLabel = props.part.startLine > 0 ? `${props.part.startLine}${props.part.endLine > props.part.startLine ? `-${props.part.endLine}` : ''}` : '';

    return [{ type: 'file-reference', label: lineLabel ? `${props.part.fileName}:${lineLabel}` : props.part.fileName }];
  }

  const textPart = props.part as ChatMessageTextPart;
  const parts: MessageBubbleTextSegment[] = [];
  let lastIndex = 0;

  textPart.text.replace(FILE_REFERENCE_TOKEN_PATTERN, (match: string, fileName?: string, start?: string, end?: string, offset?: number) => {
    if (offset !== undefined && offset > lastIndex) {
      parts.push({ type: 'text', text: textPart.text.slice(lastIndex, offset) });
    }

    if (fileName) {
      const startLine = start ? Number(start) : 0;
      const endLine = end ? Number(end) : startLine;
      let lineLabel = '';
      if (startLine > 0) {
        lineLabel = startLine === endLine ? `${startLine}` : `${startLine}-${endLine}`;
      }
      parts.push({ type: 'file-reference', label: lineLabel ? `${fileName}:${lineLabel}` : fileName });
    }

    lastIndex = offset !== undefined ? offset + match.length : lastIndex;
    return match;
  });

  if (lastIndex < textPart.text.length) {
    parts.push({ type: 'text', text: textPart.text.slice(lastIndex) });
  }

  if (!parts.length) {
    parts.push({ type: 'text', text: textPart.text });
  }

  return parts;
});
</script>

<style scoped lang="less">
.message-bubble-user-input {
  word-break: normal;
  white-space: pre-wrap;
}

.message-bubble-user-input__tag {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  height: 20px;
  padding: 0 6px;
  font-size: 12px;
  line-height: 20px;
  color: var(--text-primary);
  border: 1px solid var(--border-secondary);
  border-radius: 4px;
}
</style>
