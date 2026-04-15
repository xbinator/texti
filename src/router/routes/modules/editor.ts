import type { AppRouteRecordRaw } from '../../type';
import { customAlphabet } from 'nanoid';

const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz_', 8);

const routes: AppRouteRecordRaw[] = [
  {
    path: 'editor/:id?',
    name: 'editor',
    component: () => import('@/views/editor/index.vue'),
    meta: { hideTab: true },
    beforeEnter: (to) => {
      if (!to.params.id) {
        return { name: 'editor', params: { id: nanoid() }, replace: true };
      }
    }
  }
];

export default routes;
