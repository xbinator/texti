/**
 * @file widget.ts
 * @description 定义文件化Widget工具页面路由。
 */

import type { AppRouteRecordRaw } from '../../type';
import { customAlphabet } from 'nanoid';
import { createFileRouteTabMeta } from '../helpers/fileRouteTab';

const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz_', 8);

const routes: AppRouteRecordRaw[] = [
  {
    path: 'widget/:id?',
    name: 'widget',
    component: () => import('@/views/widget/index.vue'),
    meta: {
      hideTab: true,
      tab: {
        ...createFileRouteTabMeta('widget'),
        icon: 'lucide:blocks'
      }
    },
    beforeEnter: (to) => {
      if (!to.params.id) {
        return { name: 'widget', params: { id: nanoid() }, replace: true };
      }
    }
  }
];

export default routes;
