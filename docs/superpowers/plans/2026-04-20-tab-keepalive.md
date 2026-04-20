/**
 * @file 2026-04-20-tab-keepalive.md
 * @description 多标签页 KeepAlive 缓存实现计划。
 */

# Tab KeepAlive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every visible tab preserve its page instance until that tab is closed.

**Architecture:** Add a route cache-key resolver, store cache keys in `tabsStore`, and render the default layout through `RouterView` plus `KeepAlive`. Editor activation resources move to activated/deactivated lifecycle hooks so cached editor instances do not compete while inactive.

**Tech Stack:** Vue 3, Vue Router, Pinia, TypeScript, Vitest.

---

### Task 1: Route Cache Key Resolver

**Files:**
- Create: `src/router/cache.ts`
- Test: `test/router/cache.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import type { RouteLocationNormalizedLoaded } from 'vue-router';
import { describe, expect, it } from 'vitest';
import { resolveRouteCacheKey, resolveRouteTabId } from '@/router/cache';

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
});
```

- [ ] **Step 2: Run route cache tests and verify failure**

Run: `pnpm test test/router/cache.test.ts`

Expected: FAIL because `src/router/cache.ts` does not exist.

- [ ] **Step 3: Implement route cache helper**

Create `src/router/cache.ts` with documented exported functions:

```typescript
/**
 * @file cache.ts
 * @description 解析路由对应的标签页 ID 与 KeepAlive 缓存 key。
 */

import type { RouteLocationNormalizedLoaded } from 'vue-router';

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
 * 解析当前路由对应的标签页 ID。
 * @param route - 当前路由
 * @returns 标签页 ID
 */
export function resolveRouteTabId(route: RouteLocationNormalizedLoaded): string {
  if (isEditorRoute(route)) {
    return normalizeRouteParam(route.params.id);
  }

  if (isSettingsRoute(route)) {
    return 'settings';
  }

  return route.fullPath || route.path;
}

/**
 * 解析当前路由对应的 KeepAlive 缓存 key。
 * @param route - 当前路由
 * @returns 缓存 key
 */
export function resolveRouteCacheKey(route: RouteLocationNormalizedLoaded): string {
  if (isEditorRoute(route)) {
    const editorId = normalizeRouteParam(route.params.id);
    return editorId ? `editor:${editorId}` : route.fullPath || route.path;
  }

  if (isSettingsRoute(route)) {
    return 'settings';
  }

  return route.fullPath || route.path;
}
```

- [ ] **Step 4: Run route cache tests and verify pass**

Run: `pnpm test test/router/cache.test.ts`

Expected: PASS.

### Task 2: Tabs Store Cache Lifecycle

**Files:**
- Modify: `src/stores/tabs.ts`
- Test: `test/stores/tabs.test.ts`

- [ ] **Step 1: Add failing store tests**

Add tests that prove adding tabs records cache keys, closing tabs removes them, and saved data without cache keys migrates safely.

- [ ] **Step 2: Run store tests and verify failure**

Run: `pnpm test test/stores/tabs.test.ts`

Expected: FAIL because cache state and methods are missing.

- [ ] **Step 3: Implement cache state**

Add `cacheKey` to `Tab`, `cachedKeys` to `TabsState`, register cache keys in `addTab`, and remove cache keys in `removeTab`.

- [ ] **Step 4: Run store tests and verify pass**

Run: `pnpm test test/stores/tabs.test.ts`

Expected: PASS.

### Task 3: Layout KeepAlive Rendering

**Files:**
- Modify: `src/layouts/default/index.vue`

- [ ] **Step 1: Replace raw RouterView**

Render `RouterView` through its slot, wrap the dynamic component in `KeepAlive`, and bind `:key` to `resolveRouteCacheKey(route)`.

- [ ] **Step 2: Keep cache list tab-owned**

Use `tabsStore.cachedComponentNames` as the KeepAlive include list and import `useTabsStore`.

- [ ] **Step 3: Run type check**

Run: `pnpm build`

Expected: PASS.

### Task 4: Router And Editor Integration

**Files:**
- Modify: `src/router/index.ts`
- Modify: `src/views/editor/hooks/useSession.ts`
- Modify: `src/views/editor/index.vue`

- [ ] **Step 1: Use cache helper in router guard**

Use `resolveRouteTabId` and `resolveRouteCacheKey` when adding non-hidden route tabs.

- [ ] **Step 2: Use cache helper in editor session**

Pass the editor cache key when adding editor tabs.

- [ ] **Step 3: Move active editor resources to activation lifecycle**

Register editor tool context and file watcher on activation, release them on deactivation and unmount.

- [ ] **Step 4: Run focused tests and build**

Run: `pnpm test test/router/cache.test.ts test/stores/tabs.test.ts`

Expected: PASS.

Run: `pnpm build`

Expected: PASS.

### Task 5: Changelog

**Files:**
- Modify: `changelog/2026-04-20.md`

- [ ] **Step 1: Record implementation**

Add a `Changed` entry describing tab-owned KeepAlive cache support.
