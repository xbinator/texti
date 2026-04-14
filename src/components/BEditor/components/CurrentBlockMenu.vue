<template>
  <div v-if="isVisible" ref="rootRef" class="current-block-menu" :style="buttonStyle" @mouseenter="isHoveringMenu = true" @mouseleave="handleMenuMouseLeave">
    <button type="button" class="current-block-menu__trigger" :class="{ 'is-open': open }" @mousedown.prevent="toggleMenu" @click.prevent>
      <Icon :icon="triggerIcon" />
    </button>

    <div v-if="open" class="current-block-menu__panel" :class="panelClass">
      <BScrollbar :max-height="320" class="current-block-menu__scrollbar" inset>
        <div class="current-block-menu__content">
          <template v-for="item in menuItems" :key="item.value">
            <div v-if="item.type === 'divider'" class="current-block-menu__divider"></div>
            <button
              v-else
              type="button"
              class="current-block-menu__item"
              :class="{ 'is-active': item.active, 'is-danger': item.danger, 'is-disabled': item.disabled }"
              :disabled="item.disabled"
              @mousedown.prevent="handleSelect(item)"
              @click.prevent
            >
              <span class="current-block-menu__item-icon">
                <Icon :icon="item.icon" />
              </span>
              <span class="current-block-menu__item-label">{{ item.label }}</span>
              <span v-if="item.active" class="current-block-menu__item-check">
                <Icon icon="lucide:check" />
              </span>
            </button>
          </template>
        </div>
      </BScrollbar>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Editor } from '@tiptap/vue-3';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { Icon } from '@iconify/vue';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { onClickOutside, useEventListener } from '@vueuse/core';
import BScrollbar from '@/components/BScrollbar/index.vue';

interface Props {
  editor?: Editor | null;
}

interface BlockPosition {
  attrs: Record<string, unknown>;
  depth: number;
  index: number;
  nodeSize: number;
  nodeType: string;
  parentOffset: number;
  pos: number;
}

interface MenuAction {
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  icon: string;
  label: string;
  onClick: () => void;
  type: 'item';
  value: string;
}

interface MenuDivider {
  type: 'divider';
  value: string;
}

type MenuItem = MenuAction | MenuDivider;

const props = withDefaults(defineProps<Props>(), {
  editor: null
});

const rootRef = ref<HTMLElement | null>(null);
const open = ref(false);
const isFocused = ref(false);
const isHoveringMenu = ref(false);
const currentBlock = ref<BlockPosition | null>(null);
const hoveredBlockPos = ref<number | null>(null);
const triggerSize = 28;
const position = ref({ top: 0 });
const placement = ref<'top' | 'bottom'>('bottom');

const hiddenBlockTypes = new Set(['codeBlock', 'table', 'tableRow', 'tableCell', 'tableHeader']);

function isInsideExcludedContainer(editor: Editor | null | undefined, block: BlockPosition | null): boolean {
  if (!editor || !block) {
    return false;
  }

  const nodeElement = editor.view.nodeDOM(block.pos);
  if (!(nodeElement instanceof HTMLElement)) {
    return false;
  }

  return Boolean(nodeElement.closest('pre, table, td, th'));
}

const shouldHideForCurrentBlock = computed(() => {
  const block = currentBlock.value;
  const { editor } = props;

  if (editor?.isActive('codeBlock')) {
    return true;
  }

  if (editor?.isActive('table') || editor?.isActive('tableRow') || editor?.isActive('tableCell') || editor?.isActive('tableHeader')) {
    return true;
  }

  if (isInsideExcludedContainer(editor, block)) {
    return true;
  }

  return Boolean(block && hiddenBlockTypes.has(block.nodeType));
});

const isVisible = computed(() =>
  Boolean(props.editor && currentBlock.value && !shouldHideForCurrentBlock.value && (hoveredBlockPos.value !== null || open.value || isHoveringMenu.value))
);
const buttonStyle = computed(() => ({
  left: '-20px',
  top: `${position.value.top}px`,
  transform: 'translateX(-50%)'
}));
const panelClass = computed(() => ({
  'is-placement-top': placement.value === 'top',
  'is-placement-bottom': placement.value === 'bottom'
}));
const triggerIcon = computed(() => {
  const block = currentBlock.value;
  const { editor } = props;
  if (!block) {
    return 'lucide:text';
  }

  if (block.nodeType === 'heading') {
    const level = typeof block.attrs.level === 'number' ? block.attrs.level : 0;
    if (level === 1) return 'lucide:heading-1';
    if (level === 2) return 'lucide:heading-2';
    if (level === 3) return 'lucide:heading-3';
    return 'lucide:heading';
  }

  if (block.nodeType === 'orderedList') return 'lucide:list-ordered';
  if (block.nodeType === 'bulletList') return 'lucide:list';
  if (block.nodeType === 'blockquote') return 'lucide:quote';
  if (block.nodeType === 'codeBlock') return 'lucide:square-code';
  if (block.nodeType === 'horizontalRule') return 'lucide:minus';
  if (block.nodeType === 'table') return 'lucide:table-properties';

  if (editor?.isActive('orderedList')) return 'lucide:list-ordered';
  if (editor?.isActive('bulletList')) return 'lucide:list';

  return 'lucide:text';
});

function handleMenuMouseLeave(): void {
  isHoveringMenu.value = false;
}

function getCurrentBlockPosition(state: EditorState, pointerPos?: number | null): BlockPosition | null {
  if (pointerPos === null || pointerPos === undefined) {
    return null;
  }

  const $from = state.doc.resolve(pointerPos);

  for (let { depth } = $from; depth > 0; depth -= 1) {
    const node = $from.node(depth);

    if (!node.isBlock) {
      continue;
    }

    return {
      attrs: node.attrs as Record<string, unknown>,
      depth,
      index: $from.index(depth),
      pos: $from.before(depth),
      nodeType: node.type.name,
      parentOffset: $from.start(depth) - 1,
      nodeSize: node.nodeSize
    };
  }

  const { firstChild } = state.doc;
  if (!firstChild) {
    return null;
  }

  return {
    attrs: firstChild.attrs as Record<string, unknown>,
    depth: 0,
    index: 0,
    pos: 0,
    nodeType: firstChild.type.name,
    parentOffset: 0,
    nodeSize: firstChild.nodeSize
  };
}

function findBlockElement(target: EventTarget | null, editorRoot: HTMLElement): HTMLElement | null {
  if (!(target instanceof HTMLElement)) {
    return null;
  }

  const blockSelectors = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'li', 'hr', 'table'].join(', ');

  const blockElement = target.closest(blockSelectors);
  if (!(blockElement instanceof HTMLElement) || !editorRoot.contains(blockElement)) {
    return null;
  }

  return blockElement;
}

function getHoveredBlockPos(editor: Editor, target: EventTarget | null): number | null {
  const editorRoot = editor.view.dom;
  if (!(editorRoot instanceof HTMLElement)) {
    return null;
  }

  const blockElement = findBlockElement(target, editorRoot);
  if (!blockElement) {
    return null;
  }

  try {
    return editor.view.posAtDOM(blockElement, 0);
  } catch {
    return null;
  }
}

function isPointerWithinCurrentBlockInteractionZone(event: MouseEvent, editor: Editor): boolean {
  const block = currentBlock.value;
  if (!block) {
    return false;
  }

  const nodeElement = editor.view.nodeDOM(block.pos);
  if (!(nodeElement instanceof HTMLElement)) {
    return false;
  }

  const nodeRect = nodeElement.getBoundingClientRect();
  const menuRect = rootRef.value?.getBoundingClientRect();
  const fallbackTriggerRect = {
    left: nodeRect.left - 34,
    right: nodeRect.left - 6,
    top: nodeRect.top + nodeRect.height / 2 - 14,
    bottom: nodeRect.top + nodeRect.height / 2 + 14
  };
  const anchorRect = menuRect ?? fallbackTriggerRect;
  const padding = 8;
  const left = Math.min(anchorRect.left, nodeRect.left) - padding;
  const right = nodeRect.left + padding;
  const top = Math.min(anchorRect.top, nodeRect.top) - padding;
  const bottom = Math.max(anchorRect.bottom, nodeRect.bottom) + padding;

  return event.clientX >= left && event.clientX <= right && event.clientY >= top && event.clientY <= bottom;
}

function updatePosition(): void {
  const { editor } = props;
  const block = currentBlock.value;
  const rootElement = rootRef.value?.offsetParent instanceof HTMLElement ? rootRef.value.offsetParent : rootRef.value?.parentElement;

  if (!editor || !block || !rootElement) {
    return;
  }

  const nodeElement = editor.view.nodeDOM(block.pos);
  if (!(nodeElement instanceof HTMLElement)) {
    return;
  }

  const rootRect = rootElement.getBoundingClientRect();
  const nodeRect = nodeElement.getBoundingClientRect();
  const computedStyle = window.getComputedStyle(nodeElement);
  const parsedLineHeight = Number.parseFloat(computedStyle.lineHeight);
  const parsedFontSize = Number.parseFloat(computedStyle.fontSize);
  let effectiveLineHeight = triggerSize;
  if (Number.isFinite(parsedLineHeight)) {
    effectiveLineHeight = parsedLineHeight;
  } else if (Number.isFinite(parsedFontSize)) {
    effectiveLineHeight = parsedFontSize * 1.2;
  }
  const triggerTopOffset = Math.max(0, (effectiveLineHeight - triggerSize) / 2);
  position.value = { top: Math.max(0, nodeRect.top - rootRect.top + triggerTopOffset) };
}

function updatePlacement(): void {
  const triggerElement = rootRef.value?.querySelector('.current-block-menu__trigger');
  if (!triggerElement) {
    return;
  }

  const triggerRect = triggerElement.getBoundingClientRect();
  const viewportHeight = window.innerHeight;
  const estimatedPanelHeight = 400;

  const spaceBelow = viewportHeight - triggerRect.bottom;
  const spaceAbove = triggerRect.top;

  if (spaceBelow < estimatedPanelHeight && spaceAbove > spaceBelow) {
    placement.value = 'top';
  } else {
    placement.value = 'bottom';
  }
}

function syncCurrentBlock(): void {
  const { editor } = props;
  if (!editor) {
    currentBlock.value = null;
    return;
  }

  const nextBlock = getCurrentBlockPosition(editor.state, hoveredBlockPos.value);
  if (!nextBlock) {
    if (!open.value && !isHoveringMenu.value) {
      currentBlock.value = null;
    }
    return;
  }

  currentBlock.value = nextBlock;
  if (shouldHideForCurrentBlock.value) {
    open.value = false;
  }
  updatePosition();
}

function runCommand(command: () => boolean): void {
  const executed = command();
  if (!executed) {
    return;
  }

  syncCurrentBlock();
  open.value = false;
}

function insertBlockBelow(
  content: { type: 'paragraph' } | { type: 'heading'; attrs: { level: 2 } } | { type: 'codeBlock' } | [{ type: 'horizontalRule' }, { type: 'paragraph' }],
  focusOffset: number
): void {
  const { editor } = props;
  const block = currentBlock.value;
  if (!editor || !block) {
    return;
  }

  const insertPos = block.pos + block.nodeSize;
  const executed = editor
    .chain()
    .focus()
    .insertContentAt(insertPos, content)
    .setTextSelection(insertPos + focusOffset)
    .run();

  if (!executed) {
    return;
  }

  syncCurrentBlock();
  open.value = false;
}

function deleteCurrentBlock(): void {
  const { editor } = props;
  const block = currentBlock.value;
  if (!editor || !block) {
    return;
  }

  const { pos, nodeSize } = block;
  editor.commands.focus();
  editor.view.dispatch(editor.state.tr.delete(pos, pos + nodeSize).scrollIntoView());
  syncCurrentBlock();
  open.value = false;
}

function duplicateCurrentBlock(): void {
  const { editor } = props;
  const block = currentBlock.value;
  if (!editor || !block) {
    return;
  }

  const node = editor.state.doc.nodeAt(block.pos);
  if (!node) {
    return;
  }

  const insertPos = block.pos + block.nodeSize;
  const transaction = editor.state.tr.insert(insertPos, node);
  const selectionPos = Math.min(insertPos + 1, transaction.doc.content.size);

  editor.view.dispatch(transaction.setSelection(TextSelection.near(transaction.doc.resolve(selectionPos))).scrollIntoView());
  syncCurrentBlock();
  open.value = false;
}

const menuItems = computed<MenuItem[]>(() => {
  const { editor } = props;
  const block = currentBlock.value;
  if (!editor || !block) {
    return [];
  }

  return [
    {
      type: 'item',
      value: 'paragraph',
      label: '正文',
      icon: 'lucide:text',
      active: editor.isActive('paragraph'),
      onClick: () => runCommand(() => editor.chain().focus().setParagraph().run())
    },
    {
      type: 'item',
      value: 'heading-1',
      label: '标题 1',
      icon: 'lucide:heading-1',
      active: editor.isActive('heading', { level: 1 }),
      onClick: () => runCommand(() => editor.chain().focus().toggleHeading({ level: 1 }).run())
    },
    {
      type: 'item',
      value: 'heading-2',
      label: '标题 2',
      icon: 'lucide:heading-2',
      active: editor.isActive('heading', { level: 2 }),
      onClick: () => runCommand(() => editor.chain().focus().toggleHeading({ level: 2 }).run())
    },
    {
      type: 'item',
      value: 'heading-3',
      label: '标题 3',
      icon: 'lucide:heading-3',
      active: editor.isActive('heading', { level: 3 }),
      onClick: () => runCommand(() => editor.chain().focus().toggleHeading({ level: 3 }).run())
    },
    {
      type: 'item',
      value: 'bullet-list',
      label: '无序列表',
      icon: 'lucide:list',
      active: editor.isActive('bulletList'),
      onClick: () => runCommand(() => editor.chain().focus().toggleBulletList().run())
    },
    {
      type: 'item',
      value: 'ordered-list',
      label: '有序列表',
      icon: 'lucide:list-ordered',
      active: editor.isActive('orderedList'),
      onClick: () => runCommand(() => editor.chain().focus().toggleOrderedList().run())
    },
    {
      type: 'item',
      value: 'blockquote',
      label: '引用',
      icon: 'lucide:quote',
      active: editor.isActive('blockquote'),
      onClick: () => runCommand(() => editor.chain().focus().toggleBlockquote().run())
    },
    {
      type: 'item',
      value: 'code-block',
      label: '代码块',
      icon: 'lucide:square-code',
      active: editor.isActive('codeBlock'),
      onClick: () => runCommand(() => editor.chain().focus().toggleCodeBlock().run())
    },
    {
      type: 'divider',
      value: 'divider-block-actions'
    },
    {
      type: 'item',
      value: 'duplicate',
      label: '复制当前块',
      icon: 'lucide:copy',
      onClick: duplicateCurrentBlock
    },
    {
      type: 'divider',
      value: 'divider-insert'
    },
    {
      type: 'item',
      value: 'insert-paragraph',
      label: '下方插入正文',
      icon: 'lucide:between-horizontal-start',
      onClick: () => insertBlockBelow({ type: 'paragraph' }, 1)
    },
    {
      type: 'item',
      value: 'insert-heading',
      label: '下方插入标题',
      icon: 'lucide:heading-2',
      onClick: () => insertBlockBelow({ type: 'heading', attrs: { level: 2 } }, 1)
    },
    {
      type: 'item',
      value: 'insert-code-block',
      label: '下方插入代码块',
      icon: 'lucide:square-code',
      onClick: () => insertBlockBelow({ type: 'codeBlock' }, 1)
    },
    {
      type: 'item',
      value: 'insert-divider',
      label: '下方插入分割线',
      icon: 'lucide:minus',
      onClick: () => insertBlockBelow([{ type: 'horizontalRule' }, { type: 'paragraph' }], 2)
    },
    {
      type: 'divider',
      value: 'divider-delete'
    },
    {
      type: 'item',
      value: 'delete',
      label: '删除当前块',
      icon: 'lucide:trash-2',
      danger: true,
      onClick: deleteCurrentBlock
    }
  ];
});

function toggleMenu(): void {
  open.value = !open.value;
  if (open.value) {
    props.editor?.commands.focus();
    syncCurrentBlock();
    updatePlacement();
  }
}

function handleSelect(item: MenuItem): void {
  if (item.type === 'divider') {
    return;
  }

  item.onClick();
}

function bindEditor(editor: Editor | null | undefined): (() => void) | undefined {
  if (!editor) {
    return undefined;
  }

  const editorDom = editor.view.dom;

  const update = (): void => {
    syncCurrentBlock();
  };
  const handleFocus = (): void => {
    isFocused.value = true;
    syncCurrentBlock();
  };
  const handleBlur = (): void => {
    isFocused.value = false;
    if (!open.value && !isHoveringMenu.value) {
      currentBlock.value = null;
    }
  };

  // 绑定在 document 上，这样鼠标在按钮与编辑器之间的间隙中移动时也能追踪
  const handleMouseMove = (event: MouseEvent): void => {
    if (open.value) return;

    const targetNode = event.target instanceof Node ? event.target : null;
    const inEditor = Boolean(targetNode && editorDom instanceof HTMLElement && editorDom.contains(targetNode));
    const inMenu = Boolean(targetNode && rootRef.value?.contains(targetNode));

    if (inMenu) {
      // 在菜单内，保持当前 block 不变
      return;
    }

    if (inEditor) {
      // 在编辑器内，正常更新
      const nextHoveredBlockPos = getHoveredBlockPos(editor, event.target);
      if (nextHoveredBlockPos !== null) {
        hoveredBlockPos.value = nextHoveredBlockPos;
        syncCurrentBlock();
        return;
      }

      if (isPointerWithinCurrentBlockInteractionZone(event, editor)) {
        return;
      }

      hoveredBlockPos.value = null;
      if (!isHoveringMenu.value) {
        currentBlock.value = null;
      }
      syncCurrentBlock();
      return;
    }

    if (isPointerWithinCurrentBlockInteractionZone(event, editor)) {
      return;
    }

    // 真正离开编辑器和菜单（包括间隙以外的区域），才清空
    hoveredBlockPos.value = null;
    if (!isHoveringMenu.value) {
      currentBlock.value = null;
    }
  };

  editor.on('selectionUpdate', update);
  editor.on('transaction', update);
  editor.on('focus', handleFocus);
  editor.on('blur', handleBlur);
  document.addEventListener('mousemove', handleMouseMove);

  isFocused.value = editor.isFocused;
  syncCurrentBlock();

  return () => {
    editor.off('selectionUpdate', update);
    editor.off('transaction', update);
    editor.off('focus', handleFocus);
    editor.off('blur', handleBlur);
    document.removeEventListener('mousemove', handleMouseMove);
  };
}

let cleanupEditor: (() => void) | undefined;

watch(
  () => props.editor,
  (editor) => {
    cleanupEditor?.();
    cleanupEditor = bindEditor(editor);
  },
  { immediate: true }
);

useEventListener('resize', () => {
  updatePosition();
});

onClickOutside(rootRef, () => {
  open.value = false;
  isHoveringMenu.value = false;
  if (!isFocused.value) {
    currentBlock.value = null;
  }
});

onBeforeUnmount(() => {
  cleanupEditor?.();
});
</script>

<style scoped>
.current-block-menu {
  position: absolute;
  z-index: 12;
}

.current-block-menu__trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  color: var(--text-secondary);
  cursor: pointer;
  background: var(--bg-primary);
  border: 1px solid var(--border-primary);
  border-radius: 8px;
  box-shadow: var(--shadow-dropdown);
  transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}

.current-block-menu__trigger:hover,
.current-block-menu__trigger.is-open {
  color: var(--text-primary);
  background: var(--bg-tertiary);
  border-color: var(--border-primary);
}

.current-block-menu__panel {
  position: absolute;
  right: calc(100% + 8px);
  min-width: 172px;
  padding: 6px;
  background: var(--dropdown-bg);
  border: 1px solid var(--dropdown-border);
  border-radius: 10px;
  box-shadow: var(--shadow-lg);
}

.current-block-menu__panel.is-placement-bottom {
  top: 0;
}

.current-block-menu__panel.is-placement-top {
  bottom: 0;
}

.current-block-menu__scrollbar {
  max-height: 320px;
}

.current-block-menu__content {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.current-block-menu__item {
  display: flex;
  gap: 8px;
  align-items: center;
  width: 100%;
  height: 32px;
  padding: 0 8px;
  font-size: 13px;
  color: var(--text-primary);
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: 8px;
}

.current-block-menu__item:hover {
  background: var(--bg-hover);
}

.current-block-menu__item.is-disabled,
.current-block-menu__item:disabled {
  color: var(--text-disabled);
  cursor: not-allowed;
  background: transparent;
}

.current-block-menu__item.is-active {
  background: var(--color-primary-bg);
}

.current-block-menu__item.is-danger {
  color: var(--color-error);
}

.current-block-menu__divider {
  height: 1px;
  margin: 4px 6px;
  background: var(--dropdown-divider);
}

.current-block-menu__item-icon,
.current-block-menu__item-check {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
}

.current-block-menu__item-label {
  flex: 1;
  text-align: left;
}

@media (width <= 768px) {
  .current-block-menu {
    display: none;
  }
}
</style>
