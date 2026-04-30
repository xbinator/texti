# 编辑器页宽设置设计

## 背景

当前 `BEditor` 正文容器在样式中写死了 `max-width: 900px`，所有文档都使用同一阅读宽度。这对长文写作比较稳，但当用户在宽屏设备上编辑表格、代码块或多列内容时，正文区会显得偏窄。

现在需要为编辑器新增页宽设置，支持以下三档：

- `default`：默认宽度，`900px`
- `wide`：较宽模式，`1200px`
- `full`：全宽模式，取消 `max-width`

这项设置只影响编辑正文区，不改变外层布局、侧边栏、大纲区或窗口级分栏宽度。同时，这个设置需要同时支持：

- 视图菜单切换
- 系统菜单切换
- AI 设置工具读写
- 本地持久化

## 目标

- 为正文编辑区域提供三档稳定的宽度模式。
- 将页宽设置纳入 `src/stores/setting.ts`，与主题、大纲、源码模式保持同一数据源。
- 保证富文本模式和源码模式共用同一页宽设置，不引入模式差异。
- 保证 UI 菜单、系统菜单、AI settings tool 对同一状态读写，避免多套状态源。

## 非目标

- 不支持自定义像素宽度输入。
- 不按文件或标签页分别记忆页宽。
- 不改变侧边栏、滚动容器、查找条或大纲面板宽度。
- 不在第一版加入快捷键切换。

## 方案对比

### 方案一：全局持久化设置，统一挂到 `settingStore`

为 `settingStore` 增加 `editorPageWidth` 字段，并由 `BEditor`、视图菜单、系统菜单、AI settings tool 共同消费。

优点：

- 和现有 `theme`、`showOutline`、`sourceMode` 模式一致，符合现有代码组织。
- 持久化逻辑、菜单状态同步、AI 设置入口都可以复用现有路径。
- 改动边界清晰，适合后续继续扩展更多编辑器视图设置。

缺点：

- 这是应用级设置，不是按文档独立记忆。

### 方案二：由编辑页局部持有页宽状态，再透传给 `BEditor`

优点：

- 组件边界更纯，`BEditor` 只消费 prop。

缺点：

- 状态最终仍要持久化，实际只是把复杂度从 store 转移到页面层。
- 菜单、AI tool、系统菜单还要再绕回页面状态，链路更散。

### 方案三：仅通过根节点 class 切换样式，不新增显式设置类型

优点：

- 表面上改动最少。

缺点：

- 持久化、AI 设置和菜单同步需要额外拼接判断，类型边界不清楚。
- 不符合当前项目以 `settingStore` 统一承载应用设置的风格。

## 结论

采用方案一：将页宽定义为全局持久化设置，统一存储在 `settingStore`，并由正文容器样式消费。

## 数据设计

### 新增类型

在 `src/stores/setting.ts` 中新增：

```ts
export type EditorPageWidth = 'default' | 'wide' | 'full';
```

### 持久化字段

在 `PersistedSettingState` 中新增：

- `editorPageWidth: EditorPageWidth`

并在 `DEFAULT_SETTINGS` 中设置默认值：

- `editorPageWidth: 'default'`

### 合法值校验

在 `normalizeSettings()` 中增加页宽合法值兜底：

- 若值不是 `default | wide | full`，则回退到 `DEFAULT_SETTINGS.editorPageWidth`

这样老用户本地没有该字段时，会自然落到默认宽度，不需要额外迁移脚本。

### Store Action

在 `settingStore.actions` 中新增：

- `setEditorPageWidth(width: EditorPageWidth): void`

职责：

- 更新 store 状态
- 调用 `persistSettings()`
- 调用 `syncNativeMenuState()`

第一版不增加循环切换方法，因为该设置主要通过显式菜单选择，不存在和主题一样的顺序切换需求。

## 菜单设计

### 应用内视图菜单

在 `src/layouts/default/hooks/useViewActive.ts` 的现有“视图”配置中新增“页宽”子菜单，结构与“主题”保持一致。

子项如下：

- `default` -> `默认`
- `wide` -> `较宽`
- `full` -> `全宽`

点击行为统一调用 `settingStore.setEditorPageWidth(...)`。

选中态直接绑定 `settingStore.editorPageWidth`，保证当前状态在菜单中即时反映。

### 系统菜单

在 `electron/main/modules/menu/service.mts` 的 View 菜单下新增“页宽”分组。

建议使用三个互斥的 checkbox 菜单项，模式与现有主题切换保持一致：

- `view:pageWidth:default`
- `view:pageWidth:wide`
- `view:pageWidth:full`

这样可以复用当前系统菜单“通过 checked 表达当前状态”的交互风格，也便于 `syncNativeMenuState()` 做单向状态同步。

### 菜单 Action 分发

在 `src/hooks/useMenuAction.ts` 中新增对应的 action 处理逻辑，将系统菜单点击统一映射到：

- `settingStore.setEditorPageWidth('default')`
- `settingStore.setEditorPageWidth('wide')`
- `settingStore.setEditorPageWidth('full')`

## AI 设置工具设计

在 `src/ai/tools/builtin/settings.ts` 中扩展设置支持范围，使 AI 可以直接读写页宽设置。

### 支持项扩展

将 `editorPageWidth` 加入支持的 setting key 集合。

### 值校验

对 `editorPageWidth` 限定可接受值：

- `default`
- `wide`
- `full`

若传入其他值，返回明确错误提示，引导模型使用合法枚举值。

### 设置落地

AI 工具成功校验后，统一调用：

```ts
settingStore.setEditorPageWidth(input.value)
```

不新增旁路状态，不直接写本地存储，保证所有入口都通过同一个 action 生效。

## UI 渲染设计

### 影响范围

这项设置只影响 `src/components/BEditor/index.vue` 中正文容器 `.b-editor-container` 的内容宽度。

不影响以下区域：

- `BScrollbar` 外层滚动容器
- 左侧 `BEditorSidebar`
- 查找条显示逻辑
- 外层布局的 panel splitter

### 宽度映射

建议在组件内部将 `editorPageWidth` 映射为 CSS 可消费值：

- `default` -> `900px`
- `wide` -> `1200px`
- `full` -> `none`

### 样式接入方式

推荐使用 CSS 变量，而不是为每种模式写一组 class。

理由：

- 只需保留一套 `.b-editor-container` 样式结构
- 逻辑层只负责输出宽度值，样式层负责消费
- 以后若需要再补第四档宽度，改动点更少

实现思路：

- 在脚本中根据 `settingStore.editorPageWidth` 计算 `editorPageMaxWidth`
- 在正文容器上绑定 `style`
- 将样式中的固定 `max-width: 900px` 替换为 `max-width: var(--editor-page-max-width)`

当模式为 `full` 时，变量值传入 `none`，浏览器会直接取消正文最大宽度限制。

## 数据流

完整链路如下：

1. 用户在应用内视图菜单、系统菜单或 AI tool 中发起页宽变更
2. 各入口统一调用 `settingStore.setEditorPageWidth()`
3. store 更新内存状态并持久化到本地
4. `syncNativeMenuState()` 刷新系统菜单的 checked 状态
5. `BEditor` 读取新的 `editorPageWidth` 并更新正文容器 `max-width`
6. 富文本与源码模式在同一容器内共享新宽度

## 兼容性

- 现有本地设置没有 `editorPageWidth` 字段时，自动使用 `default`
- 不需要新增迁移版本号
- 旧的主题、大纲、源码模式存储逻辑保持不变

## 错误处理

- `settingStore` 层对非法页宽值做归一化，防止本地污染数据进入运行态
- AI settings tool 层在入参校验阶段拒绝非法值，并返回可理解的错误信息
- 系统菜单和应用内菜单都只提供固定选项，不开放自由输入

## 测试策略

### Store 层

- 新增或补充设置归一化测试，验证非法 `editorPageWidth` 会回退为 `default`
- 验证 `setEditorPageWidth()` 会持久化并触发菜单状态同步

### 菜单联动

- 验证应用内菜单切换三档宽度后，选中态与实际状态一致
- 验证系统菜单点击后三个 checkbox 互斥更新

### 编辑器显示

- 验证 `default` 时正文容器仍为 `900px`
- 验证 `wide` 时正文容器扩展到 `1200px`
- 验证 `full` 时正文容器取消 `max-width`
- 验证富文本模式与源码模式共用同一宽度设置

### AI 设置

- 验证 AI tool 可成功将 `editorPageWidth` 设为三种合法值
- 验证 AI tool 对非法值返回明确错误

## 风险与控制

### 风险一：菜单状态和 store 状态不同步

控制方式：

- 所有入口统一通过 `settingStore.setEditorPageWidth()`
- 不允许菜单直接写样式或本地存储

### 风险二：`full` 模式下正文内容过宽影响可读性

控制方式：

- 这是显式用户选择，不作为默认值
- 第一版只提供三档固定值，不自动根据窗口宽度切换

### 风险三：宽度逻辑分散到多个编辑模式组件

控制方式：

- 宽度只在 `BEditor` 外层容器统一生效
- 不在 `PaneRichEditor` 与 `PaneSourceEditor` 内部分别处理

## 实施边界

本次只覆盖以下文件方向：

- `src/stores/setting.ts`
- `src/layouts/default/hooks/useViewActive.ts`
- `src/components/BEditor/index.vue`
- `src/hooks/useMenuAction.ts`
- `electron/main/modules/menu/service.mts`
- `src/ai/tools/builtin/settings.ts`

如果实现过程中发现系统菜单结构对“页宽”分组展示有限制，再做同层级位置微调，但不改变“单一 store 数据源”这一核心方案。
