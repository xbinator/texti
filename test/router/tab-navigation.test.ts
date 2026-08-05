/**
 * @file tab-navigation.test.ts
 * @description 路由导航结果与顶部标签同步边界测试。
 * @vitest-environment jsdom
 */
import type { RouteLocationNormalized } from 'vue-router';
import { isNavigationFailure } from 'vue-router';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import router from '@/router';
import { resolveRootRedirectPath } from '@/router/routes';
import { local } from '@/shared/storage/base';
import type { TabsState } from '@/stores/workspace/tabs';
import { useTabsStore } from '@/stores/workspace/tabs';

describe('route tab synchronization', (): void => {
  beforeEach(async (): Promise<void> => {
    localStorage.clear();
    setActivePinia(createPinia());
    await router.push('/welcome');
    const tabsStore = useTabsStore();
    tabsStore.tabs = [];
    tabsStore.cachedKeys = [];
  });

  it('does not create a target tab when navigation is aborted', async (): Promise<void> => {
    const removeGuard = router.beforeEach((to: RouteLocationNormalized): boolean => to.path !== '/chat/session-a');

    const result = await router.push('/chat/session-a');
    removeGuard();

    expect(isNavigationFailure(result)).toBe(true);
    expect(router.currentRoute.value.path).toBe('/welcome');
    expect(useTabsStore().tabs).toEqual([]);
  });

  it('records the active route after a successful navigation', async (): Promise<void> => {
    await router.push('/chat/session-a');

    expect(useTabsStore().activePath).toBe('/chat/session-a');
  });

  it('redirects the root route to the persisted active tab path on startup', (): void => {
    local.setItem<TabsState>('app_tabs', {
      tabs: [
        {
          id: 'chat:session-a',
          path: '/chat/session-a',
          title: '会话 A',
          cacheKey: 'chat:session-a'
        }
      ],
      dirtyById: {},
      missingById: {},
      cachedKeys: [],
      activePath: '/chat/session-a'
    });
    setActivePinia(createPinia());

    expect(resolveRootRedirectPath()).toBe('/chat/session-a');
  });

  it('falls back to welcome when the persisted active path is unavailable', (): void => {
    local.setItem<TabsState>('app_tabs', {
      tabs: [
        {
          id: 'chat:session-a',
          path: '/chat/session-a',
          title: '会话 A',
          cacheKey: 'chat:session-a'
        }
      ],
      dirtyById: {},
      missingById: {},
      cachedKeys: [],
      activePath: '/chat/missing'
    });
    setActivePinia(createPinia());

    expect(resolveRootRedirectPath()).toBe('/welcome');
  });
});
