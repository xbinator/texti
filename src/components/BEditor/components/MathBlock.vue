<!--
  @file MathBlock.vue
  @description BEditor Rich 模式块级数学公式 NodeView，支持预览与 LaTeX 编辑切换。
-->
<template>
  <NodeViewWrapper :class="[name, { 'is-editing': isEditing }]">
    <div class="b-markdown-mathblock__header" contenteditable="false">
      <span class="b-markdown-mathblock__label">Formula</span>

      <button
        type="button"
        :class="[bem('control-btn'), { 'is-active': isPreviewVisible }]"
        :title="isPreviewVisible ? '编辑' : '预览'"
        :aria-label="isPreviewVisible ? '编辑公式' : '预览公式'"
        @mousedown.prevent
        @click="togglePreview"
      >
        <BIcon :icon="isPreviewVisible ? 'lucide:eye-off' : 'lucide:eye'" />
      </button>
    </div>

    <textarea
      v-if="isEditing"
      ref="textarea"
      v-model="input"
      class="b-markdown-mathblock__editor"
      spellcheck="false"
      contenteditable="false"
      @input="handleLatexInput"
    ></textarea>

    <div v-else class="b-markdown-mathblock__preview" contenteditable="false">
      <div v-if="previewHtml" class="b-markdown-mathblock__preview-inner" v-html="previewHtml"></div>
      <div v-else class="b-markdown-mathblock__empty">输入 LaTeX 公式</div>
    </div>
  </NodeViewWrapper>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3';
import { useTextareaAutosize } from '@vueuse/core';
import katex from 'katex';
import { createNamespace } from '@/utils/namespace';

const [name, bem] = createNamespace('markdown-mathblock');

const props = defineProps(nodeViewProps);

const isEditing = ref(false);
const isPreviewVisible = computed<boolean>(() => !isEditing.value);

const latex = computed<string>(() => (typeof props.node.attrs.latex === 'string' ? props.node.attrs.latex : ''));
const draftLatex = ref(latex.value);
// @ts-ignore
const { textarea, input, triggerResize } = useTextareaAutosize({
  input: draftLatex
});

/**
 * 渲染 KaTeX 预览 HTML。
 * @returns KaTeX HTML，公式为空时返回空字符串
 */
const previewHtml = computed<string>(() => {
  const source = latex.value.trim();
  if (!source) {
    return '';
  }

  return katex.renderToString(source, {
    displayMode: true,
    throwOnError: false
  });
});

watch(latex, (value: string): void => {
  if (draftLatex.value !== value) {
    draftLatex.value = value;
    triggerResize();
  }
});

/**
 * 切换预览和编辑状态。
 */
function togglePreview(): void {
  isEditing.value = !isEditing.value;
}

/**
 * 处理 LaTeX 输入并同步到 Tiptap 节点属性。
 * @param event - textarea 输入事件
 */
function handleLatexInput(event: Event): void {
  const { target } = event;
  if (!(target instanceof HTMLTextAreaElement)) {
    return;
  }

  draftLatex.value = target.value;
  props.updateAttributes({ latex: target.value });
  triggerResize();
}
</script>

<style lang="less" scoped>
.b-markdown-mathblock {
  display: block;
  margin: 0.75em 0;
  overflow: hidden;
  background: var(--code-bg);
  border: var(--surface-border-width) solid var(--code-border);
  border-radius: var(--surface-radius);
  box-shadow: var(--shadow-sm);
  transition: border-color var(--motion-duration-base) var(--motion-easing-standard), box-shadow var(--motion-duration-base) var(--motion-easing-standard),
    background var(--motion-duration-base) var(--motion-easing-standard);
}

.b-markdown-mathblock__header {
  display: flex;
  gap: 6px;
  align-items: center;
  justify-content: space-between;
  height: 42px;
  padding: 0 14px;
  background: var(--code-header-bg);
}

.b-markdown-mathblock__label {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--code-line-number);
}

.b-markdown-mathblock__control-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  color: var(--code-line-number);
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: var(--control-radius);
  transition: color var(--motion-duration-base) var(--motion-easing-standard), background var(--motion-duration-base) var(--motion-easing-standard);

  &:hover {
    color: var(--code-text);
    background: var(--code-line-bg);
  }

  &.is-active {
    color: var(--color-info);
    background: var(--code-line-hover-bg);
  }
}

.b-markdown-mathblock__preview {
  min-height: 72px;
  padding: 20px;
  overflow-x: auto;
  background: var(--bg-primary);
  border-top: var(--surface-border-width) solid var(--code-border);
}

.b-markdown-mathblock__preview-inner {
  min-width: max-content;
}

.b-markdown-mathblock__empty {
  font-size: 13px;
  color: var(--text-tertiary);
}

.b-markdown-mathblock__editor {
  display: block;
  width: 100%;
  min-height: 120px;
  padding: 14px 16px;
  font-family: var(--font-mono);
  font-size: 14px;
  line-height: 1.6;
  color: var(--code-text);
  resize: none;
  outline: none;
  background: var(--code-bg);
  border: 0;
  border-top: var(--surface-border-width) solid var(--code-border);
}
</style>
