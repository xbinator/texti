<template>
  <BPanelSplitter v-model:size="sidebarWidth" position="right" :min-width="180" :max-width="400">
    <div class="b-editor-sidebar">
      <div v-if="title" class="sidebar__header">
        <div class="sidebar__main" @click="handleTitleClick">
          <Icon icon="lucide:file-text" width="14" height="14" class="sidebar__file-icon" />
          <span class="sidebar__title">{{ title }}</span>
        </div>

        <BDropdown>
          <BButton square size="small" type="text" class="sidebar__more" @click.stop>
            <Icon icon="lucide:ellipsis" width="14" height="14" />
          </BButton>

          <template #overlay>
            <BDropdownMenu :options="headerMenuOptions" :width="180" />
          </template>
        </BDropdown>
      </div>
      <div v-if="items.length" class="sidebar__content">
        <AnchorContent :items="items" :active-id="activeId" @click="handleAnchorClick" />
      </div>
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

const emit = defineEmits(['change', 'rename-file', 'delete-file', 'show-in-folder', 'save', 'save-as', 'copy-path', 'copy-relative-path']);

const sidebarWidth = ref(260);

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

const items = computed(() => {
  if (!props.content) return [];

  const tokens = marked.lexer(props.content);

  const headings = tokens.filter((t) => t.type === 'heading' && t.text?.trim()) as Tokens.Heading[];

  const _headings = headings.map((t, i) => ({
    id: props.anchorIdPrefix ? `${props.anchorIdPrefix}-heading-${i}` : `heading-${i}`,
    text: stripMarkdown(t.text.trim()),
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
    value: 'save',
    label: '保存',
    icon: 'lucide:save',
    onClick: () => emit('save')
  },
  {
    value: 'save-as',
    label: '另存为',
    icon: 'lucide:save-all',
    onClick: () => emit('save-as')
  },
  {
    type: 'divider'
  },
  {
    value: 'copy-path',
    label: '复制路径',
    icon: 'lucide:copy',
    disabled: !props.filePath,
    onClick: () => emit('copy-path')
  },
  {
    value: 'copy-relative-path',
    label: '复制相对路径',
    icon: 'lucide:copy-plus',
    disabled: !props.filePath,
    onClick: () => emit('copy-relative-path')
  },
  {
    type: 'divider'
  },
  {
    value: 'reveal',
    label: '打开所在位置',
    icon: 'lucide:folder-open',
    disabled: !props.filePath,
    onClick: () => emit('show-in-folder')
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
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: var(--bg-primary);
  border-radius: 8px;
  backdrop-filter: blur(10px);
}

.sidebar__header {
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

.sidebar__main {
  display: flex;
  flex: 1;
  gap: 8px;
  align-items: center;
  min-width: 0;
  cursor: pointer;
}

.sidebar__content {
  flex: 1;
  height: 0;
}

.sidebar__file-icon {
  flex-shrink: 0;
  color: var(--text-secondary);
}

.sidebar__title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 13px;
  letter-spacing: 0.08em;
  white-space: nowrap;
}

.sidebar__more {
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
