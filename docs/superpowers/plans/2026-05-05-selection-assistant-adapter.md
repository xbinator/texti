# Selection Assistant Adapter 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将选区工具（SelectionToolbar + SelectionAIInput）从 Tiptap 专属改造为 rich/source 双模式通用，通过 SelectionAssistantAdapter 协议屏蔽编辑器内核差异。

**Architecture:** 三层分离 — UI 层（纯展示 + 事件）、编排层（useSelectionAssistant 状态机）、适配器层（rich/source 各自实现）。第一阶段保留 rich 模式 BubbleMenu，source 模式用绝对定位浮层。

**Tech Stack:** Vue 3 + TypeScript, Tiptap (ProseMirror), CodeMirror 6, @iconify/vue

---

### Task 1: 定义适配器类型协议

**Files:**
- Create: `src/components/BEditor/adapters/selectionAssistant.ts`

- [ ] **Step 1: 写入完整的适配器类型定义**

在 `src/components/BEditor/adapters/selectionAssistant.ts` 中写入：

```typescript
/**
 * @file selectionAssistant.ts
 * @description 选区工具适配器协议，定义 rich/source 双模式统一的选区交互接口。
 */
import type { EditorState } from '../types';

/**
 * 选区范围信息。
 */
export interface SelectionAssistantRange {
  from: number;
  to: number;
  text: string;
  /** 选区快照生成时的文档版本，用于校验范围是否仍然可信 */
  docVersion?: number;
  /** 可选的快照标识，用于跨阶段追踪同一轮 AI / 引用流程 */
  snapshotId?: string;
}

/**
 * 矩形区域信息。
 */
export interface SelectionAssistantRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * 浮层定位信息。
 */
export interface SelectionAssistantPosition {
  /** 相对当前编辑器浮层容器的锚点矩形，默认基于当前选区末行 */
  anchorRect: SelectionAssistantRect;
  /** 当前选区末行的视觉高度，用于面板与工具栏的纵向间距计算 */
  lineHeight: number;
  /** 可选的容器矩形，供宿主做 viewport clamp 或溢出处理 */
  containerRect?: SelectionAssistantRect;
}

/**
 * 聊天引用上下文。
 */
export interface SelectionReferencePayload {
  id: string;
  ext: string;
  filePath: string;
  fileName: string;
  startLine: number;
  endLine: number;
  renderStartLine: number;
  renderEndLine: number;
}

/**
 * 工具栏支持的动作类型。
 */
export type SelectionToolbarAction =
  | 'ai'
  | 'reference'
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strike'
  | 'code';

/**
 * 选区工具能力声明。
 */
export interface SelectionAssistantCapabilities {
  actions: Partial<Record<SelectionToolbarAction, boolean>>;
}

/**
 * 适配器构建所需的编辑器上下文。
 */
export interface SelectionAssistantContext {
  /** BEditor 自定义文件上下文 */
  editorState: EditorState;
  /** 宿主注入的浮层根容器；adapter 返回的所有定位信息都必须相对该容器 */
  overlayRoot: HTMLElement;
}

/**
 * 选区工具适配器协议。
 */
export interface SelectionAssistantAdapter {
  dispose?(): void;
  getCapabilities(): SelectionAssistantCapabilities;
  isEditable(): boolean;
  getSelection(): SelectionAssistantRange | null;
  /** 在 AI 内容应用前恢复缓存选区，不等同于任意时刻覆写当前选区 */
  restoreSelection(range: SelectionAssistantRange): void;
  /** 判断缓存选区是否仍然有效；失效时编排层需阻止应用并提示重新选择 */
  isRangeStillValid?(range: SelectionAssistantRange): boolean;
  /**
   * 清理原生选中态，让视觉层退回到 adapter 的高亮实现。
   * 若未实现，编排层默认不主动清理原生选区，只依赖宿主自身行为。
   */
  clearNativeSelection?(): void;
  /** 供 AI 输入面板使用，锚点默认基于当前选区末行 */
  getPanelPosition(range: SelectionAssistantRange): SelectionAssistantPosition | null;
  /** 供选区工具栏使用，锚点默认基于当前选区首行 */
  getToolbarPosition(range: SelectionAssistantRange): SelectionAssistantPosition | null;
  showSelectionHighlight(range: SelectionAssistantRange): void;
  clearSelectionHighlight(): void;
  /**
   * 允许抛出异常；由编排层统一捕获并决定 UI 反馈。
   * 建议至少区分"可重试"和"不可重试"两类失败。
   */
  applyGeneratedContent(range: SelectionAssistantRange, content: string): Promise<void>;
  buildSelectionReference(range: SelectionAssistantRange): SelectionReferencePayload | null;
  bindSelectionEvents(handlers: {
    onSelectionChange: () => void;
    onFocus: () => void;
    /** 仅供编排层同步高亮与显隐，不承载 rich 模式的 BubbleMenu 恢复策略 */
    onBlur: (event?: FocusEvent) => void;
    onPointerDownInsideEditor?: (event: PointerEvent) => void;
    onPointerDownOutsideEditor?: (event: PointerEvent) => void;
    onEscape?: () => void;
  }): () => void;
}
```

- [ ] **Step 2: 验证 TypeScript 编译通过**

```bash
npx vue-tsc --noEmit --project tsconfig.json 2>&1 | head -30
```

Expected: 无与该文件直接相关的新类型错误（可能已有其他文件的预存错误）。

---

### Task 2: 实现编排层 Hook

**Files:**
- Create: `src/components/BEditor/hooks/useSelectionAssistant.ts`

- [ ] **Step 1: 写入 useSelectionAssistant 核心实现**

在 `src/components/BEditor/hooks/useSelectionAssistant.ts` 中写入：

```typescript
/**
 * @file useSelectionAssistant.ts
 * @description 选区工具统一编排层，管理选区工作流状态机、缓存、高亮同步与事件分发。
 */
import type { SelectionAssistantAdapter, SelectionAssistantCapabilities, SelectionAssistantRange, SelectionAssistantPosition, SelectionReferencePayload } from '../adapters/selectionAssistant';
import type { SelectionToolbarAction } from '../adapters/selectionAssistant';
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { useEventListener } from '@vueuse/core';
import { SERVICE_MODEL_UPDATED_EVENT, type ServiceModelUpdatedDetail } from '@/shared/storage/service-models/events';
import { useServiceModelStore } from '@/stores/service-model';
import { emitChatFileReferenceInsert } from '@/shared/chat/fileReference';

/**
 * 选区工具状态机状态枚举。
 */
export type SelectionAssistantStatus =
  | 'idle'
  | 'toolbar-visible'
  | 'ai-input-visible'
  | 'ai-streaming'
  | 'reference-highlight';

/**
 * useSelectionAssistant 的配置选项。
 */
export interface UseSelectionAssistantOptions {
  /** adapter 的响应式引用，允许延迟绑定或动态切换 */
  adapter: () => SelectionAssistantAdapter | null;
  /** 编辑器是否可编辑 */
  isEditable?: () => boolean;
}

/**
 * 选区工具统一编排 hook。
 * @param options - 配置选项
 * @returns 编排层对外暴露的状态与方法
 */
export function useSelectionAssistant(options: UseSelectionAssistantOptions) {
  const serviceModelStore = useServiceModelStore();

  // ---- 核心状态 ----
  const status = ref<SelectionAssistantStatus>('idle');
  const cachedSelectionRange = ref<SelectionAssistantRange | null>(null);
  const toolbarPosition = ref<SelectionAssistantPosition | null>(null);
  const panelPosition = ref<SelectionAssistantPosition | null>(null);
  const isModelAvailable = ref(false);
  const stickyHighlightRange = ref<SelectionAssistantRange | null>(null);
  const pendingError = ref<string | null>(null);
  const capabilities = ref<SelectionAssistantCapabilities>({ actions: {} });

  // ---- 派生状态 ----
  const toolbarVisible = computed(() => status.value === 'toolbar-visible');
  const aiInputVisible = computed(() =>
    status.value === 'ai-input-visible' || status.value === 'ai-streaming'
  );
  const isStreaming = computed(() => status.value === 'ai-streaming');
  const isReferenceHighlight = computed(() => status.value === 'reference-highlight');

  // ---- 模型可用性 ----
  async function checkModelAvailability(): Promise<void> {
    isModelAvailable.value = await serviceModelStore.isServiceAvailable('polish');
  }

  function handleServiceModelUpdated(event: Event): void {
    const { detail } = event as CustomEvent<ServiceModelUpdatedDetail>;
    if (detail.serviceType !== 'polish') return;
    checkModelAvailability();
  }

  useEventListener(window, SERVICE_MODEL_UPDATED_EVENT, handleServiceModelUpdated);
  checkModelAvailability();

  // ---- 内部清理 ----
  let cleanupAdapterEvents: (() => void) | undefined;

  /**
   * 绑定 adapter 的选区事件，并开始监听。
   */
  function bindAdapterEvents(): void {
    cleanupAdapterEvents?.();
    const adapter = options.adapter();
    if (!adapter) return;

    capabilities.value = adapter.getCapabilities();

    cleanupAdapterEvents = adapter.bindSelectionEvents({
      onSelectionChange() {
        handleSelectionChange();
      },
      onFocus() {
        handleFocus();
      },
      onBlur(_event?: FocusEvent) {
        handleBlur();
      },
      onPointerDownInsideEditor(_event: PointerEvent) {
        // source 模式复用 rich 模式"编辑器面板内其他区域"语义
        if (status.value === 'reference-highlight') {
          clearStickyHighlight();
          transitionTo('idle');
        }
      },
      onPointerDownOutsideEditor(_event: PointerEvent) {
        // 点击编辑器外部不立即清理粘性高亮
      },
      onEscape() {
        clearAll();
      }
    });
  }

  /**
   * 同步 adapter 能力声明与状态。
   */
  function syncCapabilities(): void {
    const adapter = options.adapter();
    if (adapter) {
      capabilities.value = adapter.getCapabilities();
    }
  }

  // ---- 状态迁移 ----
  function transitionTo(newStatus: SelectionAssistantStatus): void {
    status.value = newStatus;
    pendingError.value = null;
  }

  /**
   * 处理选区变化：同步缓存、高亮、定位与状态。
   */
  function handleSelectionChange(): void {
    const adapter = options.adapter();
    if (!adapter) return;

    const selection = adapter.getSelection();

    // 无有效选区 → idle
    if (!selection) {
      if (status.value === 'reference-highlight') {
        // 粘性高亮状态：不主动清理，等待内部重新聚焦收敛
        return;
      }
      clearAll();
      return;
    }

    // 更新缓存
    cachedSelectionRange.value = { ...selection };

    // 根据当前状态决定下一步
    switch (status.value) {
      case 'idle':
      case 'reference-highlight':
        transitionTo('toolbar-visible');
        recomputeToolbarPosition();
        adapter.showSelectionHighlight(selection);
        break;
      case 'toolbar-visible':
        recomputeToolbarPosition();
        adapter.showSelectionHighlight(selection);
        break;
      case 'ai-input-visible':
      case 'ai-streaming':
        adapter.showSelectionHighlight(selection);
        recomputePanelPosition();
        break;
    }
  }

  function handleFocus(): void {
    syncCapabilities();
    // 焦点回到编辑器：若存在粘性高亮，以当前真实选区收敛
    if (status.value === 'reference-highlight') {
      const adapter = options.adapter();
      const selection = adapter?.getSelection();
      if (selection) {
        clearStickyHighlight();
        cachedSelectionRange.value = { ...selection };
        transitionTo('toolbar-visible');
        recomputeToolbarPosition();
      } else {
        clearStickyHighlight();
        transitionTo('idle');
      }
    }
  }

  function handleBlur(): void {
    // blur 只做高亮同步，不直接改变状态
    // 工具栏隐藏/恢复由各 adapter host 自行处理
  }

  // ---- 动作 ----

  /**
   * 点击"AI 助手"按钮。
   */
  function openAIInput(): void {
    const range = cachedSelectionRange.value;
    if (!range) return;

    const adapter = options.adapter();
    if (!adapter) return;

    adapter.clearNativeSelection?.();
    adapter.showSelectionHighlight(range);
    recomputePanelPosition();
    transitionTo('ai-input-visible');
  }

  /**
   * 关闭 AI 输入面板。
   */
  function closeAIInput(): void {
    transitionTo('idle');
    const adapter = options.adapter();
    if (!adapter) return;
    adapter.clearSelectionHighlight();
  }

  /**
   * AI 流式生成完成，应用内容。
   */
  async function applyAIResult(content: string): Promise<void> {
    const range = cachedSelectionRange.value;
    const adapter = options.adapter();
    if (!range || !adapter) return;

    // 校验 range 有效性
    if (adapter.isRangeStillValid && !adapter.isRangeStillValid(range)) {
      pendingError.value = '选区已失效，请重新选择文本后重试';
      transitionTo('ai-input-visible');
      return;
    }

    try {
      await adapter.applyGeneratedContent(range, content);
      // 应用成功后，清理并让宿主重新同步选区
      adapter.clearSelectionHighlight();
      // 迁移到 idle，待下一次 selectionChange 事件推至正确状态
      transitionTo('idle');
      cachedSelectionRange.value = null;
    } catch (error) {
      pendingError.value = error instanceof Error ? error.message : '应用内容时发生错误';
      transitionTo('ai-input-visible');
    }
  }

  /**
   * 设置 AI 流式状态。
   */
  function setStreaming(streaming: boolean): void {
    if (streaming) {
      transitionTo('ai-streaming');
    } else {
      transitionTo('ai-input-visible');
    }
  }

  /**
   * 点击"插入对话"按钮。
   */
  function insertReference(): void {
    const range = cachedSelectionRange.value;
    const adapter = options.adapter();
    if (!range || !adapter) return;

    // 构造文件引用并发送
    const payload = adapter.buildSelectionReference(range);
    if (payload) {
      emitChatFileReferenceInsert(payload);
    }

    // 保留视觉高亮，进入粘性高亮状态
    adapter.showSelectionHighlight(range);
    stickyHighlightRange.value = { ...range };
    transitionTo('reference-highlight');

    // 执行后隐藏工具栏
    toolbarPosition.value = null;
  }

  // ---- 定位重算 ----
  function recomputeToolbarPosition(): void {
    const adapter = options.adapter();
    const range = cachedSelectionRange.value;
    if (!adapter || !range) {
      toolbarPosition.value = null;
      return;
    }
    toolbarPosition.value = adapter.getToolbarPosition(range);
  }

  function recomputePanelPosition(): void {
    const adapter = options.adapter();
    const range = cachedSelectionRange.value;
    if (!adapter || !range) {
      panelPosition.value = null;
      return;
    }
    panelPosition.value = adapter.getPanelPosition(range);
  }

  /**
   * 重新计算所有浮层位置。
   */
  function recomputeAllPositions(): void {
    recomputeToolbarPosition();
    recomputePanelPosition();
  }

  // ---- 清理 ----
  function clearStickyHighlight(): void {
    const adapter = options.adapter();
    adapter?.clearSelectionHighlight();
    stickyHighlightRange.value = null;
  }

  function clearAll(): void {
    const adapter = options.adapter();
    adapter?.clearSelectionHighlight();
    status.value = 'idle';
    cachedSelectionRange.value = null;
    toolbarPosition.value = null;
    panelPosition.value = null;
    stickyHighlightRange.value = null;
    pendingError.value = null;
  }

  // ---- 生命周期 ----
  watch(
    () => options.adapter(),
    (newAdapter, oldAdapter) => {
      if (oldAdapter !== newAdapter) {
        oldAdapter?.dispose?.();
        clearAll();
        bindAdapterEvents();
      }
    },
    { immediate: true }
  );

  onBeforeUnmount(() => {
    cleanupAdapterEvents?.();
    options.adapter()?.dispose?.();
  });

  return {
    // 状态
    status,
    toolbarVisible,
    aiInputVisible,
    isStreaming,
    isReferenceHighlight,
    cachedSelectionRange,
    toolbarPosition,
    panelPosition,
    isModelAvailable,
    capabilities,
    pendingError,
    // 动作
    openAIInput,
    closeAIInput,
    applyAIResult,
    setStreaming,
    insertReference,
    recomputeAllPositions,
    // 检查
    checkModelAvailability,
    syncCapabilities,
  };
}
```

- [ ] **Step 2: 验证编译**

```bash
npx vue-tsc --noEmit 2>&1 | grep -i "useSelectionAssistant" | head -10
```

Expected: 无错误输出。

---

### Task 3: 实现 Rich 模式适配器

**Files:**
- Create: `src/components/BEditor/adapters/richSelectionAssistant.ts`

- [ ] **Step 1: 写入 RichSelectionAssistantAdapter 实现**

在 `src/components/BEditor/adapters/richSelectionAssistant.ts` 中写入：

```typescript
/**
 * @file richSelectionAssistant.ts
 * @description Rich 模式（Tiptap）选区工具适配器实现。
 */
import type { Editor } from '@tiptap/vue-3';
import type {
  SelectionAssistantAdapter,
  SelectionAssistantCapabilities,
  SelectionAssistantContext,
  SelectionAssistantPosition,
  SelectionAssistantRange,
  SelectionReferencePayload
} from './selectionAssistant';
import { TextSelection } from '@tiptap/pm/state';
import { clearAISelectionHighlight, setAISelectionHighlight } from '../extensions/AISelectionHighlight';
import { getSelectionSourceLineRange, getSelectionSourceLineRangeFromMarkdown } from './sourceLineMapping';

/**
 * 创建 Rich 模式选区工具适配器。
 * @param editor - Tiptap Editor 实例
 * @param context - 编辑器上下文（文件元数据 + 浮层根容器）
 * @returns 遵循 SelectionAssistantAdapter 协议的适配器实例
 */
export function createRichSelectionAssistantAdapter(
  editor: Editor,
  context: SelectionAssistantContext
): SelectionAssistantAdapter {
  /**
   * 将 Tiptap 的 coordsAtPos 结果转换为相对 overlayRoot 的 Positioning。
   */
  function coordsToAnchorRect(coords: { top: number; left: number; right: number; bottom: number }): { top: number; left: number; width: number; height: number } {
    const overlayRect = context.overlayRoot.getBoundingClientRect();
    return {
      top: coords.top - overlayRect.top,
      left: coords.left - overlayRect.left,
      width: coords.right - coords.left,
      height: coords.bottom - coords.top
    };
  }

  return {
    getCapabilities(): SelectionAssistantCapabilities {
      return {
        actions: {
          ai: true,
          reference: true,
          bold: true,
          italic: true,
          underline: true,
          strike: true,
          code: true
        }
      };
    },

    isEditable(): boolean {
      return editor.isEditable;
    },

    getSelection(): SelectionAssistantRange | null {
      const selection = editor.state.selection;
      if (selection.from === selection.to) return null;

      return {
        from: selection.from,
        to: selection.to,
        text: editor.state.doc.textBetween(selection.from, selection.to, ''),
        docVersion: editor.state.doc.nodeSize
      };
    },

    restoreSelection(range: SelectionAssistantRange): void {
      const { state, view } = editor;
      view.dispatch(
        state.tr.setSelection(TextSelection.create(state.doc, range.from, range.to))
      );
    },

    clearNativeSelection(): void {
      // rich 模式通过 CSS ::selection transparent 隐藏原生选区，无需额外操作
    },

    getPanelPosition(range: SelectionAssistantRange): SelectionAssistantPosition | null {
      const endCoords = editor.view.coordsAtPos(range.to);
      const lineHeight = endCoords.bottom - endCoords.top;
      return {
        anchorRect: coordsToAnchorRect(endCoords),
        lineHeight,
        containerRect: {
          top: 0,
          left: 0,
          width: context.overlayRoot.clientWidth,
          height: context.overlayRoot.clientHeight
        }
      };
    },

    getToolbarPosition(range: SelectionAssistantRange): SelectionAssistantPosition | null {
      const startCoords = editor.view.coordsAtPos(range.from);
      const lineHeight = startCoords.bottom - startCoords.top;
      return {
        anchorRect: coordsToAnchorRect(startCoords),
        lineHeight,
        containerRect: {
          top: 0,
          left: 0,
          width: context.overlayRoot.clientWidth,
          height: context.overlayRoot.clientHeight
        }
      };
    },

    showSelectionHighlight(range: SelectionAssistantRange): void {
      setAISelectionHighlight(editor, { from: range.from, to: range.to });
    },

    clearSelectionHighlight(): void {
      clearAISelectionHighlight(editor);
    },

    async applyGeneratedContent(range: SelectionAssistantRange, content: string): Promise<void> {
      this.restoreSelection(range);
      editor.chain().focus().insertContentAt({ from: range.from, to: range.to }, content).run();
    },

    buildSelectionReference(range: SelectionAssistantRange): SelectionReferencePayload | null {
      const { editorState } = context;

      const sourceLineRange =
        getSelectionSourceLineRangeFromMarkdown(
          editor.state.doc,
          range.from,
          range.to,
          editorState.content || ''
        ) ||
        getSelectionSourceLineRange(editor.state.doc, range.from, range.to);

      const textBeforeStart = editor.state.doc.textBetween(0, range.from, '\n', '\n');
      const textBeforeEnd = editor.state.doc.textBetween(0, range.to, '\n', '\n');
      const renderStartLine = textBeforeStart.split(/\r?\n/).length;
      const renderEndLine = textBeforeEnd.split(/\r?\n/).length;

      const { id = '', ext = '', path: filePath, name: fileName } = editorState;
      const { startLine = 0, endLine = 0 } = sourceLineRange || {};

      return {
        id,
        ext,
        filePath: filePath || '',
        fileName,
        startLine,
        endLine,
        renderStartLine,
        renderEndLine
      };
    },

    bindSelectionEvents(handlers): () => void {
      editor.on('selectionUpdate', handlers.onSelectionChange);
      editor.on('focus', handlers.onFocus);
      editor.on('blur', handlers.onBlur as (event?: FocusEvent) => void);

      return () => {
        editor.off('selectionUpdate', handlers.onSelectionChange);
        editor.off('focus', handlers.onFocus);
        editor.off('blur', handlers.onBlur as (event?: FocusEvent) => void);
      };
    }
  };
}
```

- [ ] **Step 2: 验证编译**

```bash
npx vue-tsc --noEmit 2>&1 | grep -i "richSelectionAssistant" | head -10
```

Expected: 无错误输出。

---

### Task 4: 实现 Source 模式适配器

**Files:**
- Create: `src/components/BEditor/adapters/sourceSelectionAssistant.ts`

- [ ] **Step 1: 写入 SourceSelectionAssistantAdapter 实现**

在 `src/components/BEditor/adapters/sourceSelectionAssistant.ts` 中写入：

```typescript
/**
 * @file sourceSelectionAssistant.ts
 * @description Source 模式（CodeMirror）选区工具适配器实现。
 */
import type { EditorView, ViewUpdate } from '@codemirror/view';
import type { Compartment, Extension, Text } from '@codemirror/state';
import { EditorSelection, StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView as EditorViewRef, ViewPlugin } from '@codemirror/view';
import type {
  SelectionAssistantAdapter,
  SelectionAssistantCapabilities,
  SelectionAssistantContext,
  SelectionAssistantPosition,
  SelectionAssistantRange,
  SelectionReferencePayload
} from './selectionAssistant';

/**
 * 源码模式高亮 decoration 的 CSS class。
 */
const HIGHLIGHT_CLASS = 'source-ai-selection-highlight';

/**
 * 高亮范围状态字段。
 */
const highlightRangeEffect = StateEffect.define<SelectionAssistantRange | null>();

const highlightRangeField = StateField.define<SelectionAssistantRange | null>({
  create(): SelectionAssistantRange | null {
    return null;
  },
  update(value, tr): SelectionAssistantRange | null {
    for (const effect of tr.effects) {
      if (effect.is(highlightRangeEffect)) return effect.value;
    }
    return value;
  }
});

/**
 * 从 CodeMirror lineBlock 返回该行的像素高度。
 */
function getLineHeight(view: EditorView, pos: number): number {
  const lineBlock = view.lineBlockAt(pos);
  return lineBlock.bottom - lineBlock.top;
}

/**
 * 获取文档的 docVersion（内容长度）。
 */
function getDocVersion(view: EditorView): number {
  return view.state.doc.length;
}

/**
 * 创建 Source 模式选区工具适配器。
 * @param view - CodeMirror EditorView 实例
 * @param context - 编辑器上下文（文件元数据 + 浮层根容器）
 * @returns 遵循 SelectionAssistantAdapter 协议的适配器实例
 */
export function createSourceSelectionAssistantAdapter(
  view: EditorView,
  context: SelectionAssistantContext
): SelectionAssistantAdapter {
  return {
    getCapabilities(): SelectionAssistantCapabilities {
      return {
        actions: {
          ai: true,
          reference: true,
          bold: false,
          italic: false,
          underline: false,
          strike: false,
          code: false
        }
      };
    },

    isEditable(): boolean {
      return true;
    },

    getSelection(): SelectionAssistantRange | null {
      const selection = view.state.selection.main;
      if (selection.from === selection.to) return null;

      return {
        from: selection.from,
        to: selection.to,
        text: view.state.sliceDoc(selection.from, selection.to),
        docVersion: getDocVersion(view)
      };
    },

    restoreSelection(range: SelectionAssistantRange): void {
      view.dispatch({
        selection: EditorSelection.range(range.from, range.to)
      });
    },

    clearNativeSelection(): void {
      view.dispatch({
        selection: EditorSelection.cursor(view.state.selection.main.head)
      });
    },

    getPanelPosition(range: SelectionAssistantRange): SelectionAssistantPosition | null {
      const overlayRect = context.overlayRoot.getBoundingClientRect();
      const endCoords = view.coordsAtPos(range.to);
      if (!endCoords) return null;

      const lineHeight = getLineHeight(view, range.to);
      return {
        anchorRect: {
          top: endCoords.top - overlayRect.top,
          left: endCoords.left - overlayRect.left,
          width: endCoords.right - endCoords.left,
          height: endCoords.bottom - endCoords.top
        },
        lineHeight,
        containerRect: {
          top: 0,
          left: 0,
          width: context.overlayRoot.clientWidth,
          height: context.overlayRoot.clientHeight
        }
      };
    },

    getToolbarPosition(range: SelectionAssistantRange): SelectionAssistantPosition | null {
      const overlayRect = context.overlayRoot.getBoundingClientRect();
      const startCoords = view.coordsAtPos(range.from);
      if (!startCoords) return null;

      const lineHeight = getLineHeight(view, range.from);
      return {
        anchorRect: {
          top: startCoords.top - overlayRect.top,
          left: startCoords.left - overlayRect.left,
          width: startCoords.right - startCoords.left,
          height: startCoords.bottom - startCoords.top
        },
        lineHeight,
        containerRect: {
          top: 0,
          left: 0,
          width: context.overlayRoot.clientWidth,
          height: context.overlayRoot.clientHeight
        }
      };
    },

    showSelectionHighlight(range: SelectionAssistantRange): void {
      view.dispatch({
        effects: highlightRangeEffect.of({ ...range })
      });
    },

    clearSelectionHighlight(): void {
      view.dispatch({
        effects: highlightRangeEffect.of(null)
      });
    },

    async applyGeneratedContent(range: SelectionAssistantRange, content: string): Promise<void> {
      const nextPosition = range.from + content.length;
      view.dispatch({
        changes: {
          from: range.from,
          to: range.to,
          insert: content
        },
        selection: EditorSelection.cursor(nextPosition),
        scrollIntoView: true
      });
      view.focus();
    },

    buildSelectionReference(range: SelectionAssistantRange): SelectionReferencePayload | null {
      const { editorState } = context;
      const { id = '', ext = '', path: filePath, name: fileName } = editorState;

      const fullText = view.state.doc.toString();
      const textBeforeStart = fullText.slice(0, range.from);
      const textBeforeEnd = fullText.slice(0, range.to);
      const startLine = textBeforeStart.split(/\r?\n/).length;
      const endLine = textBeforeEnd.split(/\r?\n/).length;

      return {
        id,
        ext,
        filePath: filePath || '',
        fileName,
        startLine,
        endLine,
        renderStartLine: startLine,
        renderEndLine: endLine
      };
    },

    bindSelectionEvents(handlers): () => void {
      // 使用 ViewPlugin 监听选区变化
      const selectionPlugin = ViewPlugin.fromClass(
        class {
          // eslint-disable-next-line no-useless-constructor
          constructor(/* view: EditorView */) {
            // 无操作
          }

          update(update: ViewUpdate): void {
            if (update.selectionSet) {
              handlers.onSelectionChange();
            }
          }
        }
      );

      // 使用 DOM 事件监听 focus/blur
      const dom = view.dom;
      dom.addEventListener('focus', handlers.onFocus);
      dom.addEventListener('blur', handlers.onBlur as EventListener);

      return () => {
        dom.removeEventListener('focus', handlers.onFocus);
        dom.removeEventListener('blur', handlers.onBlur as EventListener);
      };
    },

    dispose(): void {
      this.clearSelectionHighlight();
    }
  };
}

/**
 * 创建 Source 模式高亮 decoration 扩展。
 * 用于在 CodeMirror 中渲染选区高亮视觉效果。
 * @returns CodeMirror Extension，包含高亮状态字段与装饰层
 */
export function createSourceSelectionHighlightExtension(): Extension {
  return [
    highlightRangeField,
    EditorViewRef.decorations.compute(['doc', highlightRangeField], (state) => {
      const range = state.field(highlightRangeField);
      if (!range || range.from === range.to) {
        return Decoration.none;
      }
      return Decoration.set([
        Decoration.mark({
          class: HIGHLIGHT_CLASS,
          attributes: {
            'data-source-highlight': 'true'
          }
        }).range(range.from, range.to)
      ]);
    })
  ];
}
```

- [ ] **Step 2: 验证编译**

```bash
npx vue-tsc --noEmit 2>&1 | grep -i "sourceSelectionAssistant" | head -10
```

Expected: 无错误输出。

---

### Task 5: 拆分 SelectionToolbar

**Files:**
- Create: `src/components/BEditor/components/SelectionToolbarContent.vue`
- Create: `src/components/BEditor/components/RichSelectionToolbarHost.vue`
- Create: `src/components/BEditor/components/SourceSelectionToolbarHost.vue`

- [ ] **Step 1: 创建 SelectionToolbarContent.vue（纯按钮内容）**

在 `src/components/BEditor/components/SelectionToolbarContent.vue` 中写入：

```vue
<template>
  <div class="selection-toolbar">
    <template v-if="showAIButton">
      <div class="selection-toolbar__ai-btn" @mousedown.prevent="$emit('ai')">
        <Icon icon="lucide:sparkles" />
        <span>AI 助手</span>
      </div>
      <div class="selection-toolbar__divider"></div>
    </template>

    <template v-if="showReferenceButton">
      <div class="selection-toolbar__ai-btn" @mousedown.prevent="$emit('reference')">
        <Icon icon="lucide:message-square-plus" />
        <span>插入对话</span>
      </div>
      <div class="selection-toolbar__divider"></div>
    </template>

    <button
      v-for="btn in visibleFormatButtons"
      :key="btn.command"
      type="button"
      class="selection-toolbar__btn"
      :class="{ 'is-active': btn.active }"
      @mousedown.prevent="$emit('format', btn.command)"
    >
      <Icon :icon="btn.icon" />
    </button>
  </div>
</template>

<script setup lang="ts">
import type { SelectionToolbarAction } from '../adapters/selectionAssistant';
import { computed } from 'vue';
import { Icon } from '@iconify/vue';

interface FormatButton {
  command: SelectionToolbarAction;
  icon: string;
  /** 该按钮是否处于激活态（由 host 注入） */
  active?: boolean;
}

interface Props {
  /** 是否展示 AI 助手按钮 */
  showAIButton?: boolean;
  /** 是否展示插入对话按钮 */
  showReferenceButton?: boolean;
  /** 需要展示的格式按钮列表 */
  formatButtons?: FormatButton[];
}

const props = withDefaults(defineProps<Props>(), {
  showAIButton: false,
  showReferenceButton: false,
  formatButtons: () => []
});

defineEmits<{
  (e: 'ai'): void;
  (e: 'reference'): void;
  (e: 'format', command: SelectionToolbarAction): void;
}>();

const visibleFormatButtons = computed(() =>
  props.formatButtons.filter((btn) => btn.command !== 'ai' && btn.command !== 'reference')
);
</script>

<style lang="less" scoped>
.selection-toolbar {
  display: flex;
  gap: 2px;
  align-items: center;
  padding: 4px;
  background: var(--bg-primary);
  border: 1px solid var(--border-primary);
  border-radius: 8px;
  box-shadow: var(--shadow-lg);
}

.selection-toolbar__ai-btn {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  height: 28px;
  padding: 0 8px;
  font-size: 13px;
  color: var(--color-primary);
  cursor: pointer;
  border: none;
  border-radius: 6px;
  transition: background-color 0.15s ease;

  &:hover {
    background: var(--color-primary-bg-hover);
  }
}

.selection-toolbar__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  font-size: 14px;
  color: var(--text-secondary);
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: 6px;
  transition: background-color 0.15s ease, color 0.15s ease;

  &:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  &.is-active {
    color: var(--color-primary);
    background: var(--bg-hover);
  }
}

.selection-toolbar__divider {
  width: 1px;
  height: 16px;
  margin: 0 4px;
  background: var(--border-primary);
}
</style>
```

- [ ] **Step 2: 创建 RichSelectionToolbarHost.vue（BubbleMenu 宿主）**

在 `src/components/BEditor/components/RichSelectionToolbarHost.vue` 中写入：

```vue
<template>
  <BubbleMenu
    v-if="editor"
    :editor="editor"
    :plugin-key="SELECTION_TOOLBAR_PLUGIN_KEY"
    :should-show="shouldShow"
    :options="bubbleMenuOptions"
    class="bubble-menu-wrapper"
  >
    <SelectionToolbarContent
      :show-ai-button="showAIButton"
      :show-reference-button="showReferenceButton"
      :format-buttons="formatButtons"
      @ai="$emit('ai')"
      @reference="$emit('reference')"
      @format="handleFormat"
    />
  </BubbleMenu>
</template>

<script setup lang="ts">
import type { Editor } from '@tiptap/vue-3';
import type { EditorState as ProseMirrorState } from '@tiptap/pm/state';
import type { SelectionToolbarAction } from '../adapters/selectionAssistant';
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { PluginKey } from '@tiptap/pm/state';
import { BubbleMenu } from '@tiptap/vue-3/menus';
import SelectionToolbarContent from './SelectionToolbarContent.vue';

interface FormatButton {
  command: SelectionToolbarAction;
  icon: string;
  active?: boolean;
}

interface Props {
  editor: Editor;
  showAIButton?: boolean;
  showReferenceButton?: boolean;
  formatButtons?: FormatButton[];
}

const props = withDefaults(defineProps<Props>(), {
  showAIButton: false,
  showReferenceButton: false,
  formatButtons: () => []
});

const emit = defineEmits<{
  (e: 'ai'): void;
  (e: 'reference'): void;
  (e: 'format', command: SelectionToolbarAction): void;
}>();

const SELECTION_TOOLBAR_PLUGIN_KEY = new PluginKey('bubbleMenu');

const suppressRestore = ref(false);

/**
 * 覆盖 BubbleMenu 内置显示判定：
 * - 去掉 hasEditorFocus 检查，失焦时菜单不隐藏
 * - 选区为空或选中区域无文本时仍隐藏
 */
const shouldShow = computed(() => ({ state }: { state: ProseMirrorState }): boolean => {
  const { from, to } = state.selection;
  if (from === to || !state.doc.textBetween(from, to, '') || !props.editor?.isEditable) {
    return false;
  }
  return true;
});

const bubbleMenuOptions = computed(() => ({
  placement: 'top-start' as const,
  onShow: () => {
    emit('ai', false as unknown as SelectionToolbarAction); // effectively reset
  },
  onHide: () => {
    // 由编排层管理清理，不在此处直接操作
  }
}));

function handleFormat(command: SelectionToolbarAction): void {
  const editor = props.editor;
  switch (command) {
    case 'bold':
      editor.chain().focus().toggleBold().run();
      break;
    case 'italic':
      editor.chain().focus().toggleItalic().run();
      break;
    case 'underline':
      editor.chain().focus().toggleUnderline().run();
      break;
    case 'strike':
      editor.chain().focus().toggleStrike().run();
      break;
    case 'code':
      editor.chain().focus().toggleCode().run();
      break;
  }
  emit('format', command);
}

/**
 * blur 后若选区仍存在，通过 meta 强制重显菜单。
 */
let lastMousedownTarget: HTMLElement | null = null;

function handleDocumentMousedown(e: MouseEvent): void {
  lastMousedownTarget = e.target as HTMLElement | null;
}

function handleBlurRestore({ event }: { event: FocusEvent }): void {
  if (suppressRestore.value) {
    suppressRestore.value = false;
    return;
  }

  const { state } = props.editor!;
  const { from, to } = state.selection;
  if (from === to) return;

  const target = (event.relatedTarget as HTMLElement | null) ?? lastMousedownTarget;
  lastMousedownTarget = null;

  if (target) {
    const editorDom = props.editor!.view.dom;
    const editorPane = editorDom.parentElement?.parentElement ?? null;
    if (editorPane && editorPane.contains(target) && !editorDom.contains(target)) {
      return;
    }
  }

  props.editor!.view.dispatch(state.tr.setMeta(SELECTION_TOOLBAR_PLUGIN_KEY, 'show'));
}

onMounted(() => {
  document.addEventListener('mousedown', handleDocumentMousedown, true);
  nextTick(() => {
    props.editor?.on('blur', handleBlurRestore);
  });
});

onUnmounted(() => {
  document.removeEventListener('mousedown', handleDocumentMousedown, true);
  props.editor?.off('blur', handleBlurRestore);
});

defineExpose({ suppressRestore });
</script>
```

- [ ] **Step 3: 创建 SourceSelectionToolbarHost.vue（绝对定位宿主）**

在 `src/components/BEditor/components/SourceSelectionToolbarHost.vue` 中写入：

```vue
<template>
  <Teleport :to="overlayRoot" :disabled="!overlayRoot">
    <div
      v-if="visible && style.top !== undefined"
      class="source-selection-toolbar"
      :style="style"
    >
      <SelectionToolbarContent
        :show-ai-button="showAIButton"
        :show-reference-button="showReferenceButton"
        :format-buttons="formatButtons"
        @ai="$emit('ai')"
        @reference="$emit('reference')"
        @format="$emit('format', $event)"
      />
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import type { SelectionAssistantPosition, SelectionToolbarAction } from '../adapters/selectionAssistant';
import { type CSSProperties, computed } from 'vue';
import SelectionToolbarContent from './SelectionToolbarContent.vue';

interface FormatButton {
  command: SelectionToolbarAction;
  icon: string;
  active?: boolean;
}

interface Props {
  visible?: boolean;
  position?: SelectionAssistantPosition | null;
  overlayRoot?: HTMLElement | null;
  showAIButton?: boolean;
  showReferenceButton?: boolean;
  formatButtons?: FormatButton[];
}

const props = withDefaults(defineProps<Props>(), {
  visible: false,
  position: null,
  overlayRoot: null,
  showAIButton: false,
  showReferenceButton: false,
  formatButtons: () => []
});

defineEmits<{
  (e: 'ai'): void;
  (e: 'reference'): void;
  (e: 'format', command: SelectionToolbarAction): void;
}>();

const style = computed<CSSProperties>(() => {
  if (!props.position) return { display: 'none' };
  return {
    position: 'absolute',
    top: `${props.position.anchorRect.top - 40}px`,
    left: `${props.position.anchorRect.left}px`,
    zIndex: 100
  };
});
</script>
```

- [ ] **Step 4: 验证编译**

```bash
npx vue-tsc --noEmit 2>&1 | grep -E "(SelectionToolbarContent|RichSelectionToolbarHost|SourceSelectionToolbarHost)" | head -10
```

Expected: 无错误输出。

---

### Task 6: 改造 SelectionAIInput 解除 Tiptap 依赖

**Files:**
- Modify: `src/components/BEditor/components/SelectionAIInput.vue`

- [ ] **Step 1: 改造 SelectionAIInput.vue 使用 adapter 接口**

将 `src/components/BEditor/components/SelectionAIInput.vue` 的 `<script setup>` 部分替换为 adapter 版本：

```vue
<script setup lang="ts">
import type { SelectionAssistantAdapter, SelectionAssistantRange, SelectionAssistantPosition } from '../adapters/selectionAssistant';
import { onBeforeUnmount, computed, nextTick, ref, watch } from 'vue';
import { Icon } from '@iconify/vue';
import { onClickOutside, useEventListener } from '@vueuse/core';
import { message } from 'ant-design-vue';
import { useChat } from '@/hooks/useChat';
import { useShortcuts } from '@/hooks/useShortcuts';
import type { ServiceModelUpdatedDetail } from '@/shared/storage/service-models/events';
import { SERVICE_MODEL_UPDATED_EVENT } from '@/shared/storage/service-models/events';
import type { AvailableServiceModelConfig } from '@/stores/service-model';
import { useServiceModelStore } from '@/stores/service-model';

interface Props {
  adapter?: SelectionAssistantAdapter | null;
  selectionRange?: SelectionAssistantRange | null;
  position?: SelectionAssistantPosition | null;
}

const props = withDefaults(defineProps<Props>(), {
  adapter: null,
  selectionRange: null,
  position: null
});

const visible = defineModel<boolean>('visible', { default: false });

const inputValue = ref('');
const previewText = ref('');
const loading = ref(false);
const inputRef = ref<{ focus: (options?: FocusOptions) => void } | null>(null);
const wrapperRef = ref<HTMLElement | null>(null);
const modelConfig = ref<AvailableServiceModelConfig | null>(null);
const serviceModelStore = useServiceModelStore();

const providerId = computed(() => modelConfig.value?.providerId ?? '');

const { agent } = useChat({
  providerId,
  onText(content) {
    previewText.value += content;
  },
  onComplete() {
    loading.value = false;
  },
  onError(error) {
    loading.value = false;
    message.error(error.message);
  }
});

const { registerShortcut } = useShortcuts();
let unregisterEscape: (() => void) | null = null;

// ---- Position ----

function scrollIntoViewIfObscured(): void {
  if (!wrapperRef.value) return;
  const rect = wrapperRef.value.getBoundingClientRect();
  const isObscured = rect.bottom > window.innerHeight - 400;
  if (isObscured) {
    wrapperRef.value.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function syncFloatPosition(): void {
  const position = props.position;
  if (!position) return;
  const top = position.anchorRect.top + position.lineHeight + 6;
  wrapperStyle.value = { top: `${position.top}px` };
  nextTick(scrollIntoViewIfObscured);
}

// ---- Selection ----

function collapseToSelectionStart(): void {
  const adapter = props.adapter;
  const range = props.selectionRange;
  if (!adapter || !range) return;
  adapter.restoreSelection({ from: range.from, to: range.from, text: '', docVersion: range.docVersion, snapshotId: range.snapshotId });
}

// ---- State ----

function resetState(): void {
  inputValue.value = '';
  previewText.value = '';
  loading.value = false;
}

function stopStreaming(): void {
  if (loading.value) {
    agent.abort();
  }
}

function closePanel(): void {
  stopStreaming();
  resetState();
  visible.value = false;
  collapseToSelectionStart();
}

// ---- Model Config ----

async function fetchModelConfig(): Promise<void> {
  modelConfig.value = await serviceModelStore.getAvailableServiceConfig('polish');
}

function onServiceModelUpdated(event: Event): void {
  const { detail } = event as CustomEvent<ServiceModelUpdatedDetail>;
  if (detail.serviceType !== 'polish') return;
  fetchModelConfig();
}

useEventListener(window, SERVICE_MODEL_UPDATED_EVENT, onServiceModelUpdated);
fetchModelConfig();

// ---- Visible Watch ----

watch(visible, (isVisible) => {
  if (isVisible) {
    fetchModelConfig();
    nextTick(syncFloatPosition);
    nextTick(() => inputRef.value?.focus({ preventScroll: true }));
    unregisterEscape = registerShortcut({ key: 'escape', handler: closePanel });
  } else {
    resetState();
    unregisterEscape?.();
    unregisterEscape = null;
  }
});

// ---- AI ----

function buildAIPrompt(selectedText: string, userInput: string): string {
  const template = modelConfig.value?.customPrompt ?? '';
  return template.replace(/\{\{SELECTED_TEXT\}\}/g, selectedText).replace(/\{\{USER_INPUT\}\}/g, userInput);
}

async function sendInstruction(): Promise<void> {
  const value = inputValue.value.trim();
  const range = props.selectionRange;
  if (!value || !range || loading.value) return;

  const config = modelConfig.value;
  if (!config?.providerId || !config?.modelId) {
    message.warning('未找到可用的模型配置');
    return;
  }

  if (range.from === range.to) return;

  const selectedText = range.text;
  const prompt = buildAIPrompt(selectedText, value);

  loading.value = true;
  agent.stream({ modelId: config.modelId, prompt });
}

function applyGeneratedContent(): void {
  if (!props.adapter || !props.selectionRange || !previewText.value) return;

  props.adapter.applyGeneratedContent(props.selectionRange, previewText.value).catch((error) => {
    message.error(error.message || '应用内容失败');
  });

  closePanel();
}

// ---- Events ----

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter') {
    event.preventDefault();
    sendInstruction();
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    closePanel();
  }
}

onClickOutside(wrapperRef, () => {
  if (!loading.value) closePanel();
});

onBeforeUnmount(() => {
  unregisterEscape?.();
  unregisterEscape = null;
});
</script>
```

- [ ] **Step 2: 更新 template 部分**

将 `<script setup>` 部分的 `wrapperStyle` 定义移入（如果之前没有则需要添加）：

模板部分保持不变（和现有 template 一致），但需要将 `v-if="editor && visible"` 改为 `v-if="adapter && visible"`，以及将 `wrapperStyle` 声明添加到 script 中：

在 script 中添加：
```typescript
const wrapperStyle = ref<CSSProperties>({});
```

修改 template 第一行：
```vue
<div v-if="adapter && visible" ref="wrapperRef" class="ai-input-wrapper" :style="wrapperStyle">
```

- [ ] **Step 3: 验证编译**

```bash
npx vue-tsc --noEmit 2>&1 | grep -i "SelectionAIInput" | head -10
```

Expected: 无新错误。

---

### Task 7: 在 RichEditorContent 中集成适配器

**Files:**
- Modify: `src/components/BEditor/components/RichEditorContent.vue`

- [ ] **Step 1: 创建 RichEditorContent 的 overlayRoot ref 并注入适配器**

在 `RichEditorContent.vue` 中：
1. 添加 `overlayRoot` ref
2. 在 `setup` 中创建 adapter 并调用 `useSelectionAssistant`
3. 用 `RichSelectionToolbarHost` 替换旧的 `SelectionToolbar`
4. 将编排层的状态传给 UI 组件

核心修改（替换现有的 script setup 部分，保留 template 和样式）：

在 template 中，将 `rich-editor-pane` div 改为带 ref 的：
```vue
<div ref="overlayRootRef" class="rich-editor-pane" @click="navigate.onLink">
```

将 `<SelectionToolbar>` 替换为：
```vue
<RichSelectionToolbarHost
  v-if="editor && adapter"
  :editor="editor"
  :show-ai-button="assistant.showAIButton.value"
  :show-reference-button="assistant.showReferenceButton.value"
  :format-buttons="assistant.formatButtons.value"
  @ai="assistant.openAIInput()"
  @reference="assistant.insertReference()"
/>
```

将 `<SelectionAIInput>` 替换为：
```vue
<SelectionAIInput
  v-model:visible="assistant.aiInputVisible.value"
  :adapter="adapter"
  :selection-range="assistant.cachedSelectionRange.value"
  :position="assistant.panelPosition.value"
/>
```

注意：需要移除 `import SelectionToolbar` 和添加新的 import：
```typescript
import RichSelectionToolbarHost from './RichSelectionToolbarHost.vue';
import SelectionAIInput from './SelectionAIInput.vue';
```

不再直接 `import SelectionToolbar`。

在 script setup 中添加 adapter 创建和 useSelectionAssistant 调用：
```typescript
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
// ... other imports
import { useSelectionAssistant } from '../hooks/useSelectionAssistant';
import { createRichSelectionAssistantAdapter } from '../adapters/richSelectionAssistant';
import type { SelectionAssistantAdapter } from '../adapters/selectionAssistant';

const overlayRootRef = ref<HTMLElement | null>(null);
const adapter = shallowRef<SelectionAssistantAdapter | null>(null);

const assistant = useSelectionAssistant({
  adapter: () => adapter.value,
  isEditable: () => true
});

// 监听 editor + overlayRoot 就绪后创建 adapter
watch(
  [() => props.editor, overlayRootRef],
  ([editor, root]) => {
    if (editor && root) {
      adapter.value = createRichSelectionAssistantAdapter(editor, {
        editorState: props.editorState || { content: '', name: '', path: '', id: '', ext: '' },
        overlayRoot: root
      });
    } else {
      adapter.value = null;
    }
  },
  { immediate: true }
);

onBeforeUnmount(() => {
  adapter.value?.dispose?.();
  adapter.value = null;
});
```

移除原有的：
- `aiInputVisible`, `selectionRange` ref 声明
- `handleAIInputToggle`, `handleSelectionReferenceInsert`, `handleSelectionReferenceClear` 函数
- `syncSelectionHighlight`, `getCurrentSelectionRange`, `updateSelectionRange`
- `bindSelectionHighlight`, `cleanupSelectionHighlight` watch 相关
- `watch(aiInputVisible, ...)` 相关

因为这些都被 `useSelectionAssistant` 接管了。

- [ ] **Step 2: 验证编译**

```bash
npx vue-tsc --noEmit 2>&1 | grep -i "RichEditorContent" | head -20
```

Expected: 无新类型错误。

---

### Task 8: 在 PaneSourceEditor 中集成适配器

**Files:**
- Modify: `src/components/BEditor/components/PaneSourceEditor.vue`

- [ ] **Step 1: 修改 PaneSourceEditor 模板与 script**

在 `PaneSourceEditor.vue` 中：

模板部分添加 overlayRoot ref：
```vue
<div ref="editorHostRef" class="source-editor-pane">
  <div ref="overlayRootRef" class="source-editor-content-host">
    <div ref="editorViewHostRef" class="source-editor-codemirror"></div>
    <SourceSelectionToolbarHost
      :visible="assistant.toolbarVisible.value"
      :position="assistant.toolbarPosition.value"
      :overlay-root="overlayRootRef"
      :show-ai-button="assistant.showSourceAIButton.value"
      :show-reference-button="assistant.showSourceReferenceButton.value"
      :format-buttons="[]"
      @ai="assistant.openAIInput()"
      @reference="assistant.insertReference()"
    />
    <SelectionAIInput
      v-model:visible="assistant.aiInputVisible.value"
      :adapter="adapter"
      :selection-range="assistant.cachedSelectionRange.value"
      :position="assistant.panelPosition.value"
    />
  </div>
</div>
```

在 script setup 中添加：
```typescript
import { useSelectionAssistant } from '../hooks/useSelectionAssistant';
import { createSourceSelectionAssistantAdapter, createSourceSelectionHighlightExtension } from '../adapters/sourceSelectionAssistant';
import type { SelectionAssistantAdapter } from '../adapters/selectionAssistant';
import SourceSelectionToolbarHost from './SourceSelectionToolbarHost.vue';
import SelectionAIInput from './SelectionAIInput.vue';
import { computed } from 'vue';

const overlayRootRef = ref<HTMLElement | null>(null);
const editorViewHostRef = ref<HTMLDivElement | null>(null); // 替换原来的 editorHostRef
const adapter = shallowRef<SelectionAssistantAdapter | null>(null);

const assistant = useSelectionAssistant({
  adapter: () => adapter.value,
  isEditable: () => props.editable
});

// 暴露 computed 属性供模板使用
const showSourceAIButton = computed(
  () => assistant.isModelAvailable.value && assistant.capabilities.value.actions?.ai === true
);
const showSourceReferenceButton = computed(
  () => Boolean(props.editorId) && assistant.capabilities.value.actions?.reference === true
);
```

将原来的 `editorHostRef` 改为 `editorViewHostRef`（CodeMirror DOM 挂载点）。

在 `onMounted` 中，CodeMirror 创建后立即创建 adapter：
```typescript
onMounted((): void => {
  const parent = editorViewHostRef.value;
  const overlayRoot = overlayRootRef.value;
  if (!parent || !overlayRoot) return;

  editorView.value = new EditorView({
    parent,
    state: EditorState.create({
      doc: editorContent.value,
      extensions: [
        ...createEditorExtensions(),
        createSourceSelectionHighlightExtension() // 添加高亮扩展
      ]
    })
  });

  // 创建 source adapter
  adapter.value = createSourceSelectionAssistantAdapter(editorView.value, {
    editorState: {
      content: editorContent.value,
      name: '',
      path: '',
      id: props.editorId || '',
      ext: ''
    },
    overlayRoot
  });
});
```

在 `onBeforeUnmount` 中清理 adapter：
```typescript
onBeforeUnmount((): void => {
  adapter.value?.dispose?.();
  adapter.value = null;
  editorView.value?.destroy();
  editorView.value = null;
});
```

添加样式保证 `source-editor-content-host` 为 `position: relative`：
```less
.source-editor-content-host {
  position: relative;
  min-height: 100%;
}
```

- [ ] **Step 2: 验证编译**

```bash
npx vue-tsc --noEmit 2>&1 | grep -i "PaneSourceEditor" | head -20
```

Expected: 无新类型错误。

---

### Task 9: 添加 Source 模式高亮 CSS

**Files:**
- Modify: `src/components/BEditor/components/PaneSourceEditor.vue`

- [ ] **Step 1: 在 PaneSourceEditor 样式中添加高亮 class**

在 `PaneSourceEditor.vue` 的 `<style>` 部分（`.source-editor-codemirror` 之前）添加：

```less
.source-editor-codemirror {
  .source-ai-selection-highlight {
    color: var(--selection-color);
    background: var(--selection-bg);
    box-shadow: 0 0.2em 0 0 var(--selection-bg), 0 -0.2em 0 0 var(--selection-bg);
    -webkit-box-decoration-break: clone;
    box-decoration-break: clone;
  }
}
```

---

### Task 10: 处理 Edge Cases – Source 编辑器只读与文件状态同步

**Files:**
- Modify: `src/components/BEditor/adapters/sourceSelectionAssistant.ts`

- [ ] **Step 1: 让 source adapter 的 `isEditable` 反映实际状态**

Source adapter 目前硬编码 `isEditable: () => true`。需要改为接收 `editable` 参数：

修改 `createSourceSelectionAssistantAdapter` 签名添加 `editable` 参数：
```typescript
export function createSourceSelectionAssistantAdapter(
  view: EditorView,
  context: SelectionAssistantContext,
  editable: () => boolean
): SelectionAssistantAdapter {
```

将 `isEditable()` 改为：
```typescript
isEditable(): boolean {
  return editable();
},
```

在 `PaneSourceEditor.vue` 中创建 adapter 时传入：
```typescript
adapter.value = createSourceSelectionAssistantAdapter(editorView.value, { ... }, () => props.editable);
```

---

### Task 11: 全量编译验证与回归测试

- [ ] **Step 1: 运行 TypeScript 类型检查**

```bash
npx vue-tsc --noEmit 2>&1 | tail -30
```

检查输出，修复任何与本次变更相关的新类型错误。

- [ ] **Step 2: 运行 ESLint 检查**

```bash
npx eslint src/components/BEditor/adapters/selectionAssistant.ts src/components/BEditor/adapters/richSelectionAssistant.ts src/components/BEditor/adapters/sourceSelectionAssistant.ts src/components/BEditor/hooks/useSelectionAssistant.ts src/components/BEditor/components/SelectionToolbarContent.vue src/components/BEditor/components/RichSelectionToolbarHost.vue src/components/BEditor/components/SourceSelectionToolbarHost.vue 2>&1
```

Expected: 无 ESLint error。

- [ ] **Step 3: 检查未使用的旧 SelectionToolbar.vue**

确认旧的 `src/components/BEditor/components/SelectionToolbar.vue` 在所有引用点都已被替换为 `RichSelectionToolbarHost`：

```bash
grep -r "SelectionToolbar" src/components/BEditor/ --include="*.vue" --include="*.ts" | grep -v "RichSelectionToolbarHost\|SourceSelectionToolbarHost\|SelectionToolbarContent\|\.spec\." --color
```

预期的旧引用（`SelectionToolbar` 单独导入）应仅出现在不再需要的文件中。RichEditorContent 应使用 `RichSelectionToolbarHost`。

---

### Task 12: 记录 Changelog

- [ ] **Step 1: 写入 changelog**

```bash
cat >> changelog/2026-05-05.md << 'EOF'

## Changed
- SelectionToolbar 拆分为 SelectionToolbarContent + RichSelectionToolbarHost + SourceSelectionToolbarHost，实现 rich/source 双模式复用
- SelectionAIInput 解除 Tiptap 直接依赖，改为使用 SelectionAssistantAdapter 协议
- RichEditorContent 中的选区编排逻辑迁移至 useSelectionAssistant hook

## Added
- SelectionAssistantAdapter 协议定义（src/components/BEditor/adapters/selectionAssistant.ts）
- useSelectionAssistant 统一编排层 hook（src/components/BEditor/hooks/useSelectionAssistant.ts）
- RichSelectionAssistantAdapter 富文本适配器（src/components/BEditor/adapters/richSelectionAssistant.ts）
- SourceSelectionAssistantAdapter 源码模式适配器（src/components/BEditor/adapters/sourceSelectionAssistant.ts）
- PaneSourceEditor 接入选区工具栏、AI 面板、"插入对话"功能

## Features
- 源码编辑模式支持选中文本后调用 AI 助手与插入文件引用
- 源码模式保留粘性高亮语义：插入对话后高亮持续到编辑器内部重新聚焦
EOF
```

---

### 测试场景清单（手工回归）

实现完成后需要验证的场景：

1. **rich 模式**：选中文本后显示选区工具栏
2. **rich 模式**：点击 "AI 助手" 后显示 AI 面板，选区保持高亮
3. **rich 模式**：AI 面板中输入指令，流式生成，应用内容正确替换原选区
4. **rich 模式**：点击 "插入对话" 后插入正确的文件引用，选区保持高亮
5. **rich 模式**：格式按钮（加粗/斜体/下划线/删除线/行内代码）正常工作
6. **rich 模式**：blur 后工具栏不消失（保持现有交互）
7. **rich 模式**：插入对话后高亮粘住，重新聚焦编辑器后收敛
8. **source 模式**：选中文本后显示选区工具栏（只有 AI 助手和插入对话）
9. **source 模式**：不显示格式按钮
10. **source 模式**：AI 面板定位正确
11. **source 模式**：插入对话后正确计算行号并发送文件引用
12. **source 模式**：粘性高亮语义与 rich 一致
13. **切换模式/文件**：旧高亮被清理
14. **只读状态**：工具入口按能力隐藏
15. **编辑器销毁**：事件监听与 decoration 均被清理
