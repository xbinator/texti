import { createRouter, createWebHistory } from 'vue-router';
import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'Editor',
    component: () => import('../views/editor/index.vue')
  },
  {
    path: '/settings',
    name: 'Settings',
    component: () => import('../views/settings/index.vue')
  }
];

const router = createRouter({
  history: createWebHistory(),
  routes
});

export default router;
