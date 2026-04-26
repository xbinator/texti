<template>
  <BubblePart type="tool-result" has-content>
    <template #title>
      <Icon :icon="part.result.status === 'success' ? 'lucide:check-circle-2' : 'lucide:circle-alert'" width="14" height="14" />
      <span :class="bem('part-name')">工具结果：{{ part.toolName }}</span>
      <span v-if="part.result.status === 'failure'" :class="bem('part-status', { failure: true })">失败</span>
    </template>

    <BubblePartCode :value="part.result" />
  </BubblePart>
</template>

<script setup lang="ts">
/**
 * @file BubblePartToolResult.vue
 * @description 聊天工具结果片段组件，负责展示结果状态和折叠内容。
 */
import type { ChatMessageToolResultPart } from 'types/chat';
import { Icon } from '@iconify/vue';
import { createNamespace } from '@/utils/namespace';
import BubblePart from './BubblePart.vue';
import BubblePartCode from './BubblePartCode.vue';

defineOptions({ name: 'BubblePartToolResult' });

interface Props {
  /** 工具结果片段 */
  part: ChatMessageToolResultPart;
}

withDefaults(defineProps<Props>(), {});

const [, bem] = createNamespace('', 'message-bubble');
</script>

<style scoped lang="less">
.message-bubble__part-name {
  flex: 1;
}

.message-bubble__part-status--failure {
  margin-left: 8px;
  color: var(--color-error);
}
</style>
