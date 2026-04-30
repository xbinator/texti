# Logger State Localization 设计文档

## 概述

将日志查看页的页面状态与加载逻辑从 `src/views/settings/logger/stores/logViewer.ts` 收回到 `src/views/settings/logger/index.vue` 中，移除该 Pinia store。

保留 `src/views/settings/logger/components/LogFilterBar.vue` 作为展示与输入组件，但不再直接依赖 store，而是通过 `props + emits` 接收和回传筛选值。这样日志页会变成“页面单一数据源 + 受控子组件”的结构，降低局部页面状态被独立 store 分散后的维护成本。

---

## 目标

- 删除 `src/views/settings/logger/stores/logViewer.ts`。
- 让 `index.vue` 成为日志页唯一的状态持有者。
- 保留 `LogFilterBar.vue` 子组件，并通过双向绑定方式接入页面状态。
- 保持现有功能不变：首次加载、筛选、日期切换、关键字搜索、触底加载更多、打开目录、空态与加载态。

---

## 非目标

- 不修改 `logger.getLogs()` 的查询参数与返回结构。
- 不新增新的分页策略、虚拟列表或缓存层。
- 不把 `LogTimeline.vue` 再次拆分或改成别的数据流模式。
- 不引入新的 `provide/inject` 或新的 composable 抽象。

---

## 现状问题

当前日志页的状态保存在 `logViewer.ts` 中，但这个 store 只服务于单个页面：

- 没有跨页面共享需求。
- 没有持久化需求。
- 没有复用到其他模块。

这会带来几个额外成本：

- 页面理解成本变高，读 `index.vue` 时看不到数据来源全貌。
- `LogFilterBar.vue` 对 store 形成隐式依赖，降低组件边界清晰度。
- 后续想调整日志页数据流时，需要在页面、子组件、store 三处来回跳。

---

## 方案对比

### 方案 A：推荐，页面状态全部收回 `index.vue`

- `index.vue` 持有 `entries`、`isLoading`、`filterLevel`、`keyword`、`selectedDate`、`offset`、`hasMore`。
- `LogFilterBar.vue` 改成受控组件，只接收值并发出 `update:*` 事件。
- 页面内部监听筛选变化并触发 `loadLogs(true)`。

优点：

- 数据源单一，行为最直观。
- 组件边界清晰，`LogFilterBar.vue` 更容易测试。
- 完全符合“这个页面不需要 store”的目标。

代价：

- `index.vue` 会比现在更重一些，但仍在合理范围内。

### 方案 B：页面状态收回，但子组件内再维护一层本地镜像状态

- `index.vue` 持有最终状态。
- `LogFilterBar.vue` 内部再保留 `computed` 或 `ref` 镜像。

优点：

- 表面上对子组件改动较少。

缺点：

- 容易重新引入双状态同步问题。
- 实际上没有减少复杂度，只是把 store 换成了局部镜像。

### 方案 C：改成 `provide/inject`

- `index.vue` 提供日志页状态。
- `LogFilterBar.vue` 注入所需值和操作。

优点：

- 不需要层层传参。

缺点：

- 这里只有一层子组件，`provide/inject` 会让依赖变隐式。
- 相比 `props + emits`，可读性和测试性都更差。

---

## 结论

采用方案 A：

- 删除 `logViewer.ts`
- 页面集中持有状态
- `LogFilterBar.vue` 使用 `props + emits`

这是最小且最清晰的重构路径。

---

## 组件职责调整

### `src/views/settings/logger/index.vue`

负责：

- 持有日志页全部状态
- 负责首次加载和分页加载
- 构建查询参数
- 处理筛选变化后的刷新
- 把筛选值和事件传给 `LogFilterBar.vue`

新增或内聚到页面内的状态：

- `entries`
- `isLoading`
- `filterLevel`
- `keyword`
- `selectedDate`
- `offset`
- `hasMore`

页面内保留的方法：

- `loadLogs(reset?: boolean)`
- `onLoadMore()`
- `handleScroll(event)`

页面内新增监听逻辑：

- 监听 `filterLevel`
- 监听 `keyword`
- 监听 `selectedDate`

任一筛选变化时都触发 `loadLogs(true)`。

### `src/views/settings/logger/components/LogFilterBar.vue`

负责：

- 展示标题、记录数和“打开目录”按钮
- 提供日志级别、关键字、日期输入控件
- 通过事件把用户输入回传给父组件

改造后输入输出：

- Props
  - `count`
    - 语义为“当前页面已加载条数”，即 `entries.length`，不是筛选后的总命中数
  - `level`
  - `keyword`
  - `date`
- Emits
  - `update:level`
  - `update:keyword`
  - `update:date`

父组件使用方式：

```vue
<LogFilterBar
  v-model:level="filterLevel"
  v-model:keyword="keyword"
  v-model:date="selectedDate"
  :count="entries.length"
/>
```

保留在子组件内的逻辑：

- `logger.openLogFolder()`
- 输入控件的展示层双向绑定适配

移除：

- `useLogViewerStore()`
- 对 store 字段和 store action 的直接调用

---

## 数据流设计

改造后数据流为：

1. `index.vue` 初始化页面状态
2. `onMounted` 调用 `loadLogs(true)`
3. `LogFilterBar.vue` 展示父组件下发的筛选值
4. 用户修改筛选条件
5. 子组件通过 `update:*` 事件把新值发回 `index.vue`
6. `index.vue` 更新本地状态
7. 页面监听到筛选值变化后重新调用 `loadLogs(true)`
8. 日志内容区用页面本地的 `entries` 渲染

这个数据流的关键点是：筛选行为不再在子组件内部直接触发加载，而是由页面统一决定何时刷新。

---

## 行为细节

### 首次加载

- 页面挂载时调用 `loadLogs(true)`。
- 行为保持与当前一致。

### 筛选刷新

- 级别、关键字、日期任一变化都重置分页。
- `offset` 在重置加载时从 `0` 重新开始。

### 加载更多

- 继续使用触底加载。
- 触底时调用 `onLoadMore()`，仅当 `hasMore` 为 `true` 且当前不在加载中时执行实际请求。

### 记录数展示

- 顶部“共 X 条记录”继续显示当前页面已加载到的 `entries.length`。
- 不改成总命中数，因为底层日志 API 当前不提供总数。

---

## 测试策略

### 需要调整的测试

- `LogFilterBar` 组件测试

从“依赖 store 的布局和绑定测试”改成：

- 是否正确展示 `props.count`
- 是否把 `props.level / keyword / date` 绑定到控件
- 是否在用户交互时通过 `v-model` 正确回传新值（即发出对应的 `update:*` 事件）

### 需要新增的测试

- `index.vue` 页面测试

至少覆盖：

- 页面挂载后调用日志加载
- 筛选值变化后重置加载
- 触底时调用 `onLoadMore`
- 筛选值变化时 `offset` 会归零
- 筛选值变化时 `hasMore` 会重置为 `true`

### 不需要新增的测试

- `LogTimeline.vue` 与页面状态下沉无直接关系，不需要因这次重构调整其测试目标。

---

## 风险与处理

### 风险 1：页面内 watch 触发重复加载

如果在初始化阶段直接 watch 筛选值，可能出现首屏加载和 watch 同时触发的问题。

处理方式：

- `watch` 保持默认的 `immediate: false` 行为，不在声明时立即触发。
- 首次请求只在 `onMounted` 中显式调用一次 `loadLogs(true)`。
- 筛选项后续发生真实变化时，再由 `watch` 触发重新加载。

### 风险 2：子组件事件命名和 `v-model` 适配不一致

如果 `props` / `emits` 命名不统一，筛选栏输入会失效。

处理方式：

- 统一使用 `v-model:level`、`v-model:keyword`、`v-model:date`
- 对应事件统一为 `update:level`、`update:keyword`、`update:date`
- 在父组件中显式绑定，不混用其他命名方式

### 风险 3：测试仍然依赖已删除 store

如果旧测试没有同步改造，会让这次重构出现大量无意义失败。

处理方式：

- 先改 `LogFilterBar` 测试
- 再补 `index.vue` 的页面层测试

---

## 文件变更范围

- 删除：`src/views/settings/logger/stores/logViewer.ts`
- 修改：`src/views/settings/logger/index.vue`
- 修改：`src/views/settings/logger/components/LogFilterBar.vue`
- 修改：`test/views/settings/logger/log-filter-bar.component.test.ts`
- 新增：`test/views/settings/logger/index.test.ts` 或等价页面测试文件
- 检查并清理：store 聚合导出文件中对 `logViewer.ts` 的引用（如存在）
- 修改：`changelog/2026-04-30.md`

Changelog 粒度：

- 这是一次页面内部状态重构，无功能变更。
- `changelog/2026-04-30.md` 中补一行说明即可，不需要写实现细节。

---

## 验收标准

- `logViewer.ts` 被移除后，日志页功能保持可用。
- `index.vue` 成为日志页唯一状态来源。
- `LogFilterBar.vue` 不再依赖 store。
- 修改筛选条件时，页面仍会正确刷新日志。
- 触底加载、空态、加载态和打开目录功能保持不变。
