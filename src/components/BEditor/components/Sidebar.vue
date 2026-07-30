<!--
  @file Sidebar.vue
  @description Markdown 大纲侧栏，负责标题锚点导航、宽度调整以及按钮触发的显隐动画。
-->
<template>
  <BPanelSplitter
    v-model:size="sidebarWidth"
    class="b-markdown-sidebar-panel"
    :class="{
      'b-markdown-sidebar-panel--motion': props.motionEnabled,
      'b-markdown-sidebar-panel--visible': props.visible
    }"
    :style="sidebarStyle"
    :inert="!props.visible || undefined"
    :disabled="!props.visible"
    position="right"
    :min-width="180"
    :max-width="400"
    @close="emit('close')"
    @resize-start="emit('resize-start')"
  >
    <div class="b-markdown-sidebar">
      <div class="sidebar__header">
        <div v-if="title" class="sidebar__main" @click="handleTitleClick">
          <span class="sidebar__title">{{ title }}</span>
        </div>
        <BButton class="sidebar__toggle" type="ghost" size="small" square icon="lucide:list-indent-decrease" @click="emit('button-close')" />
      </div>
      <div v-if="items.length" class="sidebar__content">
        <AnchorContent :items="items" :active-id="activeId" @click="handleAnchorClick" />
      </div>
      <div v-else class="sidebar__empty">
        <span class="sidebar__empty-text">暂无标题大纲</span>
      </div>
    </div>
  </BPanelSplitter>
</template>

<script setup lang="ts">
import type { CSSProperties } from 'vue';
import { computed, ref, watch } from 'vue';
import { marked, Tokens } from 'marked';
import AnchorContent, { AnchorItem } from './AnchorContent.vue';

/**
 * Markdown 大纲侧栏属性。
 */
interface Props {
  /** 当前文档标题 */
  title?: string;
  /** 用于生成标题锚点的 Markdown 内容 */
  content?: string;
  /** 标题锚点 ID 前缀 */
  anchorIdPrefix?: string;
  /** 当前选中的锚点 ID */
  activeId?: string;
  /** 是否显示大纲侧栏 */
  visible?: boolean;
  /** 是否临时启用按钮显隐动画 */
  motionEnabled?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  title: '',
  content: '',
  anchorIdPrefix: '',
  activeId: '',
  visible: false,
  motionEnabled: false
});

const emit = defineEmits<{
  /** 切换当前大纲锚点 */
  change: [item: AnchorItem];
  /** 分隔器拖拽关闭侧栏 */
  close: [];
  /** 用户开始拖拽调整侧栏宽度 */
  'resize-start': [];
  /** 标题栏按钮请求关闭侧栏 */
  'button-close': [];
}>();

/** 大纲侧栏默认宽度。 */
const DEFAULT_SIDEBAR_WIDTH = 260;

/**
 * 大纲侧栏根节点样式。
 */
type SidebarStyle = CSSProperties & {
  /** 当前侧栏宽度 */
  '--markdown-sidebar-width': string;
};

const sidebarWidth = ref(DEFAULT_SIDEBAR_WIDTH);
const sidebarStyle = computed<SidebarStyle>(
  (): SidebarStyle => ({
    '--markdown-sidebar-width': `${sidebarWidth.value}px`
  })
);

watch(
  (): boolean => props.visible,
  (visible: boolean): void => {
    if (visible && sidebarWidth.value === 0) {
      sidebarWidth.value = DEFAULT_SIDEBAR_WIDTH;
    }
  }
);

/**
 * 移除标题文本中的 Markdown 行内标记。
 * @param text - 原始标题文本
 * @returns 纯文本标题
 */
function stripMarkdown(text: string): string {
  return text
    .replace(/^#+\s*/, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/\[(.+?)\]\(.+?\)/g, '$1');
}

const items = computed<AnchorItem[]>((): AnchorItem[] => {
  if (!props.content) return [];

  const tokens = marked.lexer(props.content);

  const headings = tokens.filter((t) => t.type === 'heading' && t.text?.trim()) as Tokens.Heading[];

  const normalizedHeadings = headings.map(
    (heading: Tokens.Heading, index: number): AnchorItem => ({
      id: props.anchorIdPrefix ? `${props.anchorIdPrefix}-heading-${index}` : `heading-${index}`,
      text: stripMarkdown(heading.text.trim()),
      level: heading.depth
    })
  );

  const minLevel = Math.min(...normalizedHeadings.map((heading: AnchorItem): number => heading.level));

  return normalizedHeadings.map(
    (heading: AnchorItem): AnchorItem => ({
      ...heading,
      level: heading.level - minLevel + 1
    })
  );
});

/**
 * 切换到用户点击的大纲锚点。
 * @param item - 目标锚点
 */
function handleAnchorClick(item: AnchorItem): void {
  emit('change', item);
}

/**
 * 点击文档标题时跳转到文档顶部。
 */
function handleTitleClick(): void {
  emit('change', { id: '', text: '', level: 0 });
}
</script>

<style scoped>
.b-markdown-sidebar-panel {
  flex-shrink: 0;
  width: 0;
  min-width: 0;
  pointer-events: none;
  opacity: 0;
  transform: translateX(-12px);
}

.b-markdown-sidebar-panel--motion {
  transition: width 0.36s ease, opacity 0.24s ease, transform 0.36s ease;
  will-change: width, opacity, transform;
}

.b-markdown-sidebar-panel--visible {
  width: var(--markdown-sidebar-width);
  pointer-events: auto;
  opacity: 1;
  transform: translateX(0);
}

.b-markdown-sidebar {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: var(--bg-primary);
  border: 1px solid var(--border-primary);
  border-radius: 8px;
  backdrop-filter: blur(10px);
}

.sidebar__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 40px;
  padding: 0 12px;
  color: var(--text-primary);
}

.sidebar__main {
  display: flex;
  flex: 1;
  gap: 8px;
  align-items: center;
  min-width: 0;
  cursor: pointer;
}

.sidebar__toggle {
  margin-left: auto;
}

.sidebar__content {
  flex: 1;
  height: 0;
}

.sidebar__empty {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 8px;
  align-items: center;
  justify-content: center;
}

.sidebar__empty-text {
  font-size: 13px;
  color: var(--text-tertiary);
}

.sidebar__title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0.08em;
  white-space: nowrap;
}

@media (prefers-reduced-motion: reduce) {
  .b-markdown-sidebar-panel--motion {
    transition: none;
  }
}
</style>
