import type { AppRouteRecordRaw } from '../type';
import type { RouteRecordRaw } from 'vue-router';
import DEFAULT_LAYOUT_COMPONENT from '@/layouts/default/index.vue';
import { useTabsStore } from '@/stores/workspace/tabs';

type RouterRowMap = Record<string, { default: AppRouteRecordRaw[] }>;

const modules: RouterRowMap = import.meta.glob('./modules/**.ts', { eager: true });

function transformRouteToVueRoutes(route: RouterRowMap): RouteRecordRaw[] {
  return Object.values(route).flatMap((module) => module.default) as RouteRecordRaw[];
}

const childRoutes = transformRouteToVueRoutes(modules);

/**
 * 解析应用根路径启动时的重定向目标。
 * @returns 最近激活页面路径，不可恢复时返回欢迎页
 */
export function resolveRootRedirectPath(): string {
  return useTabsStore().getStartupPath();
}

export const basicRoutes: RouteRecordRaw[] = [
  {
    path: '/',
    component: DEFAULT_LAYOUT_COMPONENT,
    children: childRoutes,
    redirect: resolveRootRedirectPath
  }
];
