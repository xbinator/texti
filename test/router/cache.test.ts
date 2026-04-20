/**
 * @file cache.test.ts
 * @description 验证路由标签页 ID 与 KeepAlive 缓存 key 的解析规则。
 */

import type { RouteLocationNormalizedLoaded } from 'vue-router';
import { describe, expect, it } from 'vitest';
import { resolveRouteCacheKey, resolveRouteCacheName, resolveRouteTabId } from '@/router/cache';

/**
 * 创建测试用的路由对象。
 * @param overrides - 需要覆盖的路由字段
 * @returns 标准化后的测试路由
 */
function createRoute(overrides: Partial<RouteLocationNormalizedLoaded>): RouteLocationNormalizedLoaded {
  return {
    fullPath: '/fallback',
    path: '/fallback',
    name: undefined,
    params: {},
    query: {},
    hash: '',
    matched: [],
    meta: {},
    redirectedFrom: undefined,
    ...overrides
  } as RouteLocationNormalizedLoaded;
}

describe('route cache helpers', () => {
  it('uses editor params as the editor cache key and tab id', () => {
    const route = createRoute({ path: '/editor/file_1', fullPath: '/editor/file_1', name: 'editor', params: { id: 'file_1' } });

    expect(resolveRouteTabId(route)).toBe('file_1');
    expect(resolveRouteCacheKey(route)).toBe('editor:file_1');
  });

  it('groups settings routes into one tab and cache key', () => {
    const route = createRoute({ path: '/settings/provider/openai', fullPath: '/settings/provider/openai', name: 'provider-detail' });

    expect(resolveRouteTabId(route)).toBe('settings');
    expect(resolveRouteCacheKey(route)).toBe('settings');
  });

  it('falls back to fullPath for ordinary routes', () => {
    const route = createRoute({ path: '/welcome', fullPath: '/welcome?from=boot', name: 'welcome' });

    expect(resolveRouteTabId(route)).toBe('/welcome?from=boot');
    expect(resolveRouteCacheKey(route)).toBe('/welcome?from=boot');
  });

  it('creates stable component names from cache keys', () => {
    expect(resolveRouteCacheName('editor:file_1')).toBe(resolveRouteCacheName('editor:file_1'));
    expect(resolveRouteCacheName('editor:file_1')).not.toBe(resolveRouteCacheName('editor:file_2'));
    expect(resolveRouteCacheName('/settings/provider?tab=models')).toMatch(/^RouteCache_[A-Za-z0-9_]+$/);
  });
});
