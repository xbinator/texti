<template>
  <div :class="bem('part', { [type]: true })">
    <div :class="bem('part-title', { clickable: hasContent })" @click="hasContent && toggleCollapse()">
      <Icon v-if="hasContent" :icon="collapsed ? 'lucide:chevron-down' : 'lucide:chevron-up'" width="14" height="14" />
      <slot name="title"></slot>
    </div>

    <div v-show="hasContent && !collapsed" :class="bem('part-content')">
      <slot></slot>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * @file MessageBubblePart.vue
 * @description 聊天气泡片段共享组件，处理折叠逻辑和通用结构。
 */
import { computed, ref } from 'vue';
import { Icon } from '@iconify/vue';
import { createNamespace } from '@/utils/namespace';

defineOptions({ name: 'MessageBubblePart' });

interface Props {
  /** 片段类型 */
  type: 'thinking' | 'tool-call' | 'tool-result';
  /** 是否有可展示内容（无内容时不可折叠） */
  hasContent?: boolean;
  /** 默认折叠状态，默认为 true（折叠） */
  defaultCollapsed?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  defaultCollapsed: true
});

const [, bem] = createNamespace('', 'message-bubble');
const collapsed = ref(props.defaultCollapsed);

const hasContent = computed(() => props.hasContent !== false);

/**
 * 切换折叠状态。
 */
function toggleCollapse(): void {
  collapsed.value = !collapsed.value;
}
</script>

<style scoped lang="less">
.message-bubble__part {
  padding: 10px 12px;
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: 8px;
}

.message-bubble__part--thinking {
  background: var(--bg-tertiary);
}

.message-bubble__part--tool-call,
.message-bubble__part--tool-result {
  border-style: dashed;
}

.message-bubble__part-title {
  display: flex;
  gap: 6px;
  align-items: center;
  font-weight: 500;
  color: var(--text-primary);
}

.message-bubble__part-title--clickable {
  cursor: pointer;
  user-select: none;
}

.message-bubble__part-title--tool-result {
  width: 100%;
}

.message-bubble__part-status {
  padding: 1px 6px;
  font-size: 11px;
  line-height: 1.4;
  border-radius: 999px;
}

.message-bubble__part-status--failure {
  color: var(--color-error);
  background: var(--color-error-bg);
}

.message-bubble__part-content {
  margin-top: 8px;
}
</style>
