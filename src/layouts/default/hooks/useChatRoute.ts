/**
 * @file useChatRoute.ts
 * @description 协调 ChatSider 会话切换、聊天页跳转与删除后的标签同步。
 */
import { useRoute, useRouter } from 'vue-router';
import { isBlockingNavigationFailure } from '@/router/navigation';
import { createChatPath, createChatTabId, findChatTab } from '@/router/routes/helpers/chatRouteTab';
import { createChatRecentId } from '@/shared/storage';
import { useChatTabStore } from '@/stores/chat/tab';
import { useSettingStore } from '@/stores/ui/setting';
import { useRecentStore } from '@/stores/workspace/recent';
import type { Tab } from '@/stores/workspace/tabs';
import { useTabsStore } from '@/stores/workspace/tabs';
import { asyncTo } from '@/utils/asyncTo';

/**
 * 标准聊天页路由目标。
 */
export interface ChatRouteTarget {
  /** 目标标签 ID。 */
  tabId: string;
  /** 目标应导航到的路径。 */
  path: string;
  /** 当前真实会话 ID。 */
  sessionId?: string;
}

/**
 * ChatSider 会话路由依赖项。
 */
interface UseChatRouteOptions {
  /** 侧栏进入草稿会话。 */
  openDraftSession: () => Promise<void>;
  /** 切换侧栏当前会话。 */
  switchSession: (sessionId: string) => Promise<void>;
  /** 同步会话删除后的侧栏状态。 */
  syncDeletedSession: (sessionId: string) => void;
}

/**
 * 聊天会话路由 API。
 */
interface ChatRouteApi {
  /** 查找草稿或持久化会话路由目标。 */
  resolveRoute: (sessionId?: string | null) => ChatRouteTarget | undefined;
  /** 打开当前侧栏会话对应的聊天页。 */
  openChatPage: () => Promise<void>;
  /** 路由优先的会话切换。 */
  handleSwitchSession: (sessionId: string) => Promise<void>;
  /** 同步成功删除后的侧栏状态，并关闭对应顶部聊天标签。 */
  handleDeletedSession: (sessionId: string) => Promise<void>;
}

/**
 * 创建标准聊天路由目标。
 * @param tabId - 目标标签 ID
 * @param path - 目标导航路径
 * @param sessionId - 可选真实会话 ID
 * @returns 标准聊天路由目标
 */
function createRouteTarget(tabId: string, path: string, sessionId?: string | null): ChatRouteTarget {
  return {
    tabId,
    path,
    ...(sessionId ? { sessionId } : {})
  };
}

/**
 * 提供统一的聊天会话路由协调。
 * @param options - hook 依赖项
 * @returns 聊天路由 API
 */
export function useChatRoute(options: UseChatRouteOptions): ChatRouteApi {
  const route = useRoute();
  const router = useRouter();
  const settingStore = useSettingStore();
  const tabsStore = useTabsStore();
  const runtimeStore = useChatTabStore();
  const recentStore = useRecentStore();

  /**
   * 查找草稿或持久化会话路由目标。
   * @param sessionId - 会话 ID；空值表示唯一草稿
   * @returns 标准聊天路由目标，不存在时返回 undefined
   */
  function resolveRoute(sessionId?: string | null): ChatRouteTarget | undefined {
    const runtimeOwner = sessionId ? runtimeStore.findOwner(sessionId) : undefined;
    if (runtimeOwner) {
      const ownerTab = tabsStore.tabs.find((tab: Tab): boolean => tab.id === runtimeOwner.tabId);
      if (ownerTab) return createRouteTarget(runtimeOwner.tabId, ownerTab.path, runtimeOwner.sessionId);
    }

    const ownerTab = findChatTab(tabsStore.tabs, sessionId);
    return ownerTab ? createRouteTarget(ownerTab.id, ownerTab.path, sessionId) : undefined;
  }

  /**
   * 打开当前侧栏会话对应的聊天页，成功后侧栏进入草稿态。
   */
  async function openChatPage(): Promise<void> {
    const sessionId = settingStore.chatSidebarActiveSessionId;
    const target = resolveRoute(sessionId);
    const [navigationError, navigationResult] = await asyncTo(router.push(target?.path ?? createChatPath(sessionId)));
    if (navigationError || isBlockingNavigationFailure(navigationResult)) return;

    runtimeStore.requestFocus(target?.tabId ?? createChatTabId(sessionId));
    await options.openDraftSession();
  }

  /**
   * 优先打开已拥有目标会话的聊天页；未被页面拥有时切换侧栏会话。
   * @param sessionId - 目标会话 ID
   */
  async function handleSwitchSession(sessionId: string): Promise<void> {
    const target = resolveRoute(sessionId);
    if (target) {
      const [navigationError, navigationResult] = await asyncTo(router.push(target.path));
      if (!navigationError && !isBlockingNavigationFailure(navigationResult)) runtimeStore.requestFocus(target.tabId);
      return;
    }

    await options.switchSession(sessionId);
  }

  /**
   * 同步成功删除后的侧栏状态，并关闭对应顶部聊天标签。
   * @param sessionId - 已删除会话 ID
   */
  async function handleDeletedSession(sessionId: string): Promise<void> {
    const runtimeOwner = runtimeStore.findOwner(sessionId);
    const target = resolveRoute(sessionId);
    await asyncTo(recentStore.removeFile(createChatRecentId(sessionId)));
    options.syncDeletedSession(sessionId);
    if (!target) {
      if (runtimeOwner) runtimeStore.removeTab(runtimeOwner.tabId);
      return;
    }

    const plan = tabsStore.getClosePlan('close', {
      anchorTabId: target.tabId,
      activeTabId: target.path === route.fullPath ? target.tabId : null,
      allowCloseLastTab: true
    });

    if (plan.requiresNavigation) {
      await asyncTo(router.push(plan.nextActivePath ?? '/welcome'));
    }

    tabsStore.applyClosePlan(plan);
    runtimeStore.removeTab(target.tabId);
    if (runtimeOwner && runtimeOwner.tabId !== target.tabId) runtimeStore.removeTab(runtimeOwner.tabId);
  }

  return {
    resolveRoute,
    openChatPage,
    handleSwitchSession,
    handleDeletedSession
  };
}
