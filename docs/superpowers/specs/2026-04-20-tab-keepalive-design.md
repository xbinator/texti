/**
 * @file 2026-04-20-tab-keepalive-design.md
 * @description 多标签页 KeepAlive 缓存方案设计说明。
 */

# 多标签页 KeepAlive 缓存方案

## 背景

当前应用已经具备顶部多标签页、标签页拖拽排序和标签页持久化能力，但默认布局仍直接渲染 `RouterView`。这会导致页面在标签页切换时重建，编辑器、设置页表单、滚动位置和临时输入状态无法自然保留。

本方案采用标签页级缓存生命周期：标签页存在时保留页面实例，标签页关闭时销毁对应缓存。

## 目标

- 所有可见标签页对应的页面支持 KeepAlive 缓存。
- 缓存生命周期由 `tabsStore` 管理，保持“标签页还在，页面状态还在；标签页关闭，缓存释放”的行为。
- 编辑器、设置页和普通路由使用统一的缓存 key 解析规则。
- 切换编辑器标签页时，当前激活编辑器能接管文件监听和 AI 工具上下文。
- 关闭标签页时强制销毁对应页面缓存，避免长时间使用导致内存持续增长。

## 非目标

- 不改变顶部标签页视觉样式。
- 不重新设计文件保存、自动保存和脏状态判断规则。
- 不让已关闭标签页在后台继续保留页面实例。

## 推荐架构

### 缓存入口

默认布局的主内容区使用 `RouterView` 插槽渲染页面组件，并在外层包裹 `KeepAlive`。渲染组件时使用统一的路由缓存 key，保证同一个标签页对应同一个组件实例。

### 缓存状态

`tabsStore` 增加缓存 key 状态，负责记录当前仍应保留的页面缓存。新增或更新标签页时同步注册缓存 key；关闭标签页时同步移除缓存 key。

### 缓存 key 规则

- 编辑器路由 `/editor/:id` 使用文件 ID 作为标签页 ID，并派生稳定缓存 key。
- 设置页所有子路由统一归并为一个设置标签和一个设置缓存 key。
- 其他普通路由默认使用 `route.fullPath` 作为标签页 ID 和缓存 key。

### 组件命名规则

Vue `KeepAlive` 的 `include` 基于组件名称过滤。所有需要缓存的页面组件应具备稳定组件名，避免异步路由组件在不同构建环境下名称不一致。

## 新增页面接入说明

普通页面默认不需要额外接入 KeepAlive。只要路由没有设置 `meta.hideTab: true`，路由守卫会自动创建标签页，`tabsStore` 会自动登记缓存，默认布局会在标签页存在期间保留页面实例，并在关闭标签页时释放缓存。

新增普通页面时，只需要正常新增路由：

```typescript
/**
 * @file about.ts
 * @description 关于页面路由配置。
 */

import type { AppRouteRecordRaw } from '../../type';

/**
 * 关于页面路由。
 */
const routes: AppRouteRecordRaw[] = [
  {
    path: 'about',
    name: 'about',
    component: () => import('@/views/about/index.vue'),
    meta: {
      title: '关于'
    }
  }
];

export default routes;
```

以下页面需要额外注明并处理：

- 多实例页面：如果一个路由会按业务 ID 打开多个标签页，例如 `/editor/:id`，需要在 `src/router/cache.ts` 中补充 tab id 和 cache key 解析规则。
- 分组页面：如果多个子路由需要归并为一个标签页，例如 `/settings/**`，需要在 `src/router/cache.ts` 中补充分组规则。
- 隐藏标签页页面：如果路由设置 `meta.hideTab: true`，路由守卫不会自动创建标签页，也不会自动进入多标签页缓存生命周期。
- 含激活态副作用的页面：如果页面有文件监听、定时器、全局注册、当前页面上下文等副作用，需要使用 `onActivated` 接管资源，使用 `onDeactivated` 和 `onUnmounted` 释放资源。

普通表单、列表、滚动状态不需要单独处理，KeepAlive 会随标签页实例自动保留这些状态。

## 数据流

1. 用户进入路由。
2. 路由守卫或页面会话逻辑创建或更新标签页。
3. 标签页状态同步注册对应缓存 key。
4. 默认布局根据当前路由解析缓存 key，并渲染缓存页面实例。
5. 用户切换标签页时，缓存实例被激活或停用，不重建页面。
6. 用户关闭标签页时，`tabsStore` 删除标签页、脏状态和缓存 key。
7. 默认布局收到缓存 key 移除后，`KeepAlive` 释放对应组件实例。

## 编辑器激活态

编辑器页面需要区分“实例存在”和“当前激活”：

- 页面实例被 KeepAlive 缓存后，切换标签页不会触发 `onUnmounted`。
- 文件监听、AI 工具上下文注册等当前页面能力应在 `onActivated` 时接管。
- 页面停用时应在 `onDeactivated` 中释放当前激活态资源。
- 页面最终销毁时仍需在 `onBeforeUnmount` 或 `onUnmounted` 中兜底释放资源。

## 错误处理

- 如果缓存 key 无法从路由解析，回退到 `route.fullPath`。
- 如果标签页关闭时找不到缓存 key，关闭操作继续执行，避免 UI 卡住。
- 如果设置页子路由变化，只更新设置标签路径，不新增缓存实例。

## 测试策略

- 为缓存 key 解析工具补充单元测试，覆盖编辑器、设置页和普通路由。
- 为 `tabsStore` 补充缓存 key 注册与移除测试。
- 手动验证打开多个编辑器标签、切换标签、关闭标签后页面实例释放。
- 手动验证设置页多个子页面只占用一个设置标签和一个设置缓存。

## 待实现文件

- `src/router/type.ts`
- `src/router/index.ts`
- `src/stores/tabs.ts`
- `src/layouts/default/index.vue`
- `src/views/editor/index.vue`
- `src/views/editor/hooks/useSession.ts`
- 相关单元测试文件
