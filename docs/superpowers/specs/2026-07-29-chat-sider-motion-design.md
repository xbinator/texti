# ChatSider 按钮动画与分隔器修复设计

## 背景

`src/layouts/default/components/ChatSider.vue` 当前把宽度、透明度和位移过渡永久设置在 `.chat-sider` 根节点上。任何 `sidebarWidth` 或 `sidebarVisible` 变化都会触发过渡，包括 `BPanelSplitter` 拖拽、持久化状态恢复和其他代码主动打开侧栏。

根节点同时设置了 `overflow: hidden`。`BPanelSplitter` 的拖拽线位于根节点左边缘，并通过 `translateX(-100%)` 向外偏移，因此会被根节点裁掉，用户无法正常拖拽调整侧栏宽度。

## 目标

- 仅在用户点击顶部“辅助工具侧边栏切换按钮”时播放侧栏打开或关闭动画。
- 用户点击 ChatSider 内部的关闭按钮时播放关闭动画。
- `BPanelSplitter` 拖拽关闭和其他代码触发的显隐保持即时，不播放动画。
- 恢复 `BPanelSplitter` 拖拽线及宽度调整能力。
- 保持 ChatSider 常驻挂载、会话状态和现有显隐语义不变。

## 非目标

- 不修改 `BPanelSplitter` 的通用实现。
- 不改变侧栏默认宽度、最小宽度、最大宽度或关闭阈值。
- 不改变 Pinia 设置的持久化结构。
- 不调整侧栏内容、会话管理或聊天运行时行为。

## 方案选择

采用由默认布局管理临时动画状态、由 ChatSider 接收动画状态并发出按钮关闭请求的方案。

没有采用以下方案：

- 不把动画状态放入 `useSettingStore`，因为它是短暂的视图交互状态，不应进入全局持久化设置。
- 不通过组件 `ref` 暴露命令式开关方法，避免父组件直接调用子组件内部行为。

## 组件职责

### 默认布局

`src/layouts/default/index.vue` 负责：

- 保存 `sidebarMotionEnabled` 临时状态。
- 在顶部切换按钮被点击时开启动画，再恢复默认宽度并切换 `sidebarVisible`。
- 在收到 ChatSider 内部关闭按钮请求时开启动画，再关闭侧栏。
- 在动画时长结束或组件卸载时清理动画状态和定时器。

动画持续时间为 360ms，与 ChatSider 的宽度和位移过渡时长保持一致。连续点击时先清理旧定时器，再重新计算完整动画周期。

### ChatSider

`src/layouts/default/components/ChatSider.vue` 负责：

- 接收 `motionEnabled` 布尔属性。
- 根据属性添加 `chat-sider--motion` 类。
- 内部关闭按钮发出独立的按钮关闭事件，由默认布局执行带动画关闭。
- `BPanelSplitter @close` 继续直接关闭 Store 中的侧栏显隐状态，不请求动画。

内部关闭按钮和分隔器关闭必须使用不同处理函数，确保拖拽关闭不会误用按钮动画路径。

## 状态流

顶部切换按钮：

```text
用户点击顶部按钮
  -> 开启 sidebarMotionEnabled
  -> 必要时恢复 sidebarWidth
  -> 切换 sidebarVisible
  -> 360ms 后关闭 sidebarMotionEnabled
```

ChatSider 内部关闭按钮：

```text
用户点击内部关闭按钮
  -> ChatSider 发出按钮关闭事件
  -> 默认布局开启 sidebarMotionEnabled
  -> 设置 sidebarVisible = false
  -> 360ms 后关闭 sidebarMotionEnabled
```

拖拽或程序化显隐：

```text
BPanelSplitter 拖拽关闭或其他代码修改 Store
  -> 直接更新 sidebarWidth / sidebarVisible
  -> sidebarMotionEnabled 保持 false
  -> 立即更新布局
```

## 样式设计

- `.chat-sider` 保留隐藏态的宽度、透明度、位移和交互控制，但不再常驻声明 `transition` 与 `will-change`。
- `.chat-sider--motion` 临时声明宽度、透明度和位移过渡，并设置对应的 `will-change`。
- `.chat-sider--visible` 继续恢复当前侧栏宽度、透明度、位移和指针交互。
- 删除 `.chat-sider` 根节点的 `overflow: hidden`，允许 `BPanelSplitter` 的外置拖拽线显示和接收鼠标事件。
- `.chat-sider__content` 继续保留 `overflow: hidden`，侧栏内部内容和圆角裁剪行为不变。
- `prefers-reduced-motion: reduce` 只对临时动画类关闭过渡。

## 生命周期与异常边界

- 动画状态只存在于默认布局实例中，不持久化，也不跨窗口或重新挂载恢复。
- 默认布局卸载时清理动画定时器，避免卸载后的状态更新。
- 连续点击使用同一个可重置定时器，避免旧定时器提前清除新一轮动画。
- 程序化打开侧栏时不会残留动画状态；动画结束后所有后续宽度拖拽都即时响应。

## 测试策略

先更新测试并确认失败，再修改实现：

- ChatSider 仅在 `motionEnabled` 为 true 时包含 `chat-sider--motion` 类。
- ChatSider 内部关闭按钮发出按钮关闭事件，不直接复用分隔器关闭路径。
- `BPanelSplitter @close` 直接关闭侧栏且不请求动画。
- 顶部切换按钮点击时启用临时动画并切换显隐状态。
- ChatSider 内部关闭事件启用临时动画并关闭侧栏。
- 程序化修改 `sidebarVisible` 时不启用临时动画。
- `.chat-sider` 根样式不包含 `overflow: hidden`，而 `.chat-sider__content` 继续包含该规则。

完成实现后运行：

```bash
pnpm test test/layouts/default/chat-sider.test.ts
pnpm test test/layouts/default/settings-button.test.ts
pnpm exec eslint src/layouts/default/components/ChatSider.vue src/layouts/default/index.vue test/layouts/default/chat-sider.test.ts test/layouts/default/settings-button.test.ts
pnpm exec stylelint 'src/layouts/default/**/*.{vue,less,css}'
pnpm exec tsc --noEmit
```

同时更新 `changelog/2026-07-29.md`，记录 ChatSider 动画触发范围和分隔器恢复。
