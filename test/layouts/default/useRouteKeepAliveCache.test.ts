/**
 * @file useRouteKeepAliveCache.test.ts
 * @description 验证默认布局的路由 KeepAlive 包装组件缓存逻辑。
 */

import type { Component } from 'vue';
import type { RouteLocationNormalizedLoaded } from 'vue-router';
import { describe, expect, it } from 'vitest';
import { useRouteKeepAliveCache } from '@/layouts/default/hooks/useRouteKeepAliveCache';

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

/**
 * 读取 Vue 组件名称。
 * @param component - Vue 组件
 * @returns 组件名称
 */
function getComponentName(component: Component): string | undefined {
  return (component as { name?: string }).name;
}

describe('useRouteKeepAliveCache', () => {
  it('reuses wrapper components for the same route cache key', () => {
    const { getRouteCacheComponent } = useRouteKeepAliveCache();
    const route = createRoute({ path: '/editor/file_1', fullPath: '/editor/file_1', name: 'editor', params: { id: 'file_1' } });

    expect(getRouteCacheComponent(route)).toBe(getRouteCacheComponent(route));
  });

  it('creates different wrapper component names for different route cache keys', () => {
    const { getRouteCacheComponent } = useRouteKeepAliveCache();
    const firstRoute = createRoute({ path: '/editor/file_1', fullPath: '/editor/file_1', name: 'editor', params: { id: 'file_1' } });
    const secondRoute = createRoute({ path: '/editor/file_2', fullPath: '/editor/file_2', name: 'editor', params: { id: 'file_2' } });

    expect(getComponentName(getRouteCacheComponent(firstRoute))).not.toBe(getComponentName(getRouteCacheComponent(secondRoute)));
  });
});
