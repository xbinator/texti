<!--
  @file Markdown.vue
  @description Markdown 编辑器完整布局组件，聚合大纲、编辑器面板、选区工具、快捷操作及搜索栏。
-->
<template>
  <div ref="layoutRef" class="b-markdown-layout" @click="commentActions.handleCommentClick">
    <Sidebar
      :visible="showOutline"
      :motion-enabled="outlineMotionEnabled"
      :title="editorState.name"
      :content="outlineContent"
      :anchor-id-prefix="editorState.id"
      :active-id="activeAnchorId"
      @change="handleEditorAnchorChange"
      @close="closeOutlineByDrag"
      @resize-start="cancelOutlineMotion"
      @button-close="closeOutlineByButton"
    />

    <div class="b-markdown-main">
      <BButton
        v-if="!showOutline"
        class="b-markdown-main__outline-toggle"
        type="ghost"
        size="small"
        square
        icon="lucide:list-indent-increase"
        @click="openOutlineByButton"
      />

      <BScrollbar ref="scrollbarRef" class="b-markdown-scrollbar" @scroll="handleEditorScrollEvent">
        <div class="b-markdown-container" :style="editorContainerStyle">
          <PaneRichEditor
            v-if="isRichMode"
            ref="richEditorPaneRef"
            v-model:value="content"
            v-model:outline-content="outlineContent"
            :editor-state="effectiveEditorState"
            :editable="editable"
            :on-scroll-element-into-center="scrollElementIntoCenter"
            :on-selection-host-change="handleRichSelectionHostChange"
            :on-selection-overlay-change="recomputeSelectionOverlays"
            @editor-blur="handleEditorBlur"
            @request-source-mode="handleSwitchToSource"
          />

          <PaneSourceEditor
            v-else
            ref="sourceEditorPaneRef"
            v-model:value="content"
            v-model:outline-content="outlineContent"
            :editor-id="editorState.id"
            :editor-state="effectiveEditorState"
            :on-anchor-scroll="scrollSourceAnchorIntoView"
            :editable="editable"
            :on-selection-host-change="handleSourceSelectionHostChange"
            :on-selection-overlay-change="recomputeSelectionOverlays"
            @editor-blur="handleEditorBlur"
          />

          <SelectionToolbarRich
            v-if="isRichMode && selectionToolbarKind === 'rich' && currentRichSelectionHost?.editor && !isRichLoading"
            data-export-ignore
            :editor="currentRichSelectionHost.editor"
            :visible="selectionAssistant.toolbarVisible.value"
            :position="selectionAssistant.toolbarPosition.value"
            :overlay-root="currentRichSelectionHost.overlayRoot"
            :format-buttons="formatButtons"
            @ai="selectionAssistant.openAIInput()"
            @reference="selectionAssistant.insertReference()"
            @comment="selectionAssistant.openCommentInput()"
          />

          <SelectionToolbarSource
            v-else-if="!isRichMode && selectionToolbarKind === 'source'"
            data-export-ignore
            :visible="selectionAssistant.toolbarVisible.value"
            :position="selectionAssistant.toolbarPosition.value"
            :overlay-root="currentSourceSelectionHost?.overlayRoot"
            :format-buttons="[]"
            @ai="selectionAssistant.openAIInput()"
            @reference="selectionAssistant.insertReference()"
            @comment="selectionAssistant.openCommentInput()"
          />

          <SelectionAIInput
            v-if="!isRichLoading"
            data-export-ignore
            :visible="selectionAssistant.aiInputVisible.value"
            :adapter="currentSelectionAdapter"
            :selection-range="selectionAssistant.cachedSelectionRange.value"
            :position="selectionAssistant.panelPosition.value"
            @update:visible="handleSelectionAIVisibleChange"
            @apply="selectionAssistant.applyAIResult($event)"
            @streaming-change="selectionAssistant.setStreaming($event)"
          />

          <SelectionCommentInput
            v-if="!isRichLoading"
            data-export-ignore
            :visible="selectionAssistant.commentInputVisible.value"
            :position="selectionAssistant.panelPosition.value"
            @update:visible="handleSelectionCommentVisibleChange"
            @submit="selectionAssistant.applyComment($event)"
          />

          <CommentCard
            v-if="!isRichLoading"
            data-export-ignore
            :visible="!!commentActions.activeCommentCard.value"
            :comment-id="commentActions.activeCommentCard.value?.id ?? ''"
            :annotated-text="commentActions.activeCommentCard.value?.annotatedText ?? ''"
            :comment="commentActions.activeCommentCard.value?.content ?? ''"
            :position="commentActions.activeCommentCard.value?.position ?? null"
            :overlay-root="isRichMode ? currentRichSelectionHost?.overlayRoot : currentSourceSelectionHost?.overlayRoot"
            @update:visible="commentActions.activeCommentCard.value = $event ? commentActions.activeCommentCard.value : null"
            @edit="commentActions.handleCommentEdit"
            @delete="commentActions.handleCommentDelete"
          />
        </div>

        <FindBar v-model:visible="findBarVisible" data-export-ignore :editor-instance="editorPublicInstance" />
      </BScrollbar>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { SelectionAssistantAdapter, SelectionToolbarAction } from './adapters/selectionAssistant';
import type { RichLoadState } from './adapters/types';
import type { AnchorRecord } from './hooks/useAnchors';
import type { EditorController, EditorPublicInstance, EditorState } from './types';
import type { Editor as TiptapEditor } from '@tiptap/vue-3';
import type { CSSProperties } from 'vue';
import { computed, nextTick, onActivated, onDeactivated, ref, shallowRef, watch, watchEffect } from 'vue';
import BScrollbar from '@/components/BScrollbar/index.vue';
import { PDF_FILE_FILTER } from '@/constants/extensions';
import { useIntentMotion } from '@/hooks/useIntentMotion';
import { native } from '@/shared/platform';
import type { EditorPageWidth } from '@/stores/editor/preferences';
import { useEditorPreferencesStore } from '@/stores/editor/preferences';
import type { HeaderToolbarItem } from '@/stores/ui/headerToolbar';
import { useHeaderToolbarStore } from '@/stores/ui/headerToolbar';
import { handleEditorAnchorNavigation } from './adapters/editorAnchorNavigation';
import Sidebar from './components/Sidebar.vue';
import { useAnchors } from './hooks/useAnchors';
import { useCommentActions } from './hooks/useCommentActions';
import { useEditorController } from './hooks/useEditorController';
import { useSelectionAssistant } from './hooks/useSelectionAssistant';
import PaneRichEditor from './panes/PaneRichEditor.vue';
import PaneSourceEditor from './panes/PaneSourceEditor.vue';
import CommentCard from './shared/CommentCard.vue';
import FindBar from './shared/FindBar.vue';
import SelectionAIInput from './shared/SelectionAIInput.vue';
import SelectionCommentInput from './shared/SelectionCommentInput.vue';
import SelectionToolbarRich from './shared/SelectionToolbarRich.vue';
import SelectionToolbarSource from './shared/SelectionToolbarSource.vue';
import { buildRichPdfExportHtml, buildSourcePdfExportHtml, resolvePdfDefaultPath } from './utils/exportToPdf';

const layoutRef = ref<HTMLElement | null>(null);
const scrollbarRef = ref<InstanceType<typeof BScrollbar> | null>(null);
const editorPreferencesStore = useEditorPreferencesStore();

/**
 * Markdown 组件入参。
 */
interface Props {
  /** 编辑器状态数据项，包含内容、文件名、路径等信息。 */
  editorState: EditorState;
  /** 是否可编辑。 */
  editable: boolean;
  /** 当前编辑器是否处于激活标签页。 */
  active?: boolean;
}

/**
 * Rich 模式选区宿主状态。
 */
interface RichSelectionHostState {
  /** 当前浮层根节点 */
  overlayRoot: HTMLElement | null;
  /** 当前选区适配器 */
  adapter: SelectionAssistantAdapter | null;
  /** 当前 Tiptap 编辑器实例 */
  editor: TiptapEditor | null;
}

/**
 * Source 模式选区宿主状态。
 */
interface SourceSelectionHostState {
  /** 当前浮层根节点 */
  overlayRoot: HTMLElement | null;
  /** 当前选区适配器 */
  adapter: SelectionAssistantAdapter | null;
}

const props = withDefaults(defineProps<Props>(), {
  active: true
});

const emit = defineEmits<{
  'update:outlineContent': [value: string];
  'editor-blur': [event: FocusEvent];
  'rename-file': [];
  save: [];
  'save-as': [];
  'copy-path': [];
  'show-in-folder': [];
}>();

const isRichMode = computed<boolean>(() => editorPreferencesStore.viewMode === 'rich');
const headerToolbarStore = useHeaderToolbarStore();
const headerToolbarOwnerId = computed<string>(() => `markdown:${props.editorState.id}`);

/**
 * 大纲显示状态双向绑定，同步到偏好设置 store。
 */
const showOutline = computed<boolean>({
  get: () => editorPreferencesStore.showOutline,
  set: (val: boolean) => editorPreferencesStore.setShowOutline(val)
});

/** 大纲侧栏只在按钮动作与真实状态目标一致时保留显隐动画。 */
const {
  motionEnabled: outlineMotionEnabled,
  startMotion: startOutlineMotion,
  syncState: syncOutlineVisibility,
  cancelMotion: cancelOutlineMotion
} = useIntentMotion<boolean>();

watch(showOutline, syncOutlineVisibility);

/**
 * 通过主内容区按钮打开大纲。
 */
function openOutlineByButton(): void {
  startOutlineMotion(true);
  showOutline.value = true;
}

/**
 * 通过 Sidebar 按钮关闭大纲。
 */
function closeOutlineByButton(): void {
  startOutlineMotion(false);
  showOutline.value = false;
}

/**
 * 处理分隔器拖拽关闭，不启用动画。
 */
function closeOutlineByDrag(): void {
  cancelOutlineMotion();
  showOutline.value = false;
}

const content = defineModel<string>('content', { default: '' });
const outlineContent = defineModel<string>('outlineContent', { default: '' });
const richEditorPaneRef = ref<(EditorController & { recomputeSelectionOverlays?: () => void; richLoadState?: RichLoadState }) | null>(null);
const sourceEditorPaneRef = ref<EditorController | null>(null);
const findBarVisible = ref(false);
const currentRichSelectionHost = shallowRef<RichSelectionHostState | null>(null);
const currentSourceSelectionHost = shallowRef<SourceSelectionHostState | null>(null);

/**
 * 编辑器滚动位置快照。
 */
interface EditorScrollSnapshot {
  /** 垂直滚动位置 */
  top: number;
  /** 水平滚动位置 */
  left: number;
}

const cachedScrollSnapshot = ref<EditorScrollSnapshot>({ top: 0, left: 0 });

const editorPageMaxWidth = computed<string>(() => {
  switch (editorPreferencesStore.pageWidth) {
    case 'wide':
      return '1200px';
    case 'full':
      return 'none';
    default:
      return '900px';
  }
});

const editorContainerStyle = computed<CSSProperties>(() => ({
  '--editor-page-max-width': editorPageMaxWidth.value
}));

/**
 * 将 prop 中的只读 editorState 与本地 content 模型合并，
 * 派生出一个完整的 EditorState 对象供子组件使用。
 */
const effectiveEditorState = computed<EditorState>(() => ({
  ...props.editorState,
  content: content.value
}));

const markdownEditorController = useEditorController({ isRichMode, richEditorPaneRef, sourceEditorPaneRef });
const currentSelectionAdapter = computed<SelectionAssistantAdapter | null>(() => {
  return isRichMode.value ? currentRichSelectionHost.value?.adapter ?? null : currentSourceSelectionHost.value?.adapter ?? null;
});
const selectionToolbarKind = computed<'rich' | 'source'>(() => {
  return isRichMode.value ? 'rich' : 'source';
});

/**
 * Rich 编辑器是否正处于加载或失败状态，用于禁用选区工具/评论/AI 交互入口。
 */
const isRichLoading = computed<boolean>(() => {
  const state = richEditorPaneRef.value?.richLoadState;
  return state?.phase === 'loading' || state?.phase === 'failed';
});
const selectionAssistant = useSelectionAssistant({
  adapter: () => currentSelectionAdapter.value,
  isEditable: () => props.editable
});

const commentActions = useCommentActions({
  getEditor: () => currentRichSelectionHost.value?.editor ?? null,
  getPanelPosition: (from, to) => {
    const adapter = currentSelectionAdapter.value;
    if (!adapter) return null;
    return adapter.getPanelPosition({ from, to, text: '', docVersion: undefined });
  },
  getOverlayRoot: () => currentRichSelectionHost.value?.overlayRoot ?? null
});

/**
 * Rich 模式格式按钮列表。
 */
interface MarkdownFormatButton {
  /** 按钮对应的选区动作 */
  command: SelectionToolbarAction;
  /** Iconify 图标名称 */
  icon: string;
}

/**
 * Rich 模式完整格式按钮候选列表。
 */
const richFormatButtonCandidates: readonly MarkdownFormatButton[] = [
  { command: 'bold' as SelectionToolbarAction, icon: 'lucide:bold' },
  { command: 'italic' as SelectionToolbarAction, icon: 'lucide:italic' },
  { command: 'underline' as SelectionToolbarAction, icon: 'lucide:underline' },
  { command: 'strike' as SelectionToolbarAction, icon: 'lucide:strikethrough' },
  { command: 'link' as SelectionToolbarAction, icon: 'lucide:link' },
  { command: 'code' as SelectionToolbarAction, icon: 'lucide:code' }
];

/**
 * Rich 模式当前选区可显示的格式按钮列表。
 */
const formatButtons = computed<MarkdownFormatButton[]>(() =>
  richFormatButtonCandidates.filter((button) => selectionAssistant.capabilities.value.actions[button.command] === true)
);

/**
 * 读取当前模式下应导出的完整 HTML 文档。
 * 富文本模式导出当前渲染结果，源码模式导出转义后的源码文本。
 * @returns 可直接交给 PDF 通道的完整 HTML 文档
 */
function buildCurrentPdfExportHtml(): string {
  if (isRichMode.value) {
    const renderedContentRoot = layoutRef.value?.querySelector('.b-markdown-rich');
    if (renderedContentRoot instanceof HTMLElement) {
      return buildRichPdfExportHtml(renderedContentRoot);
    }

    return buildSourcePdfExportHtml(content.value);
  }

  return buildSourcePdfExportHtml(content.value);
}

/**
 * 导出当前文档为 PDF。
 * 导出内容的语义判断全部收口在渲染层，原生层只处理保存与渲染。
 */
async function handleExportPdf(): Promise<void> {
  await native.exportPdf({
    html: buildCurrentPdfExportHtml(),
    filters: [PDF_FILE_FILTER],
    defaultPath: resolvePdfDefaultPath(effectiveEditorState.value)
  });
}

/**
 * 判断给定值是否为编辑器页宽模式。
 * @param value - 待判断的值
 * @returns 是否为合法页宽模式
 */
function isEditorPageWidthValue(value: string): value is EditorPageWidth {
  return value === 'default' || value === 'wide' || value === 'full';
}

/**
 * 设置 Markdown 正文页宽。
 * @param value - 目标页宽模式
 */
function setMarkdownPageWidth(value: string): void {
  if (isEditorPageWidthValue(value)) {
    editorPreferencesStore.setPageWidth(value);
  }
}

/**
 * 构建 Markdown 编辑器 Header 工具栏条目。
 * @returns Header 工具栏条目列表
 */
function buildMarkdownHeaderToolbarItems(): HeaderToolbarItem[] {
  return [
    {
      type: 'menu',
      key: 'markdown-file-actions',
      icon: 'lucide:ellipsis',
      width: 180,
      options: [
        {
          value: 'rename',
          label: '重命名',
          icon: 'lucide:pencil',
          onClick: (): void => emit('rename-file')
        },
        {
          value: 'save',
          label: '保存',
          icon: 'lucide:save',
          onClick: (): void => emit('save')
        },
        {
          value: 'save-as',
          label: '另存为',
          icon: 'lucide:save-all',
          onClick: (): void => emit('save-as')
        },
        {
          value: 'export-pdf',
          label: '导出 PDF',
          icon: 'lucide:file-output',
          onClick: handleExportPdf
        },
        {
          value: 'page-width',
          label: '视宽',
          icon: 'lucide:maximize',
          children: [
            {
              value: 'page-width-default',
              label: '默认',
              checked: editorPreferencesStore.pageWidth === 'default',
              onClick: (): void => setMarkdownPageWidth('default')
            },
            {
              value: 'page-width-wide',
              label: '较宽',
              checked: editorPreferencesStore.pageWidth === 'wide',
              onClick: (): void => setMarkdownPageWidth('wide')
            },
            {
              value: 'page-width-full',
              label: '全宽',
              checked: editorPreferencesStore.pageWidth === 'full',
              onClick: (): void => setMarkdownPageWidth('full')
            }
          ]
        },
        { type: 'divider' },
        {
          value: 'copy-path',
          label: '复制路径',
          icon: 'lucide:copy',
          disabled: !props.editorState.path,
          onClick: (): void => emit('copy-path')
        },
        {
          value: 'reveal',
          label: '打开所在位置',
          icon: 'lucide:folder-open',
          disabled: !props.editorState.path,
          onClick: (): void => emit('show-in-folder')
        }
      ]
    }
  ];
}

watchEffect((onCleanup): void => {
  const ownerId = headerToolbarOwnerId.value;

  if (!props.active) {
    headerToolbarStore.unregister(ownerId);
    return;
  }

  headerToolbarStore.register(ownerId, buildMarkdownHeaderToolbarItems());
  onCleanup((): void => headerToolbarStore.unregister(ownerId));
});

/**
 * 接收 Rich pane 回传的选区宿主状态。
 * @param payload - 当前选区宿主状态
 */
function handleRichSelectionHostChange(payload: RichSelectionHostState | null): void {
  currentRichSelectionHost.value = payload;
}

/**
 * 切换到源码模式（由 Rich pane 的 loading/failed 状态触发）。
 */
function handleSwitchToSource(): void {
  editorPreferencesStore.setViewMode('source');
}

/**
 * 接收 Source pane 回传的选区宿主状态。
 * @param payload - 当前选区宿主状态
 */
function handleSourceSelectionHostChange(payload: SourceSelectionHostState | null): void {
  currentSourceSelectionHost.value = payload;
}

/**
 * 请求重算当前选区浮层位置。
 */
function recomputeSelectionOverlays(): void {
  selectionAssistant.recomputeAllPositions();
}

/**
 * 处理 AI 输入层显隐变化。
 * @param visible - 最新显隐状态
 */
function handleSelectionAIVisibleChange(visible: boolean): void {
  if (!visible) {
    selectionAssistant.closeAIInput();
  }
}

/**
 * 处理评论输入面板显隐变化，打开时清除批注卡片状态以避免两者同时显示。
 * @param visible - 最新显隐状态
 */
function handleSelectionCommentVisibleChange(visible: boolean): void {
  if (!visible) {
    selectionAssistant.closeCommentInput();
  } else {
    commentActions.activeCommentCard.value = null;
  }
}

/**
 * 仅当焦点真正离开整个编辑器交互区域时，向外抛出统一的 editor-blur 事件。
 * @param event - 编辑器内部上抛的失焦事件
 */
function handleEditorBlur(event: FocusEvent): void {
  const nextTarget = event.relatedTarget;

  if (nextTarget instanceof Node && layoutRef.value?.contains(nextTarget)) {
    return;
  }

  emit('editor-blur', event);
}

/**
 * 缓存当前滚动位置，供 KeepAlive 标签页恢复。
 */
function rememberScrollbarPosition(): void {
  const scrollElement = scrollbarRef.value?.getScrollElement();
  if (!scrollElement || !scrollElement.isConnected) {
    return;
  }

  cachedScrollSnapshot.value = {
    top: scrollElement.scrollTop,
    left: scrollElement.scrollLeft
  };
}

/**
 * 通过统一入口滚动 Markdown 容器并同步滚动快照。
 * @param options - 滚动参数
 */
function scrollMarkdownTo(options: ScrollToOptions): void {
  const scrollElement = scrollbarRef.value?.getScrollElement();
  if (!scrollElement || !scrollElement.isConnected) {
    return;
  }

  const nextTop = typeof options.top === 'number' ? options.top : scrollElement.scrollTop;
  const nextLeft = typeof options.left === 'number' ? options.left : scrollElement.scrollLeft;

  scrollbarRef.value?.scrollTo(options);
  cachedScrollSnapshot.value = {
    top: nextTop,
    left: nextLeft
  };
}

const { activeAnchorId, handleChangeAnchor, handleEditorScroll, setActiveAnchorId } = useAnchors(layoutRef, scrollbarRef, {
  onScrollTo: scrollMarkdownTo
});

/**
 * 将目标元素滚动到编辑器可视区域中心（搜索匹配与行定位选区共用）。
 * @param targetElement - 目标元素
 */
function scrollElementIntoCenter(targetElement: HTMLElement): void {
  const scrollElement = scrollbarRef.value?.getScrollElement();
  if (!scrollElement) {
    targetElement.scrollIntoView({ block: 'center', inline: 'nearest' });
    return;
  }

  const scrollRect = scrollElement.getBoundingClientRect();
  const targetRect = targetElement.getBoundingClientRect();
  const centeredTop = scrollElement.scrollTop + (targetRect.top - scrollRect.top) - (scrollElement.clientHeight - targetRect.height) / 2;
  const maxScrollTop = Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight);
  const nextTop = Math.min(Math.max(centeredTop, 0), maxScrollTop);

  scrollMarkdownTo({ top: nextTop, behavior: 'auto' });
}

/**
 * 将源码锚点滚动到目标位置。
 * @param hostElement - 锚点宿主元素
 * @param offsetTop - 顶部偏移
 */
function scrollSourceAnchorIntoView(hostElement: HTMLElement, offsetTop: number): void {
  const scrollElement = scrollbarRef.value?.getScrollElement();
  if (!scrollElement) {
    hostElement.scrollIntoView({ block: 'start' });
    return;
  }

  const scrollRect = scrollElement.getBoundingClientRect();
  const hostRect = hostElement.getBoundingClientRect();
  const nextTop = scrollElement.scrollTop + (hostRect.top - scrollRect.top) + offsetTop;

  scrollMarkdownTo({ top: Math.max(0, nextTop), behavior: 'auto' });
}

/**
 * 恢复当前 KeepAlive 标签页上次停留的滚动位置。
 */
async function restoreScrollbarPosition(): Promise<void> {
  await nextTick();

  scrollMarkdownTo({
    top: cachedScrollSnapshot.value.top,
    left: cachedScrollSnapshot.value.left,
    behavior: 'auto'
  });
  recomputeSelectionOverlays();
}

/**
 * 处理大纲锚点切换。
 * @param record - 当前锚点记录
 */
function handleEditorAnchorChange(record: AnchorRecord): void {
  handleEditorAnchorNavigation({
    record,
    isRichMode: isRichMode.value,
    setActiveAnchorId,
    scrollToTop: () => scrollMarkdownTo({ top: 0, behavior: 'auto' }),
    scrollRichAnchor: handleChangeAnchor,
    scrollEditorAnchor: markdownEditorController.value.scrollToAnchor
  });
}

/**
 * 响应 Markdown 编辑器滚动并同步活跃锚点。
 */
function handleEditorScrollEvent(): void {
  rememberScrollbarPosition();

  if (isRichMode.value) {
    handleEditorScroll();
    recomputeSelectionOverlays();
    return;
  }

  const scrollElement = scrollbarRef.value?.getScrollElement();
  if (!scrollElement) {
    return;
  }

  if (scrollElement.scrollTop < 50) {
    setActiveAnchorId('');
    recomputeSelectionOverlays();
    return;
  }

  setActiveAnchorId(markdownEditorController.value.getActiveAnchorId(scrollElement, 100));
  recomputeSelectionOverlays();
}

onActivated((): void => {
  restoreScrollbarPosition();
});

onDeactivated((): void => {
  rememberScrollbarPosition();
});

/**
 * 对外开放的编辑器实例能力集合，供 FindBar 等子组件使用。
 */
const editorPublicInstance = computed<EditorPublicInstance>(() => ({
  undo: () => markdownEditorController.value.undo?.(),
  redo: () => markdownEditorController.value.redo?.(),
  canUndo: () => markdownEditorController.value.canUndo?.() ?? false,
  canRedo: () => markdownEditorController.value.canRedo?.() ?? false,
  focusEditor: () => markdownEditorController.value.focusEditor?.(),
  getSelection: () => markdownEditorController.value.getSelection?.() ?? null,
  insertAtCursor: (text: string) => markdownEditorController.value.insertAtCursor?.(text),
  replaceSelection: (text: string) => markdownEditorController.value.replaceSelection?.(text),
  replaceDocument: (text: string) => markdownEditorController.value.replaceDocument?.(text),
  selectLineRange: (startLine: number, endLine: number) => markdownEditorController.value.selectLineRange?.(startLine, endLine) ?? false,
  setSearchTerm: (term: string) => markdownEditorController.value.setSearchTerm?.(term),
  findNext: () => markdownEditorController.value.findNext?.(),
  findPrevious: () => markdownEditorController.value.findPrevious?.(),
  clearSearch: () => markdownEditorController.value.clearSearch?.(),
  getSearchState: () => markdownEditorController.value.getSearchState?.() ?? { currentIndex: 0, matchCount: 0, term: '' }
}));

/**
 * 对外暴露编辑器控制器，供父组件 BEditor 统一调度。
 */
defineExpose({
  editorController: markdownEditorController,
  rememberScrollPosition: rememberScrollbarPosition,
  restoreScrollPosition: restoreScrollbarPosition,
  scrollToAnchor(anchorId: string): boolean {
    return markdownEditorController.value.scrollToAnchor(anchorId);
  },
  getActiveAnchorId(scrollContainer: HTMLElement, thresholdPx: number): string {
    return markdownEditorController.value.getActiveAnchorId(scrollContainer, thresholdPx);
  }
});
</script>

<style lang="less">
.b-markdown-layout {
  display: flex;
  height: 100%;

  --selection-bg: var(--color-primary-border);
  --native-selection-color: var(--selection-color);
  --native-selection-bg: var(--selection-bg);
  --comment-highlight-line: rgb(255 152 0 / 70%);

  ::selection {
    background: transparent;
  }
}

.b-markdown-main {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  width: 0;
  min-width: 0;
  background: var(--bg-primary);
  border: 1px solid var(--border-primary);
  border-radius: 8px;

  .b-markdown-main__outline-toggle {
    position: absolute;
    top: 8px;
    left: 8px;
    z-index: 3;
  }
}

.b-markdown-scrollbar {
  flex: 1;
  height: 0;
}

.b-markdown-container {
  position: relative;
  max-width: var(--editor-page-max-width);
  margin: 0 auto;
  font-size: 16px;
}

.b-markdown-title {
  display: block;
  width: 100%;
  padding: 20px 40px 0;
  margin: 0;
  font-size: 28px;
  font-weight: 600;
  color: var(--editor-text);
  cursor: text;
  resize: none;
  outline: none;
  background: transparent;
  border: none;

  &::placeholder {
    font-weight: 600;
    color: var(--editor-placeholder);
  }
}

.editor-comment-highlight {
  padding: 0.25em 0;
  cursor: pointer;
  background: rgb(255 213 79 / 30%);
  background-image: linear-gradient(var(--comment-highlight-line), var(--comment-highlight-line));
  background-repeat: no-repeat;
  background-position: 0 calc(100% - 1px);
  background-size: 100% 2px;
  border-radius: 2px;
  -webkit-box-decoration-break: clone;
  box-decoration-break: clone;
  transition: background 0.2s ease;

  &:hover {
    background-image: linear-gradient(var(--comment-highlight-line), rgb(255 213 79 / 50%));
  }
}
</style>
