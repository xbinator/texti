<template>
  <div :class="bem('part', { 'tool-call': true })">
    <div :class="bem('part-title', { clickable: hasContent })" @click="toggleCollapse">
      <Icon v-if="hasContent" :icon="collapsed ? 'lucide:chevron-down' : 'lucide:chevron-up'" width="14" height="14" />
      <Icon icon="lucide:wrench" width="14" height="14" />
      <span>调用工具：{{ part.toolName }}</span>
    </div>
    <pre v-show="hasContent && !collapsed" :class="bem('part-code')">{{ formatStructuredValue(part.input) }}</pre>
  </div>
</template>

<script setup lang="ts">
/**
 * @file ChatMessageBubblePartToolCall.vue
 * @description 聊天工具调用片段组件，负责展示工具名称和输入参数，支持折叠功能。
 */
import type { ChatMessageToolCallPart } from 'types/chat';
import { computed, ref } from 'vue';
import { Icon } from '@iconify/vue';
import { createNamespace } from '@/utils/namespace';
import { formatStructuredValue, hasStructuredValueContent } from '@/components/BChatSidebar/utils/messagePart';

defineOptions({ name: 'ChatMessageBubblePartToolCall' });

const props = defineProps<{
  /** 工具调用片段 */
  part: ChatMessageToolCallPart;
}>();

const [, bem] = createNamespace('message-bubble');

/** 折叠状态，默认折叠 */
const collapsed = ref(true);

/** 是否有结构化内容 */
const hasContent = computed(() => hasStructuredValueContent(props.part.input));

/**
 * 切换工具调用内容的折叠状态。
 * 仅在有结构化内容时允许切换。
 */
function toggleCollapse(): void {
  if (hasContent.value) {
    collapsed.value = !collapsed.value;
  }
}
</script>
