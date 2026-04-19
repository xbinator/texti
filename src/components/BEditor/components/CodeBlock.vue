<template>
  <NodeViewWrapper class="b-code-block" :class="{ 'is-collapsed': isCollapsed, 'is-word-wrap': isWordWrap }">
    <div class="b-code-block__header" contenteditable="false">
      <BSelect v-model:value="selectedLanguage" :width="200" :options="languageOptions" @change="handleLanguageChange" />

      <div class="flex-1"></div>

      <button
        v-if="isMermaidLanguage"
        type="button"
        class="b-code-block__control-btn"
        :class="{ 'is-active': isMermaidPreviewVisible }"
        :disabled="!hasMermaidCode"
        :title="hasMermaidCode ? '预览' : '输入代码后可预览'"
        @mousedown.prevent
        @click="toggleMermaidPreview"
      >
        <Icon :icon="showMermaidPreview ? 'lucide:eye-off' : 'lucide:eye'" />
      </button>

      <button type="button" class="b-code-block__control-btn" :class="{ 'is-active': isCollapsed }" @mousedown.prevent @click="toggleCollapse">
        <Icon :icon="isCollapsed ? 'lucide:chevron-down' : 'lucide:chevron-up'" />
      </button>

      <button type="button" class="b-code-block__copy" :title="copyLabel" :aria-label="copyLabel" @mousedown.prevent @click="handleCopy">
        <Icon class="b-code-block__copy-icon" :icon="copyIconName" />
      </button>
    </div>

    <div v-show="!isCollapsed" class="b-code-block__body-wrapper">
      <div v-show="isMermaidPreviewVisible" class="b-code-block__mermaid-preview" contenteditable="false">
        <div v-if="renderError" class="b-code-block__mermaid-error">
          <Icon icon="lucide:alert-circle" />
          <span>{{ renderError }}</span>
        </div>
        <div v-else ref="mermaidPreviewRef" class="b-code-block__mermaid-diagram"></div>
      </div>
      <pre v-show="!isMermaidPreviewVisible" class="b-code-block__body"><NodeViewContent as="code" :class="codeClassName" /></pre>
    </div>
  </NodeViewWrapper>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { Icon } from '@iconify/vue';
import { NodeViewContent, NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3';
import { useClipboard, useDebounceFn } from '@vueuse/core';
import { message } from 'ant-design-vue';
import BSelect from '@/components/BSelect/index.vue';

// ─── 类型 ────────────────────────────────────────────────────────────────────

type CopyState = '复制' | '已复制' | '复制失败';

// ─── 常量 ────────────────────────────────────────────────────────────────────

const COPY_ICON_MAP: Record<CopyState, string> = {
  复制: 'lucide:copy',
  已复制: 'lucide:check',
  复制失败: 'lucide:x'
};

const COPY_RESET_DELAY = 1500;
const MERMAID_DEBOUNCE_DELAY = 300;

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
let mermaidModulePromise: Promise<typeof import('mermaid')> | null = null;

async function loadMermaidModule(): Promise<typeof import('mermaid')> {
  if (!mermaidModulePromise) {
    mermaidModulePromise = import('mermaid');
  }

  return mermaidModulePromise;
}

async function initMermaid(): Promise<typeof import('mermaid').default> {
  const mermaidModule = await loadMermaidModule();
  const mermaid = mermaidModule.default;
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const theme = isDark ? 'dark' : 'default';

  // 主题未变化时跳过重新初始化
  if (mermaidInitialized && mermaidCurrentTheme === theme) {
    return mermaid;
  }

  mermaid.initialize({
    startOnLoad: false,
    theme,
    securityLevel: 'loose',
    fontFamily: 'inherit'
  });

  mermaidInitialized = true;
  mermaidCurrentTheme = theme;

  return mermaid;
}

// ─── 组件 ────────────────────────────────────────────────────────────────────

const props = defineProps(nodeViewProps);

const { copy } = useClipboard();

// UI 状态
const copyState = ref<CopyState>('复制');
const isCollapsed = ref(false);
const isWordWrap = ref(false);
const showMermaidPreview = ref(true);
const renderError = ref<string | null>(null);
const mermaidPreviewRef = ref<HTMLElement | null>(null);

// 渲染竞态守卫
let mermaidRenderIndex = 0;

// 复制重置定时器
let resetTimer: ReturnType<typeof setTimeout> | null = null;

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
const hasMermaidCode = computed(() => codeContent.value.trim().length > 0);
const isMermaidPreviewVisible = computed(() => isMermaidLanguage.value && showMermaidPreview.value && hasMermaidCode.value);

// 复制按钮图标，通过 Map 替代多分支 if
const copyIconName = computed(() => COPY_ICON_MAP[copyState.value]);
// 保持模板兼容（原来用 copyLabel 绑定 title/aria-label）
const copyLabel = computed(() => copyState.value);

// ─── Mermaid 渲染 ────────────────────────────────────────────────────────────

async function renderMermaid(): Promise<void> {
  // 提前退出：预览不可见时无需渲染
  if (!isMermaidPreviewVisible.value) return;

  const code = codeContent.value.trim();

  // 提前退出：无内容时清空画布
  if (!code) {
    renderError.value = null;
    if (mermaidPreviewRef.value) mermaidPreviewRef.value.innerHTML = '';
    return;
  }

  // 占领本次渲染序号，用于后续竞态检测
  const renderIndex = ++mermaidRenderIndex;

  renderError.value = null;
  await nextTick();

  // 提前退出：等待期间状态已变化
  if (!mermaidPreviewRef.value) return;
  if (!isMermaidPreviewVisible.value) return;
  if (renderIndex !== mermaidRenderIndex) return;

  try {
    const mermaid = await initMermaid();
    const mermaidId = `mermaid-${Date.now()}-${renderIndex}`;
    const { svg } = await mermaid.render(mermaidId, code);

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

  try {
    await copy(text);
    copyState.value = '已复制';
    message.success('复制成功');
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
}

function toggleCollapse(): void {
  isCollapsed.value = !isCollapsed.value;
}

function toggleMermaidPreview(): void {
  // 提前退出：没有代码时不允许切换
  if (!hasMermaidCode.value) return;

  showMermaidPreview.value = !showMermaidPreview.value;

  if (showMermaidPreview.value) renderMermaid();
}

// ─── 侦听器 ──────────────────────────────────────────────────────────────────

// 代码变化时防抖渲染（避免每次击键都触发）
watch(codeContent, () => {
  if (isMermaidPreviewVisible.value) debouncedRenderMermaid();
});

// 预览可见性变化时立即渲染（用户主动切换，需要即时响应）
watch(isMermaidPreviewVisible, (visible: boolean) => {
  if (visible) renderMermaid();
});

// ─── 生命周期 ────────────────────────────────────────────────────────────────

onMounted(() => {
  if (isMermaidPreviewVisible.value) renderMermaid();
});

onUnmounted(() => {
  // 使所有进行中的异步渲染失效
  mermaidRenderIndex++;

  if (resetTimer !== null) {
    clearTimeout(resetTimer);
    resetTimer = null;
  }
});
</script>

<style lang="less" scoped>
.b-code-block {
  margin: 0.75em 0;
  overflow: hidden;
  background: var(--code-bg);
  border: 1px solid var(--code-border);
  border-radius: 6px;
  box-shadow: var(--shadow-sm);
  transition: all 0.2s ease;

  &.is-collapsed {
    .b-code-block__body-wrapper {
      display: none;
    }
  }

  &.is-word-wrap {
    .b-code-block__body {
      code {
        overflow-wrap: break-word;
        white-space: pre-wrap;
      }
    }
  }
}

.b-code-block__header {
  display: flex;
  gap: 6px;
  align-items: center;
  justify-content: space-between;
  height: 42px;
  padding: 0 14px;
  background: var(--code-header-bg);
}

.b-code-block__control-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  color: var(--code-line-number);
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: 4px;
  transition: all 0.2s ease;

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

.b-code-block__copy {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  color: var(--code-text);
  cursor: pointer;
  background: transparent;
  border-radius: 4px;
  transition: all 0.2s ease;

  &:hover {
    background: var(--code-line-bg);
  }
}

.b-code-block__copy-icon {
  font-size: 14px;
}

.b-code-block__body-wrapper {
  overflow: hidden;
}

.b-code-block__mermaid-preview {
  padding: 20px;
  overflow: auto;
  background: var(--bg-primary);
  border-top: 1px solid var(--code-border);
}

.b-code-block__mermaid-diagram {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100px;

  :deep(svg) {
    max-width: 100%;
    height: auto;
  }
}

.b-code-block__mermaid-placeholder {
  font-size: 14px;
  color: var(--text-tertiary);
}

.b-code-block__mermaid-error {
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

.b-code-block__body {
  padding: 16px;
  margin: 0;
  overflow-x: auto;
  background: var(--code-bg);
  border-top: 1px solid var(--code-border);
}
</style>
