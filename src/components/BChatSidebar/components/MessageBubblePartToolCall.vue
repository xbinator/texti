<template>
  <MessageBubblePart type="tool-call" :has-content="hasContent">
    <template #title>
      <Icon icon="lucide:wrench" width="14" height="14" />
      <span>调用工具：{{ part.toolName }}</span>
    </template>
    <MessageBubblePartCode :value="part.input" />
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
import { hasStructuredValueContent } from '@/components/BChatSidebar/utils/messagePart';
import MessageBubblePart from './MessageBubblePart.vue';
import MessageBubblePartCode from './MessageBubblePartCode.vue';

defineOptions({ name: 'MessageBubblePartToolCall' });

interface Props {
  /** 工具调用片段 */
  part: ChatMessageToolCallPart;
}

const props = withDefaults(defineProps<Props>(), {});

const hasContent = computed(() => hasStructuredValueContent(props.part.input));
</script>
