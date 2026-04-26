/**
 * @file cache.ts
 * @description 解析路由对应的标签页 ID 与 KeepAlive 缓存 key。
 */

import type { RouteLocationNormalizedLoaded } from 'vue-router';

/**
 * KeepAlive 包装组件名称前缀。
 */
const ROUTE_CACHE_NAME_PREFIX = 'RouteCache';

/**
 * 将路由参数值规范为单个字符串。
 * @param value - Vue Router 参数值
 * @returns 参数字符串，不存在时返回空字符串
 */
function normalizeRouteParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

/**
 * 判断是否为编辑器路由。
 * @param route - 当前路由
 * @returns 是否为编辑器页面
 */
function isEditorRoute(route: RouteLocationNormalizedLoaded): boolean {
  return route.name === 'editor' || route.path.startsWith('/editor/');
}

/**
 * 判断是否为设置路由。
 * @param route - 当前路由
 * @returns 是否为设置页或其子页面
 */
function isSettingsRoute(route: RouteLocationNormalizedLoaded): boolean {
  return route.path === '/settings' || route.path.startsWith('/settings/');
}

/**
 * 解析路由对应的标签页 ID 和 KeepAlive 缓存 key。
 * @param route - 当前路由
 * @returns 包含 tabId 和 cacheKey 的对象
 */
export function resolveRouteTabInfo(route: RouteLocationNormalizedLoaded): { tabId: string; cacheKey: string } {
  if (isEditorRoute(route)) {
    const editorId = normalizeRouteParam(route.params.id);
    const fallback = route.fullPath || route.path;

    return {
      tabId: editorId || fallback,
      cacheKey: editorId ? `editor:${editorId}` : fallback
    };
  }

  if (isSettingsRoute(route)) {
    return { tabId: 'settings', cacheKey: 'settings' };
  }

  const fallback = route.fullPath || route.path;

  return { tabId: fallback, cacheKey: fallback };
}

/**
 * 计算字符串的稳定短哈希，降低规范化名称冲突概率。
 * @param value - 原始字符串
 * @returns base36 哈希值
 */
function hashString(value: string): string {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash.toString(36);
}

/**
 * 解析缓存 key 对应的 KeepAlive 包装组件名称。
 * Vue KeepAlive 的 include 使用组件 name 过滤，组件名称用于把业务 cacheKey 映射到 Vue 可裁剪的缓存条目。
 * @param cacheKey - 标签页缓存 key
 * @returns 稳定的组件名称
 */
export function resolveRouteCacheName(cacheKey: string): string {
  const normalized = encodeURIComponent(cacheKey)
    .replace(/%/g, '_')
    .replace(/[^A-Za-z0-9_]/g, '_');

  return `${ROUTE_CACHE_NAME_PREFIX}_${normalized}_${hashString(cacheKey)}`;
}
