<template>
  <MessageBubblePart type="tool-call" :has-content="hasContent">
    <template #title>
      <Icon icon="lucide:wrench" width="14" height="14" />
      <span>调用工具：{{ part.toolName }}</span>
    </template>
    <pre :class="bem('part-code')">{{ formatStructuredValue(part.input) }}</pre>
  </MessageBubblePart>
</template>

<script setup lang="ts">
/**
 * @file MessageBubblePartToolCall.vue
 * @description 聊天工具调用片段组件，负责展示工具名称和输入参数，支持折叠功能。
 */
import type { ChatMessageToolCallPart } from 'types/chat';
import { computed } from 'vue';
import { Icon } from '@iconify/vue';
import { formatStructuredValue, hasStructuredValueContent } from '@/components/BChatSidebar/utils/messagePart';
import { createNamespace } from '@/utils/namespace';
import MessageBubblePart from './MessageBubblePart.vue';

defineOptions({ name: 'MessageBubblePartToolCall' });

interface Props {
  /** 工具调用片段 */
  part: ChatMessageToolCallPart;
}

const props = withDefaults(defineProps<Props>(), {});

const [, bem] = createNamespace('', 'message-bubble');

const hasContent = computed(() => hasStructuredValueContent(props.part.input));
</script>

<style scoped lang="less">
.message-bubble__part-code {
  max-height: 180px;
  padding: 8px;
  margin: 0;
  overflow: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
  font-size: 11px;
  line-height: 1.5;
  white-space: pre-wrap;
  background: var(--bg-primary);
  border-radius: 6px;
}
</style>
