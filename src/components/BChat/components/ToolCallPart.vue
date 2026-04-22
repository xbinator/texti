<template>
  <div :class="bem('part', { 'tool-call': true })">
    <div :class="bem('part-title')">
      <Icon icon="lucide:wrench" width="14" height="14" />
      <span>调用工具：{{ part.toolName }}</span>
    </div>
    <pre v-if="hasStructuredValueContent(part.input)" :class="bem('part-code')">{{ formatStructuredValue(part.input) }}</pre>
  </div>
</template>

<script setup lang="ts">
/**
 * @file ToolCallPart.vue
 * @description 聊天工具调用片段组件，负责展示工具名称和输入参数。
 */
import type { ChatMessageToolCallPart } from 'types/chat';
import { Icon } from '@iconify/vue';
import { createNamespace } from '@/utils/namespace';
import { formatStructuredValue, hasStructuredValueContent } from '../utils/message-part';

defineOptions({ name: 'ToolCallPart' });

defineProps<{
  /** 工具调用片段 */
  part: ChatMessageToolCallPart;
}>();

const [, bem] = createNamespace('message-bubble');
</script>
