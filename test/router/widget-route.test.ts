/**
 * @file widget-route.test.ts
 * @description 验证文件化小组件页面路由注册。
 */
import type { RouteLocationNormalizedLoaded } from 'vue-router';
import { describe, expect, it } from 'vitest';
import routes from '@/router/routes/modules/widget';

/**
 * 通过路由名称查找 Widget 路由记录。
 * @param name - 路由名称
 * @returns 命中的路由记录
 */
function findWidgetRoute(name: string): (typeof routes)[number] | undefined {
  return routes.find((route): boolean => route.name === name);
}

describe('widget route', (): void => {
  it('registers a parameterized widget file route', (): void => {
    const widgetRoute = findWidgetRoute('widget');
    const route = {
      params: {
        id: 'widget-1'
      }
    } as unknown as RouteLocationNormalizedLoaded;
    const tabId = widgetRoute?.meta?.tab?.id;
    const cacheKey = widgetRoute?.meta?.tab?.cacheKey;

    expect(widgetRoute).toBeTruthy();
    expect(widgetRoute?.path).toBe('widget/:id?');
    expect(widgetRoute?.name).toBe('widget');
    expect(widgetRoute?.meta?.hideTab).toBe(true);
    expect(widgetRoute?.meta?.tab?.icon).toBe('lucide:blocks');
    expect(typeof tabId).toBe('function');
    expect(typeof cacheKey).toBe('function');
    expect(typeof tabId === 'function' ? tabId(route) : '').toBe('widget-1');
    expect(typeof cacheKey === 'function' ? cacheKey(route) : '').toBe('widget:widget-1');
  });

  it('does not register a separate widget code route', (): void => {
    const widgetCodeRoute = findWidgetRoute('widget-code');

    expect(widgetCodeRoute).toBeUndefined();
  });
});
