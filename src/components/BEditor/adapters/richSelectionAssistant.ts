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
  SelectionToolbarAction,
  SelectionReferencePayload
} from './selectionAssistant';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { Selection } from '@tiptap/pm/state';
import type { Editor } from '@tiptap/vue-3';
import { AllSelection, NodeSelection, TextSelection } from '@tiptap/pm/state';
import { CellSelection, findTable, TableMap } from '@tiptap/pm/tables';
import { nanoid } from 'nanoid';
import { clearAISelectionHighlight, setAISelectionHighlight } from '../extensions/aiRangeHighlight';
import { getSelectionSourceLineRange, getSelectionSourceLineRangeFromMarkdown } from './sourceLineMapping';

/**
 * Rich 模式内由 Tiptap mark 命令承载的文字格式动作。
 */
const RICH_TEXT_FORMAT_ACTIONS: readonly SelectionToolbarAction[] = ['bold', 'italic', 'underline', 'strike', 'code', 'link'];

/**
 * 判断字符是否为行尾换行符。
 * @param char - 待判断字符
 * @returns 是否为换行符
 */
function isLineBreakChar(char: string): boolean {
  return char === '\n' || char === '\r';
}

/**
 * 判断 DOMRect 是否具有可见面积。
 * @param rect - 待判断矩形
 * @returns 是否为可见矩形
 */
function isVisibleDomRect(rect: DOMRect): boolean {
  return rect.width > 0 && rect.height > 0;
}

/**
 * 判断表格单元格选区是否覆盖了整张表。
 * @param selection - 当前 CellSelection
 * @param table - 当前选区所在表格
 * @returns 是否选中了整张表
 */
function isWholeTableCellSelection(selection: CellSelection, table: NonNullable<ReturnType<typeof findTable>>): boolean {
  const tableMap = TableMap.get(table.node);
  const rect = tableMap.rectBetween(selection.$anchorCell.pos - table.start, selection.$headCell.pos - table.start);

  return rect.left === 0 && rect.top === 0 && rect.right === tableMap.width && rect.bottom === tableMap.height;
}

/**
 * 将 ProseMirror 选区转换为 Rich 选区工具可消费的范围。
 * Ctrl+A 会产生 AllSelection，需要保留为完整文档范围以触发 AI 高亮。
 * @param selection - ProseMirror 当前选区
 * @param doc - ProseMirror 当前文档
 * @returns Rich 选区范围；非文本类选区返回 null
 */
export function resolveRichSelectionRange(selection: Selection, doc: PMNode): SelectionAssistantRange | null {
  if (selection.empty) {
    return null;
  }

  if (selection instanceof CellSelection) {
    const table = findTable(selection.$anchorCell);
    if (!table) {
      return null;
    }

    if (!isWholeTableCellSelection(selection, table)) {
      return null;
    }

    const from = table.pos;
    const to = table.pos + table.node.nodeSize;
    return {
      from,
      to,
      text: doc.textBetween(from, to, ''),
      docVersion: doc.nodeSize,
      highlightKind: 'node'
    };
  }

  if (!(selection instanceof TextSelection) && !(selection instanceof AllSelection)) {
    return null;
  }

  return {
    from: selection.from,
    to: selection.to,
    text: doc.textBetween(selection.from, selection.to, ''),
    docVersion: doc.nodeSize
  };
}

/**
 * 获取 Rich 模式当前选区可用的工具能力。
 * 表格容器等 node 级选区不适合执行文字 mark 命令，因此只保留 AI/引用/评论动作。
 * @param range - 当前选区范围；为空时返回默认文字选区能力
 * @returns Rich 选区工具能力声明
 */
export function getRichSelectionCapabilities(range?: SelectionAssistantRange | null): SelectionAssistantCapabilities {
  const canApplyTextFormat = range?.highlightKind !== 'node';
  const actions: SelectionAssistantCapabilities['actions'] = {
    ai: true,
    reference: true,
    comment: true
  };

  RICH_TEXT_FORMAT_ACTIONS.forEach((action) => {
    actions[action] = canApplyTextFormat;
  });

  return { actions };
}

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

  /**
   * 将 viewport 坐标系下的 DOMRect 转换为相对 overlayRoot 的矩形。
   * @param rect - viewport 坐标系矩形
   * @returns overlayRoot 坐标系矩形
   */
  function domRectToOverlayRect(rect: DOMRect): {
    top: number;
    left: number;
    width: number;
    height: number;
  } {
    const overlayRect = context.overlayRoot.getBoundingClientRect();
    return {
      top: rect.top - overlayRect.top,
      left: rect.left - overlayRect.left,
      width: rect.width,
      height: rect.height
    };
  }

  /**
   * 归一化 rich 选区起始锚点位置。
   * ProseMirror 在全选场景下 selection.from 可能为 0，此时需要回退到第一个可定位位置。
   * @param from - 原始选区起点
   * @returns 可传给 coordsAtPos 的合法位置
   */
  function resolveToolbarAnchorPos(from: number): number {
    return Math.max(1, from);
  }

  /**
   * 将 rich 选区结束位置收敛到最后一个真实高亮字符之后。
   * 末尾空行未被视觉高亮时，不应参与工具栏和 AI 面板的底部定位。
   * @param range - 当前选区范围
   * @returns 用于底部定位的结束位置
   */
  function resolveSelectionEndAnchorPos(range: SelectionAssistantRange): number {
    let anchorPos = range.to;
    while (anchorPos > range.from) {
      const tailChar = editor.state.doc.textBetween(anchorPos - 1, anchorPos, '\0', '\0');
      if (!isLineBreakChar(tailChar)) {
        return anchorPos;
      }
      anchorPos -= 1;
    }

    return range.to;
  }

  /**
   * 计算视口在 overlayRoot 坐标系中的可见区域矩形。
   * 用于宿主组件做边界约束，确保工具栏/面板不会超出可视区域。
   * @param overlayRect - overlayRoot 的 getBoundingClientRect 结果
   * @returns 视口可见区域，overlayRoot 坐标系
   */
  function getViewportContainerRect(overlayRect: DOMRect): { top: number; left: number; width: number; height: number } {
    const viewportTop = Math.max(0, -overlayRect.top);
    const viewportLeft = Math.max(0, -overlayRect.left);
    return {
      top: viewportTop,
      left: viewportLeft,
      width: window.innerWidth - viewportLeft,
      height: window.innerHeight - viewportTop
    };
  }

  /**
   * 读取浏览器真实选区矩形。
   * 优先使用 DOM selection 的 client rects，以浏览器实际高亮区域为准，避免尾部空行或块边界扩张误导定位。
   * @returns 选区矩形；若当前环境无法读取则返回 null
   */
  function getDomSelectionRect(): { top: number; left: number; width: number; height: number } | null {
    const domSelection = window.getSelection();
    if (!domSelection || domSelection.rangeCount === 0) {
      return null;
    }

    const range = domSelection.getRangeAt(0);
    const clientRects = Array.from(range.getClientRects()).filter(isVisibleDomRect);
    if (clientRects.length === 0) {
      const fallbackRect = range.getBoundingClientRect();
      if (!isVisibleDomRect(fallbackRect)) {
        return null;
      }
      return domRectToOverlayRect(fallbackRect);
    }

    const top = Math.min(...clientRects.map((rect) => rect.top));
    const left = Math.min(...clientRects.map((rect) => rect.left));
    const right = Math.max(...clientRects.map((rect) => rect.right));
    const bottom = Math.max(...clientRects.map((rect) => rect.bottom));

    return domRectToOverlayRect(new DOMRect(left, top, right - left, bottom - top));
  }

  /**
   * 读取 AI 高亮装饰的真实矩形。
   * rich 模式的视觉高亮以 `.ai-selection-highlight` 为准，因此工具栏下方定位应优先跟随这些真实 DOM 片段。
   * @returns 高亮矩形；若当前未渲染高亮装饰则返回 null
   */
  function getHighlightDecorationRect(): { top: number; left: number; width: number; height: number } | null {
    const highlightElements = Array.from(editor.view.dom.querySelectorAll<HTMLElement>('.ai-selection-highlight'));
    const highlightRects = highlightElements.map((element) => element.getBoundingClientRect()).filter(isVisibleDomRect);
    if (highlightRects.length === 0) {
      return null;
    }

    const top = Math.min(...highlightRects.map((rect) => rect.top));
    const left = Math.min(...highlightRects.map((rect) => rect.left));
    const right = Math.max(...highlightRects.map((rect) => rect.right));
    const bottom = Math.max(...highlightRects.map((rect) => rect.bottom));

    return domRectToOverlayRect(new DOMRect(left, top, right - left, bottom - top));
  }

  return {
    getCapabilities(range?: SelectionAssistantRange | null): SelectionAssistantCapabilities {
      return getRichSelectionCapabilities(range);
    },

    isEditable(): boolean {
      return editor.isEditable;
    },

    getSelection(): SelectionAssistantRange | null {
      const { selection } = editor.state;
      return resolveRichSelectionRange(selection, editor.state.doc);
    },

    restoreSelection(range: SelectionAssistantRange): void {
      const { state, view } = editor;
      if (range.highlightKind === 'node') {
        view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, range.from)));
        return;
      }

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
      const endCoords = editor.view.coordsAtPos(resolveSelectionEndAnchorPos(range), -1);
      const lineHeight = endCoords.bottom - endCoords.top;
      const overlayRect = context.overlayRoot.getBoundingClientRect();
      return {
        anchorRect: coordsToAnchorRect(endCoords),
        lineHeight,
        containerRect: getViewportContainerRect(overlayRect)
      };
    },

    getToolbarPosition(range: SelectionAssistantRange): SelectionAssistantPosition | null {
      const startCoords = editor.view.coordsAtPos(resolveToolbarAnchorPos(range.from));
      const endCoords = editor.view.coordsAtPos(resolveSelectionEndAnchorPos(range), -1);
      const lineHeight = startCoords.bottom - startCoords.top;
      const overlayRect = context.overlayRoot.getBoundingClientRect();
      const fallbackSelectionRect = {
        top: Math.min(startCoords.top, endCoords.top) - overlayRect.top,
        left: Math.min(startCoords.left, endCoords.left) - overlayRect.left,
        width: Math.max(startCoords.right, endCoords.right) - Math.min(startCoords.left, endCoords.left),
        height: Math.max(startCoords.bottom, endCoords.bottom) - Math.min(startCoords.top, endCoords.top)
      };
      return {
        anchorRect: coordsToAnchorRect(startCoords),
        selectionRect: getHighlightDecorationRect() ?? getDomSelectionRect() ?? fallbackSelectionRect,
        lineHeight,
        containerRect: getViewportContainerRect(overlayRect)
      };
    },

    showSelectionHighlight(range: SelectionAssistantRange): void {
      setAISelectionHighlight(editor, { from: range.from, to: range.to, highlightKind: range.highlightKind });
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
      editor.chain().focus().insertContentAt({ from: range.from, to: range.to }, content, { contentType: 'markdown' }).run();
    },

    /**
     * 应用行内批注到指定范围，为选中文本添加 inlineComment mark。
     * @param range - 目标选区范围
     * @param comment - 批注正文
     */
    applyComment(range: SelectionAssistantRange, comment: string): void {
      const id = nanoid();
      this.restoreSelection(range);
      editor.chain().focus().setMark('inlineComment', { comment, id }).setTextSelection(range.to).run();
    },

    /**
     * 构造文件引用载荷，计算源码行号。
     * Markdown 原文存在时只接受精确映射，避免映射失败后混用不完整的 ProseMirror 属性坐标。
     * 仅无 Markdown 原文时允许使用节点属性回退。
     * @param range - 当前选区范围
     * @returns 文件引用载荷，无法构造时返回 null
     */
    buildSelectionReference(range: SelectionAssistantRange): SelectionReferencePayload | null {
      const { editorState } = context;

      // 原文存在时失败关闭为无行号引用，防止把渲染坐标误报为 Markdown 物理行号。
      const markdown = editorState.content || '';
      const sourceLineRange = markdown.trim()
        ? getSelectionSourceLineRangeFromMarkdown(editor.state.doc, range.from, range.to, markdown)
        : getSelectionSourceLineRange(editor.state.doc, range.from, range.to);

      const { id = '', ext = '', path: filePath, name: fileName } = editorState;
      const { startLine = 0, endLine = 0 } = sourceLineRange || {};

      return {
        id,
        ext,
        filePath: filePath || null,
        fileName,
        startLine,
        endLine
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
