/**
 * @file use-keep-alive.test.ts
 * @description 默认布局 KeepAlive 包装组件缓存淘汰测试。
 */
import type { RouteLocationNormalizedLoaded } from 'vue-router';
import { describe, expect, it, vi } from 'vitest';
import { useKeepAlive } from '@/layouts/default/hooks/useKeepAlive';

vi.mock('@/router/cache', () => ({
  resolveRouteTabInfo: (route: { fullPath: string }): { cacheKey: string } => ({ cacheKey: route.fullPath }),
  resolveRouteCacheName: (cacheKey: string): string => `route-cache:${cacheKey}`
}));

/**
 * 创建测试路由。
 * @param fullPath - 路由完整路径
 * @returns 最小路由对象
 */
function createRoute(fullPath: string): RouteLocationNormalizedLoaded {
  return { fullPath } as unknown as RouteLocationNormalizedLoaded;
}

describe('useKeepAlive', (): void => {
  it('prunes wrappers that are no longer present in the valid cache names', (): void => {
    const cache = useKeepAlive();
    const firstRoute = createRoute('/editor/first');
    const secondRoute = createRoute('/editor/second');
    const firstComponent = cache.getRouteCacheComponent(firstRoute);
    const secondComponent = cache.getRouteCacheComponent(secondRoute);

    cache.prune(['route-cache:/editor/second']);

    expect(cache.getRouteCacheComponent(firstRoute)).not.toBe(firstComponent);
    expect(cache.getRouteCacheComponent(secondRoute)).toBe(secondComponent);
  });
});
