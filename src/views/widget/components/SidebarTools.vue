<!--
  @file SidebarTools.vue
  @description Widget页面侧边栏工具网格，展示可拖拽的Widget元素工具项。
-->
<template>
  <SidebarPanel title="组件">
    <div class="sidebar-tools__categories">
      <section v-for="category in widgetElementCategories" :key="category.key" class="sidebar-tools__category">
        <h3 class="sidebar-tools__category-title">{{ category.label }}</h3>
        <div class="sidebar-tools__tool-grid">
          <div
            v-for="schema in category.elements"
            :key="schema.name"
            class="sidebar-tools__tool-item"
            @pointerdown.left.prevent="handleToolPointerdown(schema, $event)"
          >
            <BIcon :icon="schema.icon" :size="16" />
            <span>{{ schema.label }}</span>
          </div>
        </div>
      </section>
    </div>
  </SidebarPanel>
</template>

<script setup lang="ts">
import { groupBy } from 'lodash-es';
import { WIDGET_ELEMENT_SCHEMAS, type WidgetElementSchema } from '@/components/BWidget/elements';
import { WIDGET_ELEMENT_ROLES, type WidgetElementRoleDefinition } from '@/components/BWidget/elements/roles';
import { useDraggerController } from '../hooks/useDragger';
import SidebarPanel from './_SidebarPanel.vue';

/**
 * 带有已注册元素的侧栏分类。
 */
type WidgetElementCategoryGroup = WidgetElementRoleDefinition & {
  /** 当前分类下的元素 Schema */
  elements: WidgetElementSchema[];
};

const emit = defineEmits<{
  /** 开始拖拽创建 Widget 元素 */
  'drag-start': [];
}>();

/** 按分类键索引的元素 Schema。 */
const elementSchemasByCategory = groupBy(WIDGET_ELEMENT_SCHEMAS, 'role');
/** 元素拖拽控制器。 */
const elementDrag = useDraggerController();

/**
 * 为分类定义附加其元素列表。
 * @param category - 元素分类定义
 * @returns 包含元素列表的侧栏分类
 */
function createElementCategoryGroup(category: WidgetElementRoleDefinition): WidgetElementCategoryGroup {
  return {
    ...category,
    elements: elementSchemasByCategory[category.key] ?? []
  };
}

/**
 * 判断侧栏分类是否包含元素。
 * @param category - 侧栏分类
 * @returns 是否应展示该分类
 */
function hasCategoryElements(category: WidgetElementCategoryGroup): boolean {
  return category.elements.length > 0;
}

/** 当前侧栏展示的有序非空元素分类。 */
const widgetElementCategories = WIDGET_ELEMENT_ROLES.map(createElementCategoryGroup).filter(hasCategoryElements);

/**
 * 处理工具项指针按下，启动自定义拖拽并通知父级临时收起侧栏内容区。
 * @param schema - 被拖拽的 Widget 元素工具
 * @param event - 指针事件
 */
function handleToolPointerdown(schema: WidgetElementSchema, event: PointerEvent): void {
  elementDrag.startDrag(schema, event);
  emit('drag-start');
}
</script>

<style lang="less" scoped>
.sidebar-tools__categories {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.sidebar-tools__category {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sidebar-tools__category-title {
  margin: 0;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-tertiary);
}

.sidebar-tools__tool-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.sidebar-tools__tool-item {
  display: flex;
  gap: 8px;
  align-items: center;
  min-width: 0;
  height: 32px;
  padding: 0 10px;
  overflow: hidden;
  font-size: 13px;
  color: var(--text-secondary);
  cursor: grab;
  user-select: none;
  background: var(--bg-secondary);
  border: var(--control-border-width) solid transparent;
  border-radius: var(--control-radius);
  transition: color var(--motion-duration-fast) var(--motion-easing-standard), background var(--motion-duration-fast) var(--motion-easing-standard),
    border-color var(--motion-duration-fast) var(--motion-easing-standard);
}

.sidebar-tools__tool-item:hover {
  color: var(--text-primary);
  background: var(--bg-tertiary);
  border-color: var(--border-primary);
}

.sidebar-tools__tool-item:active {
  cursor: grabbing;
}
</style>
