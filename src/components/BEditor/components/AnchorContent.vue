<template>
  <BScrollbar class="anchor-panel__content" inset>
    <TransitionGroup name="anchor-fade" tag="div">
      <div
        v-for="item in treeItems"
        :key="item.id"
        class="anchor-item"
        :class="{ active: activeId === item.id }"
        :style="item.style"
        @click="handleClick(item)"
      >
        <div v-if="item.children.length" class="anchor-item__toggle" @click.stop="toggleCollapsed(item.id)">
          <Icon :icon="isCollapsed(item.id) ? 'lucide:chevron-right' : 'lucide:chevron-down'" />
        </div>

        <span v-else class="anchor-item__toggle anchor-item__toggle--empty"></span>

        <span class="anchor-item__text">{{ item.text }}</span>
      </div>
    </TransitionGroup>
  </BScrollbar>
</template>

<script setup lang="ts">
import { computed, CSSProperties, ref } from 'vue';
import { Icon } from '@iconify/vue';
import BScrollbar from '../../BScrollbar/index.vue';

export interface AnchorItem {
  // 目录项id
  id: string;
  // 目录项文本
  text: string;
  // 目录项等级
  level: number;
}

interface AnchorTreeItem extends AnchorItem {
  children: AnchorTreeItem[];
}

interface VisibleAnchorItem extends AnchorTreeItem {
  depth: number;
  //
  style: CSSProperties;
}

interface Props {
  // 目录项
  items: AnchorItem[];
  // 当前选中的目录项id
  activeId?: string;
}

const props = withDefaults(defineProps<Props>(), {
  activeId: ''
});

const emit = defineEmits(['click']);

const collapsedIds = ref<Record<string, boolean>>({});

function handleClick(item: VisibleAnchorItem) {
  emit('click', item);
}

function toggleCollapsed(id: string): void {
  collapsedIds.value[id] = !collapsedIds.value[id];
}

function isCollapsed(id: string): boolean {
  return !!collapsedIds.value[id];
}

function buildAnchorTree(items: AnchorTreeItem[], depth = 0): VisibleAnchorItem[] {
  return items.flatMap((item) => {
    const visibleItem = { ...item, depth, style: { paddingLeft: `${14 + depth * 16}px` } };

    if (isCollapsed(item.id)) {
      return [visibleItem];
    }

    return [visibleItem, ...buildAnchorTree(item.children, depth + 1)];
  });
}

const treeItems = computed(() => {
  const roots: AnchorTreeItem[] = [];
  const stack: AnchorTreeItem[] = [];

  for (let i = 0; i < props.items.length; i++) {
    const item = props.items[i];

    const node: AnchorTreeItem = { ...item, children: [] };

    while (stack.length && stack[stack.length - 1].level >= node.level) {
      stack.pop();
    }

    (stack.length ? stack[stack.length - 1].children : roots).push(node);

    stack.push(node);
  }

  return buildAnchorTree(roots);
});
</script>

<style scoped>
.anchor-panel__content {
  flex: 1;
  padding: 16px 2px 12px 8px;
}

.anchor-item {
  display: flex;
  gap: 6px;
  align-items: center;
  min-height: 32px;
  padding-right: 12px;
  color: #57606a;
  cursor: pointer;
  border-radius: 8px;
  transition: background-color 0.2s ease, color 0.2s ease;
}

.anchor-item:hover,
.anchor-item--active {
  color: #0969da;
  background: rgb(9 105 218 / 8%);
}

.anchor-item__toggle {
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

.anchor-item__text {
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 13px;
  white-space: nowrap;
}

.anchor-fade-enter-active,
.anchor-fade-leave-active {
  overflow: hidden;
  transition: all 0.2s ease;
}

.anchor-fade-enter-from,
.anchor-fade-leave-to {
  min-height: 0;
  max-height: 0;
  opacity: 0;
}

.anchor-fade-enter-to,
.anchor-fade-leave-from {
  max-height: 28px;
}
</style>
