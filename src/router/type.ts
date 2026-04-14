import type { RouteRecordRaw } from 'vue-router';

export interface RouteMeta {
  title?: string;
  // true 表示该路由不应被添加到顶部标签页中
  hideTab?: boolean;
}

export interface AppRouteRecordRaw extends Omit<RouteRecordRaw, 'meta'> {
  meta?: RouteMeta;
}
