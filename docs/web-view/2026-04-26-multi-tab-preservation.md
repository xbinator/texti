# 多标签页 WebView 页面保持方案

## 问题

当前通过路由 `?url=xxx` 切换 webview 地址时，Vue 组件的 `onBeforeUnmount` 会调用 `destroy()`，导致 `WebContentsView` 被销毁。切换 tab 后再切回来，页面重新加载。

目标：切换 tab 时只隐藏 webview 不销毁，切回来时保持原有页面状态。

---

## 方案：复用现有 KeepAlive 机制

项目已有一套成熟的 KeepAlive 标签页缓存体系（`src/layouts/default/index.vue:58`）：

```
RouterView → KeepAlive(:include="cachedComponentNames") → 动态命名包装组件 → 实际页面组件
```

`cachedComponentNames` 由 `tabsStore.cachedComponentNames` getter 提供，getter 将 `cachedKeys[]` 映射为组件名。`tabsStore.removeTab(id)` 将对应 `cacheKey` 从 `cachedKeys` 中移除 → getter 不再包含该组件名 → KeepAlive 丢弃组件 → `onBeforeUnmount` 触发。

| 生命周期钩子 | 触发时机 |
|---|---|
| `onMounted` | 首次渲染（仅一次） |
| `onActivated` | 首次 mount 后、每次切回该 tab |
| `onDeactivated` | 每次切走该 tab |
| `onBeforeUnmount` | 仅当 KeepAlive 丢弃（tab 关闭时 `cachedKeys` 移除对应 key） |

**核心思路：让 webview 路由加入 KeepAlive 体系，利用 `onActivated`/`onDeactivated` 控制 show/hide，而非 mount/unmount。**

---

## 改动点

### 1. 路由：移除 `hideTab: true`

**文件**：`src/router/routes/modules/webview.ts`

```diff
{
  path: '/webview',
  name: 'webview',
  component: () => import('@/views/webview/index.vue'),
- meta: { title: '网页浏览', hideTab: true }
+ meta: { title: '网页浏览' }
}
```

移除后，`router.afterEach`（`src/router/index.ts`）将自动为每个 webview 路径调用 `tabsStore.addTab()`，`resolveRouteTabInfo` 对非 editor、非 settings 路由使用 `fullPath` 作为 `tabId` 和 `cacheKey`：

```
/webview?url=https://a.com  →  tabId = "/webview?url=https://a.com"  cacheKey = "/webview?url=https://a.com"
/webview?url=https://b.com  →  tabId = "/webview?url=https://b.com"  cacheKey = "/webview?url=https://b.com"
```

不同 URL 天然产生不同的缓存实例。

### 2. 组件：使用哈希值作为主进程 webview 标识

**文件**：`src/views/webview/index.vue`

```diff
- const tabId = computed(() => (route.query.tabId as string) || 'default');
+ /**
+  * 使用路由完整路径的哈希值作为主进程 WebContentsView 的唯一标识。
+  * 直接使用 fullPath 作为 tabId 会导致 IPC 日志中打印过长 URL 字符串，
+  * 使用短哈希同时保证唯一性和可读性。
+  */
+ import { hashString } from '@/shared/utils/hash';
+ const tabId = computed(() => hashString(route.fullPath));
```

需要新增一个简单的哈希工具函数 `src/shared/utils/hash.ts`：

```typescript
/**
 * 计算字符串的稳定短哈希（base36）。
 * 输出空间 2^32（uint32），用于少量 tab 场景（<100）时碰撞概率可忽略。
 * 如需更高唯一性，可改用 FNV-1a 或拼接 fullPath 前缀。
 * @param value - 原始字符串
 * @returns base36 哈希值（如 "abc123"）
 */
export function hashString(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}
```

### 3. 组件生命周期：验证 `onBeforeUnmount` 调用链路

**文件**：`src/views/webview/index.vue`

当前代码（**无需修改**）：

```typescript
onBeforeUnmount(async () => {
  await webview.destroy();
});
```

销毁链路验证：

```
用户关闭 Tab
  → HeaderTabs 调用 tabsStore.removeTab(id)
  → removeTab 从 cachedKeys[] 中移除 cacheKey（src/stores/tabs.ts:182-184）
  → cachedComponentNames getter 更新，不再包含对应组件名
  → Vue KeepAlive 响应式重新评估 :include → 丢弃该组件
  → 组件 onBeforeUnmount 触发
  → webview.destroy() 执行
  → 主进程 WebViewManager.destroy() 移除 WebContentsView
```

**关键前提**：`addTab` 必须正确将 `cacheKey` 写入 `cachedKeys`（`src/stores/tabs.ts:132-135`，已验证该逻辑存在），否则 KeepAlive 不会缓存组件。

### 4. 生命周期：`onMounted` 与 `onActivated` 双重 `show()` 的幂等性

**文件**：`src/views/webview/index.vue`（**无需修改**）

```typescript
onMounted(async () => {
  await webview.create(initialUrl.value);
  updateBounds();
  updateTab();
  await webview.show();  // ① 首次创建后显示
});

onActivated(async () => {
  await webview.show();  // ② onMounted 之后紧接着触发
  updateBounds();        // ③ 重新计算精确位置（已有代码，无需新增）
});
```

KeepAlive 下组件首次渲染的钩子顺序：`setup` → 渲染 → `onMounted` → `onActivated`。

`show()` 被连续调用两次，验证结果：

- 场景 A（无其他 webview tab）：`onMounted` 的 `show()` 将 `activeTabId` 设置为当前 tabId → `onActivated` 的 `show()` 命中 `if (this.activeTabId === tabId) return;` 提前返回
- 场景 B（替换已有 webview tab）：`onMounted` 的 `show()` 隐藏旧 tab、显示新 tab → `onActivated` 的 `show()` 命中提前返回

**结论**：`WebViewManager.show()` 的早期返回（`electron/main/modules/webview/ipc.mts:94`）保证幂等，无需添加标志位。

### 5. 生命周期：`onDeactivated` 隐藏 webview

**文件**：`src/views/webview/index.vue`（**已有，无需修改**）

```typescript
onDeactivated(async () => {
  await webview.hide();  // 存入 lastBounds，bounds 置零，WebContentsView 保持存活
});
```

与 `onActivated` 对称：`hide()` 存入 lastBounds 备后续恢复，`show()` 从 lastBounds 取出并 setBounds。

### 6. 同一 URL 重复打开的处理

**无需额外代码**。完整链路分析：

**场景 A：从其他 tab 导航到已有 webview URL**

```
用户在 /editor/file1  →  router.push('/webview?url=https://a.com')
  → from.fullPath ≠ to.fullPath → Vue Router 正常导航
  → afterEach 触发 → tabsStore.addTab() 命中已有记录（同 id），更新而非新增
  → KeepAlive :include 已包含该 cacheKey → 激活已有缓存组件
  → onActivated 触发 → webview.show()
```

**场景 B：已在 webview tab 上重复打开同一 URL**

```
用户在 /webview?url=https://a.com  →  router.push('/webview?url=https://a.com')
  → from.fullPath === to.fullPath → Vue Router 抛出 NavigationDuplicated
  → 导航取消，用户停留在当前 tab（符合预期）
  → 注意：项目未全局捕获 NavigationDuplicated（src/router/index.ts），
      重复 push 会在控制台产生未处理的 Promise rejection 警告。
      如果 webview 入口（BMessage/index.vue:73）频繁触发，建议调用方加 .catch(()=>{}) 消除噪音。
```

无需 `beforeEnter` 守卫——`return false` 会取消导航并停留在当前页（不会激活已有 tab），反而有副作用。`NavigationDuplicated` 仅在原地重复导航时触发，跨 tab 导航不会触发。

---

## 完整运行时流程

```
用户打开 https://a.com
  → router.push('/webview?url=https%3A%2F%2Fa.com')
  → afterEach: tabsStore.addTab({ id: fullPath, cacheKey: fullPath, ... })
  → KeepAlive: 创建 RouteCache_wrapper 组件
  → onMounted: webview.create(hash, url)         ← 首次挂载，创建 WebContentsView（仅一次）
  → onMounted: webview.show()                     ← 设置 activeTabId，显示页面
  → onActivated: webview.show()                   ← 幂等，提前返回
  → onActivated: updateBounds()                   ← 精确修正位置
  → 页面加载中...

用户切换到另一个 tab（如编辑器）
  → KeepAlive 缓存 webview 组件（不销毁）
  → onDeactivated: webview.hide()                 ← 存入 lastBounds，bounds 置零
  → WebContentsView 仍然存活，页面状态完整保留

用户切回 webview tab
  → KeepAlive 恢复 webview 组件（不重新 mount）
  → onActivated: webview.show()                   ← 从 lastBounds 恢复 + setBounds
  → onActivated: updateBounds()                   ← 重新计算精确位置（窗口尺寸可能已变）
  → 页面马上显示，无需重新加载

用户打开新网页 https://b.com
  → router.push('/webview?url=https%3A%2F%2Fb.com')
  → afterEach: 创建另一个 tab，cacheKey 不同
  → KeepAlive: 创建新的 RouteCache_wrapper 组件
  → onMounted: webview.create(新tabId, 新url)
  → 同时存在两个 WebContentsView

用户关闭 https://a.com 的 tab
  → HeaderTabs: tabsStore.removeTab(id)
  → cachedKeys 移除对应 cacheKey（src/stores/tabs.ts:184）
  → KeepAlive 丢弃该组件（不再在 :include 中）
  → onBeforeUnmount: webview.destroy()            ← 真正销毁
```

---

## 涉及文件清单

| 文件 | 改动内容 | 必须 |
|---|---|---|
| `src/router/routes/modules/webview.ts` | 移除 `hideTab: true` | 是 |
| `src/views/webview/index.vue` | `tabId` 从 `query.tabId` 改为 `hashString(fullPath)` | 是 |
| `src/shared/utils/hash.ts` | 新增：`hashString` 工具函数 | 是 |
| `src/views/webview/hooks/useWebView.ts` | 无需改动 | — |
| `electron/main/modules/webview/ipc.mts` | 无需改动 | — |
| `electron/preload/*` | 无需改动 | — |

---

## 潜在风险与应对

| 风险 | 应对 |
|---|---|
| 多 WebContentsView 占用内存 | 限制最大缓存数（如 5 个），超出时 LRU 淘汰最旧 tab |
| WebContentsView 进程崩溃 | `did-fail-load` 已监听，可加 crash 恢复逻辑 |
| 哈希碰撞导致两个 tab 共用同一 WebContentsView | 输出空间 2^32，<100 tab 时碰撞概率可忽略；若需零风险可改用 `fullPath` 直接作 tabId（仅影响日志可读性）|
| `fullPath` 作为 `path` 在 Tab UI 显示问题 | Tab 标题由 `webview.state.value.title` 动态更新（`index.vue:70-78` 已处理），`path` 仅用于路由导航，不直接影响 UI |

---

## 与现有设计文档的关系

本文档是 `docs/web-view/2026-04-26-design.md` 的增量补充，专注于多标签页页面保持方案。基础架构（WebContentsView 管理、IPC 通道、安全配置等）已在原有设计文档中定义，本文不重复。
