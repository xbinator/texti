# WebView 新标签页处理设计

## 背景

`src/views/webview/web/index.vue` 使用 Electron `<webview>` 标签承载远程页面。当前通过
`src/views/webview/web/utils/hosting.ts` 动态创建的元素没有启用 `allowpopups`，主进程也没有在访客
`WebContents` 附加后注册新窗口处理器。因此，远程页面中的 `target="_blank"`、`window.open()` 和
`<form target="_blank">` 请求会被 Electron 默认阻止，用户点击后没有可见反馈。

## 目标

- 让 HTTP/HTTPS 新窗口请求在 Tibis 内打开为新的 `webview-web` 标签页。
- 保留普通链接在当前 WebView 内导航的现有行为。
- 阻止远程页面直接创建独立 Electron `BrowserWindow`。
- 拒绝非 HTTP/HTTPS 协议，避免远程页面借新窗口请求启动危险或未支持的协议。

## 方案比较

### 方案一：应用内标签页（采用）

为 `<webview>` 添加 `allowpopups`，主进程使用 `setWindowOpenHandler` 捕获请求，校验 URL 后通过已有
`webview:open-in-new-tab` IPC 通道通知渲染进程。渲染进程使用 Vue Router 打开新的 `webview-web`
路由，现有标签页 Store 会根据路由自动创建标签。

优点是交互与 Tibis 标签系统一致，并且主进程始终返回 `deny`，不会真正创建不受控窗口。

### 方案二：系统浏览器

主进程捕获请求后调用 `shell.openExternal()`。实现简单，但会离开 Tibis，不符合应用内浏览体验。

### 方案三：Electron BrowserWindow

主进程返回 `allow` 并创建独立窗口。该方式扩大远程页面的窗口控制能力，还需要额外管理权限、窗口
生命周期和导航策略，因此不采用。

## 架构与数据流

1. `ensureHostedWebviewElement()` 在首次创建 `<webview>` 时设置 `allowpopups`。
2. 主窗口监听 `did-attach-webview`，对访客 `WebContents` 注册 `setWindowOpenHandler`。
3. 当远程页面请求新窗口时，主进程解析并校验目标 URL。
4. HTTP/HTTPS URL 通过 `webview:open-in-new-tab` 发送给主窗口渲染进程；无效 URL 和其他协议不发送。
5. 无论 URL 是否有效，处理器都返回 `{ action: 'deny' }`，阻止 Electron 创建独立窗口。
6. 应用根组件通过独立 Hook 注册唯一的全局 IPC 监听器，收到 URL 后导航到 `webview-web` 路由。
7. `src/router/index.ts` 的现有后置守卫为目标路由创建并激活新的应用标签页。

全局监听器放在应用根组件而不是每个 WebView 页面中，避免 KeepAlive 缓存的多个 WebView 实例同时
响应同一个 IPC 消息，也避免与默认布局正在进行的其他改动耦合。

## 接口与错误处理

- 复用 `WebViewAPI.onOpenInNewTab(callback)`，负载继续保持单个 URL 字符串，不新增 IPC 接口。
- 主进程提供纯函数解析新窗口 URL，返回规范化的 HTTP/HTTPS URL 或 `null`，便于单元测试。
- URL 解析失败或协议不支持时静默拒绝，不触发路由导航，也不抛出未处理异常。
- 渲染进程在 Hook 作用域销毁时注销监听器，防止热更新或根组件重挂载造成重复订阅。

## 测试

- `hosting.ts` 测试验证新建和复用的 `<webview>` 都带有 `allowpopups`。
- 主进程测试验证：
  - HTTP/HTTPS URL 会被转发；
  - 非 HTTP/HTTPS URL 和无效 URL 不会被转发；
  - 所有请求都返回 `deny`。
- 应用级 Hook 测试验证收到 `onOpenInNewTab` 消息后导航到编码后的 `webview-web` 路由，并在作用域销毁时
  注销监听。
- 运行目标 Vitest、ESLint、Stylelint 和 TypeScript 类型检查，确认没有回归。

## 非目标

- 不改变普通 `<a href>` 的同页导航。
- 不支持远程页面直接创建或控制独立窗口。
- 不改变现有 `WebContentsView` 版本的新窗口行为。
- 不新增用户可配置的新窗口打开策略。
