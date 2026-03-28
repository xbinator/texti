<template>
  <BScrollbar v-if="props.items.length" class="toc-panel__content">
    <div
      v-for="item in visibleItems"
      :key="item.id"
      class="toc-item"
      :class="{ 'toc-item--active': props.activeId === item.id }"
      :style="{ paddingLeft: `${14 + item.depth * 16}px` }"
    >
      <button v-if="item.hasChildren" type="button" class="toc-item__toggle" @click="toggleCollapsed(item.id)">
        <Icon :icon="isCollapsed(item.id) ? 'lucide:chevron-right' : 'lucide:chevron-down'" />
      </button>

      <span v-else class="toc-item__toggle toc-item__toggle--empty"></span>

      <span class="toc-item__text">{{ item.text }}</span>
    </div>
  </BScrollbar>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { Icon } from '@iconify/vue';
import BScrollbar from '../../BScrollbar/index.vue';

export interface TocItem {
  id: string;
  text: string;
  level: number;
}

interface TocTreeItem extends TocItem {
  children: TocTreeItem[];
}

interface VisibleTocItem extends TocTreeItem {
  depth: number;
  hasChildren: boolean;
}

interface Props {
  items: TocItem[];
  activeId?: string;
}

const props = withDefaults(defineProps<Props>(), {
  activeId: ''
});

const collapsedIds = ref<Record<string, boolean>>({});

function toggleCollapsed(id: string): void {
  collapsedIds.value[id] = !collapsedIds.value[id];
}

function isCollapsed(id: string): boolean {
  return !!collapsedIds.value[id];
}

function buildTree(items: TocItem[]): TocTreeItem[] {
  const roots: TocTreeItem[] = [];
  const stack: TocTreeItem[] = [];

  items.forEach((item) => {
    const node: TocTreeItem = {
      ...item,
      children: []
    };

    while (stack.length && stack[stack.length - 1].level >= node.level) {
      stack.pop();
    }

    if (stack.length) {
      stack[stack.length - 1].children.push(node);
    } else {
      roots.push(node);
    }

    stack.push(node);
  });

  return roots;
}

const treeItems = computed<TocTreeItem[]>(() => buildTree(props.items));

function flattenVisibleItems(items: TocTreeItem[], depth = 0): VisibleTocItem[] {
  return items.flatMap((item) => {
    const visibleItem: VisibleTocItem = {
      ...item,
      depth,
      hasChildren: item.children.length > 0
    };

    if (isCollapsed(item.id)) {
      return [visibleItem];
    }

    return [visibleItem, ...flattenVisibleItems(item.children, depth + 1)];
  });
}

const visibleItems = computed<VisibleTocItem[]>(() => flattenVisibleItems(treeItems.value));
</script>

<style scoped>
.toc-panel__content {
  flex: 1;
  padding: 16px 8px 12px;
}

.toc-item {
  display: flex;
  gap: 6px;
  align-items: center;
  min-height: 28px;
  padding-right: 12px;
  color: #57606a;
  border-radius: 8px;
  transition: background-color 0.2s ease, color 0.2s ease;
}

.toc-item:hover,
.toc-item--active {
  color: #0969da;
  background: rgb(9 105 218 / 8%);
}

.toc-item__toggle {
  display: inline-flex;
  flex: 0 0 18px;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  color: inherit;
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 6px;
}

.toc-item__toggle--empty {
  cursor: default;
}

.toc-item__text {
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 13px;
  white-space: nowrap;
}
</style>
