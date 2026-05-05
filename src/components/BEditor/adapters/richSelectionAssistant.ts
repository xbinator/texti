/**
 * @file richSelectionAssistant.ts
 * @description Rich 模式（Tiptap）选区工具适配器实现。
 */
import type {
  SelectionAssistantAdapter,
  SelectionAssistantCapabilities,
  SelectionAssistantContext,
  SelectionAssistantPosition,
  SelectionAssistantRange,
  SelectionReferencePayload
} from './selectionAssistant';
import type { Editor } from '@tiptap/vue-3';
import { TextSelection } from '@tiptap/pm/state';
import { clearAISelectionHighlight, setAISelectionHighlight } from '../extensions/AISelectionHighlight';
import { getSelectionSourceLineRange, getSelectionSourceLineRangeFromMarkdown } from './sourceLineMapping';

/**
 * 创建 Rich 模式选区工具适配器。
 * @param editor - Tiptap Editor 实例
 * @param context - 编辑器上下文（文件元数据 + 浮层根容器）
 * @returns 遵循 SelectionAssistantAdapter 协议的适配器实例
 */
export function createRichSelectionAssistantAdapter(editor: Editor, context: SelectionAssistantContext): SelectionAssistantAdapter {
  /**
   * 将 Tiptap 的 coordsAtPos 返回坐标转换为相对 overlayRoot 的矩形。
   */
  function coordsToAnchorRect(coords: { top: number; left: number; right: number; bottom: number }): {
    top: number;
    left: number;
    width: number;
    height: number;
  } {
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
      const { selection } = editor.state;
      if (selection.from === selection.to) {
        return null;
      }

      return {
        from: selection.from,
        to: selection.to,
        text: editor.state.doc.textBetween(selection.from, selection.to, ''),
        docVersion: editor.state.doc.nodeSize
      };
    },

    restoreSelection(range: SelectionAssistantRange): void {
      const { state, view } = editor;
      view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, range.from, range.to)));
    },

    isRangeStillValid(range: SelectionAssistantRange): boolean {
      const currentDocVersion = editor.state.doc.nodeSize;
      if (range.docVersion !== undefined && range.docVersion !== currentDocVersion) {
        return false;
      }

      const currentText = editor.state.doc.textBetween(range.from, range.to, '');
      return currentText === range.text;
    },

    clearNativeSelection(): void {
      // rich 模式通过 CSS ::selection { background: transparent } 隐藏原生选区
      // 无需额外操作
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

    /**
     * 应用 AI 生成内容到原选区位置。
     * 先恢复选中的文本范围，再用 Markdown 格式的内容替换。
     * @param range - 原选区范围
     * @param content - AI 生成的新内容
     */
    async applyGeneratedContent(range: SelectionAssistantRange, content: string): Promise<void> {
      this.restoreSelection(range);
      editor.chain().focus().insertContentAt({ from: range.from, to: range.to }, content).run();
    },

    /**
     * 构造文件引用载荷，计算源码行号与渲染行号。
     * 优先使用基于 Markdown 原文的精确行号映射，回退到基于 ProseMirror node attr 的方案。
     * @param range - 当前选区范围
     * @returns 文件引用载荷，无法构造时返回 null
     */
    buildSelectionReference(range: SelectionAssistantRange): SelectionReferencePayload | null {
      const { editorState } = context;

      // 优先使用基于 Markdown lexer 的精确行号，回退到基于 attrs 的方案
      const sourceLineRange =
        getSelectionSourceLineRangeFromMarkdown(editor.state.doc, range.from, range.to, editorState.content || '') ||
        getSelectionSourceLineRange(editor.state.doc, range.from, range.to);

      // 计算渲染行号（基于 ProseMirror 文档文本的换行符计数）
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

    /**
     * 绑定编辑器选区、焦点、失焦事件。
     * Tiptap 的 blur 事件回调签名为 ({ event }: { event: FocusEvent }) => void，
     * 通过包装函数适配到 adapter 协议的 onBlur(event?) 签名。
     * @param handlers - 事件处理器集合
     * @returns 解绑函数
     */
    bindSelectionEvents(handlers): () => void {
      editor.on('selectionUpdate', handlers.onSelectionChange);
      editor.on('focus', handlers.onFocus);
      const onTiptapBlur = ({ event }: { event: FocusEvent }) => handlers.onBlur(event);
      editor.on('blur', onTiptapBlur);
      const editorDom = editor.view.dom;
      const handleKeydown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') {
          handlers.onEscape?.();
        }
      };
      editorDom.addEventListener('keydown', handleKeydown);

      return () => {
        editor.off('selectionUpdate', handlers.onSelectionChange);
        editor.off('focus', handlers.onFocus);
        editor.off('blur', onTiptapBlur);
        editorDom.removeEventListener('keydown', handleKeydown);
      };
    }
  };
}
