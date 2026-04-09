import type { App } from 'vue';
import type { RouteRecordRaw } from 'vue-router';
import { createRouter, createWebHistory } from 'vue-router';
import { native } from '@/shared/platform';
import { basicRoutes } from './routes';

const router = createRouter({
  history: createWebHistory(),
  routes: basicRoutes as RouteRecordRaw[],
  strict: true,
  scrollBehavior: (to, from, saved) => (to.name !== from.name ? saved || { left: 0, top: 0 } : undefined)
});

router.afterEach((to) => {
  const title = to.meta?.title as string | undefined;
  if (title) {
    native.setWindowTitle(title);
  }
});

export function setupRouter(app: App<Element>): void {
  app.use(router);
}

export default router;
