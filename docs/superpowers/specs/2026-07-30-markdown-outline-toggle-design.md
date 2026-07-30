# Markdown 大纲侧栏切换按钮设计

## 背景

`src/components/BEditor/Markdown.vue` 目前只在 `showOutline` 为 `true` 时渲染 `Sidebar`，关闭侧栏后，编辑器内容区内没有重新打开大纲的入口。

`src/components/BEditor/components/Sidebar.vue` 已通过 `close` 事件通知父组件关闭侧栏，但侧栏标题栏内没有与“打开大纲”成对的图标按钮。

## 目标

- 大纲关闭时，在 Markdown 主内容区左上角显示打开按钮。
- 打开按钮使用 `lucide:list-indent-increase` 图标。
- 点击打开按钮后显示 Sidebar，同时隐藏主内容区中的打开按钮。
- Sidebar 右上角显示 `lucide:list-indent-decrease` 按钮。
- 点击 Sidebar 内按钮后关闭 Sidebar，使主内容区打开按钮重新出现。
- 两个新增按钮都不添加 `title` 或 `aria-label`。
- 仅点击两个新增按钮时播放 Sidebar 打开或关闭动画。
- 拖拽关闭、调整宽度以及程序化显隐 Sidebar 时不播放动画。

## 非目标

- 不新增大纲显隐状态。
- 不修改大纲宽度、拖拽或锚点导航逻辑。
- 不调整编辑器富文本与源码模式。
- 不让临时动画状态进入 Pinia 或持久化设置。

## 方案选择

采用现有 `showOutline` 作为唯一显隐状态，并增加只存在于 `Markdown.vue` 实例内的临时动画状态：

- `Markdown.vue` 在 `showOutline` 为 `false` 时显示打开按钮；点击时先临时启用动画，再将 `showOutline` 设为 `true`。
- `Sidebar.vue` 始终挂载，通过 `visible` 控制可见类，通过 `motionEnabled` 控制动画类。
- Sidebar 标题栏按钮发出独立的 `button-close` 事件，父组件收到后先启用动画，再将 `showOutline` 设为 `false`。
- `BPanelSplitter` 拖拽关闭继续发出 `close`，父组件直接隐藏 Sidebar，不启用动画。
- Store、菜单或其他代码直接修改 `showOutline` 时不会经过按钮处理函数，因此不启用动画。
- 按钮点击通过通用 `useIntentMotion<State>` 控制器声明本次动画的目标状态，360ms 后自动结束动画事务。
- 控制器不暴露打开、关闭等面板专用阶段，只公开 `motionEnabled`、`startMotion`、`syncState` 和 `cancelMotion`。
- 控制器仅在后续实际状态与动作目标一致时保留动画；程序化反向更新会立即取消动画。
- `BPanelSplitter` 在按下拖拽条时发出 `resize-start`，父组件立即取消仍在进行的按钮动画，确保调整宽度不会继承按钮过渡。
- `useIntentMotion<State>` 不依赖 `BPanelSplitter`、DOM 或具体 CSS；`resize-start` 只是 Markdown 与 ChatSider 主动调用 `cancelMotion` 的一种业务信号。
- Markdown 与默认布局 ChatSider 使用布尔状态实例化控制器；未来展开面板、卡片或其他枚举状态动画可复用同一接口。

未采用以下方案：

- 不让主内容区按钮常驻并切换图标，因为需求要求 Sidebar 打开后该按钮消失。
- 不复用同一个 `close` 事件处理按钮和拖拽关闭，因为两条路径的动画语义不同。
- 不把动画状态放入 Store，因为它是短暂且局部的交互状态。
- 不只做透明度和位移动画，因为 Sidebar 宽度瞬间切换会让主编辑区跳动。
- 不只做宽度动画，因为缺少淡入和空间方向反馈。
- 不抽取新的通用按钮组件，因为这两个按钮只复用现有 `BButton` 与 Iconify 能力，额外抽象不会减少复杂度。
- 不抽取通用侧栏外观组件或 Less mixin；左右侧栏的方向、宽度变量和内容布局不同，当前真正重复且容易出错的是动画生命周期。
- 不把 CSS、Vue Transition、GSAP 或拖拽协议封装进 `useIntentMotion`；Hook 只负责判断一次显式动作是否仍应启用动画。

## 组件与样式

### Markdown 主内容区

- 在 `.b-markdown-main` 内添加仅关闭状态可见的按钮。
- `.b-markdown-main` 作为按钮定位上下文。
- 按钮固定在主内容区左上角，并置于编辑器内容上层。
- 按钮使用小尺寸、方形、弱强调样式，避免遮挡正文时产生过强视觉噪声。
- 按钮不添加 `title` 或 `aria-label`。

### Sidebar 标题栏

- 保持标题点击跳转文档顶部的行为不变。
- 在标题右侧添加小尺寸方形按钮。
- 按钮不参与标题点击区域，点击只发出 `button-close` 事件。
- 按钮不添加 `title` 或 `aria-label`。

### Sidebar 动画

- Sidebar 保持挂载，隐藏态宽度为 `0`、透明度为 `0`，并向左偏移 `12px`。
- 显示态宽度使用当前 `sidebarWidth`、透明度为 `1`、位移归零。
- 临时动画类只在按钮处理函数中启用。
- 宽度与位移使用 `360ms ease`，透明度使用 `240ms ease`。
- 动画属性与 `src/layouts/default/components/ChatSider.vue` 保持一致，仅将横移方向镜像为左侧的 `-12px`。
- 隐藏时禁用指针事件并设置 `inert`，避免不可见内容获得焦点。
- `prefers-reduced-motion: reduce` 下关闭过渡，但保留相同显隐结果。
- 拖拽关闭将宽度变为 `0` 后，再次显示时恢复默认宽度 `260px`。

## 状态流

```text
showOutline = false
  -> 主内容区显示 lucide:list-indent-increase
  -> 用户点击
  -> 临时启用动画
  -> showOutline = true
  -> Sidebar 从左侧展开并淡入，主内容区按钮消失
  -> 360ms 后关闭临时动画状态

Sidebar 显示
  -> 用户点击 lucide:list-indent-decrease
  -> Sidebar 发出 button-close
  -> Markdown 临时启用动画
  -> Markdown 将 showOutline 设为 false
  -> Sidebar 向左收起并淡出，主内容区按钮恢复
  -> 360ms 后关闭临时动画状态

BPanelSplitter 拖拽关闭
  -> BPanelSplitter 在 mousedown 发出 resize-start
  -> Markdown 立即取消仍在进行的按钮动画
  -> Sidebar 发出 close
  -> Markdown 直接将 showOutline 设为 false
  -> 不启用动画

程序化显隐
  -> Store 或菜单直接更新 showOutline
  -> 若与仍在进行的按钮目标冲突，立即取消按钮动画
  -> Sidebar 立即切换显示状态
  -> 不启用动画
```

## 可访问性

- 使用真实按钮组件，保留键盘焦点和 Enter/Space 激活能力。
- Sidebar 隐藏时使用 `inert` 阻止不可见内容进入键盘焦点顺序。
- 动画遵循 `prefers-reduced-motion`。

## 测试策略

先编写组件测试并确认在动画事件分流缺失时失败，再实现最小代码：

- 验证两个新增按钮都没有 `title` 和 `aria-label`。
- 点击打开按钮后验证 `showOutline` 和临时动画状态同时启用，360ms 后只清理动画状态。
- 点击 Sidebar 关闭按钮后验证独立的 `button-close` 事件和动画关闭路径。
- 验证 BPanelSplitter 拖拽关闭只发出 `close`，不会启用动画。
- 验证程序化修改 `showOutline` 不会启用动画。
- 验证按钮动画期间开始拖拽会立即取消动画。
- 验证按钮动画期间发生反向程序化显隐会立即取消动画。
- 验证 BPanelSplitter 在拖拽开始时发出 `resize-start`。
- 验证 `useIntentMotion<State>` 可处理布尔值和字符串枚举状态，并且不暴露面板专用阶段。
- 验证 Markdown 和默认布局 ChatSider 共用 `useIntentMotion<boolean>`，且原有 360ms 行为保持不变。
- 验证 Sidebar 只有在 `motionEnabled` 为 `true` 时包含动画类。
- 验证动画样式包含宽度、透明度、横移和 `prefers-reduced-motion` 规则。

实现后运行针对性组件测试、ESLint、Stylelint 和 TypeScript 类型检查，并更新 `changelog/2026-07-30.md`。
