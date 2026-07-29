# WebView 新标签页处理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让远程页面的 `target="_blank"` 和 `window.open()` 安全地打开为 Tibis 内的新 WebView 标签页。

**Architecture:** `<webview>` 启用弹窗请求后，由主进程访客 `WebContents` 的 `setWindowOpenHandler` 捕获并拒绝原生窗口创建。合法 HTTP/HTTPS URL 通过已有 IPC 通道交给应用级 Hook，Hook 使用 Vue Router 创建应用标签页。

**Tech Stack:** Electron 41、Vue 3、Vue Router、TypeScript、Vitest

## Global Constraints

- 禁止使用 `any`，所有新增函数和类型必须有明确类型与注释。
- 异步错误处理遵循 `src/utils/asyncTo.ts`，但本功能不新增需要等待的异步流程。
- 远程页面永远不能直接创建 Electron `BrowserWindow`。
- 仅允许 HTTP/HTTPS 新窗口请求进入 Tibis 标签系统。
- 文档和 changelog 只使用仓库相对路径。

---

### Task 1: 安全转发 WebView 新窗口请求

**Files:**
- Modify: `src/views/webview/web/utils/hosting.ts`
- Modify: `electron/main/window.mts`
- Create: `src/hooks/useWebviewNewTab.ts`
- Modify: `src/App.vue`
- Modify: `test/views/webview/web-hosting.test.ts`
- Create: `test/electron/main/window-webview.test.ts`
- Create: `test/hooks/use-webview-new-tab.test.ts`
- Modify: `changelog/2026-07-29.md`

**Interfaces:**
- Consumes: `WebViewAPI.onOpenInNewTab(callback: (url: string) => void): () => void`
- Produces: `createWindowOpenHandler(send: (url: string) => void)`，始终返回 `deny` 并仅转发 HTTP/HTTPS URL
- Produces: `useWebviewNewTab(): void`，在应用作用域内注册和清理新标签页 IPC 监听

- [x] **Step 1: 为宿主元素写失败测试**

在 `test/views/webview/web-hosting.test.ts` 导入 `ensureHostedWebviewElement`，增加：

```ts
it('enables popup requests on created and reused webview elements', (): void => {
  const hostLayer = document.createElement('div');
  const firstElement = ensureHostedWebviewElement(hostLayer);

  expect(firstElement.hasAttribute('allowpopups')).toBe(true);

  firstElement.removeAttribute('allowpopups');
  const reusedElement = ensureHostedWebviewElement(hostLayer);

  expect(reusedElement).toBe(firstElement);
  expect(reusedElement.hasAttribute('allowpopups')).toBe(true);
});
```

- [x] **Step 2: 为主进程窗口处理器写失败测试**

创建 `test/electron/main/window-webview.test.ts`：

```ts
/**
 * @file window-webview.test.ts
 * @description Electron WebView 新窗口请求处理测试。
 */
import { describe, expect, it, vi } from 'vitest';
import { createWindowOpenHandler } from '../../../electron/main/window.mts';

vi.mock('electron', () => ({
  app: { isPackaged: true },
  BrowserWindow: vi.fn()
}));

vi.mock('../../../electron/main/modules/webview/ipc.mjs', () => ({
  normalizeAttachedWebviewUrl: (url: string): string => url,
  sanitizeAttachedWebPreferences: (preferences: Record<string, unknown>): Record<string, unknown> => preferences
}));

describe('webview window open handler', (): void => {
  it.each(['https://example.com/path', 'http://example.com/path'])('forwards supported URL %s and denies the native window', (url: string): void => {
    const send = vi.fn<(targetUrl: string) => void>();
    const handler = createWindowOpenHandler(send);

    expect(handler({ url })).toEqual({ action: 'deny' });
    expect(send).toHaveBeenCalledWith(url);
  });

  it.each(['javascript:alert(1)', 'file:///tmp/example.html', 'not a url'])('rejects unsupported URL %s without forwarding it', (url: string): void => {
    const send = vi.fn<(targetUrl: string) => void>();
    const handler = createWindowOpenHandler(send);

    expect(handler({ url })).toEqual({ action: 'deny' });
    expect(send).not.toHaveBeenCalled();
  });
});
```

- [x] **Step 3: 为应用级导航 Hook 写失败测试**

创建 `test/hooks/use-webview-new-tab.test.ts`：

```ts
/**
 * @file use-webview-new-tab.test.ts
 * @description WebView 新标签页应用级导航 Hook 测试。
 * @vitest-environment jsdom
 */
import { defineComponent } from 'vue';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWebviewNewTab } from '@/hooks/useWebviewNewTab';

const electronAvailable = vi.hoisted(() => ({ value: true }));
const unregisterMock = vi.hoisted(() => vi.fn<() => void>());
const onOpenInNewTabMock = vi.hoisted(() =>
  vi.fn<(callback: (url: string) => void) => () => void>(() => unregisterMock)
);
const routerPushMock = vi.hoisted(() => vi.fn());

vi.mock('@/shared/platform/electron-api', () => ({
  hasElectronAPI: (): boolean => electronAvailable.value,
  getElectronAPI: () => ({
    webview: {
      onOpenInNewTab: onOpenInNewTabMock
    }
  })
}));

vi.mock('vue-router', () => ({
  useRouter: () => ({
    push: routerPushMock
  })
}));

/** WebView 新标签页 Hook 测试宿主。 */
const TestHost = defineComponent({
  name: 'TestHost',
  setup() {
    useWebviewNewTab();
    return () => null;
  }
});

describe('useWebviewNewTab', (): void => {
  beforeEach((): void => {
    electronAvailable.value = true;
    unregisterMock.mockClear();
    onOpenInNewTabMock.mockClear();
    routerPushMock.mockClear();
  });

  it('opens forwarded URLs as application WebView tabs and unregisters on dispose', (): void => {
    const wrapper = mount(TestHost);
    const callback = onOpenInNewTabMock.mock.calls[0]?.[0];
    const targetUrl = 'https://example.com/path?query=value';

    expect(callback).toBeDefined();
    callback?.(targetUrl);
    expect(routerPushMock).toHaveBeenCalledWith({
      name: 'webview-web',
      query: { url: encodeURIComponent(targetUrl) }
    });

    wrapper.unmount();
    expect(unregisterMock).toHaveBeenCalledTimes(1);
  });

  it('does not register outside Electron', (): void => {
    electronAvailable.value = false;

    const wrapper = mount(TestHost);

    expect(onOpenInNewTabMock).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
```

- [x] **Step 4: 运行测试并确认 RED**

Run:

```bash
pnpm exec vitest run test/views/webview/web-hosting.test.ts test/electron/main/window-webview.test.ts test/hooks/use-webview-new-tab.test.ts
```

Expected: FAIL，原因分别是宿主元素缺少 `allowpopups`、`createWindowOpenHandler` 不存在、`useWebviewNewTab` 不存在。

- [x] **Step 5: 配置 `<webview>` 弹窗请求**

将 `hosting.ts` 的元素样式函数改为统一配置函数：

```ts
/**
 * 配置真实 `<webview>` 的基础属性与布局样式。
 * @param webviewElement - 真实 `<webview>` 节点
 */
function configureHostedWebviewElement(webviewElement: HTMLElement): void {
  webviewElement.setAttribute('allowpopups', '');
  webviewElement.style.display = 'flex';
  webviewElement.style.flex = '1 1 auto';
  webviewElement.style.width = '100%';
  webviewElement.style.height = '100%';
  webviewElement.style.minWidth = '0';
  webviewElement.style.minHeight = '0';
  webviewElement.style.border = '0';
  webviewElement.style.borderRadius = `${WEBVIEW_BORDER_RADIUS_PX}px`;
}
```

新建和复用分支都调用 `configureHostedWebviewElement()`。

- [x] **Step 6: 实现主进程安全处理器**

在 `electron/main/window.mts` 添加：

```ts
/**
 * WebView 新标签页 URL 发送器。
 */
type NewTabUrlSender = (url: string) => void;

/**
 * 创建 WebView 新窗口请求处理器。
 * @param send - 合法 URL 转发函数
 * @returns Electron 新窗口处理器
 */
export function createWindowOpenHandler(
  send: NewTabUrlSender
): (details: Pick<Electron.HandlerDetails, 'url'>) => Electron.WindowOpenHandlerResponse {
  return ({ url }): Electron.WindowOpenHandlerResponse => {
    try {
      const targetUrl = new URL(url);
      if (targetUrl.protocol === 'http:' || targetUrl.protocol === 'https:') {
        send(targetUrl.href);
      }
    } catch {
      // 无效 URL 保持拒绝，不转发到渲染进程。
    }

    return { action: 'deny' };
  };
}
```

在 `createWindow()` 中注册：

```ts
mainWindow.webContents.on('did-attach-webview', (_event, guestContents) => {
  guestContents.setWindowOpenHandler(
    createWindowOpenHandler((url: string): void => {
      mainWindow?.webContents.send('webview:open-in-new-tab', url);
    })
  );
});
```

- [x] **Step 7: 实现应用级导航 Hook**

创建 `src/hooks/useWebviewNewTab.ts`：

```ts
/**
 * @file useWebviewNewTab.ts
 * @description 将 WebView 新窗口请求路由为 Tibis 应用标签页。
 */
import { onScopeDispose } from 'vue';
import { useRouter } from 'vue-router';
import { getElectronAPI, hasElectronAPI } from '@/shared/platform/electron-api';

/**
 * 注册 WebView 新标签页导航监听。
 */
export function useWebviewNewTab(): void {
  if (!hasElectronAPI()) {
    return;
  }

  const router = useRouter();
  const unregister = getElectronAPI().webview.onOpenInNewTab((url: string): void => {
    router.push({
      name: 'webview-web',
      query: { url: encodeURIComponent(url) }
    });
  });

  onScopeDispose(unregister);
}
```

在 `src/App.vue` 导入并调用 `useWebviewNewTab()`。

- [x] **Step 8: 运行目标测试并确认 GREEN**

Run:

```bash
pnpm exec vitest run test/views/webview/web-hosting.test.ts test/electron/main/window-webview.test.ts test/hooks/use-webview-new-tab.test.ts
```

Expected: 三个测试文件全部 PASS。

- [x] **Step 9: 更新 changelog**

在 `changelog/2026-07-29.md` 的 `## Fixed` 下增加：

```markdown
- 修复 WebView 页面中 `target="_blank"` 与 `window.open()` 链接点击无响应的问题，安全转发为 Tibis 内的新 WebView 标签页。
```

- [x] **Step 10: 运行完整验证**

Run:

```bash
pnpm exec eslint src/App.vue src/hooks/useWebviewNewTab.ts src/views/webview/web/utils/hosting.ts --ext .vue,.ts
pnpm exec eslint test/views/webview/web-hosting.test.ts test/electron/main/window-webview.test.ts test/hooks/use-webview-new-tab.test.ts --ext .ts
pnpm exec tsc --noEmit
pnpm run electron:build-main
pnpm lint:style
```

Expected: 所有命令退出码为 0。

- [x] **Step 11: 提交修复**

```bash
git add src/App.vue src/hooks/useWebviewNewTab.ts src/views/webview/web/utils/hosting.ts electron/main/window.mts test/views/webview/web-hosting.test.ts test/electron/main/window-webview.test.ts test/hooks/use-webview-new-tab.test.ts changelog/2026-07-29.md docs/superpowers/plans/2026-07-29-webview-new-tab.md
git commit -m "fix(webview): 支持应用内打开新标签页"
```
