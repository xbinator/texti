<template>
  <BDropdown v-model:open="open" :disabled="isDisabled" :align="{ offset: [-45, 0] }">
    <BButton square size="small" type="text" :disabled="isDisabled">
      <Icon icon="lucide:history" width="16" height="16" />
    </BButton>

    <template #overlay>
      <div class="session-history" @click.stop>
        <div v-if="sessions.length" class="session-history__list" v-bind="containerProps">
          <div class="session-history__list-inner" v-bind="wrapperProps">
            <template v-for="{ data } in list" :key="data.key">
              <div v-if="data.type === 'header'" class="session-history__group-title">
                {{ data.label }}
              </div>
              <div
                v-else
                class="session-history__item"
                :class="{ 'is-active': data.session?.id === props.activeSessionId }"
                @click="handleSwitchSession(data.session!.id)"
              >
                <span class="session-history__content">
                  <span class="session-history__item-title">{{ data.session?.title }}</span>
                </span>
                <span class="session-history__actions">
                  <BButton type="text" square danger size="small" @click.stop="handleDeleteSession(data.session!.id)">
                    <Icon icon="lucide:trash-2" width="14" height="14" />
                  </BButton>
                </span>
              </div>
            </template>
          </div>
        </div>

        <div v-else class="session-history__empty">暂无历史会话</div>
      </div>
    </template>
  </BDropdown>
</template>

<script setup lang="ts">
import type { ChatSession } from 'types/chat';
import { computed, onMounted, ref, watch } from 'vue';
import { Icon } from '@iconify/vue';
import { useVirtualList } from '@vueuse/core';
import { message } from 'ant-design-vue';
import dayjs from 'dayjs';
import { groupBy, map } from 'lodash-es';
import BButton from '@/components/BButton/index.vue';
import BDropdown from '@/components/BDropdown/index.vue';
import { useChatStore } from '@/stores/chat';
import { useSettingStore } from '@/stores/setting';
import { asyncTo } from '@/utils/asyncTo';

interface Props {
  /** 当前选中的会话 ID */
  activeSessionId?: string | null;

  /** 是否禁用历史会话操作 */
  disabled?: boolean;
}

interface SessionGroup {
  key: string;
  label: string;
  sessions: ChatSession[];
}

interface FlatItem {
  type: 'header' | 'session';
  key: string;
  label?: string;
  session?: ChatSession;
}

const CHAT_SESSION_TYPE = 'assistant';

const props = withDefaults(defineProps<Props>(), {
  activeSessionId: null,
  disabled: false
});

const open = ref(false);
const chatStore = useChatStore();
const settingStore = useSettingStore();
const sessions = ref<ChatSession[]>([]);

const emit = defineEmits<{
  (e: 'switch-session', sessionId: string): void;
  (e: 'update:currentSession', session: ChatSession | undefined): void;
}>();

const currentSession = computed<ChatSession | undefined>(() => {
  if (!props.activeSessionId) return undefined;
  return sessions.value.find((s) => s.id === props.activeSessionId);
});

const loading = ref(false);

const isDisabled = computed(() => props.disabled || !sessions.value.length);

async function refreshSessions(): Promise<void> {
  sessions.value = await chatStore.getSessions(CHAT_SESSION_TYPE);
  emit('update:currentSession', currentSession.value);
}

watch(
  () => props.activeSessionId,
  async (newId, oldId) => {
    if (newId && newId !== oldId) {
      await refreshSessions();
    }

    emit('update:currentSession', currentSession.value);
  },
  { immediate: true }
);

onMounted(async () => {
  sessions.value = await chatStore.getSessions(CHAT_SESSION_TYPE);
});

defineExpose({
  refreshSessions
});

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

const flatItems = computed<FlatItem[]>(() => {
  const result: FlatItem[] = [];
  groupedSessions.value.forEach((group) => {
    result.push({ type: 'header', key: `header-${group.key}`, label: group.label });
    group.sessions.forEach((session) => {
      result.push({ type: 'session', key: session.id, session });
    });
  });
  return result;
});

const { list, containerProps, wrapperProps } = useVirtualList(flatItems, {
  itemHeight: (index) => (flatItems.value[index]?.type === 'header' ? 24 : 32),
  overscan: 5
});

function handleSwitchSession(sessionId: string): void {
  if (props.disabled) return;
  if (sessionId === props.activeSessionId) return;

  open.value = false;

  emit('switch-session', sessionId);
}

async function handleDeleteSession(sessionId: string) {
  if (props.disabled) return;
  if (loading.value) return;

  const wasActive = sessionId === props.activeSessionId;

  loading.value = true;
  const [error] = await asyncTo(chatStore.deleteSession(sessionId));
  loading.value = false;

  if (!error) {
    await refreshSessions();

    if (wasActive) {
      settingStore.setChatSidebarActiveSessionId(null);
    }
  } else {
    message.error(error.message || '删除会话失败，请重试');
  }
}
</script>

<style scoped lang="less">
.session-history {
  width: 200px;
  padding: 6px;
  background: var(--dropdown-bg, var(--bg-primary));
  border: 1px solid var(--dropdown-border, var(--border-color));
  border-radius: 8px;
  box-shadow: 0 8px 24px rgb(0 0 0 / 12%);
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
  display: none;
  flex-shrink: 0;
  gap: 4px;
  transition: opacity 0.2s ease;
}

.session-history__item:hover .session-history__actions {
  display: flex;
}

.session-history__empty {
  padding: 20px 12px;
  font-size: 12px;
  color: var(--text-secondary);
  text-align: center;
}
</style>
