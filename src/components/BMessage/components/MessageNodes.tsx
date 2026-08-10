/**
 * @file MessageNodes.tsx
 * @description 使用单个 Vue 组件将 BMessage AST 渲染为原生 VNode。
 */
/* eslint-disable no-use-before-define -- 列表与引用节点需要递归渲染块节点。 */
import type { BlockNode, InlineNode, ListItemNode, MessageNodeRenderContext, TableBlockNode, TableCellNode } from '../types';
import type { PropType, VNodeChild } from 'vue';
import { defineComponent, h, inject } from 'vue';
import BIcon from '@/components/BIcon/index.vue';
import { useClipboard } from '@/hooks/useClipboard';
import { createNamespace } from '@/utils/namespace';
import { MESSAGE_NODE_RENDER_CONTEXT_KEY } from '../types';
import CodeBlockNode from './CodeBlockNode.vue';
import ImageNode from './ImageNode.vue';
import MathBlockNode from './MathBlockNode.vue';
import MathNode from './MathNode.vue';

const [, bem] = createNamespace('message');

/**
 * 渲染器组件属性。
 */
interface Props {
  /** 顶层块节点。 */
  blocks: BlockNode[];
}

/**
 * 表格复制处理函数。
 */
type TableCopyHandler = (node: TableBlockNode, event: MouseEvent) => Promise<void>;

/**
 * 将行内节点转为复制用纯文本。
 * @param nodes - 行内节点列表
 * @returns 纯文本内容
 */
function toPlainText(nodes: InlineNode[]): string {
  return nodes
    .map((node: InlineNode): string => {
      if (node.type === 'text') return node.text;
      if (node.type === 'code') return node.text;
      if (node.type === 'math') return node.text;
      if (node.type === 'image') return node.alt;
      if (node.type === 'break') return '\n';
      if (node.type === 'cursor') return '';
      return toPlainText(node.children);
    })
    .join('');
}

/**
 * 清理 TSV 单元格内容，避免破坏行列结构。
 * @param text - 原始单元格文本
 * @returns 可安全复制为 TSV 的文本
 */
function sanitizeCellText(text: string): string {
  return text
    .replace(/[\t\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 将表格行转为 TSV 行。
 * @param cells - 表格单元格列表
 * @returns TSV 行文本
 */
function formatTableRow(cells: TableCellNode[]): string {
  return cells.map((cell: TableCellNode): string => sanitizeCellText(toPlainText(cell.children))).join('\t');
}

/**
 * 将表格节点转为 TSV 文本。
 * @param node - 表格块节点
 * @returns TSV 文本
 */
function formatTableTsv(node: TableBlockNode): string {
  return [formatTableRow(node.header), ...node.rows.map((row: TableCellNode[]): string => formatTableRow(row))].join('\n');
}

/**
 * 渲染行内节点列表。
 * @param nodes - 行内节点列表
 * @param context - 消息交互上下文
 * @returns VNode 子节点
 */
function renderInlineNodes(nodes: InlineNode[], context: MessageNodeRenderContext | null): VNodeChild[] {
  return nodes.map((node: InlineNode, index: number): VNodeChild => renderInlineNode(node, index, context));
}

/**
 * 渲染单个行内节点。
 * @param node - 行内节点
 * @param key - 同级稳定位置
 * @param context - 消息交互上下文
 * @returns VNode 子节点
 */
function renderInlineNode(node: InlineNode, key: number, context: MessageNodeRenderContext | null): VNodeChild {
  if (node.type === 'text') return node.text;
  if (node.type === 'strong') return h('strong', { key }, renderInlineNodes(node.children, context));
  if (node.type === 'em') return h('em', { key }, renderInlineNodes(node.children, context));
  if (node.type === 'del') return h('del', { key }, renderInlineNodes(node.children, context));
  if (node.type === 'mark') return h('mark', { key }, renderInlineNodes(node.children, context));
  if (node.type === 'sup') return h('sup', { key }, renderInlineNodes(node.children, context));
  if (node.type === 'sub') return h('sub', { key }, renderInlineNodes(node.children, context));
  if (node.type === 'code') return h('code', { key }, node.text);
  if (node.type === 'math') return h(MathNode, { key, text: node.text });
  if (node.type === 'link') {
    return h('a', { key, href: node.href, title: node.title || undefined, onClick: context?.navigateLink }, renderInlineNodes(node.children, context));
  }
  if (node.type === 'image') return h(ImageNode, { key, node });
  if (node.type === 'break') return h('br', { key });
  if (node.type === 'htmlInline') {
    return h(node.tag, { key, title: node.title }, renderInlineNodes(node.children, context));
  }
  return h('span', { key, class: bem('cursor'), 'aria-hidden': 'true' });
}

/**
 * 渲染列表项。
 * @param item - 列表项
 * @param context - 消息交互上下文
 * @param onTableCopy - 表格复制处理函数
 * @returns 列表项 VNode
 */
function renderListItem(item: ListItemNode, context: MessageNodeRenderContext | null, onTableCopy: TableCopyHandler): VNodeChild {
  const children: VNodeChild[] = [];
  if (item.task) {
    children.push(h('input', { type: 'checkbox', disabled: true, checked: item.checked }));
  }
  children.push(...renderBlockNodes(item.children, context, onTableCopy));
  return h('li', { key: item.id }, children);
}

/**
 * 渲染表格单元格。
 * @param tag - th 或 td
 * @param cell - 表格单元格
 * @param context - 消息交互上下文
 * @returns 单元格 VNode
 */
function renderTableCell(tag: 'th' | 'td', cell: TableCellNode, context: MessageNodeRenderContext | null): VNodeChild {
  return h(tag, { key: cell.id, style: { textAlign: cell.align || undefined } }, [
    h('div', { class: bem('table-cell-content') }, renderInlineNodes(cell.children, context))
  ]);
}

/**
 * 渲染表格块并限制外层宽度。
 * @param node - 表格块节点
 * @param context - 消息交互上下文
 * @param onTableCopy - 表格复制处理函数
 * @returns 表格滚动容器 VNode
 */
function renderTable(node: TableBlockNode, context: MessageNodeRenderContext | null, onTableCopy: TableCopyHandler): VNodeChild {
  return h('div', { key: node.id, class: bem('table-scroller') }, [
    h('div', { class: bem('table-toolbar') }, [
      h(
        'button',
        {
          type: 'button',
          class: bem('table-copy'),
          title: '复制表格',
          'aria-label': '复制表格',
          onClick: (event: MouseEvent): Promise<void> => onTableCopy(node, event)
        },
        [h(BIcon, { icon: 'lucide:copy', size: 14 })]
      )
    ]),
    h('table', [
      h('thead', [
        h(
          'tr',
          node.header.map((cell: TableCellNode): VNodeChild => renderTableCell('th', cell, context))
        )
      ]),
      h(
        'tbody',
        node.rows.map(
          (row: TableCellNode[], rowIndex: number): VNodeChild =>
            h(
              'tr',
              { key: rowIndex },
              row.map((cell: TableCellNode): VNodeChild => renderTableCell('td', cell, context))
            )
        )
      )
    ])
  ]);
}

/**
 * 渲染块节点列表。
 * @param nodes - 块节点列表
 * @param context - 消息交互上下文
 * @param onTableCopy - 表格复制处理函数
 * @returns VNode 子节点
 */
function renderBlockNodes(nodes: BlockNode[], context: MessageNodeRenderContext | null, onTableCopy: TableCopyHandler): VNodeChild[] {
  return nodes.map((node: BlockNode): VNodeChild => {
    if (node.type === 'paragraph') return h('p', { key: node.id }, renderInlineNodes(node.children, context));
    if (node.type === 'heading') return h(`h${node.depth}`, { key: node.id }, renderInlineNodes(node.children, context));
    if (node.type === 'list') {
      return h(
        node.ordered ? 'ol' : 'ul',
        { key: node.id, start: node.ordered ? node.start || undefined : undefined },
        node.items.map((item: ListItemNode): VNodeChild => renderListItem(item, context, onTableCopy))
      );
    }
    if (node.type === 'blockquote') return h('blockquote', { key: node.id }, renderBlockNodes(node.children, context, onTableCopy));
    if (node.type === 'code') return h(CodeBlockNode, { key: node.id, node });
    if (node.type === 'math') return h(MathBlockNode, { key: node.id, text: node.text });
    if (node.type === 'table') return renderTable(node, context, onTableCopy);
    if (node.type === 'hr') return h('hr', { key: node.id });
    if (node.type === 'component') {
      return h('div', { key: node.id, class: 'b-message__component-placeholder' }, node.componentName);
    }
    return h('span', { key: node.id, class: bem('cursor'), 'aria-hidden': 'true' });
  });
}

export default defineComponent({
  name: 'MessageNodes',
  props: {
    blocks: {
      type: Array as PropType<BlockNode[]>,
      required: true
    }
  },
  setup(props: Props): () => VNodeChild {
    const context = inject(MESSAGE_NODE_RENDER_CONTEXT_KEY, null);
    const { clipboard } = useClipboard();

    /**
     * 复制表格为 TSV 文本。
     * @param node - 表格块节点
     * @param event - 鼠标点击事件
     */
    async function handleTableCopy(node: TableBlockNode, event: MouseEvent): Promise<void> {
      event.preventDefault();
      event.stopPropagation();

      await clipboard(formatTableTsv(node), {
        successMessage: '表格已复制',
        trim: false
      });
    }

    return (): VNodeChild => renderBlockNodes(props.blocks, context, handleTableCopy);
  }
});
