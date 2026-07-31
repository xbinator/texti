<!--
  @file index.vue
  @description 独立聊天页宿主，协调 BChat、顶部标签与后台运行状态。
-->
<template>
  <div class="chat-page">
    <BChat
      ref="bChatRef"
      class="chat-container"
      workspace-control-enabled
      :session-id="initialSessionId"
      @session-created="handleSessionCreated"
      @session-title-persisted="handleTitlePersisted"
      @new-session="openDraftSession"
      @runtime-status-change="handleRuntimeStatus"
      @navigate-to-provider="handleProviderNavigate"
    />
  </div>
</template>

<script setup lang="ts">
import type { ChatSession } from 'types/chat';
import { computed, nextTick, onActivated, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import BChat from '@/components/BChat/index.vue';
import type { BChatRuntimeStatusChange } from '@/components/BChat/utils/types';
import { isBlockingNavigationFailure } from '@/router/navigation';
import { CHAT_DRAFT_TAB_ID, createChatPath, createChatTabId, findChatTab } from '@/router/routes/helpers/chatRouteTab';
import { normalizeRouteParam } from '@/router/routes/helpers/fileRouteTab';
import { createChatRecentId } from '@/shared/storage';
import { useChatSessionStore } from '@/stores/chat/session';
import type { ChatTabRuntimeController } from '@/stores/chat/tab';
import { useChatTabStore } from '@/stores/chat/tab';
import { useSettingStore } from '@/stores/ui/setting';
import { useRecentStore } from '@/stores/workspace/recent';
import type { Tab } from '@/stores/workspace/tabs';
import { useTabsStore } from '@/stores/workspace/tabs';
import { asyncTo } from '@/utils/asyncTo';

/** BChat 对页面宿主暴露的组件实例。 */
type BChatInstance = InstanceType<typeof BChat>;

const route = useRoute();
/** 页面实例创建时捕获的不可变会话 ID，避免后台 KeepAlive 实例跟随全局路由变化。 */
const initialSessionId = normalizeRouteParam(route.params.sessionId) ?? null;
const router = useRouter();
const chatStore = useChatSessionStore();
const settingStore = useSettingStore();
const recentStore = useRecentStore();
const tabsStore = useTabsStore();
const runtimeStore = useChatTabStore();
const bChatRef = ref<BChatInstance>();
/** 当前组件实例拥有的稳定标签 ID，草稿晋升时原位更新。 */
const ownerTabId = ref<string>(createChatTabId(initialSessionId));
/** 等待 Runtime 空闲后晋升的草稿会话。 */
const pendingSession = ref<ChatSession>();
/** 最近记录上一次成功写入的 payload，避免重复刷新同一标题。 */
const lastRecentPayload = ref<string>('');
/** 是否已有输入框聚焦请求排入下一轮渲染，避免 mount 与 activate 重复触发。 */
let focusInputQueued = false;

// 独立聊天页接管同一会话时，侧栏回到空白草稿，避免两个 BChat 同时拥有同一会话。
if (initialSessionId && settingStore.chatSidebarActiveSessionId === initialSessionId) {
  settingStore.setChatSidebarActiveSessionId(null);
}

/** 页面注册到运行态 Store 的终止控制器。 */
const runtimeController: ChatTabRuntimeController = {
  abort: async (): Promise<void> => {
    if (!bChatRef.value) throw new Error('聊天页面尚未准备完成');
    await bChatRef.value.abortRuntime();
  }
};

runtimeStore.ensureTab(ownerTabId.value, initialSessionId ?? undefined);
runtimeStore.syncStatus(ownerTabId.value);

/**
 * 判断指定聊天标签是否处于活动路由。
 * @param tabId - 聊天标签 ID
 * @returns 是否为当前活动标签
 */
function isTabActive(tabId: string): boolean {
  const owner = tabsStore.tabs.find((tab: Tab): boolean => tab.id === tabId);
  if (owner) return route.fullPath === owner.path;

  const sessionId = runtimeStore.records[tabId]?.sessionId;
  const fallbackPath = tabId === CHAT_DRAFT_TAB_ID ? createChatPath() : createChatPath(sessionId);

  return route.path === fallbackPath;
}

/** 当前组件拥有的聊天标签是否处于活动路由。 */
const ownerActive = computed<boolean>((): boolean => isTabActive(ownerTabId.value));
/** 当前持久化会话标题。 */
const initialSessionTitle = computed<string>((): string => {
  if (!initialSessionId) return '';

  return chatStore.findSession(initialSessionId)?.title.trim() ?? '';
});

/** 标记当前活动聊天已被用户查看。 */
function markCurrentViewed(): void {
  if (ownerActive.value) runtimeStore.markViewed(ownerTabId.value);
}

/**
 * 在当前聊天页成为活动标签后聚焦底部智能输入编辑器。
 */
function focusChatInput(): void {
  if (!ownerActive.value) return;
  if (focusInputQueued) return;

  focusInputQueued = true;
  nextTick((): void => {
    focusInputQueued = false;
    if (!ownerActive.value) return;

    bChatRef.value?.focusInput();
  });
}

/** 同步当前持久化会话标题到聊天页标签。 */
function syncInitialSessionTitle(): void {
  if (!initialSessionId) return;

  const title = initialSessionTitle.value;
  if (!title) return;

  tabsStore.updateTabTitle({ id: ownerTabId.value, title });
}

/**
 * 解析当前聊天最近记录标题。
 * @param session - 已确认存在的聊天会话
 * @param title - 外部传入的标题
 * @returns 最近记录展示标题
 */
function resolveRecentTitle(session: ChatSession, title?: string): string {
  return title?.trim() || session.title.trim() || '聊天';
}

/**
 * 加载当前路由对应的持久化聊天会话。
 * @returns 已存在的聊天会话，不存在或加载失败时返回 null
 */
async function loadInitialSession(): Promise<ChatSession | null> {
  if (!initialSessionId) return null;

  const [error, session] = await asyncTo(chatStore.loadSessionById(initialSessionId));
  if (error || !session) return null;

  return session;
}

/**
 * 记录当前持久化聊天会话到最近记录。
 * @param title - 可选的最新会话标题
 */
async function recordRecentSession(title?: string): Promise<void> {
  if (!initialSessionId) return;

  const session = await loadInitialSession();
  if (!session) return;

  const resolvedTitle = resolveRecentTitle(session, title);
  const payload = [initialSessionId, resolvedTitle].join('\0');
  if (payload === lastRecentPayload.value) {
    const [touchError] = await asyncTo(recentStore.touchChatRecord(createChatRecentId(initialSessionId)));
    if (!touchError) return;

    const [addError] = await asyncTo(recentStore.addChatRecord(initialSessionId, resolvedTitle));
    if (!addError) lastRecentPayload.value = payload;
    return;
  }

  const [error] = await asyncTo(recentStore.addChatRecord(initialSessionId, resolvedTitle));
  if (!error) lastRecentPayload.value = payload;
}

/** 确保共享会话集合完成加载，并在加载后补齐当前标签标题。 */
async function ensureSharedSessions(): Promise<void> {
  const [error] = await asyncTo(chatStore.ensureSessions());
  if (!error) syncInitialSessionTitle();

  await recordRecentSession();
}

/**
 * 将唯一草稿标签原位晋升为持久化会话标签。
 * 路由失败时回滚标签和运行态归属，保留待晋升会话供下一次 idle 重试。
 */
async function promoteDraft(): Promise<void> {
  const session = pendingSession.value;
  if (!session || ownerTabId.value !== CHAT_DRAFT_TAB_ID || runtimeStore.isClosing(ownerTabId.value)) return;

  const sourceTab = findChatTab(tabsStore.tabs);
  if (!sourceTab) return;

  const targetTabId = createChatTabId(session.id);
  const targetPath = createChatPath(session.id);
  const targetTab: Tab = {
    id: targetTabId,
    path: targetPath,
    title: session.title,
    cacheKey: targetTabId,
    recentKey: createChatRecentId(session.id),
    icon: sourceTab.icon ?? 'lucide:message-circle'
  };
  const wasActive = isTabActive(CHAT_DRAFT_TAB_ID);
  // 活动草稿在导航完成前保留原路径，使 HeaderTabs 始终能识别并安全关闭当前标签。
  const replacementTab = wasActive ? { ...targetTab, path: sourceTab.path } : targetTab;
  runtimeStore.markPromoting([targetTabId]);
  if (!tabsStore.replaceTab({ sourceId: CHAT_DRAFT_TAB_ID, tab: replacementTab })) {
    runtimeStore.clearPromoting([targetTabId]);
    return;
  }

  runtimeStore.promoteTab(CHAT_DRAFT_TAB_ID, targetTabId, session.id);
  ownerTabId.value = targetTabId;

  if (wasActive) {
    const [navigationError, navigationResult] = await asyncTo(router.replace(targetPath));
    if (navigationError || isBlockingNavigationFailure(navigationResult)) {
      tabsStore.replaceTab({ sourceId: targetTabId, tab: sourceTab });
      runtimeStore.promoteTab(targetTabId, CHAT_DRAFT_TAB_ID, session.id);
      ownerTabId.value = CHAT_DRAFT_TAB_ID;
      runtimeStore.clearPromoting([targetTabId]);
      return;
    }

    // 测试替身或无 afterEach 的宿主也需要在导航成功后提交最终路径。
    tabsStore.addTab(targetTab, { preserveTitle: true });
  }

  pendingSession.value = undefined;
  runtimeStore.clearPromoting([targetTabId]);
}

/**
 * 处理 BChat 创建的会话。
 * 草稿页先绑定归属并等待 idle，持久化页面则把分支打开为新标签。
 * @param session - 新建或分支会话
 */
async function handleSessionCreated(session: ChatSession): Promise<void> {
  if (ownerTabId.value === CHAT_DRAFT_TAB_ID) {
    pendingSession.value = session;
    runtimeStore.bindSession(CHAT_DRAFT_TAB_ID, session.id);
    return;
  }

  await asyncTo(router.push(createChatPath(session.id)));
}

/**
 * 同步自动命名后的标签标题。
 * @param sessionId - 已更新会话 ID
 * @param title - 最新标题
 */
function handleTitlePersisted(sessionId: string, title: string): void {
  const owner = runtimeStore.findOwner(sessionId);
  const targetTabId = owner?.tabId ?? createChatTabId(sessionId);
  tabsStore.updateTabTitle({ id: targetTabId, title });
  if (pendingSession.value?.id === sessionId) pendingSession.value.title = title;
  if (sessionId === initialSessionId) asyncTo(recordRecentSession(title));
}

/** 打开或复用唯一空白聊天标签。 */
async function openDraftSession(): Promise<void> {
  if (ownerTabId.value === CHAT_DRAFT_TAB_ID && ownerActive.value) {
    await asyncTo(bChatRef.value?.resetDraft() ?? Promise.resolve());
    return;
  }

  const draftTab = findChatTab(tabsStore.tabs);
  await asyncTo(router.push(draftTab?.path ?? createChatPath()));
}

/**
 * 同步 BChat 运行状态。
 * @param event - BChat 运行状态变化事件
 */
function handleRuntimeStatus(event: BChatRuntimeStatusChange): void {
  if (event.status === 'completed') {
    const owner = runtimeStore.findOwner(event.sessionId);
    const tabId = owner?.tabId ?? ownerTabId.value;
    runtimeStore.markCompleted(tabId, isTabActive(tabId));
    return;
  }

  const tabId = ownerTabId.value;
  runtimeStore.setStatus(tabId, event.status);
  if (event.status === 'idle' && !runtimeStore.isClosing(tabId)) asyncTo(promoteDraft());
}

/** 导航到模型 Provider 设置页。 */
function handleProviderNavigate(): void {
  asyncTo(router.push('/settings/provider'));
}

watch(() => route.fullPath, markCurrentViewed, { immediate: true });
watch(initialSessionTitle, syncInitialSessionTitle, { immediate: true });
watch(
  (): number | undefined => runtimeStore.records[ownerTabId.value]?.focusRequestId,
  (): void => focusChatInput()
);
watch(
  (): boolean => runtimeStore.isClosing(ownerTabId.value),
  (closing: boolean, previousClosing: boolean): void => {
    // 关闭被取消时，恢复终止回调暂缓的草稿晋升。
    if (!closing && previousClosing && runtimeStore.getStatus(ownerTabId.value) === 'idle') asyncTo(promoteDraft());
  }
);
onActivated((): void => {
  markCurrentViewed();
  syncInitialSessionTitle();
  asyncTo(recordRecentSession());
  focusChatInput();
});

onMounted((): void => {
  runtimeStore.registerController(ownerTabId.value, runtimeController);
  asyncTo(ensureSharedSessions());
  focusChatInput();
});

onUnmounted((): void => {
  runtimeStore.unregisterController(ownerTabId.value, runtimeController);
});
</script>

<style scoped lang="less">
.chat-page {
  display: flex;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: var(--bg-primary);
  border: 1px solid var(--border-primary);
  border-radius: 8px;
}

.chat-container {
  height: 100%;
}
</style>
