<!--
  @file ToolFileTarget.vue
  @description 仅展示文件变更工具的目标文件名与路径，不接收或渲染文件正文。
-->
<template>
  <button type="button" :class="bem('file-target', { openable })" :disabled="!openable" :title="filePath" @click="handleOpen">
    <span :class="bem('file-name')">{{ fileName }}</span>
    <span :class="bem('file-path')">{{ filePath }}</span>
  </button>
</template>

<script setup lang="ts">
import { createNamespace } from '@/utils/namespace';

defineOptions({ name: 'ToolFileTarget' });

/** 文件目标展示属性。 */
interface Props {
  /** 文件名。 */
  fileName: string;
  /** 完整文件路径。 */
  filePath: string;
  /** 是否允许打开文件。 */
  openable: boolean;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  /** 请求打开当前文件。 */
  (event: 'open'): void;
}>();
const [, bem] = createNamespace('', 'bubble-part-tool');

/**
 * 请求打开已完成且路径有效的文件。
 */
function handleOpen(): void {
  if (!props.openable) return;
  emit('open');
}
</script>

<style scoped lang="less">
.bubble-part-tool__file-target {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  padding: 6px 8px;
  font: inherit;
  text-align: left;
  cursor: default;
  background: var(--color-primary-bg);
  border: 0;
  border-radius: 4px;
}

.bubble-part-tool__file-target--openable {
  cursor: pointer;
}

.bubble-part-tool__file-target--openable:hover,
.bubble-part-tool__file-target--openable:focus-visible {
  background: var(--color-primary-bg-hover, rgb(22 119 255 / 14%));
}

.bubble-part-tool__file-target--openable:focus-visible {
  outline: 1px solid var(--color-primary);
  outline-offset: 1px;
}

.bubble-part-tool__file-target:disabled {
  color: inherit;
  opacity: 1;
}

.bubble-part-tool__file-name {
  font-weight: 500;
  color: var(--text-primary);
}

.bubble-part-tool__file-path {
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-tertiary);
  white-space: nowrap;
}
</style>
