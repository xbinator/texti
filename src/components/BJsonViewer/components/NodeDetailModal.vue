<!--
  @file NodeDetailModal.vue
  @description BJsonViewer 节点详情弹窗，展示节点内容与 JSON 路径。
-->
<template>
  maskClosable?: boolean;
  <BModal v-model:open="visible" title="节点内容" mask-closable :width="520">
    <div :class="bem('section')">
      <div :class="bem('header')">
        <span :class="bem('title')">内容</span>
        <button :class="bem('copy')" @click="copyContent">
          <BIcon icon="lucide:copy" :size="14" />
        </button>
      </div>
      <BScrollbar max-height="60vh" :class="bem('content')">
        <pre :class="bem('code')"><code v-html="formattedContent"></code></pre>
      </BScrollbar>
    </div>

    <div :class="bem('section')">
      <div :class="bem('header')">
        <span :class="bem('title')">路径</span>
        <button :class="bem('copy')" @click="copyPath">
          <BIcon icon="lucide:copy" :size="14" />
        </button>
      </div>
      <div :class="bem('content')">
        <pre :class="bem('code')">{{ node?.path || '/' }}</pre>
      </div>
    </div>
  </BModal>
</template>

<script setup lang="ts">
import type { JsonFlowNodeData, JsonNodeKind, JsonRecordRow } from '../types';
import { computed } from 'vue';
import { useClipboard } from '@/hooks/useClipboard';
import { createNamespace } from '@/utils/namespace';

defineOptions({ name: 'BJsonViewerNodeDetailModal' });

/**
 * 组件入参。
 */
interface Props {
  /** 弹窗显示状态。 */
  open: boolean;
  /** 当前选中节点数据。 */
  node: JsonFlowNodeData | null;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  /** 弹窗显示状态变更。 */
  (e: 'update:open', value: boolean): void;
}>();

const [, bem] = createNamespace('', 'b-json-viewer-node-detail');

const { clipboard } = useClipboard();

/** 双向绑定弹窗显示状态。 */
const visible = computed<boolean>({
  get: () => props.open,
  set: (val: boolean) => emit('update:open', val)
});

/** 语法高亮颜色映射，使用主题变量。 */
const KIND_VAR: Record<JsonNodeKind, string> = {
  string: 'var(--json-viewer-value)',
  number: 'var(--json-viewer-number)',
  boolean: 'var(--json-viewer-boolean)',
  null: 'var(--json-viewer-null)',
  object: 'var(--json-viewer-value)',
  array: 'var(--json-viewer-value)'
};

/** Key 颜色主题变量。 */
const KEY_VAR = 'var(--json-viewer-key)';

/**
 * HTML 特殊字符转义。
 * @param text - 原始文本
 * @returns 转义后文本
 */
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * 对单条记录行进行语法高亮。
 * @param row - 卡片行数据
 * @returns HTML 字符串
 */
function highlightRow(row: JsonRecordRow): string {
  const keyHtml = `<span style="color:${KEY_VAR}">${escapeHtml(row.key)}</span>`;
  const valueVar = KIND_VAR[row.kind];
  const valueHtml = `<span style="color:${valueVar}">${escapeHtml(row.value)}</span>`;

  return `  ${keyHtml}: ${valueHtml}`;
}

/** 格式化的内容 HTML（带语法高亮）。 */
const formattedContent = computed<string>(() => {
  if (!props.node) {
    return '';
  }

  if (props.node.variant === 'value') {
    const varName = KIND_VAR[props.node.kind];

    return `<span style="color:${varName}">${escapeHtml(props.node.valueText)}</span>`;
  }

  const rows = props.node.rows.map((row) => highlightRow(row)).join(',\n');

  return `{\n${rows}\n}`;
});

/**
 * 复制内容到剪贴板。
 */
function copyContent(): void {
  if (!props.node) {
    return;
  }

  let text: string;

  if (props.node.variant === 'value') {
    text = props.node.valueText;
  } else {
    text = `{${props.node.rows.map((row) => `\n  "${row.key}": ${row.value}`).join(',')}\n}`;
  }

  clipboard(text);
}

/**
 * 复制路径到剪贴板。
 */
function copyPath(): void {
  if (!props.node) {
    return;
  }

  clipboard(props.node.path || '/');
}
</script>

<style lang="less">
.b-json-viewer-node-detail__section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.b-json-viewer-node-detail__section + .b-json-viewer-node-detail__section {
  margin-top: 16px;
}

.b-json-viewer-node-detail__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.b-json-viewer-node-detail__title {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
}

.b-json-viewer-node-detail__copy {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  color: var(--text-tertiary);
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: var(--control-radius);
  transition: color var(--motion-duration-base) var(--motion-easing-standard);

  &:hover {
    color: var(--text-primary);
  }
}

.b-json-viewer-node-detail__content {
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.6;
  background: var(--bg-secondary);
  border-radius: var(--surface-radius);
}

.b-json-viewer-node-detail__code {
  padding: 16px;
  margin: 0;
  overflow-x: auto;
  overflow-wrap: break-word;
  white-space: pre-wrap;
  user-select: text;
}
</style>
