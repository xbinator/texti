/**
 * @file index.ts
 * @description 创建应用路由实例并同步路由标题与标签页状态。
 */

import type { App } from 'vue';
import type { RouteRecordRaw } from 'vue-router';
import { createRouter, createWebHashHistory } from 'vue-router';
import { resolveRouteTabInfo } from '@/router/cache';
import { useTabsStore } from '@/stores/workspace/tabs';
import { basicRoutes } from './routes';

// Electron 生产环境通过 file:// 加载 index.html，Hash History 可避免路由路径被当成本地文件解析。
const router = createRouter({
  history: createWebHashHistory(),
  routes: basicRoutes as RouteRecordRaw[],
  strict: true,
  scrollBehavior: (to, from, saved) => (to.name !== from.name ? saved || { left: 0, top: 0 } : undefined)
});

/**
 * 路由后置守卫
 * 根据路由元信息设置窗口标题
 */
router.afterEach((to, _from, failure): void => {
  // 失败导航不会成为当前页面，因此不能同步为顶部标签。
  if (failure) return;

  // 路由拦截添加 Tab
  const tabsStore = useTabsStore();
  if (!to.meta?.hideTab) {
    const { tabId, cacheKey, title, icon } = resolveRouteTabInfo(to);

    tabsStore.addTab({ id: tabId, path: to.fullPath, title, cacheKey, icon }, { preserveTitle: true });
  }
  tabsStore.setActivePath(to.fullPath);
});

export function setupRouter(app: App<Element>): void {
  app.use(router);
}

export default router;
