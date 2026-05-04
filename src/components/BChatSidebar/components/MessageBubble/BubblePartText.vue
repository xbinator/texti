<template>
  <div :class="bem({ error: isErrorMessage })">
    <BMessage :content="'text' in part ? part.text : ''" type="markdown" />
  </div>
</template>

<script setup lang="ts">
/**
 * @file BubblePartText.vue
 * @description 在消息气泡中渲染助手文本片段，使用 Markdown 格式。
 */
import type { ChatMessageErrorPart, ChatMessageTextPart } from 'types/chat';
import { computed } from 'vue';
import BMessage from '@/components/BMessage/index.vue';
import { createNamespace } from '@/utils/namespace';

defineOptions({ name: 'BubblePartText' });

interface Props {
  /** 要渲染的文本片段 */
  part: ChatMessageTextPart | ChatMessageErrorPart;
}

const props = defineProps<Props>();

const [, bem] = createNamespace('', 'message-bubble-text');

const isErrorMessage = computed(() => props.part.type === 'error');
</script>

<style scoped lang="less">
.message-bubble-text--error {
  padding: 10px 14px;
  font-size: 12px;
  color: var(--color-error);
  background: var(--color-error-bg);
  border: 1px solid var(--color-error);
  border-radius: 8px;
}
</style>
