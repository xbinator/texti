import type { AppRouteRecordRaw } from '../../type';

const routes: AppRouteRecordRaw[] = [
  {
    path: 'settings',
    name: 'Settings',
    component: () => import('@/views/settings/index.vue'),
    redirect: '/settings/provider',
    meta: {
      title: '设置'
    },
    children: [
      {
        path: 'provider',
        name: 'provider',
        component: () => import('@/views/settings/provider/layout.vue'),
        redirect: '/settings/provider',
        children: [
          {
            path: '',
            name: 'provider-list',
            component: () => import('@/views/settings/provider/index.vue'),
            meta: {
              title: 'AI服务商'
            }
          },
          {
            path: ':provider',
            name: 'provider-detail',
            component: () => import('@/views/settings/provider/detail.vue'),
            meta: {
              title: '服务商配置'
            }
          }
        ]
      },
      {
        path: 'service-model',
        name: 'service-model',
        component: () => import('@/views/settings/service-model/index.vue'),
        meta: { title: '服务模型' }
      }
    ]
  }
];

export default routes;
