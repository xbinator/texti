<template>
  <BModal v-model:open="visible" :mask-closable="true" :width="560" :main-style="{ padding: '16px' }">
    <div class="search-recent">
      <div ref="inputRef" class="search-recent-toolbar">
        <AInput v-model:value="keyword" placeholder="搜索最近文件" @keydown.esc.prevent="handleClose" />
      </div>

      <BScrollbar :max-height="420" inset>
        <div class="search-recent-list">
          <button
            v-for="file in filteredFiles"
            :key="file.id"
            class="search-recent-item"
            :class="{ 'is-active': file.id === activeId }"
            @click="handleSelect(file)"
          >
            <div class="search-recent-item-main">
              <span class="search-recent-item-title">{{ getFileLabel(file) }}</span>

              <span v-if="file.path" class="search-recent-item-path">{{ file.path }}</span>

              <span v-else class="search-recent-item-path is-unsaved">未保存文件</span>
            </div>

            <div class="search-recent-item-delete" @click.stop="handleRemove(file.id)">
              <Icon icon="ic:round-close" width="16" height="16" />
            </div>
          </button>
        </div>

        <div v-if="!filteredFiles.length" class="search-recent-empty">没有匹配的最近文件</div>
      </BScrollbar>
    </div>
  </BModal>
</template>

<script setup lang="ts">
import type { EditorFile } from '../../../views/editor/types';
import { computed, nextTick, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import BModal from '@/components/BModal/index.vue';
import BScrollbar from '@/components/BScrollbar/index.vue';
import { native } from '@/shared/platform';
import { recentFilesStorage, type StoredFile } from '@/shared/storage';

const route = useRoute();
const router = useRouter();
const visible = defineModel<boolean>('visible', { default: false });
const keyword = ref('');
const inputRef = ref<HTMLElement | null>(null);

const activeId = computed<string>(() => (route.name === 'editor' ? (route.params.id as string) || '' : ''));

const recentFiles = ref<StoredFile[]>([]);

function getFileLabel(file: Pick<EditorFile, 'name' | 'content'>): string {
  const content = file.content.replace(/^\s*---[\s\S]*?---\s*\n?/, '');
  const match = /^#{1,6}\s+(.+)/m.exec(content);

  return match?.[1]?.trim() || file.name || '未命名';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function createSearchRegExp(input: string): RegExp {
  return new RegExp(escapeRegExp(input), 'i');
}

const filteredFiles = computed<StoredFile[]>(() => {
  const term = keyword.value.trim();

  if (!term) return recentFiles.value;

  const searchRegExp = createSearchRegExp(term);

  return recentFiles.value.filter((file) => {
    const label = getFileLabel(file);

    const name = file.name || '';
    const path = file.path || '';
    const content = file.content || '';

    return searchRegExp.test(label) || searchRegExp.test(name) || searchRegExp.test(path) || searchRegExp.test(content);
  });
});

function focusInput(): void {
  nextTick(() => {
    const input = inputRef.value?.querySelector('input');

    if (!input) return;

    input.focus();
    input.select();
  });
}

function handleClose(): void {
  visible.value = false;
  keyword.value = '';
}

async function handleSelect(file: StoredFile): Promise<void> {
  handleClose();

  if (file.path) {
    const result = await native.readFile(file.path);

    await recentFilesStorage.updateRecentFile(file.id, { ...file, content: result.content });
  }

  router.push({ name: 'editor', params: { id: file.id } });
}

async function handleRemove(id: string): Promise<void> {
  await recentFilesStorage.removeRecentFile(id);
  recentFiles.value = recentFiles.value.filter((file) => file.id !== id);
}

watch(visible, (value) => {
  if (!value) {
    keyword.value = '';
    return;
  }

  focusInput();

  recentFilesStorage.getAllRecentFiles().then((files) => (recentFiles.value = files));
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

.search-recent-item-delete {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  color: var(--text-tertiary);
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: 6px;
  opacity: 0;
  transition: all 0.15s ease;
}

.search-recent-item-delete:hover {
  color: var(--text-primary);
  background: var(--bg-active);
}

.search-recent-item:hover .search-recent-item-delete {
  opacity: 1;
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
