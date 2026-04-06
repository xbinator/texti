import type { RouteRecordRaw } from 'vue-router';
import type { AppRouteRecordRaw } from '../type';

type RouterRowMap = Record<string, { default: AppRouteRecordRaw[] }>;

const modules: RouterRowMap = import.meta.glob('./modules/**.ts', { eager: true });

function transformRouteToVueRoutes(route: RouterRowMap): RouteRecordRaw[] {
  return Object.values(route).flatMap((module) => module.default) as RouteRecordRaw[];
}

export const basicRoutes: RouteRecordRaw[] = transformRouteToVueRoutes(modules);
