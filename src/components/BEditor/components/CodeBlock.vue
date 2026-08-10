<template>
  <NodeViewWrapper :class="[name, { 'is-collapsed': isCollapsed, 'is-word-wrap': isWordWrap }]">
    <div :class="bem('header')" data-export-ignore contenteditable="false">
      <BSelect
        v-model:value="selectedLanguage"
        :width="200"
        :options="languageOptions"
        :get-popup-container="(triggerNode) => triggerNode.parentNode?.parentNode as HTMLElement"
        @change="handleLanguageChange"
      />

      <div class="flex-1"></div>

      <!-- 预览切换按钮：Mermaid 和 JSON 共用同一个按钮，通过 activePreview 统一控制 -->
      <button
        v-if="isMermaidLanguage || isJsonLanguage"
        type="button"
        :class="[bem('control-btn'), { 'is-active': isPreviewVisible }]"
        :disabled="!hasCode"
        :title="hasCode ? '预览' : '输入代码后可预览'"
        @mousedown.prevent
        @click="togglePreview"
      >
        <BIcon :icon="isPreviewVisible ? 'lucide:eye-off' : 'lucide:eye'" />
      </button>

      <button type="button" :class="[bem('control-btn'), { 'is-active': isCollapsed }]" @mousedown.prevent @click="toggleCollapse">
        <BIcon :icon="isCollapsed ? 'lucide:chevron-down' : 'lucide:chevron-up'" />
      </button>

      <button type="button" :class="bem('copy')" :title="copyLabel" :aria-label="copyLabel" @mousedown.prevent @click="handleCopy">
        <BIcon :class="bem('copy-icon')" :icon="copyIconName" />
      </button>
    </div>

    <div v-show="!isCollapsed" :class="bem('body-wrapper')">
      <!-- Mermaid 图预览区域 -->
      <BSuspense v-if="isMermaidLanguage" :active="activePreview === 'mermaid' && hasCode" :class="bem('mermaid-preview')" contenteditable="false">
        <div v-if="renderError" :class="bem('mermaid-error')">
          <BIcon icon="lucide:alert-circle" />
          <span>{{ renderError }}</span>
        </div>
        <div v-else ref="mermaidPreviewRef" :class="bem('mermaid-diagram')"></div>
      </BSuspense>
      <!-- JSON 图预览区域 -->
      <BSuspense v-if="isJsonLanguage" :active="activePreview === 'json' && hasCode" :class="bem('json-preview')" contenteditable="false">
        <BJsonViewer :content="codeContent" />
      </BSuspense>
      <!-- 代码区域 -->
      <pre v-show="!isPreviewVisible" :class="bem('body')"><NodeViewContent as="code" :class="codeClassName" /></pre>
    </div>
  </NodeViewWrapper>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { NodeViewContent, NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3';
import { useDebounceFn } from '@vueuse/core';
import { message } from 'ant-design-vue';
import BSelect from '@/components/BSelect/index.vue';
import { useClipboard } from '@/hooks/useClipboard';
import { createNamespace } from '@/utils/namespace';
import { extractLooseMermaidHeadingRepair, getRenderableMermaidSource } from '../utils/mermaidMarkdown';
import { createMermaidRenderId } from '../utils/mermaidRenderId';

const [name, bem] = createNamespace('markdown-codeblock');

// ─── 类型 ────────────────────────────────────────────────────────────────────

type CopyState = '复制' | '已复制' | '复制失败';
type PreviewType = 'mermaid' | 'json';

/**
 * Mermaid 误吞内容修复目标。
 */
interface MermaidRepairTarget {
  /** 修复后的 Mermaid 源码与后续 Markdown */
  repair: NonNullable<ReturnType<typeof extractLooseMermaidHeadingRepair>>;
  /** 当前代码块在 ProseMirror 文档中的位置 */
  position: number;
}

// ─── 常量 ────────────────────────────────────────────────────────────────────

const COPY_ICON_MAP: Record<CopyState, string> = {
  复制: 'lucide:copy',
  已复制: 'lucide:check',
  复制失败: 'lucide:x'
};

const COPY_RESET_DELAY = 1500;
const MERMAID_DEBOUNCE_DELAY = 300;

// 支持预览的语言，后续如需扩展只改这里
const PREVIEWABLE_LANGUAGES = new Set<PreviewType>(['mermaid', 'json']);

const LANGUAGE_OPTIONS = [
  { value: 'plaintext', label: 'Plain Text' },
  { value: 'mermaid', label: 'Mermaid' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'python', label: 'Python' },
  { value: 'java', label: 'Java' },
  { value: 'c', label: 'C' },
  { value: 'cpp', label: 'C++' },
  { value: 'csharp', label: 'C#' },
  { value: 'go', label: 'Go' },
  { value: 'rust', label: 'Rust' },
  { value: 'php', label: 'PHP' },
  { value: 'ruby', label: 'Ruby' },
  { value: 'swift', label: 'Swift' },
  { value: 'kotlin', label: 'Kotlin' },
  { value: 'sql', label: 'SQL' },
  { value: 'bash', label: 'Bash' },
  { value: 'json', label: 'JSON' },
  { value: 'yaml', label: 'YAML' },
  { value: 'xml', label: 'XML' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'css', label: 'CSS' },
  { value: 'scss', label: 'SCSS' },
  { value: 'html', label: 'HTML' },
  { value: 'vue', label: 'Vue' },
  { value: 'react', label: 'React JSX' }
];

// ─── Mermaid 单例管理（模块级，跨实例共享但感知主题变化）──────────────────────

let mermaidInitialized = false;
let mermaidCurrentTheme = '';
let mermaidModule: typeof import('mermaid').default | null = null;
const themeChangeCallbacks = new Set<() => void>();
/** 模块级主题观察器，HMR 替换时需要显式断开。 */
let mermaidThemeObserver: MutationObserver | null = null;

/**
 * 通知已挂载的 Mermaid 预览在主题变化后重新渲染
 */
function handleMermaidThemeChange(): void {
  mermaidInitialized = false;
  themeChangeCallbacks.forEach((callback: () => void) => callback());
}

if (typeof window !== 'undefined' && typeof MutationObserver !== 'undefined') {
  mermaidThemeObserver = new MutationObserver(handleMermaidThemeChange);
  mermaidThemeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme']
  });
}

if (import.meta.hot) {
  import.meta.hot.dispose((): void => {
    mermaidThemeObserver?.disconnect();
    mermaidThemeObserver = null;
    themeChangeCallbacks.clear();
    mermaidModule = null;
    mermaidInitialized = false;
    mermaidCurrentTheme = '';
  });
}

async function initMermaid(): Promise<typeof import('mermaid').default> {
  if (!mermaidModule) {
    const module = await import('mermaid');
    mermaidModule = module.default;
  }

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
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

// ─── 组件 ────────────────────────────────────────────────────────────────────

const props = defineProps(nodeViewProps);

const { clipboard, copyImage } = useClipboard();

// UI 状态
const copyState = ref<CopyState>('复制');
const isCollapsed = ref(false);
const isWordWrap = ref(false);
const renderError = ref<string | null>(null);
const mermaidPreviewRef = ref<HTMLElement | null>(null);

// 统一预览状态：null 表示不显示预览，'mermaid' / 'json' 表示当前激活的预览类型
const activePreview = ref<PreviewType | null>('mermaid');

// 渲染竞态守卫
let mermaidRenderIndex = 0;

// 复制重置定时器
let resetTimer: ReturnType<typeof setTimeout> | null = null;

// Mermaid 误吞内容修复调度状态，避免在 NodeView 初始化期间同步触发编辑器事务
let isComponentMounted = false;
let mermaidRepairScheduled = false;

// ─── Computed ────────────────────────────────────────────────────────────────

const languageOptions = computed(() => LANGUAGE_OPTIONS);

// 用 computed setter 统一管理语言状态，避免本地 ref 与 node attrs 双重状态
const selectedLanguage = computed<string>({
  get: () => (typeof props.node.attrs.language === 'string' ? props.node.attrs.language : 'plaintext'),
  set: (lang: string) => props.updateAttributes({ language: lang })
});

const codeContent = computed(() => props.node.textContent);
const codeClassName = computed(() => (selectedLanguage.value ? `language-${selectedLanguage.value}` : ''));

const isMermaidLanguage = computed(() => selectedLanguage.value === 'mermaid');
const isJsonLanguage = computed(() => selectedLanguage.value === 'json');

// 当前语言是否有内容
const hasCode = computed(() => codeContent.value.trim().length > 0);

// 预览是否可见：当前语言与激活预览类型匹配，且有内容
const isPreviewVisible = computed(() => hasCode.value && activePreview.value === selectedLanguage.value);

// 复制按钮图标，通过 Map 替代多分支 if
const copyIconName = computed(() => COPY_ICON_MAP[copyState.value]);
// 保持模板兼容（原来用 copyLabel 绑定 title/aria-label）
const copyLabel = computed(() => copyState.value);

// ─── Mermaid 文档修复 ────────────────────────────────────────────────────────

/**
 * 创建用于替换误吞内容的 Markdown 片段。
 * @param source - Mermaid 图源码
 * @param markdown - 被误吞的后续 Markdown 内容
 * @returns 可插入编辑器的 Markdown 片段
 */
function createMermaidRepairMarkdown(source: string, markdown: string): string {
  return ['```mermaid', source, '```', '', markdown].join('\n');
}

/**
 * 获取 Mermaid 误吞内容修复目标。
 * @returns 可修复目标；不满足修复条件时返回 null
 */
function getMermaidRepairTarget(): MermaidRepairTarget | null {
  if (!isMermaidLanguage.value) {
    return null;
  }

  const repair = extractLooseMermaidHeadingRepair(codeContent.value);
  if (!repair) {
    return null;
  }

  const getPosition = props.getPos;
  if (typeof getPosition !== 'function') {
    return null;
  }

  const position = getPosition();
  if (typeof position !== 'number') {
    return null;
  }

  return { repair, position };
}

/**
 * 修复被 Mermaid 代码块误吞的后续 Markdown 标题。
 * @returns 是否已发起文档修复命令
 */
function repairLooseMermaidHeading(): boolean {
  const target = getMermaidRepairTarget();
  if (!target) {
    return false;
  }

  return props.editor.commands.insertContentAt(
    { from: target.position, to: target.position + props.node.nodeSize },
    createMermaidRepairMarkdown(target.repair.source, target.repair.markdown),
    { contentType: 'markdown' }
  );
}

/**
 * 延迟修复被 Mermaid 代码块误吞的后续 Markdown。
 * @returns 是否已发现并调度修复任务
 */
function scheduleLooseMermaidHeadingRepair(): boolean {
  if (!getMermaidRepairTarget()) {
    return false;
  }

  if (mermaidRepairScheduled) {
    return true;
  }

  mermaidRepairScheduled = true;

  nextTick().then(() => {
    mermaidRepairScheduled = false;
    if (!isComponentMounted) {
      return;
    }

    repairLooseMermaidHeading();
  });

  return true;
}

// ─── Mermaid 渲染 ────────────────────────────────────────────────────────────

/**
 * 等待 mermaidPreviewRef 挂载到 DOM。
 * BSuspense 使用 v-if 控制预览区域的渲染，可能导致 ref 在 onMounted 时尚未就绪。
 * 通过递归等待（nextTick + requestAnimationFrame）轮询 ref 挂载，
 * 最多等待 MAX_WAIT_REF_ROUNDS 轮，覆盖微任务和浏览器布局两个时序。
 * @param renderIndex - 当前渲染序号，用于竞态检测
 * @param round - 当前轮询轮次
 */
async function waitForMermaidPreviewRef(renderIndex: number, round = 0): Promise<void> {
  const MAX_WAIT_REF_ROUNDS = 10;

  // ref 已就绪或已被新渲染取代，停止等待
  if (mermaidPreviewRef.value || renderIndex !== mermaidRenderIndex || round >= MAX_WAIT_REF_ROUNDS) return;

  // 先等待 Vue 响应式更新完成
  await nextTick();
  // 再等待浏览器布局帧，确保 v-if 触发的 DOM 挂载已完成
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });

  await waitForMermaidPreviewRef(renderIndex, round + 1);
}

async function renderMermaid(): Promise<void> {
  // 提前退出：预览不可见时无需渲染
  if (!isPreviewVisible.value) return;

  const code = getRenderableMermaidSource(codeContent.value);

  // 提前退出：无内容时清空画布
  if (!code) {
    renderError.value = null;
    if (mermaidPreviewRef.value) mermaidPreviewRef.value.innerHTML = '';
    return;
  }

  // 占领本次渲染序号，用于后续竞态检测
  const renderIndex = ++mermaidRenderIndex;

  renderError.value = null;

  // 等待 mermaidPreviewRef 挂载：BSuspense 的 v-if 可能导致 ref 延迟就绪
  await waitForMermaidPreviewRef(renderIndex);
  if (renderIndex !== mermaidRenderIndex) return;

  // 提前退出：等待期间状态已变化
  if (!isPreviewVisible.value) return;

  try {
    const mermaidInstance = await initMermaid();
    const mermaidId = createMermaidRenderId();
    const { svg } = await mermaidInstance.render(mermaidId, code);

    // 提前退出：渲染完成后再次检查是否仍是最新请求
    if (!mermaidPreviewRef.value || renderIndex !== mermaidRenderIndex) return;

    mermaidPreviewRef.value.innerHTML = svg;
  } catch (error: unknown) {
    // 提前退出：已被新渲染取代
    if (renderIndex !== mermaidRenderIndex) return;

    renderError.value = error instanceof Error ? error.message : '渲染失败';
    if (mermaidPreviewRef.value) mermaidPreviewRef.value.innerHTML = '';
  }
}

// 防抖版本：用户输入时避免每个字符都触发渲染
const debouncedRenderMermaid = useDebounceFn(renderMermaid, MERMAID_DEBOUNCE_DELAY);

// ─── 复制 ────────────────────────────────────────────────────────────────────

/**
 * 获取当前 Mermaid 预览 SVG 元素。
 * @returns Mermaid 预览 SVG 元素
 */
function getMermaidPreviewSvg(): SVGSVGElement {
  const svgElement = mermaidPreviewRef.value?.querySelector<SVGSVGElement>('svg');

  if (!svgElement) {
    throw new Error('暂无可复制的预览图');
  }

  return svgElement;
}

function scheduleResetCopyState(): void {
  if (resetTimer !== null) window.clearTimeout(resetTimer);

  resetTimer = setTimeout(() => {
    copyState.value = '复制';
    resetTimer = null;
  }, COPY_RESET_DELAY);
}

async function handleCopy(): Promise<void> {
  const text = props.node.textContent;

  // 提前退出：无内容不处理
  if (!text) return;

  if (isPreviewVisible.value && isMermaidLanguage.value) {
    try {
      const copied = await copyImage(getMermaidPreviewSvg(), {
        successMessage: '复制成功',
        errorMessage: '复制图片失败'
      });

      copyState.value = copied ? '已复制' : '复制失败';
    } catch (error: unknown) {
      copyState.value = '复制失败';
      message.error(error instanceof Error ? error.message : '复制图片失败');
    } finally {
      scheduleResetCopyState();
    }

    return;
  }

  try {
    const copied = await clipboard(text, {
      successMessage: '复制成功',
      trim: false
    });

    copyState.value = copied ? '已复制' : '复制失败';
    if (!copied) message.error('复制失败');
  } catch {
    copyState.value = '复制失败';
    message.error('复制失败');
  } finally {
    scheduleResetCopyState();
  }
}

// ─── 交互处理 ────────────────────────────────────────────────────────────────

function handleLanguageChange(language: unknown): void {
  // 提前退出：类型不符
  if (typeof language !== 'string') return;

  selectedLanguage.value = language; // computed setter 自动同步 node attrs

  // 切换语言时：新语言支持预览则自动打开，否则收起
  activePreview.value = PREVIEWABLE_LANGUAGES.has(language as PreviewType) ? (language as PreviewType) : null;
}

function toggleCollapse(): void {
  isCollapsed.value = !isCollapsed.value;
}

// 合并后的预览切换：Mermaid 和 JSON 共用同一套开/关逻辑
function togglePreview(): void {
  // 提前退出：没有代码时不允许切换
  if (!hasCode.value) return;

  const type = selectedLanguage.value as PreviewType;
  activePreview.value = activePreview.value === type ? null : type;

  // 仅 Mermaid 需要主动触发渲染；JSON 由 BSuspense 的 :active 响应式驱动
  if (activePreview.value === 'mermaid') renderMermaid();
}

// ─── 侦听器 ──────────────────────────────────────────────────────────────────

// 代码变化时防抖渲染（避免每次击键都触发）
watch(codeContent, () => {
  if (scheduleLooseMermaidHeadingRepair()) return;

  if (isPreviewVisible.value && isMermaidLanguage.value) debouncedRenderMermaid();
});

// 预览可见性变化时立即渲染（用户主动切换，需要即时响应）
watch(isPreviewVisible, (visible: boolean) => {
  if (visible && isMermaidLanguage.value) renderMermaid();
});

// ─── 生命周期 ────────────────────────────────────────────────────────────────

onMounted(() => {
  isComponentMounted = true;
  if (!scheduleLooseMermaidHeadingRepair() && isPreviewVisible.value) renderMermaid();
  themeChangeCallbacks.add(renderMermaid);
});

onUnmounted(() => {
  isComponentMounted = false;
  // 使所有进行中的异步渲染失效
  mermaidRenderIndex++;
  debouncedRenderMermaid.cancel();
  themeChangeCallbacks.delete(renderMermaid);

  if (resetTimer !== null) {
    clearTimeout(resetTimer);
    resetTimer = null;
  }
});
</script>

<style lang="less" scoped>
.b-markdown-codeblock {
  margin: 0.75em 0;
  overflow: hidden;
  background: var(--code-bg);
  border: var(--surface-border-width) solid var(--code-border);
  border-radius: var(--surface-radius);
  box-shadow: var(--shadow-sm);
  transition: border-color var(--motion-duration-base) var(--motion-easing-standard), box-shadow var(--motion-duration-base) var(--motion-easing-standard),
    background var(--motion-duration-base) var(--motion-easing-standard);

  &.is-collapsed {
    .b-markdown-codeblock__body-wrapper {
      display: none;
    }
  }

  &.is-word-wrap {
    .b-markdown-codeblock__body {
      code {
        overflow-wrap: break-word;
        white-space: pre-wrap;
      }
    }
  }
}

.b-markdown-codeblock__header {
  display: flex;
  gap: 6px;
  align-items: center;
  justify-content: space-between;
  height: 42px;
  padding: 0 14px;
  background: var(--code-header-bg);
}

.b-markdown-codeblock__control-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
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

  &:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }

  .is-spinning {
    animation: spin 1s linear infinite;
  }
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}

.b-markdown-codeblock__copy {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  color: var(--code-text);
  cursor: pointer;
  background: transparent;
  border-radius: var(--control-radius);
  transition: color var(--motion-duration-base) var(--motion-easing-standard), background var(--motion-duration-base) var(--motion-easing-standard);

  &:hover {
    background: var(--code-line-bg);
  }
}

.b-markdown-codeblock__copy-icon {
  font-size: 14px;
}

.b-markdown-codeblock__body-wrapper {
  overflow: hidden;

  &:first-child {
    .b-markdown-codeblock__mermaid-preview {
      border-top: none;
    }

    .b-markdown-codeblock__body {
      border-top: none;
    }
  }
}

.b-markdown-codeblock__mermaid-preview {
  padding: 20px;
  overflow: auto;
  background: var(--bg-primary);
  border-top: 1px solid var(--code-border);
}

.b-markdown-codeblock__mermaid-diagram {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100px;

  :deep(svg) {
    max-width: 100%;
    height: auto;
  }
}

.b-markdown-codeblock__json-preview {
  height: 460px;
  overflow: hidden;
  border-top: 1px solid var(--code-border);
}

.b-markdown-codeblock__mermaid-placeholder {
  font-size: 14px;
  color: var(--text-tertiary);
}

.b-markdown-codeblock__mermaid-error {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
  justify-content: center;
  min-height: 100px;
  font-size: 14px;
  color: var(--color-error);
  text-align: center;

  .iconify {
    font-size: 24px;
  }
}

.b-markdown-codeblock__body {
  padding: 16px;
  margin: 0;
  overflow-x: auto;
  background: var(--code-bg);
  border-top: 1px solid var(--code-border);
}
</style>
