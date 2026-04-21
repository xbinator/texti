<template>
  <BDropdown v-model:open="open" :disabled="isDisabled">
    <BButton square size="small" type="text" :disabled="isDisabled">
      <Icon icon="lucide:history" width="16" height="16" />
    </BButton>

    <template #overlay>
      <div class="session-history" @click.stop>
        <template v-if="sessions.length">
          <div class="session-history__list">
            <div v-for="group in groupedSessions" :key="group.key" class="session-history__group">
              <div class="session-history__group-title">{{ group.label }}</div>
              <div
                v-for="session in group.sessions"
                :key="session.id"
                class="session-history__item"
                :class="{ 'is-active': session.id === props.activeSessionId }"
                @click="handleSwitchSession(session.id)"
              >
                <span class="session-history__content">
                  <span class="session-history__item-title">{{ session.title }}</span>
                </span>
                <span class="session-history__actions">
                  <BButton type="text" square danger size="small" @click.stop="handleDeleteSession(session.id)">
                    <Icon icon="lucide:trash-2" width="14" height="14" />
                  </BButton>
                </span>
              </div>
            </div>
          </div>
        </template>

        <div v-else class="session-history__empty">暂无历史会话</div>
      </div>
    </template>
  </BDropdown>
</template>

<script setup lang="ts">
import type { ChatSession } from 'types/chat';
import { computed, ref } from 'vue';
import { Icon } from '@iconify/vue';
import { message } from 'ant-design-vue';
import dayjs from 'dayjs';
import { groupBy, map } from 'lodash-es';
import BButton from '@/components/BButton/index.vue';
import BDropdown from '@/components/BDropdown/index.vue';
import { useChatStore } from '@/stores/chat';
import { asyncTo } from '@/utils/asyncTo';

interface Props {
  // 会话列表
  sessions?: ChatSession[];
  // 当前选中的会话ID
  activeSessionId?: string | null;
}

interface SessionGroup {
  key: string;
  label: string;
  sessions: ChatSession[];
}

const props = withDefaults(defineProps<Props>(), {
  sessions: () => [],
  activeSessionId: null,
  loading: false
});

const open = ref(false);
const chatStore = useChatStore();

const emit = defineEmits<{
  (e: 'switch-session', sessionId: string): void;
  (e: 'delete-session', sessionId: string): void;
}>();

const sessions = computed(() => props.sessions);

const loading = ref(false);

const isDisabled = computed(() => !sessions.value.length);

function toDateKey(timestamp: string): string {
  return dayjs(timestamp).format('YYYY-MM-DD');
}

function formatSessionDay(timestamp: string): string {
  const date = dayjs(timestamp);
  const now = dayjs();

  if (date.isSame(now, 'day')) return '今天';

  const yesterday = now.subtract(1, 'day');
  if (date.isSame(yesterday, 'day')) return '昨天';

  return date.format('MM-DD');
}

const groupedSessions = computed<SessionGroup[]>(() => {
  const groups = groupBy(sessions.value, (session) => toDateKey(session.lastMessageAt || session.updatedAt || session.createdAt || ''));

  return map(groups, (_sessions, key) => ({ key, label: formatSessionDay(_sessions[0].lastMessageAt), sessions: _sessions }));
});

function handleSwitchSession(sessionId: string): void {
  if (sessionId === props.activeSessionId) return;

  open.value = false;

  emit('switch-session', sessionId);
}

async function handleDeleteSession(sessionId: string) {
  if (loading.value) return;

  loading.value = true;
  const [error] = await asyncTo(chatStore.deleteSession(sessionId));
  loading.value = false;

  error ? message.error(error.message || '删除会话失败，请重试') : emit('delete-session', sessionId);
}
</script>

<style scoped lang="less">
.session-history {
  width: 280px;
  padding: 6px;
  background: var(--dropdown-bg, var(--bg-primary));
  border: 1px solid var(--dropdown-border, var(--border-color));
  border-radius: 8px;
  box-shadow: 0 8px 24px rgb(0 0 0 / 12%);
}

.session-history__list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 260px;
  overflow-y: auto;
}

.session-history__group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.session-history__group-title {
  padding: 2px 8px;
  font-size: 12px;
  color: var(--text-secondary);
}

.session-history__item {
  display: flex;
  gap: 8px;
  align-items: center;
  width: 100%;
  height: 32px;
  padding: 0 8px;
  text-align: left;
  cursor: pointer;
  border: none;
  border-radius: 8px;
  transition: background-color 0.2s ease;

  &:hover,
  &.is-active {
    background: var(--bg-hover);
  }
}

.session-history__content {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.session-history__item-title {
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-primary);
  white-space: nowrap;
}

.session-history__actions {
  display: flex;
  flex-shrink: 0;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.session-history__item:hover .session-history__actions {
  opacity: 1;
}

.session-history__empty {
  padding: 20px 12px;
  font-size: 12px;
  color: var(--text-secondary);
  text-align: center;
}
</style>
