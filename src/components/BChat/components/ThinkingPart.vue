<template>
  <div :class="bem('part', { thinking: true })">
    <div :class="bem('part-title', { clickable: true })" @click="toggleCollapse">
      <Icon :icon="collapsed ? 'lucide:chevron-down' : 'lucide:chevron-up'" width="14" height="14" />
      <span>深度思考</span>
    </div>
    <BMessage v-show="!collapsed" :content="part.thinking" type="markdown" :class="bem('part-content')" />
  </div>
</template>

<script setup lang="ts">
/**
 * @file ThinkingPart.vue
 * @description 聊天思考片段组件，负责展示和折叠思考内容。
 */
import type { ChatMessageThinkingPart } from 'types/chat';
import { ref } from 'vue';
import { Icon } from '@iconify/vue';
import BMessage from '@/components/BMessage/index.vue';
import { createNamespace } from '@/utils/namespace';

defineOptions({ name: 'ThinkingPart' });

const props = defineProps<{
  /** 思考片段 */
  part: ChatMessageThinkingPart;
}>();

const [, bem] = createNamespace('message-bubble');
const collapsed = ref(false);

/**
 * 切换思考内容的折叠状态。
 */
function toggleCollapse(): void {
  collapsed.value = !collapsed.value;
}
</script>
