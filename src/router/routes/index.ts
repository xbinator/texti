import type { AppRouteRecordRaw } from '../type';
import type { RouteRecordRaw } from 'vue-router';
import DEFAULT_LAYOUT_COMPONENT from '@/layouts/default/index.vue';

type RouterRowMap = Record<string, { default: AppRouteRecordRaw[] }>;

const modules: RouterRowMap = import.meta.glob('./modules/**.ts', { eager: true });

function transformRouteToVueRoutes(route: RouterRowMap): RouteRecordRaw[] {
  return Object.values(route).flatMap((module) => module.default) as RouteRecordRaw[];
}

const childRoutes = transformRouteToVueRoutes(modules);

export const basicRoutes: RouteRecordRaw[] = [
  {
    path: '/',
    component: DEFAULT_LAYOUT_COMPONENT,
    children: childRoutes
  }
];
