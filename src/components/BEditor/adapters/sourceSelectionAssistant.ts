/**
 * @file sourceSelectionAssistant.ts
 * @description Source 模式（CodeMirror）选区工具适配器实现。
 */
import type {
  SelectionAssistantAdapter,
  SelectionAssistantCapabilities,
  SelectionAssistantContext,
  SelectionAssistantPosition,
  SelectionAssistantRange,
  SelectionReferencePayload
} from './selectionAssistant';
import type { Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { EditorSelection, StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView as EditorViewRef } from '@codemirror/view';
import { restoreSourceEditorSelectionDraw, suppressSourceEditorSelectionDraw } from './sourceEditorDrawSelection';

/**
 * 源码模式高亮 decoration 的 CSS class。
 */
const HIGHLIGHT_CLASS = 'source-ai-selection-highlight';

/**
 * 高亮范围状态字段。
 * 通过 StateEffect 更新，被 decorations compute 消费以渲染高亮。
 */
const highlightRangeEffect = StateEffect.define<SelectionAssistantRange | null>();

const highlightRangeField = StateField.define<SelectionAssistantRange | null>({
  create(): SelectionAssistantRange | null {
    return null;
  },
  update(value, tr): SelectionAssistantRange | null {
    for (const effect of tr.effects) {
      if (effect.is(highlightRangeEffect)) {
        return effect.value;
      }
    }
    return value;
  }
});

/**
 * 获取指定位置所在行的像素高度。
 * @param view - CodeMirror EditorView 实例
 * @param pos - 文档位置
 * @returns 该行的像素高度
 */
function getLineHeight(view: EditorView, pos: number): number {
  const lineBlock = view.lineBlockAt(pos);
  return lineBlock.bottom - lineBlock.top;
}

/**
 * 获取文档的 docVersion（以文本长度作为版本标识）。
 * @param view - CodeMirror EditorView 实例
 * @returns 当前文档长度
 */
function getDocVersion(view: EditorView): number {
  return view.state.doc.length;
}

/**
 * 创建 Source 模式选区工具适配器。
 * @param view - CodeMirror EditorView 实例
 * @param context - 编辑器上下文（文件元数据 + 浮层根容器）
 * @param editableGetter - 获取可编辑状态的 getter
 * @returns 遵循 SelectionAssistantAdapter 协议的适配器实例
 */
export function createSourceSelectionAssistantAdapter(
  view: EditorView,
  context: SelectionAssistantContext,
  editableGetter: () => boolean
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
      return editableGetter();
    },

    getSelection(): SelectionAssistantRange | null {
      const selection = view.state.selection.main;
      if (selection.from === selection.to) {
        return null;
      }

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

    isRangeStillValid(range: SelectionAssistantRange): boolean {
      const currentDocVersion = getDocVersion(view);
      if (range.docVersion !== undefined && range.docVersion !== currentDocVersion) {
        return false;
      }

      return view.state.sliceDoc(range.from, range.to) === range.text;
    },

    clearNativeSelection(): void {
      suppressSourceEditorSelectionDraw(view);
    },

    getPanelPosition(range: SelectionAssistantRange): SelectionAssistantPosition | null {
      const overlayRect = context.overlayRoot.getBoundingClientRect();
      const endCoords = view.coordsAtPos(range.to);
      if (!endCoords) {
        return null;
      }

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
      if (!startCoords) {
        return null;
      }

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
      restoreSourceEditorSelectionDraw(view);
    },

    /**
     * 应用 AI 生成内容到原选区位置。
     * @param range - 原选区范围
     * @param content - AI 生成的新内容
     */
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

    /**
     * 构造文件引用载荷。
     * 基于源码文本直接计算行号，renderStartLine/renderEndLine 与 startLine/endLine 一致。
     * @param range - 当前选区范围
     * @returns 文件引用载荷
     */
    buildSelectionReference(range: SelectionAssistantRange): SelectionReferencePayload {
      const { editorState } = context;
      const { id = '', ext = '', path: filePath, name: fileName } = editorState;

      // 基于完整源码文本计算 1-based 行号
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
        // source 模式下渲染行号与源码行号一致
        renderStartLine: startLine,
        renderEndLine: endLine
      };
    },

    /**
     * 绑定编辑器选区、焦点、失焦事件。
     * 选区变化通过 DOM 事件（mouseup/keyup）检测，失焦/焦点通过 CodeMirror DOM 事件。
     * @param handlers - 事件处理器集合
     * @returns 解绑函数
     */
    bindSelectionEvents(handlers): () => void {
      const { dom } = view;

      const handleSelectionChange = (): void => {
        handlers.onSelectionChange();
      };
      const handlePointerDown = (event: PointerEvent): void => {
        handlers.onPointerDownInsideEditor?.(event);
      };
      const handleDocumentPointerDown = (event: PointerEvent): void => {
        if (!dom.contains(event.target as Node | null)) {
          handlers.onPointerDownOutsideEditor?.(event);
        }
      };
      const handleKeydown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') {
          handlers.onEscape?.();
        }
      };

      dom.addEventListener('mouseup', handleSelectionChange);
      dom.addEventListener('keyup', handleSelectionChange);
      dom.addEventListener('pointerdown', handlePointerDown);
      dom.addEventListener('keydown', handleKeydown);
      dom.addEventListener('focus', handlers.onFocus);
      dom.addEventListener('blur', handlers.onBlur as EventListener);
      document.addEventListener('pointerdown', handleDocumentPointerDown, true);

      return () => {
        dom.removeEventListener('mouseup', handleSelectionChange);
        dom.removeEventListener('keyup', handleSelectionChange);
        dom.removeEventListener('pointerdown', handlePointerDown);
        dom.removeEventListener('keydown', handleKeydown);
        dom.removeEventListener('focus', handlers.onFocus);
        dom.removeEventListener('blur', handlers.onBlur as EventListener);
        document.removeEventListener('pointerdown', handleDocumentPointerDown, true);
      };
    },

    dispose(): void {
      this.clearSelectionHighlight();
    }
  };
}

/**
 * 创建 Source 模式高亮 decoration 扩展。
 * 用于在 CodeMirror 中渲染选区高亮视觉效果，与 rich 模式的 AISelectionHighlight 语义对等。
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
          class: HIGHLIGHT_CLASS
        }).range(range.from, range.to)
      ]);
    })
  ];
}
