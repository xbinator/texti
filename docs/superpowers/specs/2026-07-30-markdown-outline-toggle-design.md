# Markdown 大纲侧栏切换按钮设计

## 背景

`src/components/BEditor/Markdown.vue` 目前只在 `showOutline` 为 `true` 时渲染 `Sidebar`，关闭侧栏后，编辑器内容区内没有重新打开大纲的入口。

`src/components/BEditor/components/Sidebar.vue` 已通过 `close` 事件通知父组件关闭侧栏，但侧栏标题栏内没有与“打开大纲”成对的图标按钮。

## 目标

- 大纲关闭时，在 Markdown 主内容区左上角显示打开按钮。
- 打开按钮使用 `tabler:layout-sidebar` 图标。
- 点击打开按钮后显示 Sidebar，同时隐藏主内容区中的打开按钮。
- Sidebar 右上角显示 `tabler:layout-sidebar-filled` 按钮。
- 点击 Sidebar 内按钮后关闭 Sidebar，使主内容区打开按钮重新出现。
- 两个纯图标按钮都提供可访问名称和悬浮提示。

## 非目标

- 不新增大纲显隐状态。
- 不修改大纲宽度、拖拽或锚点导航逻辑。
- 不调整编辑器富文本与源码模式。
- 不新增切换动画。

## 方案选择

采用现有 `showOutline` 状态和 `Sidebar` 的 `close` 事件完成双向交互：

- `Markdown.vue` 在 `showOutline` 为 `false` 时渲染打开按钮，点击后直接将 `showOutline` 设为 `true`。
- `Sidebar.vue` 在标题栏右侧渲染关闭按钮，点击后继续发出既有 `close` 事件。
- 父组件现有的 `@close="showOutline = false"` 负责回写偏好设置 Store。

未采用以下方案：

- 不让主内容区按钮常驻并切换图标，因为需求要求 Sidebar 打开后该按钮消失。
- 不新增 toggle 事件或独立 Store action，因为现有布尔状态和 `close` 事件已经覆盖完整状态流。
- 不抽取新的通用按钮组件，因为这两个按钮只复用现有 `BButton` 与 Iconify 能力，额外抽象不会减少复杂度。

## 组件与样式

### Markdown 主内容区

- 在 `.b-markdown-main` 内添加仅关闭状态可见的按钮。
- `.b-markdown-main` 作为按钮定位上下文。
- 按钮固定在主内容区左上角，并置于编辑器内容上层。
- 按钮使用小尺寸、方形、弱强调样式，避免遮挡正文时产生过强视觉噪声。

### Sidebar 标题栏

- 保持标题点击跳转文档顶部的行为不变。
- 在标题右侧添加小尺寸方形按钮。
- 按钮不参与标题点击区域，点击只发出 `close` 事件。

## 状态流

```text
showOutline = false
  -> 主内容区显示 tabler:layout-sidebar
  -> 用户点击
  -> showOutline = true
  -> Sidebar 显示，主内容区按钮消失

Sidebar 显示
  -> 用户点击 tabler:layout-sidebar-filled
  -> Sidebar 发出 close
  -> Markdown 将 showOutline 设为 false
  -> Sidebar 消失，主内容区按钮恢复
```

## 可访问性

- 打开按钮使用 `aria-label="打开大纲"` 和对应 `title`。
- 关闭按钮使用 `aria-label="关闭大纲"` 和对应 `title`。
- 使用真实按钮组件，保留键盘焦点和 Enter/Space 激活能力。

## 测试策略

先编写组件测试并确认在按钮缺失时失败，再实现最小代码：

- 验证 Sidebar 关闭时主内容区存在打开按钮。
- 点击打开按钮后验证偏好设置中的 `showOutline` 变为 `true`，且按钮消失。
- 验证 Sidebar 标题栏存在关闭按钮。
- 点击关闭按钮后验证 Sidebar 发出 `close` 事件。

实现后运行针对性组件测试、ESLint、Stylelint 和 TypeScript 类型检查，并更新 `changelog/2026-07-30.md`。
