import type { AppRouteRecordRaw } from '../type';

const routes: AppRouteRecordRaw[] = [
  {
    path: '/',
    name: 'Editor',
    component: () => import('@/views/editor/index.vue'),
    meta: {
      title: '编辑器'
    }
  }
];

export default routes;
