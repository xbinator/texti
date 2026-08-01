<!--
  @file index.vue
  @description BSkill 入口组件，文件预览：支持文件系统模式（rootPath）和虚拟文件模式（virtualFiles）。
-->
<template>
  <div :class="bem()">
    <div :class="bem('body')">
      <BPanelSplitter v-show="showFileTree" position="right" :size="220" :min-width="160" :max-width="300" :closable="false">
        <FileTree :root-path="rootPath" :virtual-paths="virtualPaths" :selected-file-path="selectedFilePath" @select-file="selectFile" @loaded="onTreeLoaded" />
      </BPanelSplitter>

      <div :class="bem('pane')">
        <div :class="bem('header')">
          <span :class="bem('file-name')">{{ selectedFileName }}</span>
          <div v-if="fileState.status === 'success'" :class="bem('header-actions')">
            <BButton v-if="canEditFile" type="text" square size="mini" :loading="editingFile" @click="editFile">
              <Icon icon="lucide:pencil" :width="12" />
            </BButton>

            <BButton type="text" square size="mini" @click="copyContent">
              <Icon icon="lucide:copy" :width="12" />
            </BButton>
          </div>
        </div>

        <BScrollbar :class="bem('content-wrapper')">
          <div v-if="fileState.status === 'loading'" :class="bem('empty')">正在读取文件…</div>
          <div v-else-if="fileState.status === 'error'" :class="bem('error')">
            {{ fileState.message }}
          </div>
          <template v-else-if="fileState.status === 'success'">
            <pre v-if="shouldSkipHighlight" :class="bem('content')"><code>{{ fileState.content }}</code></pre>
            <pre v-else :class="bem('content')"><code><CodeHighlightNode
              v-for="(renderNode, index) in highlightedNodes"
              :key="index"
              :node="renderNode"
            /></code></pre>
          </template>
        </BScrollbar>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * @file index.vue
 * @description BSkill 入口组件，文件预览：支持文件系统模式（rootPath）和虚拟文件模式（virtualFiles）。
 */

import type { BSkillProps as Props } from './types';
import type { PropType, VNodeChild } from 'vue';
import { computed, defineComponent, h, ref, watch } from 'vue';
import { Icon } from '@iconify/vue';
import { message } from 'ant-design-vue';
import type { CodeHighlightRenderNode } from '@/components/BMessage/utils/codeHighlight';
import { highlightMessageCode } from '@/components/BMessage/utils/codeHighlight';
import { useClipboard } from '@/hooks/useClipboard';
import { useNavigate } from '@/hooks/useNavigate';
import { native } from '@/shared/platform';
import { asyncTo } from '@/utils/asyncTo';
import { createNamespace } from '@/utils/namespace';
import FileTree from './components/FileTree.vue';
import { detectLanguage } from './utils/languageDetect';

const [, bem] = createNamespace('skill');

const props = defineProps<Props>();

const emit = defineEmits<{
  (event: 'loaded', fileCount: number): void;
}>();

if (import.meta.env.DEV && props.rootPath && props.virtualFiles) {
  console.warn('[BSkill] rootPath 与 virtualFiles 互斥，同时传入时仅 virtualFiles 生效');
}

// ─── Types ───────────────────────────────────────────────────────────────────

type FileState = { status: 'idle' } | { status: 'loading' } | { status: 'success'; content: string } | { status: 'error'; message: string };

// ─── Local components ────────────────────────────────────────────────────────

/**
 * 递归渲染单个 CodeHighlightRenderNode 为带 hljs 类名的 <span>。
 * 定义为局部组件，使父组件 scoped 样式的 .hljs-* 选择器能自动作用于递归节点。
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
    return (): VNodeChild => {
      // 文本节点直接返回字符串，由父 <code> 包裹
      if (componentProps.node.type === 'text') {
        return componentProps.node.value;
      }

      // 元素节点渲染为带 hljs 类名的 span，递归渲染子节点
      return h(
        'span',
        { class: componentProps.node.className || undefined },
        componentProps.node.children.map((child: CodeHighlightRenderNode): VNodeChild => h(CodeHighlightNode, { node: child }))
      );
    };
  }
});

// ─── State ───────────────────────────────────────────────────────────────────

const { clipboard } = useClipboard();
const { openFileByPath } = useNavigate();

const selectedFilePath = ref('');
const fileState = ref<FileState>({ status: 'idle' });
const treeFileCount = ref(0);
const editingFile = ref(false);

/** 请求版本号，用于丢弃过期的异步结果 */
let requestVersion = 0;

// ─── Derived ─────────────────────────────────────────────────────────────────

const virtualFileMap = computed<Map<string, string>>(() => {
  const map = new Map<string, string>();
  props.virtualFiles?.forEach((f) => map.set(f.path, f.content));
  return map;
});

const virtualPaths = computed<string[]>(() => [...virtualFileMap.value.keys()]);

const showFileTree = computed<boolean>(() => treeFileCount.value > 1);

const selectedFileName = computed<string>(() => selectedFilePath.value.split('/').at(-1) || '未选择文件');

/** 真实文件加载成功后允许跳转到编辑器，虚拟预览文件仅支持查看。 */
const canEditFile = computed<boolean>(() => props.editable && Boolean(props.rootPath) && !props.virtualFiles && Boolean(selectedFilePath.value));

/** 超过此字符数的文件跳过语法高亮，避免 lowlight 同步解析大文件造成卡顿。 */
const HIGHLIGHT_MAX_CHARS = 200 * 1024;

/** 当前选中文件推断出的高亮语言名（未识别为空字符串）。 */
const highlightLanguage = computed<string>(() => detectLanguage(selectedFilePath.value));

/** 是否跳过语法高亮（非成功状态或大文件）。 */
const shouldSkipHighlight = computed<boolean>(() => {
  if (fileState.value.status !== 'success') return true;
  return fileState.value.content.length > HIGHLIGHT_MAX_CHARS;
});

/** 高亮渲染节点树；跳过时返回空数组。 */
const highlightedNodes = computed<CodeHighlightRenderNode[]>(() => {
  if (shouldSkipHighlight.value || fileState.value.status !== 'success') return [];
  return highlightMessageCode(highlightLanguage.value, fileState.value.content, true);
});

// ─── File loading ─────────────────────────────────────────────────────────────

async function readContent(filePath: string): Promise<string> {
  if (props.virtualFiles) {
    const content = virtualFileMap.value.get(filePath);
    if (content === undefined) throw new Error('文件不在虚拟文件列表中');
    return content;
  }
  const { content } = await native.readFile(filePath);
  return content;
}

async function selectFile(filePath: string): Promise<void> {
  if (filePath === selectedFilePath.value) return;

  const version = ++requestVersion;
  selectedFilePath.value = filePath;
  fileState.value = { status: 'loading' };
  const [error, content] = await asyncTo(readContent(filePath));

  if (version !== requestVersion) return;
  if (error) {
    fileState.value = { status: 'error', message: error.message || '无法预览该文件' };
    return;
  }

  fileState.value = { status: 'success', content };
}

// ─── Event handlers ───────────────────────────────────────────────────────────

function onTreeLoaded(count: number): void {
  treeFileCount.value = count;
  emit('loaded', count);
  //
  props.initialFilePath && selectFile(props.initialFilePath);
}

function copyContent(): void {
  if (fileState.value.status !== 'success') return;
  clipboard(fileState.value.content, { successMessage: '内容已复制' });
}

/**
 * 在 Markdown 编辑器中打开当前选中的真实文件。
 */
async function editFile(): Promise<void> {
  if (!canEditFile.value || editingFile.value) return;

  const filePath = selectedFilePath.value;
  editingFile.value = true;
  const [error, openedFile] = await asyncTo(openFileByPath(filePath));
  editingFile.value = false;

  if (error || !openedFile) {
    message.error(`无法在编辑器中打开“${selectedFileName.value}”`);
  }
}

// ─── Watchers ─────────────────────────────────────────────────────────────────

// 数据源切换时令飞行中的请求失效并重置状态
watch([() => props.rootPath, () => props.virtualFiles], () => {
  requestVersion++;
  selectedFilePath.value = '';
  fileState.value = { status: 'idle' };
});

// ─── Expose ───────────────────────────────────────────────────────────────────

defineExpose({
  selectFile,
  copyContent
});
</script>

<style scoped lang="less">
@import url('@/assets/styles/markdown.less');

.b-skill {
  display: flex;
  flex: 1;
  min-height: 0;
  user-select: text;
}

.b-skill__body {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--border-tertiary);
  border-radius: 6px;
}

.b-skill__pane {
  display: flex;
  flex: 1;
  flex-direction: column;
  width: 0;
  background: var(--bg-primary);

  // 移入 pane 时才显示 header-actions
  &:hover .b-skill__header-actions {
    opacity: 1;
  }
}

.b-skill__content-wrapper {
  flex: 1;
  min-height: 0;
}

.b-skill__header {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
  min-height: 36px;
  padding: 0 12px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  border-bottom: 1px solid var(--border-tertiary);
}

.b-skill__file-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.b-skill__header-actions {
  display: flex;
  flex-shrink: 0;
  gap: 5px;
  align-items: center;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.b-skill__content {
  flex: 1;
  min-height: 0;
  padding: 12px;
  margin: 0;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace);
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-primary);
  overflow-wrap: anywhere;
  white-space: pre-wrap;

  // 复用 markdown.less 的 hljs 主题色（基于 --code-* CSS 变量）
  .code-highlight();
}

.b-skill__empty,
.b-skill__error {
  padding: 12px;
  font-size: 12px;
  color: var(--text-secondary);
}

.b-skill__error {
  color: var(--color-danger, #ff4d4f);
}
</style>
