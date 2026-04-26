# WebView Tag 迁移设计方案

## 背景

当前实现使用 Electron 的 `WebContentsView` API，在 `BrowserWindow.contentView` 原生层管理视图层级，通过 IPC 同步 bounds。计划迁移到更成熟稳定的 `webview tag` 方案。

## 目标

完全替换 `WebContentsView` 为 `webview tag`，移除主进程视图层级管理，改由渲染进程 DOM 直接管理 webview 元素。

## 架构变化

### Before (WebContentsView)

```
Renderer (Vue)
    ↓ IPC
Main Process: WebViewManager (WebContentsView)
    ↓
BrowserWindow.contentView (原生视图层级)
```

### After (webview tag)

```
Renderer (Vue)
    ↓ IPC
Main Process: WebViewManager (BrowserView + webview element 管理)
    ↓
Renderer DOM (webview tag 嵌入页面)
```

## 改动清单

### 1. 主进程 - WebViewManager 重写

**文件**: `electron/main/modules/webview/ipc.mts`

```typescript
// 旧: WebContentsView 管理
class WebViewManager {
  private views: Map<string, WebContentsView> = new Map();
  // ...
}

// 新: BrowserView (作为容器) + webview tag 事件转发
class WebViewManager {
  private views: Map<string, BrowserView> = new Map();
  // webview tag 的事件通过 BrowserView.webContents 转发
}
```

**主要职责变化**:
- 创建 BrowserView 作为容器（用于 window.open 拦截等）
- 管理 webview tag 的 preload 脚本路径
- 转发 webview 导航事件到渲染进程
- 处理 `will-navigate` 等安全拦截

**移除的逻辑**:
- `setBounds()` - webview tag 自适应 DOM 容器
- `show()/hide()` - 改为渲染进程控制 CSS

### 2. Preload 脚本重写

**文件**: `electron/preload/webview.mts`

```typescript
// 旧: IPC 事件监听
onStateChanged: (callback) => {
  ipcRenderer.on('webview:state-changed', handler);
}

// 新: webview element 事件监听
onStateChanged: (webviewEl: Electron.WebviewTag, callback) => {
  webviewEl.addEventListener('did-start-loading', () => {
    callback({ isLoading: true, loadProgress: 0 });
  });
}
```

**事件映射**:
| webview event | 转发到的回调 |
|---|---|
| `did-start-loading` | `onStateChanged` (isLoading: true) |
| `did-stop-loading` | `onStateChanged` (isLoading: false, loadProgress: 1) |
| `did-finish-load` | `onTitleUpdated`, `onNavigationStateChanged` |
| `page-title-updated` | `onTitleUpdated` |
| `will-navigate` | 安全拦截 |
| `new-window` | `onOpenInNewTab` |

### 3. 前端 Hook 调整

**文件**: `src/views/webview/hooks/useWebView.ts`

**接口保持不变**（向后兼容）:
```typescript
export function useWebView(tabId: Ref<string> | string) {
  return {
    state,        // 响应式状态
    create,       // (url) => void
    destroy,      // () => void
    navigate,     // (url) => void
    goBack,       // () => void
    goForward,    // () => void
    reload,       // () => void
    stop,         // () => void
    setBounds,    // (bounds) => void (保留但为空操作)
    show,         // () => void (保留但为空操作)
    hide,         // () => void (保留但为空操作)
    onOpenInNewTab // (callback) => unsubscribe
  };
}
```

**内部实现变化**:
- `create()`: 动态创建 `<webview>` DOM 元素，挂载到容器，通知主进程创建 BrowserView 容器
- `destroy()`: 移除 DOM 元素，通知主进程销毁 BrowserView 容器
- `show()`: webview element `style.display = ''` 或 `style.visibility = 'visible'`
- `hide()`: webview element `style.display = 'none'` 或 `style.visibility = 'hidden'`
- `setBounds()`: 空操作（webview 自适应容器），保留接口兼容性
- 事件监听直接绑定到 webview element，不再通过 IPC

### 4. Vue 组件调整

**文件**: `src/views/webview/index.vue`

```vue
<div ref="webviewContainerRef" class="webview-content">
  <!-- webview 元素将由 useWebView 动态创建并插入此处 -->
</div>
```

**移除的逻辑**:
- `useResizeObserver` + `updateBounds()` - 不再需要手动同步 bounds
- `onMounted` 中的 `updateBounds()` 调用

**保留的逻辑**:
- 生命周期管理 (mount/activate/deactivate/unmount)
- 标题同步到 tabsStore
- 地址栏交互

### 5. IPC 通道简化

**保留的 IPC 调用**:
| Channel | 用途 |
|---|---|
| `webview:create` | 通知主进程创建 BrowserView 容器 |
| `webview:destroy` | 通知主进程销毁 BrowserView 容器 |
| `webview:navigate` | 导航 (webviewEl.loadURL) |
| `webview:goBack` | 后退 |
| `webview:goForward` | 前进 |
| `webview:reload` | 刷新 |
| `webview:stop` | 停止 |

**移除的 IPC 调用**:
- `webview:set-bounds` - 不再需要
- `webview:show` - 不再需要
- `webview:hide` - 不再需要

**新增的 IPC 调用**:
| Channel | 用途 |
|---|---|
| `webview:create-guest` | webview tag 创建完成后通知主进程注册事件 |

## 文件清单

| 文件 | 操作 |
|------|------|
| `electron/main/modules/webview/ipc.mts` | 重写 |
| `electron/preload/webview.mts` | 重写 |
| `src/views/webview/hooks/useWebView.ts` | 修改 |
| `src/views/webview/index.vue` | 修改 |
| `src/views/webview/types.ts` | 无需改动 |
| `types/webview.d.ts` | 无需改动 |

## 测试要点

1. **基础导航**: 打开 URL、前进、后退、刷新、停止
2. **多标签页**: 同时打开多个 webview tab，切换保持状态
3. **内存**: 打开/关闭多个 tab 后内存占用稳定
4. **外部链接**: 点击外部链接在系统浏览器打开
5. **安全**: 非 http/https URL 被拦截
6. **权限**: 摄像头、麦克风等权限请求被拒绝

## 风险与应对

| 风险 | 应对 |
|------|------|
| webview tag 独立进程开销增加 | 监控内存，必要时限制最大缓存数 |
| 渲染进程崩溃影响主进程稳定性 | webview tag 有独立 guest 进程，隔离较好 |
| devtools 调试方式变化 | 熟悉新的调试流程 |
