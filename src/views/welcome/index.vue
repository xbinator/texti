<template>
  <div class="welcome-page">
    <div class="welcome-container">
      <div class="actions-section">
        <div class="action-card" data-test-id="welcome-open-chat" @click="handleOpenChat">
          <div class="action-icon">
            <Icon icon="lucide:message-circle" width="16" height="16" />
          </div>
          <span class="action-label">新对话</span>
        </div>

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

      <div v-if="topRecentRecords.length" class="recent-files-section">
        <div class="recent-files-title">最近记录</div>
        <div class="recent-files-list">
          <div v-for="record in topRecentRecords" :key="createRecentKey(record)" class="recent-file-item" @click="handleOpenRecentRecord(record)">
            <div class="recent-file-icon">
              <BRecentIcon :record="record" :size="14" />
            </div>
            <div class="recent-file-info">
              <div class="recent-file-name">{{ resolveRecentTitle(record) }}</div>
              <div class="recent-file-path">{{ resolveRecentDescription(record) }}</div>
            </div>
          </div>
        </div>
        <div class="recent-files-more" @click="handleShowShortcuts">
          <span>更多</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * @file index.vue
 * @description 渲染欢迎页快捷入口与最近文件列表，并支持拖拽打开文件。
 */

import { computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import { useNavigate } from '@/hooks/useNavigate';
import { useRecentRecord } from '@/hooks/useRecentRecord';
import { createChatPath } from '@/router/routes/helpers/chatRouteTab';
import { createRecentKey, resolveRecentDescription, resolveRecentTitle, type RecentRecord } from '@/shared/storage';
import { useCommandPanelStore } from '@/stores/ui/commandPanel';
import { useRecentStore } from '@/stores/workspace/recent';
import { asyncTo } from '@/utils/asyncTo';

const router = useRouter();
const commandPanelStore = useCommandPanelStore();
const recentStore = useRecentStore();
const { createNewFile, openNativeFile } = useNavigate();
const { openRecentRecord } = useRecentRecord();

const topRecentRecords = computed(() => recentStore.topRecentRecords);

onMounted(() => recentStore.ensureLoaded());

/**
 * 创建新的未保存文件。
 */
function handleNewFile(): void {
  createNewFile();
}

/**
 * 通过欢迎页入口打开原生文件。
 */
async function handleOpenFile(): Promise<void> {
  await openNativeFile();
}

/**
 * 打开独立聊天页草稿入口。
 */
async function handleOpenChat(): Promise<void> {
  await asyncTo(router.push(createChatPath()));
}

/**
 * 打开最近记录。
 * @param record - 最近记录
 */
function handleOpenRecentRecord(record: RecentRecord): void {
  asyncTo(openRecentRecord(record));
}

/**
 * 打开最近文件搜索弹窗。
 */
function handleShowShortcuts(): void {
  commandPanelStore.openRecent();
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
  background: var(--bg-primary);
  border: var(--surface-border-width) solid var(--border-primary);
  border-radius: var(--surface-radius);
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
  background: var(--bg-secondary);
  border-radius: var(--control-radius);
  transition: background var(--motion-duration-base) var(--motion-easing-standard);

  &:hover {
    background: var(--bg-active);
  }

  .action-icon {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: var(--control-radius);
  }

  .action-label {
    display: flex;
    flex: 1;
    align-items: center;
    justify-content: space-between;
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
  background: var(--bg-secondary);
  border-radius: var(--control-radius);
  transition: background var(--motion-duration-base) var(--motion-easing-standard);

  &:hover {
    background: var(--bg-active);
  }

  .recent-file-icon {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    color: var(--text-secondary);
    border-radius: var(--control-radius);
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
  background: var(--bg-secondary);
  border-radius: var(--control-radius);
  transition: background var(--motion-duration-base) var(--motion-easing-standard), color var(--motion-duration-base) var(--motion-easing-standard);

  &:hover {
    color: var(--text-primary);
    background: var(--bg-active);
  }
}
</style>
