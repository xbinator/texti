import type { AppRouteRecordRaw } from '../../type';
import { loadSavedData } from '@/stores/tabs';

const routes: AppRouteRecordRaw[] = [
  {
    path: '',
    name: 'RootRedirect',
    redirect: () => {
      const { tabs, activeId } = loadSavedData();

      return (tabs.find((t) => t.id === activeId) ?? tabs[0])?.path ?? '/editor';
    }
  },
  {
    path: 'editor/:id?',
    name: 'Editor',
    component: () => import('@/views/editor/index.vue'),
    meta: {
      title: '编辑器'
    }
  }
];

export default routes;
