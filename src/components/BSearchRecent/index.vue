<template>
  <BModal v-model:open="visible" :mask-closable="true" :width="560" :main-style="{ padding: '16px' }">
    <div class="b-search-recent">
      <div ref="inputRef" class="b-search-recent-toolbar">
        <AInput v-model:value="keyword" placeholder="搜索最近文件" @keydown.esc.prevent="handleClose" />
      </div>

      <BScrollbar :max-height="maxHeight" inset="auto">
        <div class="b-search-recent-list">
          <button
            v-for="file in filteredFiles"
            :key="file.id"
            class="b-search-recent-item"
            :class="{ 'is-active': file.id === activeId }"
            @click="handleSelect(file)"
          >
            <div class="b-search-recent-item-main">
              <span class="b-search-recent-item-title">{{ getRecentFileLabel(file) }}</span>

              <span v-if="file.path" class="b-search-recent-item-path">{{ file.path }}</span>

              <span v-else class="b-search-recent-item-path is-unsaved">未保存文件</span>
            </div>

            <div class="b-search-recent-item-delete" @click.stop="handleRemove(file.id)">
              <Icon icon="ic:round-close" width="16" height="16" />
            </div>
          </button>
        </div>

        <div v-if="!filteredFiles.length" class="b-search-recent-empty">没有匹配的最近文件</div>
      </BScrollbar>
    </div>
  </BModal>
</template>

<script setup lang="ts">
import type { BSearchRecentProps } from './types';
import { computed, nextTick, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { Icon } from '@iconify/vue';
import BModal from '@/components/BModal/index.vue';
import BScrollbar from '@/components/BScrollbar/index.vue';
import { useOpenFile } from '@/hooks/useOpenFile';
import type { StoredFile } from '@/shared/storage';
import { useFilesStore } from '@/stores/files';
import { useTabsStore } from '@/stores/tabs';
import { getRecentFileLabel } from '@/utils/recentFile';

withDefaults(defineProps<BSearchRecentProps>(), {
  maxHeight: 420
});

const emit = defineEmits<{
  (e: 'select', file: StoredFile): void;
  (e: 'remove', id: string): void;
}>();

const route = useRoute();
const filesStore = useFilesStore();
const tabsStore = useTabsStore();
const { openFile } = useOpenFile();
const visible = defineModel<boolean>('visible', { default: false });
const keyword = ref('');
const inputRef = ref<HTMLElement | null>(null);

const activeId = computed<string>(() => (route.name === 'editor' ? (route.params.id as string) || '' : ''));

/**
 * 转义用户输入，避免关键字中的正则字符影响匹配。
 * @param value - 用户输入
 * @returns 转义后的正则安全字符串
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 为搜索关键字创建大小写不敏感的正则。
 * @param input - 原始搜索关键字
 * @returns 搜索正则
 */
function createSearchRegExp(input: string): RegExp {
  return new RegExp(escapeRegExp(input), 'i');
}

const filteredFiles = computed<StoredFile[]>(() => {
  const files = filesStore.recentFiles ?? [];
  const term = keyword.value.trim();

  if (!term) return files;

  const searchRegExp = createSearchRegExp(term);

  return files.filter((file) => {
    const label = getRecentFileLabel(file);

    const name = file.name || '';
    const path = file.path || '';
    const content = file.content || '';

    return searchRegExp.test(label) || searchRegExp.test(name) || searchRegExp.test(path) || searchRegExp.test(content);
  });
});

/**
 * 聚焦搜索输入框。
 */
function focusInput(): void {
  nextTick(() => {
    const input = inputRef.value?.querySelector('input');

    if (!input) return;

    input.focus();
    input.select();
  });
}

/**
 * 关闭搜索弹窗并清空关键字。
 */
function handleClose(): void {
  visible.value = false;
  keyword.value = '';
}

/**
 * 选择最近文件后打开并更新 openedAt。
 * @param file - 选中的文件记录
 */
async function handleSelect(file: StoredFile): Promise<void> {
  handleClose();
  await openFile(file, 'search');
  emit('select', file);
}

/**
 * 删除最近文件记录。
 * @param id - 文件 ID
 */
async function handleRemove(id: string): Promise<void> {
  await filesStore.removeFile(id);
  tabsStore.removeTab(id);
  emit('remove', id);
}

watch(visible, (value) => {
  if (!value) {
    keyword.value = '';
    return;
  }

  focusInput();
  filesStore.ensureLoaded();
});
</script>

<style scoped>
.b-search-recent {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.b-search-recent-toolbar {
  display: flex;
  align-items: center;
}

.b-search-recent-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.b-search-recent-item {
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

.b-search-recent-item:hover {
  background: var(--bg-hover);
}

.b-search-recent-item.is-active {
  background: var(--bg-selected);
}

.b-search-recent-item-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.b-search-recent-item-title {
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
}

.b-search-recent-item-path {
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12px;
  color: var(--text-tertiary);
  white-space: nowrap;
}

.b-search-recent-item-path.is-unsaved {
  color: var(--color-orange);
}

.b-search-recent-item-delete {
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

.b-search-recent-item-delete:hover {
  color: var(--text-primary);
  background: var(--bg-active);
}

.b-search-recent-item:hover .b-search-recent-item-delete {
  opacity: 1;
}

.b-search-recent-empty {
  padding: 36px 0;
  font-size: 13px;
  color: var(--text-tertiary);
  text-align: center;
}
</style>
