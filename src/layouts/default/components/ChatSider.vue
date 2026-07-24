<!--
  @file ChatSider.vue
  @description 默认布局聊天侧栏壳，负责侧栏尺寸、标题、会话历史和显示状态。
-->
<template>
  <BPanelSplitter
    v-model:size="settingStore.sidebarWidth"
    :class="bem({ visible: settingStore.sidebarVisible })"
    :inert="settingStore.sidebarVisible ? undefined : true"
    :style="siderStyle"
    position="left"
    :min-width="340"
    max-width="40%"
    @close="handleClose"
  >
    <div :class="bem('content')">
      <div :class="bem('header')">
        <AInput
          v-if="titleEditor.editing"
          v-model:value="titleEditor.draft"
          v-focus="{ selectAll: true }"
          :class="bem('title-input')"
          size="small"
          @blur="finishTitleEdit"
          @keydown.enter.prevent="finishTitleEdit"
        />
        <div v-else :class="[bem('title'), 'truncate']" title="双击修改标题" @dblclick="startTitleEdit">{{ currentTitle }}</div>
        <!-- 新建会话 -->
        <BButton square size="small" type="text" :disabled="isSessionActionDisabled" @click="handleCreateDraftSession">
          <BIcon icon="lucide:message-circle-plus" :size="16" />
        </BButton>

        <SessionHistory
          :active-session-id="settingStore.chatSidebarActiveSessionId"
          :disabled="isSessionActionDisabled"
          @switch-session="handleSwitchSession"
          @delete-session="handleDeletedSession"
          @load-more="loadMoreSessions"
        />
        <!-- 打开聊天页面 -->
        <BButton square size="small" type="text" :disabled="isSessionActionDisabled" @click="openChatPage">
          <BIcon icon="lucide:square-arrow-out-up-right" :size="16" />
        </BButton>

        <div :class="bem('divider')"></div>
        <BButton square size="small" type="text" @click="handleClose">
          <BIcon icon="lucide:x" :size="16" />
        </BButton>
      </div>

      <BChat
        ref="bChatRef"
        :session-id="settingStore.chatSidebarActiveSessionId"
        @new-session="handleCreateDraftSession"
        @session-created="handleSessionCreated"
        @loading-change="handleChatLoadingChange"
      />
    </div>
  </BPanelSplitter>
</template>

<script setup lang="ts">
import type { ChatSession } from 'types/chat';
import type { CSSProperties } from 'vue';
import { computed, defineAsyncComponent, onMounted, reactive, ref } from 'vue';
import { Input as AInput, message } from 'ant-design-vue';
import BButton from '@/components/BButton/index.vue';
import SessionHistory from '@/components/BChat/components/SessionHistory.vue';
import { vFocus } from '@/directives/focus';
import { useChatSessionStore } from '@/stores/chat/session';
import { useSettingStore } from '@/stores/ui/setting';
import { asyncTo } from '@/utils/asyncTo';
import { createNamespace } from '@/utils/namespace';
import { useChatRoute } from '../hooks/useChatRoute';
import { useChatSession } from '../hooks/useChatSession';

const BChat = defineAsyncComponent(() => import('@/components/BChat/index.vue'));

const [, bem] = createNamespace('chat-sider', '');

/**
 * ChatSider 根元素内联样式。
 */
type ChatSiderStyle = CSSProperties & {
  /** 当前聊天侧栏宽度，用于显示状态切换时做显式宽度过渡。 */
  '--chat-sider-width': string;
};

/** 应用设置存储。 */
const settingStore = useSettingStore();
/** 聊天会话持久化存储。 */
const chatStore = useChatSessionStore();
/** 聊天运行时是否忙碌。 */
const chatLoading = ref(false);
/** 会话标题编辑状态。 */
const titleEditor = reactive({ editing: false, draft: '', saving: false });

const {
  currentSession,
  switchSession: switchSideSession,
  createDraftSession,
  handleDeletedSession: syncDeletedSession
} = useChatSession({
  isChatLoading: () => chatLoading.value
});

/** BChat 组件实例引用，用于调用聚焦输入框等方法。 */
const bChatRef = ref<InstanceType<typeof BChat>>();
/** 当前标题。 */
const currentTitle = computed<string>(() => currentSession.value?.title || '新会话');
/** 根元素样式变量，隐藏态宽度归零，显示态恢复用户拖拽宽度。 */
const siderStyle = computed<ChatSiderStyle>(
  (): ChatSiderStyle => ({
    '--chat-sider-width': `${settingStore.sidebarWidth}px`
  })
);
/** 是否禁用会话切换、新会话和删除操作。 */
const isSessionActionDisabled = computed<boolean>(() => chatLoading.value || chatStore.sessionsLoading);

/**
 * 确保共享会话集合完成首次加载。
 */
async function ensureSessions(): Promise<void> {
  const [error] = await asyncTo(chatStore.ensureSessions());
  if (error) message.error('加载会话失败');
}

/**
 * 加载共享会话集合下一页。
 */
async function loadMoreSessions(): Promise<void> {
  const [error] = await asyncTo(chatStore.loadMoreSessions());
  if (error) message.error('加载会话失败');
}

onMounted((): void => {
  asyncTo(ensureSessions());
});

/**
 * 双击当前标题后进入编辑态，聚焦与全选交给 v-focus 统一处理。
 */
function startTitleEdit(): void {
  const session = currentSession.value;
  if (!session || isSessionActionDisabled.value || titleEditor.saving) return;

  titleEditor.draft = session.title;
  titleEditor.editing = true;
}

/**
 * 完成标题编辑并持久化有效变更。
 */
async function finishTitleEdit(): Promise<void> {
  if (!titleEditor.editing) return;

  const session = currentSession.value;
  const nextTitle = titleEditor.draft.trim();
  titleEditor.editing = false;
  if (!session || !nextTitle || nextTitle === session.title) return;

  titleEditor.saving = true;
  await asyncTo(chatStore.updateSessionTitle(session.id, nextTitle));
  titleEditor.saving = false;
}

/**
 * 关闭聊天侧栏。
 */
function handleClose(): void {
  settingStore.setSidebarVisible(false);
}

/**
 * 进入新会话草稿态。
 */
async function handleCreateDraftSession(): Promise<void> {
  if (isSessionActionDisabled.value) return;
  await createDraftSession();
  await asyncTo(bChatRef.value?.resetDraft({ focus: false }) ?? Promise.resolve());
}

/** 聊天页路由与已打开标签同步能力。 */
const { openChatPage, handleSwitchSession, handleDeletedSession } = useChatRoute({
  isSessionActionDisabled: (): boolean => isSessionActionDisabled.value,
  openDraftSession: handleCreateDraftSession,
  switchSession: switchSideSession,
  syncDeletedSession
});

/**
 * 同步 BChat 内部创建的新会话。
 * @param session - 新创建的会话对象
 */
function handleSessionCreated(session: ChatSession): void {
  settingStore.setChatSidebarActiveSessionId(session.id);
}

/**
 * 同步聊天运行时状态。
 * @param loading - 是否存在正在运行的聊天、压缩或流式任务
 */
function handleChatLoadingChange(loading: boolean): void {
  chatLoading.value = loading;
}
</script>

<style lang="less">
.chat-sider {
  flex-shrink: 0;
  width: 0;
  min-width: 0;
  max-width: 40%;
  overflow: hidden;
  pointer-events: none;
  opacity: 0;
  transform: translateX(12px);
  transition: width 0.36s ease, opacity 0.24s ease, transform 0.36s ease;
  will-change: width, opacity, transform;
}

.chat-sider--visible {
  width: var(--chat-sider-width);
  pointer-events: auto;
  opacity: 1;
  transform: translateX(0);
}

.chat-sider__content {
  display: flex;
  flex-shrink: 0;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: var(--bg-primary);
  border: 1px solid var(--border-primary);
  border-radius: 8px;
}

.chat-sider__header {
  display: flex;
  gap: 8px;
  align-items: center;
  height: 40px;
  padding: 0 8px 0 12px;
  border-bottom: 1px solid var(--border-primary);
}

.chat-sider__title {
  flex: 1;
  width: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
}

.chat-sider__title-input {
  min-width: 0;
  height: 26px;
  font-size: 12px;
}

.chat-sider__divider {
  width: 1px;
  height: 16px;
  background: var(--border-secondary);
}

@media (prefers-reduced-motion: reduce) {
  .chat-sider {
    transition: none;
  }
}
</style>
