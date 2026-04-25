<template>
  <MessageBubblePart type="thinking" :has-content="hasContent" :default-collapsed="false">
    <template #title>深度思考</template>
    <BMessage :content="part.thinking" type="markdown" />
  </MessageBubblePart>
</template>

<script setup lang="ts">
import type { ChatMessageThinkingPart } from 'types/chat';
import { computed } from 'vue';
import MessageBubblePart from './MessageBubblePart.vue';

defineOptions({ name: 'MessageBubblePartThinking' });

interface Props {
  /** 思考片段 */
  part: ChatMessageThinkingPart;
}

const props = withDefaults(defineProps<Props>(), {});

const hasContent = computed(() => !!props.part.thinking);
</script>
