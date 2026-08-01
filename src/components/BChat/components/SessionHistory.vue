<!--
  @file SessionHistory.vue
  @description 展示共享聊天会话集合，并处理切换、分页请求和删除交互。
-->
<template>
  <BDropdown v-model:open="open" :align="{ offset: [-84, 0] }">
    <BButton square size="small" type="text">
      <BIcon icon="lucide:history" :size="16" />
    </BButton>

    <template #overlay>
      <div class="session-history" @click.stop>
        <div v-if="chatStore.sessions.length || chatStore.sessionsLoading" ref="scrollContainer" class="session-history__list">
          <div class="session-history__list-inner">
            <template v-for="group in groupedSessions" :key="group.key">
              <div class="session-history__group-title">
                {{ group.label }}
              </div>
              <div
                v-for="session in group.sessions"
                :key="session.id"
                class="session-history__item"
                :class="{ 'is-active': session.id === props.activeSessionId }"
                @click="handleSwitchSession(session.id)"
              >
                <span class="session-history__content">
                  <BIcon v-if="getSessionStatus(session.id) === 'running'" class="session-history__status-icon is-spinning" icon="lucide:loader-2" :size="14" />
                  <BIcon v-else-if="getSessionStatus(session.id) === 'waiting'" class="session-history__status-icon" icon="lucide:circle-help" :size="14" />
                  <span class="session-history__item-title">{{ session.title }}</span>
                </span>
                <span class="session-history__actions">
                  <BButton type="text" square danger size="small" @click.stop="handleDeleteSession(session.id)">
                    <BIcon icon="lucide:trash-2" :size="14" />
                  </BButton>
                </span>
              </div>
            </template>

            <div v-if="chatStore.sessionsLoading" class="session-history__loading">
              <BIcon icon="lucide:loader-2" :size="14" class="is-spinning" />
              <span>加载中...</span>
            </div>
          </div>
        </div>

        <div v-else class="session-history__empty">暂无历史会话</div>
      </div>
    </template>
  </BDropdown>
</template>

<script setup lang="ts">
import type { ChatSession } from 'types/chat';
import { computed, ref } from 'vue';
import { useInfiniteScroll } from '@vueuse/core';
import { message } from 'ant-design-vue';
import dayjs from 'dayjs';
import { groupBy, map } from 'lodash-es';
import BButton from '@/components/BButton/index.vue';
import BDropdown from '@/components/BDropdown/index.vue';
import { useChatSessionStore } from '@/stores/chat/session';
import { type ChatTabRuntimeStatus, useChatTabStore } from '@/stores/chat/tab';
import { asyncTo } from '@/utils/asyncTo';
import { Modal } from '@/utils/modal';

/**
 * 组件 Props 定义
 */
interface Props {
  /** 当前选中的会话 ID */
  activeSessionId?: string | null;
}

/**
 * 会话分组结构
 */
interface SessionGroup {
  /** 分组日期键 */
  key: string;
  /** 分组显示标签 */
  label: string;
  /** 该分组下的会话列表 */
  sessions: ChatSession[];
}

const props = withDefaults(defineProps<Props>(), {
  activeSessionId: null
});

const open = ref(false);
const chatStore = useChatSessionStore();
/** 聊天会话运行态投影 Store。 */
const runtimeStore = useChatTabStore();
/** 正在确认或删除的会话，避免快速重复点击创建并行事务。 */
const deletingSessionIds = new Set<string>();

/** 滚动容器引用 */
const scrollContainer = ref<HTMLElement>();

const emit = defineEmits<{
  (e: 'switch-session', sessionId: string): void;
  (e: 'delete-session', sessionId: string): void;
  (e: 'load-more'): void;
}>();

/**
 * 将时间戳转换为日期键（YYYY-MM-DD 格式）
 * @param timestamp - ISO 时间戳字符串
 * @returns 日期键
 */
function toDateKey(timestamp: string): string {
  return dayjs(timestamp).format('YYYY-MM-DD');
}

/**
 * 格式化会话日期为可读标签
 * @param timestamp - ISO 时间戳字符串
 * @returns 格式化后的日期标签（今天/昨天/MM-DD）
 */
function formatSessionDay(timestamp: string): string {
  const date = dayjs(timestamp);
  const now = dayjs();

  if (date.isSame(now, 'day')) return '今天';

  const yesterday = now.subtract(1, 'day');
  if (date.isSame(yesterday, 'day')) return '昨天';

  return date.format('MM-DD');
}

/** 按日期分组的会话列表 */
const groupedSessions = computed<SessionGroup[]>(() => {
  const groups = groupBy(chatStore.sessions, (session: ChatSession) => toDateKey(session.lastMessageAt || session.updatedAt || session.createdAt || ''));

  return map(groups, (_sessions, key) => ({ key, label: formatSessionDay(_sessions[0].lastMessageAt), sessions: _sessions }));
});

/**
 * 使用 IntersectionObserver 监听滚动容器底部，触发加载更多
 */
useInfiniteScroll(
  scrollContainer,
  (): void => {
    emit('load-more');
  },
  { distance: 50 }
);

/**
 * 切换到指定会话
 * @param sessionId - 目标会话 ID
 */
function handleSwitchSession(sessionId: string): void {
  if (sessionId === props.activeSessionId) return;

  open.value = false;

  emit('switch-session', sessionId);
}

/**
 * 获取会话当前的界面运行状态。
 * @param sessionId - 会话 ID
 * @returns Runtime Store 中的状态，找不到记录时返回 idle
 */
function getSessionStatus(sessionId: string): ChatTabRuntimeStatus {
  return runtimeStore.findOwner(sessionId)?.status ?? 'idle';
}

/**
 * 根据会话状态生成删除确认文案。
 * @param sessionId - 会话 ID
 * @returns 对应状态的危险确认文案
 */
function getDeleteContent(sessionId: string): string {
  const session = chatStore.sessions.find((item: ChatSession): boolean => item.id === sessionId);
  const title = session?.title.trim() || '未命名聊天';
  const status = getSessionStatus(sessionId);
  if (status === 'running') {
    return `确定终止并删除聊天“${title}”吗？当前聊天仍在运行，删除前会先终止所有任务。删除后无法恢复。`;
  }
  if (status === 'waiting') {
    return `确定终止并删除聊天“${title}”吗？当前聊天正在等待你的操作，删除时会取消等待中的交互。删除后无法恢复。`;
  }
  return `确定删除聊天“${title}”吗？删除后无法恢复。`;
}

/**
 * 删除指定会话，保持当前分页状态不变
 * @param sessionId - 要删除的会话 ID
 */
async function handleDeleteSession(sessionId: string): Promise<void> {
  if (chatStore.sessionsLoading || deletingSessionIds.has(sessionId)) return;

  deletingSessionIds.add(sessionId);
  try {
    const content = getDeleteContent(sessionId);
    const [confirmError, result] = await asyncTo(Modal.delete(content));
    if (confirmError) {
      message.error(confirmError.message || '打开删除确认失败，请重试');
      return;
    }
    if (!result[1]) return;

    const [deleteError] = await asyncTo(chatStore.deleteSession(sessionId));
    if (deleteError) {
      message.error(deleteError.message || '删除会话失败，请重试');
      return;
    }

    emit('delete-session', sessionId);
  } finally {
    deletingSessionIds.delete(sessionId);
  }
}
</script>

<style scoped lang="less">
.session-history {
  width: 200px;
  padding: 6px;
  background: var(--dropdown-bg);
  border-radius: var(--overlay-radius);
  box-shadow: var(--shadow-dropdown);
}

.session-history__list {
  max-height: 260px;
  overflow-y: auto;
}

.session-history__list-inner {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.session-history__group-title {
  padding: 2px 8px;
  font-size: 12px;
  color: var(--text-secondary);
}

.session-history__item {
  display: flex;
  gap: 2px;
  align-items: center;
  width: 100%;
  min-height: 32px;
  padding: 0 8px;
  text-align: left;
  cursor: pointer;
  border: none;
  border-radius: var(--control-radius);
  transition: background var(--motion-duration-base) var(--motion-easing-standard);

  &:hover,
  &.is-active {
    background: var(--dropdown-item-hover-bg);
  }
}

.session-history__content {
  display: flex;
  flex: 1;
  gap: 6px;
  align-items: center;
  min-width: 0;
}

.session-history__status-icon {
  flex-shrink: 0;
  color: var(--text-secondary);
}

.session-history__item-title {
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-primary);
  white-space: nowrap;
}

.session-history__actions {
  display: none;
  flex-shrink: 0;
  gap: 4px;
  transition: opacity var(--motion-duration-base) var(--motion-easing-standard);
}

.session-history__item:hover .session-history__actions {
  display: flex;
}

.session-history__loading {
  display: flex;
  gap: 4px;
  align-items: center;
  justify-content: center;
  padding: 8px 12px;
  font-size: 12px;
  color: var(--text-secondary);
}

.session-history__no-more {
  padding: 8px 12px;
  font-size: 12px;
  color: var(--text-tertiary, var(--text-secondary));
  text-align: center;
}

.session-history__empty {
  padding: 20px 12px;
  font-size: 12px;
  color: var(--text-secondary);
  text-align: center;
}

.is-spinning {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}
</style>
