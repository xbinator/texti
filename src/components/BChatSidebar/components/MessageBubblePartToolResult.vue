<template>
  <MessageBubblePart type="tool-result" has-content>
    <template #title>
      <Icon :icon="part.result.status === 'success' ? 'lucide:check-circle-2' : 'lucide:circle-alert'" width="14" height="14" />
      <span :class="bem('part-name')">工具结果：{{ part.toolName }}</span>
      <span v-if="part.result.status === 'failure'" :class="bem('part-status', { failure: true })">失败</span>
    </template>

    <pre :class="bem('part-code')">{{ formatStructuredValue(part.result) }}</pre>
  </MessageBubblePart>
</template>

<script setup lang="ts">
/**
 * @file MessageBubblePartToolResult.vue
 * @description 聊天工具结果片段组件，负责展示结果状态和折叠内容。
 */
import type { ChatMessageToolResultPart } from 'types/chat';
import { Icon } from '@iconify/vue';
import { formatStructuredValue } from '@/components/BChatSidebar/utils/messagePart';
import { createNamespace } from '@/utils/namespace';
import MessageBubblePart from './MessageBubblePart.vue';

defineOptions({ name: 'MessageBubblePartToolResult' });

interface Props {
  /** 工具结果片段 */
  part: ChatMessageToolResultPart;
}

withDefaults(defineProps<Props>(), {});

const [, bem] = createNamespace('', 'message-bubble');
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
