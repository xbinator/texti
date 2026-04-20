import type { App } from 'vue';
import type { RouteRecordRaw } from 'vue-router';
import { createRouter, createWebHistory } from 'vue-router';
import { resolveRouteCacheKey, resolveRouteTabId } from '@/router/cache';
import { useSettingStore } from '@/stores/setting';
import { useTabsStore } from '@/stores/tabs';
import { basicRoutes } from './routes';

const router = createRouter({
  history: createWebHistory(),
  routes: basicRoutes as RouteRecordRaw[],
  strict: true,
  scrollBehavior: (to, from, saved) => (to.name !== from.name ? saved || { left: 0, top: 0 } : undefined)
});

/**
 * 路由后置守卫
 * 根据路由元信息设置窗口标题
 */
router.afterEach((to) => {
  const title = to.meta?.title as string | undefined;
  if (title) {
    const settingStore = useSettingStore();
    settingStore.setWindowTitle(title);
  }

  // 路由拦截添加 Tab
  if (!to.meta?.hideTab) {
    const tabsStore = useTabsStore();
    const tabId = resolveRouteTabId(to);

    tabsStore.addTab({ id: tabId, path: to.fullPath, title: title || (to.name as string) || to.path, cacheKey: resolveRouteCacheKey(to) });
  }
});

export function setupRouter(app: App<Element>): void {
  app.use(router);
}

export default router;
