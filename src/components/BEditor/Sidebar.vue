<template>
  <BPanelSplitter v-model:size="sidebarWidth" position="right" :min-width="180" :max-width="400">
    <div class="b-editor-sidebar">
      <div v-if="title" class="anchor-panel__header">
        <div class="anchor-panel__main" @click="handleTitleClick">
          <Icon icon="lucide:file-text" width="14" height="14" class="anchor-panel__file-icon" />
          <span class="anchor-panel__title">{{ title }}</span>
        </div>

        <BDropdown>
          <BButton square size="small" type="text" class="anchor-panel__more" @click.stop>
            <Icon icon="lucide:ellipsis" width="14" height="14" />
          </BButton>

          <template #overlay>
            <BDropdownMenu :options="headerMenuOptions" :width="180" />
          </template>
        </BDropdown>
      </div>
      <AnchorContent v-if="items.length > 0" :items="items" :active-id="activeId" @click="handleAnchorClick" />
      <div v-else class="empty-state">
        <div class="empty-icon">📝</div>
        <div class="empty-text">暂无目录大纲</div>
      </div>
    </div>
  </BPanelSplitter>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { Icon } from '@iconify/vue';
import { marked, Tokens } from 'marked';
import BButton from '@/components/BButton/index.vue';
import BDropdown from '@/components/BDropdown/index.vue';
import BDropdownMenu from '@/components/BDropdown/Menu.vue';
import type { DropdownOption } from '@/components/BDropdown/type';
import AnchorContent, { AnchorItem } from './components/AnchorContent.vue';

interface Props {
  title?: string;
  filePath?: string | null;
  content?: string;
  anchorIdPrefix?: string;
  // 当前选中的锚点id
  activeId?: string;
}

const props = withDefaults(defineProps<Props>(), {
  title: '',
  filePath: null,
  content: '',
  anchorIdPrefix: '',
  activeId: ''
});

const emit = defineEmits(['change', 'rename-file', 'delete-file', 'show-in-folder']);

const sidebarWidth = ref(260);

const items = computed(() => {
  if (!props.content) return [];

  const tokens = marked.lexer(props.content);

  const headings = tokens.filter((t) => t.type === 'heading' && t.text?.trim()) as Tokens.Heading[];

  const _headings = headings.map((t, i) => ({
    id: props.anchorIdPrefix ? `${props.anchorIdPrefix}-heading-${i}` : `heading-${i}`,
    text: t.text.trim(),
    level: t.depth
  }));

  const minLevel = Math.min(..._headings.map((h) => h.level));

  return _headings.map((h) => ({ ...h, level: h.level - minLevel + 1 }));
});

const headerMenuOptions = computed<DropdownOption[]>(() => [
  {
    value: 'rename',
    label: '重命名',
    icon: 'lucide:pencil',
    onClick: () => emit('rename-file')
  },
  {
    value: 'reveal',
    label: '打开所在位置',
    icon: 'lucide:folder-open',
    disabled: !props.filePath,
    onClick: () => emit('show-in-folder')
  },
  {
    type: 'divider'
  },
  {
    value: 'delete',
    label: '删除',
    icon: 'lucide:trash-2',
    danger: true,
    onClick: () => emit('delete-file')
  }
]);

function handleAnchorClick(item: AnchorItem) {
  emit('change', item);
}

function handleTitleClick() {
  emit('change', { id: '', text: '', level: 0 });
}
</script>

<style scoped>
.b-editor-sidebar {
  display: flex;
  flex-shrink: 0;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: var(--bg-primary);
  border-radius: 8px;
  backdrop-filter: blur(10px);
}

.anchor-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 32px;
  padding: 0 4px 0 8px;
  margin: 16px 8px 0;
  color: var(--text-primary);
  border-radius: 6px;
  transition: background-color 0.15s ease, color 0.15s ease;

  &:hover {
    background: var(--bg-hover);
  }
}

.anchor-panel__main {
  display: flex;
  flex: 1;
  gap: 8px;
  align-items: center;
  min-width: 0;
  cursor: pointer;
}

.anchor-panel__file-icon {
  flex-shrink: 0;
  color: var(--text-secondary);
}

.anchor-panel__title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 13px;
  letter-spacing: 0.08em;
  white-space: nowrap;
}

.anchor-panel__more {
  flex-shrink: 0;
  color: var(--text-secondary);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 24px;
  color: var(--text-tertiary, #999);
  text-align: center;
}

.empty-icon {
  margin-bottom: 12px;
  font-size: 32px;
  opacity: 0.6;
}

.empty-text {
  font-size: 14px;
  color: var(--text-secondary, #666);
}
</style>
