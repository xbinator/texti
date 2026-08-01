<!--
  @file ChatSider.vue
  @description 默认布局聊天侧栏壳，负责侧栏尺寸、标题、会话历史和显示状态。
-->
<template>
  <BPanelSplitter
    v-model:size="settingStore.sidebarWidth"
    :class="bem({ motion: motionEnabled, visible: settingStore.sidebarVisible })"
    :inert="settingStore.sidebarVisible ? undefined : true"
    :style="siderStyle"
    position="left"
    :min-width="340"
    max-width="40%"
    @close="handleSplitterClose"
    @resize-start="cancelMotion"
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
        <BButton square size="small" type="text" @click="handleCreateDraftSession">
          <BIcon icon="lucide:message-circle-plus" :size="16" />
        </BButton>

        <SessionHistory
          :active-session-id="settingStore.chatSidebarActiveSessionId"
          @switch-session="handleSwitchSession"
          @delete-session="handleDeletedSession"
          @load-more="loadMoreSessions"
        />
        <!-- 打开聊天页面 -->
        <BButton square size="small" type="text" @click="openChatPage">
          <BIcon icon="lucide:square-arrow-out-up-right" :size="16" />
        </BButton>

        <div :class="bem('divider')"></div>
        <BButton square size="small" type="text" @click="requestButtonClose">
          <BIcon icon="lucide:x" :size="16" />
        </BButton>
      </div>

      <BChat
        ref="bChatRef"
        :session-id="settingStore.chatSidebarActiveSessionId"
        @new-session="handleCreateDraftSession"
        @runtime-status-change="handleRuntimeStatus"
        @session-created="handleSessionCreated"
      />
    </div>
  </BPanelSplitter>
</template>

<script setup lang="ts">
import type { ChatSession } from 'types/chat';
import type { CSSProperties } from 'vue';
import { computed, defineAsyncComponent, onMounted, reactive, ref, watch } from 'vue';
import { Input as AInput, message } from 'ant-design-vue';
import BButton from '@/components/BButton/index.vue';
import SessionHistory from '@/components/BChat/components/SessionHistory.vue';
import { expireSessionConfirmations } from '@/components/BChat/utils/confirmationController';
import type { BChatRuntimeSourceStatus, BChatRuntimeStatusChange } from '@/components/BChat/utils/types';
import { vFocus } from '@/directives/focus';
import { useActorSystem } from '@/hooks/useChat/useActorSystem';
import { useIntentMotion } from '@/hooks/useIntentMotion';
import { createChatTabId } from '@/router/routes/helpers/chatRouteTab';
import { useChatSessionStore } from '@/stores/chat/session';
import type { ChatTabRuntimeRecord } from '@/stores/chat/tab';
import { useChatTabStore } from '@/stores/chat/tab';
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
/** 聊天标签运行时投影 Store。 */
const runtimeStore = useChatTabStore();
/** 应用级 Chat Actor system，用于删除成功后的 Renderer 事实清理。 */
const actorSystem = useActorSystem();
/** BChat 最近一次持续运行状态，用于首轮会话创建后补齐投影。 */
const sideRuntimeStatus = ref<BChatRuntimeSourceStatus>('idle');

/** ChatSider 只在按钮动作与真实状态目标一致时保留显隐动画。 */
const { motionEnabled, startMotion, syncState, cancelMotion } = useIntentMotion<boolean>();

/** 监听侧栏显隐状态，当外部状态与动画目标冲突时取消动画。 */
watch((): boolean => settingStore.sidebarVisible, syncState);
/** 会话标题编辑状态。 */
const titleEditor = reactive({ editing: false, draft: '', saving: false });

const { currentSession, switchSession: switchSideSession, createDraftSession, handleDeletedSession: syncDeletedSession } = useChatSession();

/** BChat 组件实例引用，用于调用聚焦输入框等方法。 */
const bChatRef = ref<InstanceType<typeof BChat>>();

/** 侧栏展开后聚焦 BChat 输入框，便于用户立即继续对话。 */
watch(
  (): boolean => settingStore.sidebarVisible,
  (visible: boolean): void => {
    if (!visible) return;
    bChatRef.value?.focusInput();
  },
  { flush: 'post' }
);
/** 当前标题。 */
const currentTitle = computed<string>(() => currentSession.value?.title || '新会话');
/** 根元素样式变量，隐藏态宽度归零，显示态恢复用户拖拽宽度。 */
const siderStyle = computed<ChatSiderStyle>(
  (): ChatSiderStyle => ({
    '--chat-sider-width': `${settingStore.sidebarWidth}px`
  })
);
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
  if (!session || titleEditor.saving) return;

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
 * 处理分隔器拖拽关闭，取消动画并直接关闭。
 */
function handleSplitterClose(): void {
  cancelMotion();
  settingStore.setSidebarVisible(false);
}

/**
 * 通过内部关闭按钮关闭侧栏，启用动画。
 */
function requestButtonClose(): void {
  startMotion(false);
  settingStore.setSidebarVisible(false);
}

/**
 * 进入新会话草稿态。
 */
async function handleCreateDraftSession(): Promise<void> {
  await createDraftSession();
  await asyncTo(bChatRef.value?.resetDraft({ focus: false }) ?? Promise.resolve());
}

/** 聊天页路由与已打开标签同步能力。 */
const {
  openChatPage,
  handleSwitchSession,
  handleDeletedSession: syncDeletedRoute
} = useChatRoute({
  openDraftSession: handleCreateDraftSession,
  switchSession: switchSideSession,
  syncDeletedSession
});

/**
 * 清理成功删除会话的应用级 Runtime 事实，再同步侧栏与顶部标签。
 * @param sessionId - 已删除会话 ID
 */
async function handleDeletedSession(sessionId: string): Promise<void> {
  expireSessionConfirmations(sessionId);
  actorSystem.removeSession(sessionId);
  const [error] = await asyncTo(syncDeletedRoute(sessionId));
  if (error) message.error(error.message || '清理已删除会话页面失败');
}

/**
 * 确保侧边栏会话拥有唯一运行态记录。
 * @param sessionId - 持久化会话 ID
 * @returns 运行态 owner
 */
function ensureRuntimeOwner(sessionId: string): ChatTabRuntimeRecord {
  return runtimeStore.findOwner(sessionId) ?? runtimeStore.ensureTab(createChatTabId(sessionId), sessionId);
}

/**
 * 同步侧边栏 BChat 的运行状态。
 * @param event - BChat 状态事件
 */
function handleRuntimeStatus(event: BChatRuntimeStatusChange): void {
  if (event.status === 'completed') {
    const owner = ensureRuntimeOwner(event.sessionId);
    const active = settingStore.sidebarVisible && settingStore.chatSidebarActiveSessionId === event.sessionId;
    runtimeStore.markCompleted(owner.tabId, active);
    return;
  }

  const activeSessionId = settingStore.chatSidebarActiveSessionId;
  if (!event.sessionId || event.sessionId === activeSessionId) sideRuntimeStatus.value = event.status;
  const sessionId = event.sessionId ?? activeSessionId;
  if (sessionId) runtimeStore.setStatus(ensureRuntimeOwner(sessionId).tabId, event.status);
}

/**
 * 同步 BChat 内部创建的新会话。
 * @param session - 新创建的会话对象
 */
function handleSessionCreated(session: ChatSession): void {
  settingStore.setChatSidebarActiveSessionId(session.id);
  runtimeStore.setStatus(ensureRuntimeOwner(session.id).tabId, sideRuntimeStatus.value);
}

/** 暴露 startMotion 供父组件通过 ref 调用（如布局头部切换按钮）。 */
defineExpose({ startMotion });
</script>

<style lang="less">
.chat-sider {
  flex-shrink: 0;
  width: 0;
  min-width: 0;
  max-width: 40%;
  pointer-events: none;
  opacity: 0;
  transform: translateX(12px);
}

.chat-sider--motion {
  transition: width var(--motion-duration-slow) var(--motion-easing-standard), opacity var(--motion-duration-base) var(--motion-easing-standard),
    transform var(--motion-duration-slow) var(--motion-easing-standard);
  will-change: width, opacity, transform;
}

.chat-sider:not(.chat-sider--visible, .chat-sider--motion) {
  transform: none;
}

.chat-sider:not(.chat-sider--visible, .chat-sider--motion) .b-panel-splitter__section,
.chat-sider:not(.chat-sider--visible, .chat-sider--motion) .b-panel-splitter__line {
  display: none;
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
  margin-left: 6px;
  overflow: hidden;
  background: var(--bg-primary);
  border: var(--surface-border-width) solid var(--border-primary);
  border-radius: var(--surface-radius);
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
  .chat-sider--motion {
    transition: none;
  }
}
</style>
