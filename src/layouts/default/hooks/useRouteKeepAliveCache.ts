/**
 * @file useRouteKeepAliveCache.ts
 * @description 为默认布局提供按路由缓存 key 命名的 KeepAlive 包装组件。
 */

import type { Component as VueComponent, PropType } from 'vue';
import { defineComponent, h } from 'vue';
import type { RouteLocationNormalizedLoaded } from 'vue-router';
import { resolveRouteCacheName, resolveRouteTabInfo } from '@/router/cache';

/**
 * 路由 KeepAlive 缓存工具。
 */
export interface RouteKeepAliveCache {
  /**
   * 获取路由对应的 KeepAlive 缓存 key。
   * @param route - 当前路由
   * @returns 缓存 key
   */
  getRouteCacheKey(route: RouteLocationNormalizedLoaded): string;
  /**
   * 获取路由对应的具名包装组件。
   * @param route - 当前路由
   * @returns 包装组件
   */
  getRouteCacheComponent(route: RouteLocationNormalizedLoaded): VueComponent;
}

/**
 * 创建单个路由缓存包装组件。
 * @param cacheName - KeepAlive include 使用的组件名称
 * @returns 包装组件
 */
function createRouteCacheComponent(cacheName: string): VueComponent {
  return defineComponent({
    name: cacheName,
    props: {
      routeComponent: {
        type: [Object, Function] as unknown as PropType<VueComponent>,
        required: true
      }
    },
    /**
     * 渲染 RouterView 提供的真实页面组件。
     * @param props - 包装组件属性
     * @returns 渲染函数
     */
    setup(props) {
      return () => h(props.routeComponent);
    }
  });
}

/**
 * 使用路由 KeepAlive 缓存工具。
 * @returns 路由缓存工具
 */
export function useRouteKeepAliveCache(): RouteKeepAliveCache {
  const routeCacheComponents = new Map<string, VueComponent>();

  /**
   * 获取当前路由对应的 KeepAlive 包装组件。
   * @param route - 当前路由
   * @returns 具备稳定名称的包装组件
   */
  function getRouteCacheComponent(route: RouteLocationNormalizedLoaded): VueComponent {
    const cacheName = resolveRouteCacheName(resolveRouteTabInfo(route).cacheKey);
    const cachedComponent = routeCacheComponents.get(cacheName);
    if (cachedComponent) {
      return cachedComponent;
    }

    const routeCacheComponent = createRouteCacheComponent(cacheName);

    routeCacheComponents.set(cacheName, routeCacheComponent);

    return routeCacheComponent;
  }

  return {
    getRouteCacheKey: (route: RouteLocationNormalizedLoaded) => resolveRouteTabInfo(route).cacheKey,
    getRouteCacheComponent
  };
}
