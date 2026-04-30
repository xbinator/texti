<template>
  <pre :class="name">{{ formattedContent }}</pre>
</template>

<script setup lang="ts">
/**
 * @file BubblePartCode.vue
 * @description 聊天消息代码片段组件，用于展示格式化的结构化数据。
 */
import { computed } from 'vue';
import { formatStructuredValue } from '@/components/BChatSidebar/utils/messagePart';
import { createNamespace } from '@/utils/namespace';

defineOptions({ name: 'BubblePartCode' });

interface Props {
  /** 要展示的结构化数据 */
  value: unknown;
}

const props = defineProps<Props>();

const [name] = createNamespace('', 'message-bubble-tool-code');

/** 格式化后的内容 */
const formattedContent = computed(() => formatStructuredValue(props.value));
</script>

<style scoped lang="less">
.message-bubble-tool-code {
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
