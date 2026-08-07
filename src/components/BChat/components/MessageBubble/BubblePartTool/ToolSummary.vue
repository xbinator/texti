<!--
  @file ToolSummary.vue
  @description 展示工具结构化摘要、摘要标签和可展开的原始数据。
-->
<template>
  <div :class="bem('summary', { [summary.variant ?? 'success']: true })">
    <div v-if="summary.text" :class="bem('summary-text', { shell: isShellCommand })">{{ summary.text }}</div>
    <div v-if="summary.tags?.length" :class="bem('summary-tags')">
      <template v-for="tag in summary.tags" :key="`${tag.label}-${tag.value}`">
        <div v-if="isOpenFileTag(tag)" :class="bem('summary-tag', { clickable: true })" :title="tag.path" @click="handleOpenFileTag(tag)">
          <span v-if="tag.label" :class="bem('summary-tag-label')">{{ tag.label }}：</span>
          <span :class="bem('summary-tag-value')">{{ tag.value }}</span>
        </div>
        <div v-else :class="bem('summary-tag')">
          <span v-if="tag.label" :class="bem('summary-tag-label')">{{ tag.label }}：</span>
          <span :class="bem('summary-tag-value')">{{ tag.value }}</span>
        </div>
      </template>
    </div>
    <template v-if="summary.variant !== 'failure' && summary.variant !== 'cancelled'">
      <div :class="bem('summary-raw-toggle')" @click="rawExpanded = !rawExpanded">
        <BIcon :icon="rawExpanded ? 'lucide:chevron-down' : 'lucide:chevron-right'" :size="12" />
        <span>{{ rawExpanded ? '收起原始数据' : '查看原始数据' }}</span>
      </div>
      <ToolCode v-if="rawExpanded" :value="previewValue" />
    </template>
  </div>
</template>

<script setup lang="ts">
import type { ToolResultSummary, ToolSummaryTag } from '../../../utils/toolResultSummary';
import { ref } from 'vue';
import { useNavigate } from '@/hooks/useNavigate';
import { asyncTo } from '@/utils/asyncTo';
import { createNamespace } from '@/utils/namespace';
import ToolCode from './ToolCode.vue';

defineOptions({ name: 'ToolSummary' });

/** 工具摘要展示属性。 */
interface Props {
  /** 工具执行完成时的人可读摘要。 */
  summary: ToolResultSummary;
  /** 当前工具输入或结果的原始预览值。 */
  previewValue: unknown;
  /** 是否为 Shell 命令。 */
  isShellCommand: boolean;
}

defineProps<Props>();
const [, bem] = createNamespace('', 'bubble-part-tool');
/** 文件导航能力。 */
const { openFile } = useNavigate();
/** 原始数据展开状态。 */
const rawExpanded = ref(false);

/**
 * 判断摘要标签是否可打开文件。
 * @param tag - 摘要标签
 * @returns 标签可打开文件时返回 true
 */
function isOpenFileTag(tag: ToolSummaryTag): boolean {
  return tag.action === 'openFile' && typeof tag.path === 'string' && tag.path.length > 0;
}

/**
 * 打开摘要标签关联的文件。
 * @param tag - 摘要标签
 */
async function handleOpenFileTag(tag: ToolSummaryTag): Promise<void> {
  if (!isOpenFileTag(tag)) return;

  await asyncTo(openFile({ filePath: tag.path }));
}
</script>

<style scoped lang="less">
.bubble-part-tool__summary {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  line-height: 1.6;
}

.bubble-part-tool__summary--failure .bubble-part-tool__summary-text {
  color: var(--color-error);
}

.bubble-part-tool__summary--failure .bubble-part-tool__summary-tag {
  background: var(--color-error-bg, rgb(255 0 0 / 8%));
}

.bubble-part-tool__summary--failure .bubble-part-tool__summary-tag-value {
  color: var(--color-error);
}

.bubble-part-tool__summary--cancelled .bubble-part-tool__summary-text {
  color: var(--text-tertiary);
}

.bubble-part-tool__summary-text {
  color: var(--text-primary);
  white-space: pre-wrap;
}

.bubble-part-tool__summary-text--shell {
  padding: 4px 8px;
  font-family: var(--font-mono);
  font-size: 11px;
  background: var(--color-fill-tertiary, rgb(0 0 0 / 6%));
  border-radius: 4px;
}

.bubble-part-tool__summary-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.bubble-part-tool__summary-tag {
  max-width: 100%;
  padding: 1px 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  font: inherit;
  text-align: left;
  white-space: nowrap;
  background: var(--color-primary-bg);
  border: 0;
  border-radius: 4px;
}

.bubble-part-tool__summary-tag--clickable {
  cursor: pointer;
}

.bubble-part-tool__summary-tag--clickable:hover,
.bubble-part-tool__summary-tag--clickable:focus-visible {
  background: var(--color-primary-bg-hover, rgb(22 119 255 / 14%));
}

.bubble-part-tool__summary-tag--clickable:focus-visible {
  outline: 1px solid var(--color-primary);
  outline-offset: 1px;
}

.bubble-part-tool__summary-tag-label {
  flex-shrink: 0;
  color: var(--text-tertiary);
}

.bubble-part-tool__summary-tag-value {
  color: var(--color-primary);
}

.bubble-part-tool__summary-raw-toggle {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  margin-top: 6px;
  font-size: 11px;
  color: var(--text-tertiary);
  cursor: pointer;
  user-select: none;
}

.bubble-part-tool__summary-raw-toggle:hover {
  color: var(--text-secondary);
}
</style>
