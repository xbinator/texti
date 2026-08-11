<template>
  <BubblePart type="thinking" :has-content="hasContent" :default-collapsed="false">
    <template #title>深度思考</template>
    <BMessage :content="part.thinking" :loading="streaming" :message-id="part.id" type="markdown" />
  </BubblePart>
</template>

<script setup lang="ts">
import type { ChatMessageThinkingPart } from 'types/chat';
import { computed } from 'vue';
import BubblePart from '../BubblePart/index.vue';

defineOptions({ name: 'BubblePartThinking' });

interface Props {
  /** 思考片段 */
  part: ChatMessageThinkingPart;
  /** 是否为当前 Assistant 正在增长的尾片段。 */
  streaming?: boolean;
}

const props = withDefaults(defineProps<Props>(), { streaming: false });

const hasContent = computed(() => !!props.part.thinking);
</script>
