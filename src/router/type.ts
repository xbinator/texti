import type { RouteRecordRaw } from 'vue-router';

export interface RouteMeta {
  title?: string;
}

export interface AppRouteRecordRaw extends Omit<RouteRecordRaw, 'meta'> {
  meta?: RouteMeta;
}
