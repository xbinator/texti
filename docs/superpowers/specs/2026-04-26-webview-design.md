# Tibis WebView 功能设计文档

## 概述

在 Electron 主窗口中嵌入外部网页浏览功能，使用 `WebContentsView` + Vue 壳组件架构，通过 IPC 通信。

---

## 1. 架构设计

### 1.1 整体架构

```
┌─────────────────────────────────────────────────────────┐
│                    Main Process                          │
│  ┌─────────────────────────────────────────────────┐   │
│  │              WebViewManager                       │   │
│  │  - Map<tabId, WebContentsView>                   │   │
│  │  - create / destroy / show / hide / navigate    │   │
│  │  - IPC handlers                                   │   │
│  └─────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────┤
│                  Renderer Process                        │
│  ┌─────────────────────────────────────────────────┐   │
│  │  WebViewShell (index.vue)                       │   │
│  │    ├── AddressBar.vue (地址栏)                   │   │
│  │    └── WebContentsView (透明占位，实际渲染在主进程)│   │
│  └─────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────┐   │
│  │  useWebView.ts (composable)                     │   │
│  │  - 封装所有 IPC 逻辑                              │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### 1.2 核心约束

- **URL 协议**: 仅允许 `http://` 和 `https://`，拒绝其他协议
- **导航模式**: 单 Tab 模式，链接在当前 WebContentsView 内导航
- **新窗口处理**: 点击链接弹出新窗口时，调用系统浏览器打开
- **右键菜单**: 必须包含（见第 5 节）

---

## 2. 主进程设计

### 2.1 文件结构

```
electron/main/
├── modules/
│   └── webview/
│       ├── index.ts      # 导出 registerWebviewHandlers
│       └── ipc.ts        # IPC handlers 实现
└── index.mts            # 调用 registerWebviewHandlers()
```

### 2.2 WebViewManager 核心接口

```typescript
class WebViewManager {
  /** 创建 WebContentsView */
  create(tabId: string, url: string): void

  /** 销毁 WebContentsView */
  destroy(tabId: string): void

  /** 导航 */
  navigate(tabId: string, url: string): void
  goBack(tabId: string): void
  goForward(tabId: string): void
  reload(tabId: string): void
  stop(tabId: string): void

  /** 显隐控制 */
  show(tabId: string): void
  hide(tabId: string): void

  /** 设置 bounds */
  setBounds(tabId: string, bounds: Rectangle): void
}
```

### 2.3 IPC 通道

**渲染 → 主进程 (invoke)**:
| Channel | 参数 | 说明 |
|---|---|---|
| `webview:create` | `(tabId, url)` | 创建 WebContentsView |
| `webview:destroy` | `(tabId)` | 销毁实例 |
| `webview:navigate` | `(tabId, url)` | 导航到 URL |
| `webview:go-back` | `(tabId)` | 后退 |
| `webview:go-forward` | `(tabId)` | 前进 |
| `webview:reload` | `(tabId)` | 刷新 |
| `webview:stop` | `(tabId)` | 停止加载 |
| `webview:set-bounds` | `(tabId, bounds)` | 设置尺寸 |

**主进程 → 渲染 (事件)**:
| Channel | 参数 | 说明 |
|---|---|---|
| `webview:state-changed` | `(tabId, state)` | 加载状态变化 |
| `webview:title-updated` | `(tabId, title)` | 标题更新 |
| `webview:navigation-state-changed` | `(tabId, canGoBack, canGoForward)` | 导航状态 |
| `webview:page-action` | `(tabId, action)` | 页面事件 |

### 2.4 WebViewState 类型

```typescript
interface WebViewState {
  url: string
  title: string
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
  loadProgress: number  // 0-1
}
```

---

## 3. Preload 脚本

### 3.1 文件位置

`electron/preload/webview.ts`（新建）

### 3.2 暴露 API

```typescript
contextBridge.exposeInMainWorld('electronAPI', {
  // ... 现有 API 保持不变

  webview: {
    create: (tabId: string, url: string) =>
      ipcRenderer.invoke('webview:create', tabId, url),
    destroy: (tabId: string) =>
      ipcRenderer.invoke('webview:destroy', tabId),
    navigate: (tabId: string, url: string) =>
      ipcRenderer.invoke('webview:navigate', tabId, url),
    goBack: (tabId: string) =>
      ipcRenderer.invoke('webview:go-back', tabId),
    goForward: (tabId: string) =>
      ipcRenderer.invoke('webview:go-forward', tabId),
    reload: (tabId: string) =>
      ipcRenderer.invoke('webview:reload', tabId),
    stop: (tabId: string) =>
      ipcRenderer.invoke('webview:stop', tabId),
    setBounds: (tabId: string, bounds: Rectangle) =>
      ipcRenderer.invoke('webview:set-bounds', tabId, bounds),

    // 事件监听
    onStateChanged: (callback: (tabId: string, state: WebViewState) => void) =>
      ipcRenderer.on('webview:state-changed', callback),
    onTitleUpdated: (callback: (tabId: string, title: string) => void) =>
      ipcRenderer.on('webview:title-updated', callback),
    onNavigationStateChanged: (callback: (tabId: string, canGoBack: boolean, canGoForward: boolean) => void) =>
      ipcRenderer.on('webview:navigation-state-changed', callback),
  }
})
```

---

## 4. Vue 组件设计

### 4.1 文件结构

```
src/views/webview/
├── index.vue           # WebViewShell：组合 AddressBar + 状态管理
├── AddressBar.vue      # 地址栏组件
├── types.ts            # 类型定义
└── hooks/
    └── useWebView.ts   # Composable：封装 IPC 逻辑
```

### 4.2 AddressBar.vue

```
┌────────────────────────────────────────────────────────────────┐
│ [🔙] [🔜] [🔄] │ [ https://example.com                    ] [⏎] │
└────────────────────────────────────────────────────────────────┘
```

- 后退/前进/刷新按钮
- 地址栏 input（原生 input，无拼写检查，无自动补全）
- 回车键触发导航

### 4.3 index.vue (WebViewShell)

职责：
- `onMounted` / `onActivated`: 计算 bounds，调用 `create` + `show`
- `onDeactivated`: 调用 `hide`
- `onBeforeUnmount`: 调用 `destroy`
- 监听事件 (`state-changed`, `title-updated`, `navigation-state-changed`)
- 将 bounds 变化同步到主进程

### 4.4 useWebView.ts

```typescript
export function useWebView(tabId: Ref<string> | string) {
  // 创建
  const create = (url: string) => electronAPI.webview.create(tabId, url)

  // 销毁
  const destroy = () => electronAPI.webview.destroy(tabId)

  // 导航
  const navigate = (url: string) => electronAPI.webview.navigate(tabId, url)
  const goBack = () => electronAPI.webview.goBack(tabId)
  const goForward = () => electronAPI.webview.goForward(tabId)
  const reload = () => electronAPI.webview.reload(tabId)
  const stop = () => electronAPI.webview.stop(tabId)

  // bounds
  const setBounds = (bounds: Rectangle) =>
    electronAPI.webview.setBounds(tabId, bounds)

  // 状态（响应式）
  const state = ref<WebViewState>({
    url: '',
    title: '',
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    loadProgress: 0
  })

  // 事件监听（setup 时自动注册，cleanup 自动取消）
  onMounted(() => {
    const unsubState = electronAPI.webview.onStateChanged((id, s) => {
      if (id === tabId) Object.assign(state.value, s)
    })
    // ... 其他事件
  })

  return { state, create, destroy, navigate, goBack, goForward, reload, stop, setBounds }
}
```

---

## 5. 右键菜单设计

### 5.1 实现方式

在主进程通过 `webContents.on('context-menu')` 监听，用 Electron 原生 `Menu` API 构建菜单。

### 5.2 菜单项

| 菜单项 | 说明 |
|---|---|
| 在新标签页打开 | 创建新的 WebView Tab，打开当前链接 |
| 复制链接地址 | 将链接 URL 复制到剪贴板 |
| 在系统浏览器打开 | 用 `shell.openExternal()` 打开 |
| --- | 分隔线 |
| 后退 | 调用 goBack |
| 前进 | 调用 goForward |
| 刷新 | 调用 reload |
| 停止 | 调用 stop |

### 5.3 获取链接 URL

通过 `webContents.getURL()` 获取当前页面 URL。
如果用户是右键点击某个链接，需要获取该链接的 href：
- 通过 `webContents.on('context-menu', (event, params)` 的 `params.linkURL` 获取

---

## 6. 路由设计

### 6.1 路由模块

```typescript
// src/router/routes/modules/webview.ts
export default {
  routes: [
    {
      path: '/webview',
      name: 'webview',
      component: () => import('@/views/webview/index.vue'),
      meta: { title: '网页浏览' }
    }
  ]
}
```

### 6.2 URL 参数

通过 query 传递初始 URL：`/webview?url=https://example.com`

---

## 7. 安全配置

```typescript
webPreferences: {
  preload: path.join(__dirname, '../preload/webview.mjs'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
}

// 拦截新窗口
view.webContents.setWindowOpenHandler(({ url }) => {
  shell.openExternal(url)
  return { action: 'deny' }
})

// 拒绝所有权限请求
session.setPermissionRequestHandler((webContents, permission, callback) => {
  callback(false)
})

// 导航前校验（仅 http/https）
view.webContents.on('will-navigate', (event, url) => {
  const parsed = new URL(url)
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    event.preventDefault()
  }
})
```

---

## 8. 实施步骤

1. 创建 `electron/main/modules/webview/ipc.ts` - WebViewManager + IPC handlers
2. 创建 `electron/preload/webview.ts` - preload API
3. 更新 `electron/preload/index.mts` - 添加 webview 到 electronAPI
4. 创建 `src/views/webview/types.ts` - 类型定义
5. 创建 `src/views/webview/hooks/useWebView.ts` - composable
6. 创建 `src/views/webview/AddressBar.vue` - 地址栏组件
7. 创建 `src/views/webview/index.vue` - WebViewShell
8. 创建 `src/router/routes/modules/webview.ts` - 路由
9. 更新 `electron/main/modules/index.mts` - 注册 WebView handlers
10. 测试：加载常见网站验证功能
