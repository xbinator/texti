<template>
  <div :class="bem({ [type]: true })">
    <div :class="bem('title', { clickable: hasContent })" @click="hasContent && toggleCollapse()">
      <div :class="bem('title-text')">
        <slot name="title"></slot>
      </div>

      <BIcon v-if="hasContent" :icon="collapsed ? 'lucide:chevron-down' : 'lucide:chevron-up'" :size="14" />
    </div>

    <div v-show="hasContent && !collapsed" :class="bem('content')">
      <slot></slot>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * @file BubblePart.vue
 * @description 聊天气泡片段共享组件，处理折叠逻辑和通用结构。
 */
import { computed, ref } from 'vue';
import { createNamespace } from '@/utils/namespace';

defineOptions({ name: 'BubblePart' });

interface Props {
  /** 片段类型 */
  type: 'thinking' | 'tool-input' | 'tool-call' | 'tool-result' | 'tool';
  /** 是否有可展示内容（无内容时不可折叠） */
  hasContent?: boolean;
  /** 默认折叠状态，默认为 true（折叠） */
  defaultCollapsed?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  defaultCollapsed: true
});

const [, bem] = createNamespace('', 'message-bubble-part');
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
.message-bubble-part {
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--bg-secondary);
  border: var(--surface-border-width) solid var(--border-primary);
  border-radius: var(--surface-radius);
}

.message-bubble-part--thinking {
  background: var(--bg-tertiary);
}

.message-bubble-part--tool-input,
.message-bubble-part--tool-call,
.message-bubble-part--tool-result,
.message-bubble-part--tool {
  border-style: dashed;
}

.message-bubble-part__title {
  display: flex;
  gap: 6px;
  align-items: center;
  padding: 10px 12px;
  font-weight: 500;
  color: var(--text-primary);
}

.message-bubble-part__title-text {
  display: flex;
  flex: 1;
  gap: 6px;
  align-items: center;
  width: 0;
}

.message-bubble-part__title--clickable {
  cursor: pointer;
}

.message-bubble-part__content {
  margin: 0 12px 10px;
}
</style>
