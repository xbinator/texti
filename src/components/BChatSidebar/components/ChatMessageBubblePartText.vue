<template>
  <BMessage v-if="!props.enableFileReferenceChips" :content="part.text" type="markdown" :loading="loading" />

  <div v-else :class="bem('part-text')">
    <template v-for="(segment, index) in segments" :key="`${segment.type}-${index}`">
      <span v-if="segment.type === 'text'">{{ segment.text }}</span>
      <span v-else class="b-prompt-editor-tag b-prompt-editor-tag--file-reference" data-value="file-reference" contenteditable="false">
        {{ segment.label }}
      </span>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { ChatMessageFileReference, ChatMessageTextPart } from 'types/chat';
import { computed } from 'vue';
import BMessage from '@/components/BMessage/index.vue';
import { createNamespace } from '@/utils/namespace';

defineOptions({ name: 'ChatMessageBubblePartText' });

/**
 * @file ChatMessageBubblePartText.vue
 * @description Renders text segments in a message bubble, including file reference chips for user messages.
 */

/**
 * Renderable text segment inside a user bubble.
 */
interface TextDisplaySegment {
  /** Segment discriminator. */
  type: 'text';
  /** Plain text content. */
  text: string;
}

/**
 * Renderable file-reference chip segment inside a user bubble.
 */
interface FileReferenceDisplaySegment {
  /** Segment discriminator. */
  type: 'file-reference';
  /** Chip label shown to the user. */
  label: string;
}

/**
 * Union of bubble text render segments.
 */
type MessageBubbleTextSegment = TextDisplaySegment | FileReferenceDisplaySegment;

const props = withDefaults(
  defineProps<{
    /** Text part to render. */
    part: ChatMessageTextPart;
    /** Whether the part still shows streaming loading state. */
    loading: boolean;
    /** Enables user-only file-reference chip rendering. */
    enableFileReferenceChips?: boolean;
    /** File-reference metadata attached to the parent message. */
    references?: ChatMessageFileReference[];
  }>(),
  {
    enableFileReferenceChips: false,
    references: () => []
  }
);

const FILE_REFERENCE_TOKEN_PATTERN = /\{\{file-ref:([A-Za-z0-9_-]+)\}\}/g;

const [, bem] = createNamespace('b-message-bubble');

/**
 * Builds a quick lookup table from token string to reference metadata.
 */
const referenceMap = computed<Map<string, ChatMessageFileReference>>(() => {
  const map = new Map<string, ChatMessageFileReference>();
  props.references.forEach((reference) => {
    map.set(reference.token, reference);
  });
  return map;
});

/**
 * Splits raw text into plain-text and file-reference chip segments.
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

<style lang="less">
.b-message-bubble__part-text {
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
</style>
