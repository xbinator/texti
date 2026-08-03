<template>
  <div class="inspector-panel">
    <header class="inspector-panel__header">
      <div class="inspector-panel__title">
        <span>组件</span>
      </div>
      <BButton type="text" size="small" square icon="lucide:x" class="inspector-panel__close-btn" @click="emit('close')" />
    </header>

    <div v-if="selection" class="inspector-panel__content">
      <BSectionBlock title="元素">
        <template #extra>
          <BButton type="text" size="mini" square icon="lucide:camera" @click.stop="emit('captureSelectedElementScreenshot', selection)" />
        </template>

        <BSectionItem label="选择器">
          <code class="inspector-panel__value-tag">{{ selection.selector }}</code>
        </BSectionItem>
        <BSectionItem label="位置">
          <div class="inspector-panel__value-group">
            <span class="inspector-panel__value-tag">{{ roundedRect.x }}</span>
            <span class="inspector-panel__value-tag">{{ roundedRect.y }}</span>
          </div>
        </BSectionItem>
        <BSectionItem label="大小">
          <div class="inspector-panel__value-group">
            <span class="inspector-panel__value-tag">{{ roundedRect.width }}</span>
            <span class="inspector-panel__value-tag">{{ roundedRect.height }}</span>
          </div>
        </BSectionItem>
        <BSectionItem v-if="selection.text" label="文本">
          <span class="inspector-panel__value-tag">{{ selection.text }}</span>
        </BSectionItem>
      </BSectionBlock>

      <BSectionBlock title="层级">
        <ol class="inspector-panel__tree">
          <li
            v-for="item in hierarchyItems"
            :key="item.selector"
            :class="['inspector-panel__tree-item', { 'inspector-panel__tree-item--active': item.isActive }]"
          >
            <span class="inspector-panel__tree-tag">{{ item.tagName }}</span>
            <code class="inspector-panel__tree-selector">{{ item.displaySelector }}</code>
          </li>
        </ol>
      </BSectionBlock>

      <BSectionBlock v-if="attributes.length" title="属性">
        <BSectionItem v-for="attribute in attributes" :key="attribute.name" :label="attribute.name">
          <span class="inspector-panel__value-tag">{{ attribute.value }}</span>
        </BSectionItem>
      </BSectionBlock>

      <BSectionBlock v-if="styleEntries.length" title="CSS 样式">
        <div class="inspector-panel__style-entries">
          <div v-for="styleEntry in styleEntries" :key="styleEntry.name" class="inspector-panel__style-entry">
            <span class="inspector-panel__style-name">{{ styleEntry.name }}:</span>
            <span class="inspector-panel__style-value">{{ styleEntry.value }};</span>
          </div>
        </div>
      </BSectionBlock>
    </div>

    <div v-else class="inspector-panel__empty">
      <div class="inspector-panel__empty-icon">
        <BIcon icon="lucide:mouse-pointer-click" :size="20" />
      </div>
      <div class="inspector-panel__empty-text">
        <span class="inspector-panel__empty-title">选择页面元素</span>
        <span class="inspector-panel__empty-desc">点击页面中的元素，查看其层级结构、属性和样式信息</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * @file InspectorPanel.vue
 * @description 展示 WebView 页面 DOM 元素层级、属性与计算样式。
 */
import { computed } from 'vue';
import type { WebviewElementSelection } from '@/views/webview/shared/types';
import { filterStyleEntries } from '@/views/webview/web/utils/styles';
import type { StyleEntry } from '@/views/webview/web/utils/styles';

/**
 * DOM 看板组件属性。
 */
interface Props {
  /** 当前选中的 DOM 元素信息 */
  selection?: WebviewElementSelection | null;
}

const props = withDefaults(defineProps<Props>(), { selection: null });

/**
 * 面板事件。
 */
const emit = defineEmits<{
  /** 点击关闭按钮时触发，由父组件决定如何隐藏面板与停止元素选择模式。 */
  close: [];
  /** 点击元素区块截图按钮时触发，由父组件执行选中元素截图。 */
  captureSelectedElementScreenshot: [selection: WebviewElementSelection];
}>();

/**
 * DOM 层级展示项。
 */
interface HierarchyItem {
  /** 完整 CSS 选择器 */
  selector: string;
  /** 元素标签名 */
  tagName: string;
  /** 去除前导标签名后的显示用选择器 */
  displaySelector: string;
  /** 是否为当前选中元素 */
  isActive: boolean;
}

/** 有值的属性列表（过滤掉空值） */
const attributes = computed(() => props.selection?.attributes.filter((a) => a.value) ?? []);

/** 元素矩形框的四舍五入坐标 */
const roundedRect = computed(() => {
  const rect = props.selection?.rect;
  return {
    x: Math.round(rect?.x ?? 0),
    y: Math.round(rect?.y ?? 0),
    width: Math.round(rect?.width ?? 0),
    height: Math.round(rect?.height ?? 0)
  };
});

/** 祖先层级 + 当前元素 */
const hierarchyItems = computed<HierarchyItem[]>(() => {
  if (!props.selection) return [];

  const buildItem = (selector: string, tagName: string, isActive: boolean): HierarchyItem => {
    const lowerTag = tagName.toLowerCase();
    /** selector 去除前导 tagName，若去完后为空则保留原值 */
    const displaySelector = selector.slice(lowerTag.length) || selector;
    return { selector, tagName: lowerTag, displaySelector, isActive };
  };

  const ancestorItems = props.selection.ancestors
    .filter((ancestor) => !['html', 'body'].includes(ancestor.tagName.toLowerCase()))
    .map((ancestor) => buildItem(ancestor.selector, ancestor.tagName, false));

  return [...ancestorItems, buildItem(props.selection.selector, props.selection.tagName, true)];
});

/** 计算样式键值对（过滤空值、默认值、以及标签默认 display） */
const styleEntries = computed<StyleEntry[]>(() => filterStyleEntries(props.selection?.computedStyles, props.selection?.tagName));
</script>

<style scoped lang="less">
.inspector-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  color: var(--text-primary);
  background: var(--bg-primary);
  border-left: 1px solid var(--border-primary);

  :deep(.b-section-block) {
    padding-right: 12px;
    padding-left: 12px;
  }

  :deep(.b-section-item) {
    align-items: flex-start;
  }

  :deep(.b-section-item__label) {
    line-height: 28px;
  }
}

.inspector-panel__header {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  min-height: 42px;
  padding: 0 10px 0 12px;
  margin-bottom: 12px;
  border-bottom: 1px solid var(--border-primary);
}

.inspector-panel__title {
  display: inline-flex;
  gap: 8px;
  align-items: center;
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
}

.inspector-panel__close-btn {
  flex-shrink: 0;
}

/* 值标签：单值展示的背景框 */
.inspector-panel__value-tag {
  display: flex;
  flex: 1;
  gap: 6px;
  align-items: center;
  min-width: 0;
  min-height: 28px;
  padding: 4px 6px;
  font-family: var(--font-mono);
  font-size: 12px;
  overflow-wrap: anywhere;
  user-select: text;
  background: var(--bg-tertiary);
  border-radius: var(--control-radius);
}

.inspector-panel__content {
  padding-bottom: 12px;
  overflow: auto;
}

/* 多值并排容器 */
.inspector-panel__value-group {
  display: flex;
  flex: 1;
  gap: 8px;
}

.inspector-panel__style-entries {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  user-select: text;
  background: var(--bg-tertiary);
  border-radius: var(--control-radius);
}

.inspector-panel__style-entry {
  display: flex;
  gap: 6px;
  align-items: flex-start;
  font-family: var(--font-mono);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.inspector-panel__style-name {
  flex-shrink: 0;
  color: var(--text-secondary);
}

.inspector-panel__style-value {
  flex: 1;
  min-width: 0;
}

.inspector-panel__tree {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0;
  margin: 0;
  user-select: text;
  list-style: none;
}

.inspector-panel__tree-item {
  display: flex;
  gap: 6px;
  padding: 4px 0;
  font-size: 12px;
  overflow-wrap: anywhere;
  border-radius: var(--control-radius);
}

.inspector-panel__tree-item--active {
  color: var(--color-primary);
}

.inspector-panel__tree-tag {
  flex-shrink: 0;
  height: max-content;
  padding: 1px 5px;
  font-family: var(--font-mono);
  font-size: 10px;
  line-height: 16px;
  color: var(--text-secondary);
  text-transform: lowercase;
  background: var(--bg-hover);
  border-radius: var(--control-radius);
}

.inspector-panel__tree-item--active .inspector-panel__tree-tag {
  color: var(--color-primary);
  background: var(--color-primary-bg);
}

.inspector-panel__tree-selector {
  min-width: 0;
  font-family: var(--font-mono);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.inspector-panel__empty {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 16px;
  align-items: center;
  justify-content: center;
  padding: 32px 24px;
}

.inspector-panel__empty-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  color: var(--text-tertiary);
  background: var(--bg-tertiary);
  border-radius: var(--control-radius);
}

.inspector-panel__empty-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: center;
  max-width: 200px;
  text-align: center;
}

.inspector-panel__empty-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-secondary);
}

.inspector-panel__empty-desc {
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-tertiary);
}
</style>
