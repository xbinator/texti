# BChat ToolActivity 展示精简设计

## 背景

`ToolActivity` 当前同时展示工具状态、进度数量、进度阶段、进度消息、最后进展时间，以及空闲工具的控制按钮。工具气泡还会在其下方展示 Shell 终端、任务列表、问答结果或工具摘要，导致活动区域信息密度偏高。

Shell 普通管道输出仍以 `shellOutput` 数组保存，但在父组件按接收顺序拼接为连续字符串后传给 `ToolShellDisplay`。IPC chunk 边界不等于终端行边界，因此本次不把 `ToolShellDisplay` 改为数组渲染。

## 目标

- 所有工具的 `ToolActivity` 只展示当前状态文案。
- `running_idle` 工具继续展示“继续等待”和“停止”按钮。
- 保留底层活动快照、状态机、watchdog、持久化和工具控制语义。
- Shell 输出继续实时、连续地追加显示。

## 非目标

- 不删除或合并 `ChatToolActivityState` 状态。
- 不修改 Runtime 活动事件、进度上报或持久化结构。
- 不修改 Shell `shellOutput` 数组、容量限制或 Session 路由。
- 不按 IPC chunk 创建独立终端行，不区分 stdout/stderr 颜色。
- 不删除空闲工具的“继续等待”和“停止”控制。

## 方案比较

### 方案 A：精简组件接口

从 `ToolActivity` 模板和 Props 中删除进度数量、阶段、消息与最后进展时间；父组件同步删除对应 computed 和属性传递。

优点：组件职责清晰，没有不可达展示逻辑或无效 props；类型检查可以约束调用方。

缺点：所有工具都不再显示阶段、数量、等待原因和最后进展时间。

### 方案 B：只隐藏模板内容

仅删除模板节点，保留 Props、computed 和样式。

优点：改动最少。

缺点：保留无效数据准备和死接口，后续维护者无法判断这些字段是否仍有展示用途。

### 方案 C：折叠详细信息

默认只显示状态，通过展开或 tooltip 查看完整进度。

优点：保留信息。

缺点：增加新的交互状态，不符合“所有工具都只显示状态”的目标。

采用方案 A。

## 组件设计

### `ToolActivity.vue`

保留：

- `activity`：用于状态样式修饰和 `running_idle` 判断。
- `activityLabel`：当前状态文案。
- `showIdleControls`：是否显示控制按钮。
- `controlPending`：控制按钮的 loading/disabled 状态。
- `control` 事件：提交 `continue_waiting` 或 `stop`。

移除：

- `activityCount` Prop 与节点。
- `activityPhase` computed 与节点。
- `activityMessage` Prop 与节点。
- `lastProgressText` Prop 与节点。
- 只服务于上述节点的样式。

布局仍保留状态与操作按钮两端排列。状态颜色继续根据 `activity.state` 区分普通、等待和停止/中断状态。

### `BubblePartTool/index.vue`

- 不再向 `ToolActivity` 传递数量、消息和最后进展时间。
- 删除 `activityCount`、`activityMessage`、`lastProgressText` computed。
- 保留 `activityLabel`、`showIdleControls` 和 `handleToolControl`。
- 不修改 `defaultCollapsed`：执行中且存在活动快照的工具仍默认展开。

### `ToolShellDisplay.vue`

不修改。继续接收一个连续的 `terminalContent` 字符串。父组件把实时 `shellOutput` chunk 按接收顺序无分隔拼接，避免把 chunk 边界误当作终端行。

## 数据与行为

活动数据仍完整保存在 `ChatMessageToolPart.activity`，只是不再把下列字段渲染到气泡：

- `progress.phase`
- `progress.completed` / `progress.total`
- `progress.message`
- `userPrompt`
- `externalWait.reason`
- `lastProgressAt`

状态标签仍覆盖 `starting`、`executing`、`running_idle`、`waiting_user`、`waiting_external`、`stopping` 和 `interrupted`。本次精简展示字段，不减少领域状态。

## 测试设计

- 活动组件对各状态继续显示正确的状态文案。
- 活动组件不显示 phase、数量、进度消息、等待原因或最后进展时间。
- `running_idle` 且具备 Runtime 与提交函数时，仍显示并正确提交“继续等待”和“停止”。
- 工具完成或缺少 Runtime 时不显示控制按钮。
- Shell 气泡测试继续验证普通 pipe 输出按原顺序连续展示。
- TypeScript、ESLint 和 Stylelint 检查通过。

## 风险与取舍

精简后用户无法从工具气泡看到等待原因或进度数量。这是明确接受的产品取舍；底层数据仍保留，未来如需恢复或在其他界面展示，无需修改 Runtime 协议。

## 验收标准

1. 所有执行中工具的活动区域只显示状态文案。
2. 活动区域不显示阶段、数量、进度消息、等待原因或最后进展时间。
3. 空闲工具的“继续等待”和“停止”按钮行为不变。
4. Shell 实时输出仍以连续终端文本显示。
5. 不修改活动状态机、watchdog、持久化协议或 Shell 输出路由。
