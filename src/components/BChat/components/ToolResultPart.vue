<template>
  <div :class="bem('part', { [`tool-result-${part.result.status}`]: true })">
    <div :class="bem('part-title', { clickable: true })" @click="toggleCollapse">
      <Icon :icon="collapsed ? 'lucide:chevron-down' : 'lucide:chevron-up'" width="14" height="14" />
      <Icon :icon="part.result.status === 'success' ? 'lucide:check-circle-2' : 'lucide:circle-alert'" width="14" height="14" />
      <span>工具结果：{{ part.toolName }}</span>
    </div>
    <pre v-show="!collapsed" :class="bem('part-code')">{{ formatStructuredValue(part.result) }}</pre>
  </div>
</template>

<script setup lang="ts">
/**
 * @file ToolResultPart.vue
 * @description 聊天工具结果片段组件，负责展示结果状态和折叠内容。
 */
import type { ChatMessageToolResultPart } from 'types/chat';
import { ref } from 'vue';
import { Icon } from '@iconify/vue';
import { createNamespace } from '@/utils/namespace';
import { formatStructuredValue } from '../utils/message-part';

defineOptions({ name: 'ToolResultPart' });

defineProps<{
  /** 工具结果片段 */
  part: ChatMessageToolResultPart;
}>();

const [, bem] = createNamespace('message-bubble');
const collapsed = ref(true);

/**
 * 切换工具结果内容的折叠状态。
 */
function toggleCollapse(): void {
  collapsed.value = !collapsed.value;
}
</script>
