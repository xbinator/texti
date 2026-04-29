<template>
  <div :class="bem({ 'part-error': isErrorMessage })">
    <div v-if="enableFileReferenceChips" :class="bem('part-text')">
      <template v-for="(segment, index) in segments" :key="`${segment.type}-${index}`">
        <span v-if="segment.type === 'text'">{{ segment.text }}</span>
        <span v-else :class="bem('part-tag')" data-value="file-reference">
          {{ segment.label }}
        </span>
      </template>
    </div>

    <BMessage v-else :content="part.text" type="markdown" />
  </div>
</template>

<script setup lang="ts">
import type { ChatMessageFileReference, ChatMessageTextPart, ChatMessageErrorPart } from 'types/chat';
import { computed } from 'vue';
import BMessage from '@/components/BMessage/index.vue';
import { createNamespace } from '@/utils/namespace';

defineOptions({ name: 'BubblePartText' });

/**
 * @file BubblePartText.vue
 * @description 在消息气泡中渲染文本片段，包括用户消息的文件引用标签。
 */

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
  /** 要渲染的文本片段 */
  part: ChatMessageTextPart | ChatMessageErrorPart;
  /** 是否启用仅用户可见的文件引用标签渲染 */
  enableFileReferenceChips?: boolean;
  /** 父消息附加的文件引用元数据 */
  references?: ChatMessageFileReference[];
}

const props = withDefaults(defineProps<Props>(), {
  enableFileReferenceChips: false,
  references: () => []
});

const FILE_REFERENCE_TOKEN_PATTERN = /\{\{file-ref:([A-Za-z0-9_-]+)(?:\|[^}]*)?\}\}/g;

const [, bem] = createNamespace('', 'message-bubble');

const isErrorMessage = computed(() => props.part.type === 'error');

/**
 * 构建从引用标识到引用元数据的快速查找表。
 */
const referenceMap = computed<Map<string, ChatMessageFileReference>>(() => {
  const map = new Map<string, ChatMessageFileReference>();
  props.references.forEach((reference) => {
    map.set(reference.token, reference);
  });
  return map;
});

/**
 * 将原始文本拆分为纯文本和文件引用标签片段。
 */
const segments = computed<MessageBubbleTextSegment[]>(() => {
  const parts: MessageBubbleTextSegment[] = [];
  let lastIndex = 0;

  props.part.text.replace(FILE_REFERENCE_TOKEN_PATTERN, (match: string, referenceId: string, offset: number) => {
    if (offset > lastIndex) {
      parts.push({ type: 'text', text: props.part.text.slice(lastIndex, offset) });
    }

    const reference = referenceMap.value.get(match);
    if (reference) {
      parts.push({ type: 'file-reference', label: `${reference.fileName}:${reference.line}` });
    } else {
      parts.push({ type: 'text', text: `{{file-ref:${referenceId}}}` });
    }

    lastIndex = offset + match.length;
    return match;
  });

  if (lastIndex < props.part.text.length) {
    parts.push({ type: 'text', text: props.part.text.slice(lastIndex) });
  }

  if (!parts.length) {
    parts.push({ type: 'text', text: props.part.text });
  }

  return parts;
});
</script>

<style scoped lang="less">
.message-bubble--part-text {
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.message-bubble--part-tag {
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

.message-bubble--part-error {
  padding: 10px 14px;
  font-size: 12px;
  color: var(--color-error);
  background: var(--color-error-bg);
  border: 1px solid var(--color-error);
  border-radius: 8px;
}
</style>
