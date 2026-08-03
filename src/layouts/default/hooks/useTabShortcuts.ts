/**
 * @file useTabShortcuts.ts
 * @description 默认布局标签页快捷键，负责关闭当前标签与循环切换标签。
 */
import { onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { EditorShortcuts } from '@/constants/shortcuts';
import { useShortcuts } from '@/hooks/useShortcuts';
import { useTabCloseGuard } from '@/layouts/default/hooks/useTabCloseGuard';
import { isBlockingNavigationFailure } from '@/router/navigation';
import type { Tab } from '@/stores/workspace/tabs';
import { useTabsStore } from '@/stores/workspace/tabs';
import { asyncTo } from '@/utils/asyncTo';
import { emitter } from '@/utils/emitter';

/** 关闭最后一个标签后回退的欢迎页路径。 */
const WELCOME_ROUTE_PATH = '/welcome';

/**
 * 读取当前路由对应的标签 ID。
 * @param tabs - 当前标签列表
 * @param activePath - 当前路由完整路径
 * @returns 当前激活标签 ID，未命中时返回 null
 */
function getActiveTabId(tabs: Tab[], activePath: string): string | null {
  return tabs.find((tab: Tab): boolean => tab.path === activePath)?.id ?? null;
}

/**
 * 读取下一个应激活的标签。
 * @param tabs - 当前标签列表
 * @param activePath - 当前路由完整路径
 * @returns 下一个标签；无标签时返回 null
 */
function getNextTab(tabs: Tab[], activePath: string): Tab | null {
  if (tabs.length === 0) {
    return null;
  }

  const activeIndex = tabs.findIndex((tab: Tab): boolean => tab.path === activePath);
  const nextIndex = activeIndex === -1 ? 0 : (activeIndex + 1) % tabs.length;

  return tabs[nextIndex] ?? null;
}

/**
 * 让标签页快捷键始终接管浏览器默认行为。
 * @returns 是否允许处理快捷键
 */
function shouldHandleTabShortcut(): boolean {
  return true;
}

/**
 * 默认布局标签页快捷键。
 */
export function useTabShortcuts(): void {
  const route = useRoute();
  const router = useRouter();
  const tabsStore = useTabsStore();
  const { registerShortcuts } = useShortcuts();
  const { canClose, cleanupClosedTabs, cancelClose } = useTabCloseGuard();

  /**
   * 关闭当前路由对应的标签页。
   */
  async function closeActiveTab(): Promise<void> {
    const activeTabId = getActiveTabId(tabsStore.tabs, route.fullPath);
    if (!activeTabId) return;

    const plan = tabsStore.getClosePlan('close', {
      anchorTabId: activeTabId,
      activeTabId,
      allowCloseLastTab: true
    });

    const [closeError, closeAllowed] = await asyncTo(canClose(plan));
    if (closeError || !closeAllowed) return;

    if (plan.requiresNavigation) {
      const [navigationError, navigationResult] = await asyncTo(router.push(plan.nextActivePath ?? WELCOME_ROUTE_PATH));
      if (navigationError || isBlockingNavigationFailure(navigationResult)) {
        cancelClose(plan.targetTabIds);
        return;
      }
    }

    tabsStore.applyClosePlan(plan);
    cleanupClosedTabs(plan.targetTabIds);
  }

  /**
   * 切换到下一个标签页，末尾循环回第一个。
   */
  async function switchNextTab(): Promise<void> {
    const nextTab = getNextTab(tabsStore.tabs, route.fullPath);
    if (!nextTab || nextTab.path === route.fullPath) return;

    await asyncTo(router.push(nextTab.path));
  }

  /**
   * 安全执行异步标签快捷键动作。
   * @param action - 异步标签动作
   * @param warning - 失败时输出的调试提示
   */
  function runShortcutAction(action: Promise<void>, warning: string): void {
    asyncTo(action).then(([error]): void => {
      if (error) {
        console.warn(warning, error);
      }
    });
  }

  /**
   * 处理关闭当前标签快捷键。
   */
  function handleCloseShortcut(): void {
    runShortcutAction(closeActiveTab(), 'Close active tab shortcut failed');
  }

  /**
   * 处理切换到下一个标签快捷键。
   */
  function handleNextShortcut(): void {
    runShortcutAction(switchNextTab(), 'Switch next tab shortcut failed');
  }

  const unregisterShortcuts = registerShortcuts([
    {
      key: EditorShortcuts.TAB_CLOSE,
      handler: handleCloseShortcut,
      guard: shouldHandleTabShortcut
    },
    {
      key: EditorShortcuts.TAB_NEXT,
      handler: handleNextShortcut,
      guard: shouldHandleTabShortcut
    }
  ]);
  const unregisterMenuClose = emitter.on('tab:close', handleCloseShortcut);

  onUnmounted((): void => {
    unregisterShortcuts();
    unregisterMenuClose();
  });
}
