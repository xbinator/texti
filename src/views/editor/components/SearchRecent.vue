<template>
  <BModal v-model:open="visible" :width="560" :main-style="{ padding: '16px' }">
    <div class="search-recent">
      <div class="search-recent-toolbar">
        <input ref="inputRef" v-model="keyword" class="search-recent-input" :placeholder="placeholder" @keydown.esc.prevent="handleClose" />
      </div>

      <BScrollbar :max-height="420" inset>
        <div class="search-recent-list">
          <button
            v-for="file in filteredFiles"
            :key="file.id"
            class="search-recent-item"
            :class="{ 'is-active': file.id === activeId }"
            @click="handleSelect(file.id)"
          >
            <div class="search-recent-item-main">
              <span class="search-recent-item-title">{{ getFileLabel(file) }}</span>

              <span v-if="file.path" class="search-recent-item-path">{{ file.path }}</span>

              <span v-else class="search-recent-item-path is-unsaved">未保存文件</span>
            </div>
          </button>
        </div>

        <div v-if="!filteredFiles.length" class="search-recent-empty">{{ emptyText }}</div>
      </BScrollbar>
    </div>
  </BModal>
</template>

<script setup lang="ts">
import type { EditorFile } from '../types';
import { computed, nextTick, ref, watch } from 'vue';
import BModal from '@/components/BModal/index.vue';
import BScrollbar from '@/components/BScrollbar/index.vue';
import { useShortcuts } from '@/hooks/useShortcuts';
import { EditorShortcuts } from '../constants/shortcuts';

interface Props {
  files?: EditorFile[];
  activeId?: string;
  placeholder?: string;
  emptyText?: string;
}

const props = withDefaults(defineProps<Props>(), {
  files: () => [],
  activeId: '',
  title: '搜索最近',
  placeholder: '搜索最近文件',
  emptyText: '没有匹配的最近文件'
});

const emit = defineEmits<{
  (e: 'select', id: string): void;
  (e: 'close'): void;
}>();

const visible = defineModel<boolean>('visible', { default: false });
const keyword = ref('');
const inputRef = ref<HTMLInputElement | null>(null);

function getFileLabel(file: Pick<EditorFile, 'name' | 'content'>): string {
  const content = file.content.replace(/^\s*---[\s\S]*?---\s*\n?/, '');
  const match = /^#{1,6}\s+(.+)/m.exec(content);

  return match?.[1]?.trim() || file.name || '未命名';
}

const filteredFiles = computed<EditorFile[]>(() => {
  const term = keyword.value.trim().toLowerCase();

  if (!term) {
    return props.files;
  }

  return props.files.filter((file) => {
    const label = getFileLabel(file).toLowerCase();
    const name = (file.name || '').toLowerCase();
    const path = (file.path || '').toLowerCase();
    const content = (file.content || '').toLowerCase();

    return label.includes(term) || name.includes(term) || path.includes(term) || content.includes(term);
  });
});

function focusInput(): void {
  nextTick(() => {
    inputRef.value?.focus();
    inputRef.value?.select();
  });
}

function handleClose(): void {
  visible.value = false;
  keyword.value = '';
  emit('close');
}

function handleSelect(id: string): void {
  emit('select', id);
  handleClose();
}

watch(visible, (value) => {
  if (!value) {
    keyword.value = '';
    return;
  }

  focusInput();
});

// 快捷键支持 (Ctrl+M)
const { registerShortcut } = useShortcuts();

registerShortcut({
  key: EditorShortcuts.FILE_RECENT_MORE,
  handler: () => {
    visible.value = !visible.value;
  },
  enabled: true,
  preventDefault: true
});
</script>

<style scoped>
.search-recent {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.search-recent-toolbar {
  display: flex;
  align-items: center;
}

.search-recent-input {
  width: 100%;
  height: 38px;
  padding: 0 12px;
  font-size: 14px;
  color: var(--text-primary);
  outline: none;
  background: var(--input-bg);
  border: 1px solid var(--input-border);
  border-radius: 8px;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.search-recent-input:focus {
  border-color: var(--input-focus-border);
  box-shadow: var(--input-focus-shadow);
}

.search-recent-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.search-recent-item {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 10px 12px;
  text-align: left;
  cursor: pointer;
  background: var(--bg-primary);
  border: none;
  border-radius: 10px;
  transition: background-color 0.15s ease;
}

.search-recent-item:hover {
  background: var(--bg-hover);
}

.search-recent-item.is-active {
  background: var(--bg-selected);
}

.search-recent-item-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.search-recent-item-title {
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
}

.search-recent-item-path {
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12px;
  color: var(--text-tertiary);
  white-space: nowrap;
}

.search-recent-item-path.is-unsaved {
  color: var(--color-orange);
}

.search-recent-item-ext {
  flex-shrink: 0;
  padding: 2px 8px;
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--bg-active);
  border-radius: 999px;
}

.search-recent-empty {
  padding: 36px 0;
  font-size: 13px;
  color: var(--text-tertiary);
  text-align: center;
}
</style>
