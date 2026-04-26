import type { AppRouteRecordRaw } from '../../type';

const routes: AppRouteRecordRaw[] = [
  {
    path: '/webview',
    name: 'webview',
    component: () => import('@/views/webview/index.vue'),
    meta: { title: '网页浏览' }
  }
];

export default routes;
