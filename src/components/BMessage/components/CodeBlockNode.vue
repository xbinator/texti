<!--
  @file CodeBlockNode.vue
  @description BMessage Markdown 代码块渲染组件，支持语法高亮与复制。
-->
<template>
  <div :class="bem('code-block')">
    <div :class="bem('code-header')">
      <span :class="bem('code-language')">{{ displayLanguage }}</span>
      <button type="button" :class="bem('code-copy')" title="复制代码" aria-label="复制代码" @click="handleCopyClick">
        <BIcon icon="lucide:copy" :size="14" />
      </button>
    </div>
    <div v-if="isMermaidPreviewVisible" :class="bem('mermaid-preview')">
      <div v-if="mermaidError" :class="bem('mermaid-error')">
        <BIcon icon="lucide:alert-circle" />
        <span>{{ mermaidError }}</span>
      </div>
      <div v-else ref="mermaidPreviewRef" :class="bem('mermaid-diagram')"></div>
    </div>
    <pre v-else :class="bem('code-pre')"><code :class="[bem('code-content'), codeClassName]"><CodeHighlightNode
      v-for="(child, index) in highlightedNodes"
      :key="index"
      :node="child"
    /></code></pre>
  </div>
</template>

<script setup lang="ts">
/* eslint-disable no-use-before-define -- 代码高亮节点是递归结构，类型与组件渲染存在自然递归。 */
import type { CodeBlockNode as MessageCodeBlockNode } from '../types';
import type { CodeHighlightRenderNode } from '../utils/codeHighlight';
import type { PropType, VNodeChild } from 'vue';
import { computed, defineComponent, h, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { getRenderableMermaidSource } from '@/components/BEditor/utils/mermaidMarkdown';
import { useClipboard } from '@/hooks/useClipboard';
import { createNamespace } from '@/utils/namespace';
import { highlightMessageCode } from '../utils/codeHighlight';
import { createMessageMermaidRenderId } from '../utils/messageHelper';

defineOptions({ name: 'CodeBlockNode' });

const [, bem] = createNamespace('message');
let mermaidInitialized = false;
let mermaidCurrentTheme = '';
let mermaidModule: typeof import('mermaid').default | null = null;

/**
 * CodeBlockNode 组件属性。
 */
interface Props {
  /** 待渲染的代码块节点 */
  node: MessageCodeBlockNode;
}

const props = defineProps<Props>();
const { clipboard } = useClipboard();
const mermaidPreviewRef = ref<HTMLElement | null>(null);
const mermaidError = ref<string | null>(null);
let mermaidRenderIndex = 0;

/**
 * 代码高亮节点递归渲染组件。
 */
const CodeHighlightNode = defineComponent({
  name: 'CodeHighlightNode',
  props: {
    node: {
      type: Object as PropType<CodeHighlightRenderNode>,
      required: true
    }
  },
  setup(componentProps): () => VNodeChild {
    return () => {
      if (componentProps.node.type === 'text') {
        return componentProps.node.value;
      }

      return h(
        'span',
        { class: componentProps.node.className || undefined },
        componentProps.node.children.map((child: CodeHighlightRenderNode) => h(CodeHighlightNode, { node: child }))
      );
    };
  }
});

const rawLanguage = computed(() => props.node.lang?.trim().split(/\s+/, 1)[0]?.toLowerCase() ?? '');
const displayLanguage = computed(() => formatDisplayLanguage(rawLanguage.value || 'text'));
const codeClassName = computed(() => (rawLanguage.value ? `language-${rawLanguage.value}` : undefined));
const isMermaidLanguage = computed(() => rawLanguage.value === 'mermaid');
const hasCode = computed(() => props.node.text.trim().length > 0);
const isMermaidPreviewVisible = computed(() => isMermaidLanguage.value && hasCode.value && props.node.complete);
const highlightedNodes = computed<CodeHighlightRenderNode[]>(() => highlightMessageCode(rawLanguage.value, props.node.text, props.node.complete));

/**
 * 初始化 Mermaid 渲染实例。
 * @returns Mermaid 默认导出实例
 */
async function initMermaid(): Promise<typeof import('mermaid').default> {
  if (!mermaidModule) {
    const module = await import('mermaid');
    mermaidModule = module.default;
  }

  const isDark = typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark';
  const theme = isDark ? 'dark' : 'default';

  if (mermaidInitialized && mermaidCurrentTheme === theme) {
    return mermaidModule;
  }

  mermaidModule.initialize({
    startOnLoad: false,
    theme,
    securityLevel: 'loose',
    fontFamily: 'inherit',
    suppressErrorRendering: true
  });

  mermaidInitialized = true;
  mermaidCurrentTheme = theme;

  return mermaidModule;
}

/**
 * 渲染 Mermaid 图表。
 */
async function renderMermaid(): Promise<void> {
  if (!isMermaidPreviewVisible.value) return;

  const renderIndex = ++mermaidRenderIndex;
  const code = getRenderableMermaidSource(props.node.text);

  mermaidError.value = null;
  await nextTick();

  if (!mermaidPreviewRef.value || renderIndex !== mermaidRenderIndex || !isMermaidPreviewVisible.value) return;

  try {
    const mermaid = await initMermaid();
    const { svg } = await mermaid.render(createMessageMermaidRenderId(), code);

    if (!mermaidPreviewRef.value || renderIndex !== mermaidRenderIndex) return;

    mermaidPreviewRef.value.innerHTML = svg;
  } catch (error: unknown) {
    if (renderIndex !== mermaidRenderIndex) return;

    mermaidError.value = error instanceof Error ? error.message : '渲染失败';

    if (mermaidPreviewRef.value) {
      mermaidPreviewRef.value.innerHTML = '';
    }
  }
}

/**
 * 格式化代码块语言展示名称。
 * @param language - 代码块语言
 * @returns 首字母大写后的展示名称
 */
function formatDisplayLanguage(language: string): string {
  return language.charAt(0).toUpperCase() + language.slice(1);
}

/**
 * 复制代码块原始文本。
 */
async function handleCopyClick(): Promise<void> {
  await clipboard(props.node.text, {
    successMessage: '代码已复制',
    trim: false
  });
}

watch(
  () => [isMermaidPreviewVisible.value, props.node.text] as const,
  () => {
    renderMermaid();
  }
);

onMounted(() => {
  renderMermaid();
});

onUnmounted(() => {
  mermaidRenderIndex += 1;
});
</script>

<style scoped lang="less">
@import url('@/assets/styles/markdown.less');

.b-message__code-block {
  margin: 0.6em 0;
  overflow: hidden;
  background: var(--bg-primary);
  border: var(--surface-border-width) solid var(--border-secondary);
  border-radius: var(--surface-radius);
}

.b-message__code-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 34px;
  padding: 6px 8px 6px 12px;
  color: var(--text-secondary);
  background: var(--bg-tertiary);
  border-bottom: var(--surface-border-width) solid var(--border-secondary);
}

.b-message__code-language {
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1;
}

.b-message__code-copy {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  color: var(--code-text);
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: var(--control-radius);
  transition: color var(--motion-duration-base) var(--motion-easing-standard), background var(--motion-duration-base) var(--motion-easing-standard);
}

.b-message__code-copy:hover,
.b-message__code-copy:focus-visible {
  color: var(--code-text);
  background: var(--code-line-bg);
}

.b-message__code-pre {
  padding: 0;
  margin: 0;
  overflow: auto;
  background: transparent;
  border: 0;
  border-radius: 0;
}

.b-message__code-content {
  display: block;
  padding: 12px;
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.65;
  white-space: pre;
  background: transparent;
  border-radius: 0;
  .code-highlight();
}

.b-message__mermaid-preview {
  padding: 20px;
  overflow: auto;
  background: var(--bg-primary);
}

.b-message__mermaid-diagram {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100px;
}

.b-message__mermaid-diagram :deep(svg) {
  max-width: 100%;
  height: auto;
}

.b-message__mermaid-error {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
  justify-content: center;
  min-height: 100px;
  font-size: 14px;
  color: var(--color-error);
  text-align: center;
}
</style>
