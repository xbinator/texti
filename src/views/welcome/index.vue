<template>
  <div
    class="welcome-page"
    @dragenter.prevent="handleDragEnter"
    @dragover.prevent="handleDragOver"
    @drop.prevent="handleDrop"
    @dragleave.prevent="handleDragLeave"
  >
    <div v-if="isDragging" class="drag-overlay">
      <div class="drag-overlay-content"></div>
    </div>

    <div class="welcome-container">
      <div class="actions-section">
        <div class="action-card" @click="handleNewFile">
          <div class="action-icon">
            <Icon icon="lucide:file-plus" width="16" height="16" />
          </div>
          <span class="action-label">新建文档</span>
        </div>

        <div class="action-card" @click="handleOpenFile">
          <div class="action-icon">
            <Icon icon="lucide:folder-open" width="16" height="16" />
          </div>
          <span class="action-label">打开文件</span>
        </div>
      </div>

      <div v-if="topRecentFiles.length" class="recent-files-section">
        <div class="recent-files-title">最近文件</div>
        <div class="recent-files-list">
          <div v-for="file in topRecentFiles" :key="file.id" class="recent-file-item" @click="handleOpenRecentFile(file.id)">
            <div class="recent-file-icon">
              <Icon icon="lucide:file-text" width="14" height="14" />
            </div>
            <div class="recent-file-info">
              <div class="recent-file-name">{{ getFileLabel(file) }}</div>
              <div class="recent-file-path">{{ file.path || '未保存文件' }}</div>
            </div>
          </div>
        </div>
        <div class="recent-files-more" @click="handleShowShortcuts">
          <span>更多</span>
        </div>
      </div>

      <BSearchRecent v-model:visible="visibleSearchRecent" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import { customAlphabet } from 'nanoid';
import BSearchRecent from '@/components/BSearchRecent/index.vue';
import { useOpenFile } from '@/hooks/useOpenFile';
import type { StoredFile } from '@/shared/storage/files/types';
import { useFilesStore } from '@/stores/files';
import { getRecentFileLabel } from '@/utils/recentFile';

const router = useRouter();
const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz_', 8);

const filesStore = useFilesStore();
const { createNewFile, openFileById, openNativeFile } = useOpenFile();
const isDragging = ref(false);
const visibleSearchRecent = ref(false);

const topRecentFiles = computed(() => filesStore.recentFiles?.slice(0, 3) ?? []);

onMounted(() => filesStore.ensureLoaded());

/**
 * 创建新的未保存文件。
 */
function handleNewFile(): void {
  createNewFile('new');
}

/**
 * 通过欢迎页入口打开原生文件。
 */
async function handleOpenFile(): Promise<void> {
  await openNativeFile('welcome');
}

/**
 * 打开最近文件并更新 openedAt。
 * @param id - 文件 ID
 */
async function handleOpenRecentFile(id: string): Promise<void> {
  await openFileById(id, 'welcome');
}

/**
 * 获取最近文件展示标签。
 * @param file - 文件记录
 * @returns 页面展示名称
 */
function getFileLabel(file: Pick<StoredFile, 'name' | 'content'>): string {
  return getRecentFileLabel(file);
}

/**
 * 打开最近文件搜索弹窗。
 */
function handleShowShortcuts(): void {
  visibleSearchRecent.value = true;
}

let dragCounter = 0;

/**
 * 处理拖拽进入。
 */
function handleDragEnter(): void {
  dragCounter++;
  isDragging.value = true;
}

/**
 * 处理拖拽悬停。
 */
function handleDragOver(): void {
  isDragging.value = true;
}

/**
 * 处理拖拽离开。
 */
function handleDragLeave(): void {
  dragCounter = Math.max(0, dragCounter - 1);
  if (dragCounter === 0) {
    isDragging.value = false;
  }
}

/**
 * 处理拖拽打开文件。
 * @param e - 拖拽事件
 */
async function handleDrop(e: DragEvent): Promise<void> {
  dragCounter = 0;
  isDragging.value = false;

  const files = e.dataTransfer?.files;
  if (!files || files.length === 0) return;

  const file = files[0];

  // 检查文件类型，只处理文本文件
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (!ext || !['md', 'markdown', 'txt', 'text', 'js', 'ts', 'html', 'css', 'json'].includes(ext)) {
    console.warn('Unsupported file type:', ext);
    return;
  }

  let filePath = (file as unknown as { path?: string }).path;

  try {
    let openedId = '';

    if (filePath) {
      const openedFile = await filesStore.openOrCreateByPath(filePath, 'drop');
      if (!openedFile) return;

      openedId = openedFile.id;
    } else {
      const content = await file.text();
      const name = file.name.split('.').slice(0, -1).join('.') || file.name;
      const createdFile = await filesStore.createAndOpen(
        {
          id: nanoid(),
          path: null,
          name,
          ext,
          content,
          savedContent: content
        },
        'drop'
      );

      openedId = createdFile.id;
    }

    await router.push({ name: 'editor', params: { id: openedId } });
  } catch (error) {
    console.error('Failed to drop file:', error);
  }
}
</script>

<style lang="less" scoped>
.welcome-page {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  background-color: var(--bg-primary);
  border-radius: 8px;
}

.drag-overlay {
  position: absolute;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--bg-primary);
  opacity: 0.6;
  backdrop-filter: blur(4px);
}

.drag-overlay-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: center;
  color: var(--color-primary);
}

.welcome-container {
  display: flex;
  flex-direction: column;
  gap: 24px;
  width: 100%;
  max-width: 400px;
  padding: 32px 24px;
}

.actions-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.action-card {
  display: flex;
  gap: 6px;
  align-items: center;
  padding: 6px 8px;
  color: var(--text-primary);
  cursor: pointer;
  user-select: none;
  background-color: var(--bg-secondary);
  border-radius: 6px;
  transition: background-color 0.2s ease;

  &:hover {
    background-color: var(--bg-active);
  }

  .action-icon {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 8px;
  }

  .action-label {
    flex: 1;
    font-weight: 500;
  }
}

.recent-files-section {
  margin-top: 24px;
}

.recent-files-title {
  margin-bottom: 12px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.recent-files-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}

.recent-file-item {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 8px 12px;
  color: var(--text-primary);
  cursor: pointer;
  user-select: none;
  background-color: var(--bg-secondary);
  border-radius: 6px;
  transition: background-color 0.2s ease;

  &:hover {
    background-color: var(--bg-active);
  }

  .recent-file-icon {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    color: var(--text-secondary);
    border-radius: 6px;
  }

  .recent-file-info {
    flex: 1;
    min-width: 0;
  }

  .recent-file-name {
    margin-bottom: 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-primary);
    white-space: nowrap;
  }

  .recent-file-path {
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 11px;
    color: var(--text-tertiary);
    white-space: nowrap;
  }
}

.recent-files-more {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px 12px;
  color: var(--text-secondary);
  cursor: pointer;
  user-select: none;
  background-color: var(--bg-secondary);
  border-radius: 6px;
  transition: background-color 0.2s ease, color 0.2s ease;

  &:hover {
    color: var(--text-primary);
    background-color: var(--bg-active);
  }
}
</style>
