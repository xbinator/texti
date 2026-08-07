# BChat Shell Pipe 实时输出整改设计

## 背景

`run_shell_command` 的普通管道模式会通过主进程 `shell:output` IPC 持续发送 `stdout` 和 `stderr` 片段。当前应用级 ChatRuntime 迁移后只订阅 `shell:run-event`，因此普通管道片段没有进入会话 UI。BChat 只能显示命令文本，并在工具结束后从最终结构化结果读取输出；等待输入或长时间运行时会表现为“没有反应”。

仓库已经具备 `ElectronShellCommandOutputChunk`、`ChatMessageToolPart.shellOutput` 和 `append.shellOutputPart`，但这些能力未接入当前 Runtime 路由，也未被 Shell 工具气泡实时渲染。

## 目标

- 普通 pipe Shell 命令执行期间实时展示 `stdout` 和 `stderr`。
- 使用 Runtime 唯一 commandId 隔离并发会话和同名 toolCallId。
- 将真实输出作为工具进展上报，避免持续输出的命令被误判为空闲。
- 对实时输出同时施加片段数量和字符数量边界。
- 命令完成后使用最终结构化结果作为权威输出。
- 保持 PTY `auto-default`、Shell 安全分析和发布门语义不变。

## 非目标

- 不移除或默认开启 `TIBIS_SHELL_AUTO_DEFAULT_CAPABILITY`。
- 不向普通 pipe 子进程自动写入 Enter、`y` 或其他输入。
- 不针对 `npx`、`npm`、`skills add` 等命令添加重写规则。
- 不持久化每个实时输出片段，不增加数据库高频写入。
- 不支持在聊天界面中向终端发送自定义输入。

## 方案比较

### 方案 A：独立路由 pipe 输出

订阅现有 `onShellCommandOutput`，按 Runtime commandId 路由到会话 UI，复用 `shellOutput` 数据结构。

优点：保留 pipe 的 stdout/stderr 和 sequence 语义；与 PTY Screen Snapshot 解耦；改动集中且容易测试。

缺点：需要扩展 Session UI 事件和 BChat 展示逻辑。

### 方案 B：转换成 PTY terminal_update

在 Renderer 累积 pipe 片段，并转换成 `shellRunEvent.terminal_update`。

优点：可以复用现有 PTY 会话事件。

缺点：混淆增量 pipe 输出和终端屏幕快照；stdout/stderr 信息丢失；`finished` 和 sequence 语义容易产生歧义。

### 方案 C：由主进程持久化实时输出

主进程把每个片段写入运行消息，再通过消息更新事件展示。

优点：页面未挂载时也可恢复全部实时过程。

缺点：引入高频消息持久化和数据库写入；扩大 ChatRuntime 职责；超出本次缺陷修复范围。

采用方案 A。

## 架构

```text
Shell runner
  -> shell:output IPC
  -> useRuntimeEvents commandId 路由
  -> ChatSessionUIEvent.shellCommandOutput
  -> useChatWorkflow
  -> append.shellOutputPart
  -> BubblePartTool Shell 终端区域
```

PTY 仍使用原有 `shell:run-event` 和 `shellRunState` 路径，两种模式不共享输出状态类型。

## 组件职责

### `src/hooks/useChat/useRuntimeEvents.ts`

- 为所有 `run_shell_command` 请求创建 Shell 路由，而不是只为 `interactionMode: auto-default` 创建路由。
- 订阅 `onShellCommandOutput`，根据跨 Runtime 唯一 commandId 找到所属 Session 和原始 toolCallId。
- 将输出片段的 commandId 翻译回原始 toolCallId 后发布到 Session UI 总线。
- 按累计输出字符数上报 `shell_output` 工具进展；活动摘要只保留当前片段的有界文本。
- 未知 commandId、已清理路由或非托管 Runtime 的输出直接丢弃。
- 保留现有五秒迟到事件宽限期，避免工具 Promise 与 IPC 队列时序竞争。
- 旧 preload 不提供 `onShellCommandOutput` 时返回空 disposer，不影响其他 Runtime 事件。

### `src/ai/chat/sessionEvents.ts`

新增瞬时 UI 事件：

```ts
{ type: 'shellCommandOutput'; chunk: ElectronShellCommandOutputChunk }
```

该事件不进入待处理交互缓存；没有可见 Session 订阅时直接丢弃。工具完成后的最终结果仍由主进程消息更新恢复。

### `src/components/BChat/hooks/useChatWorkflow.ts`

收到 `shellCommandOutput` 后遍历当前会话消息，将片段应用到 commandId 匹配的 Shell tool part。找不到匹配 part 时不创建新消息。

### `src/components/BChat/utils/messageHelper.ts`

`shellOutputPart` 保持片段原始顺序，并执行双重边界：

- 最多保留 80 个片段。
- 所有片段文本合计最多保留尾部 12,000 个字符。

当单个片段超过字符上限时只保留该片段尾部，并保留其 commandId、stream、sequence 和 createdAt 元数据。

### `src/components/BChat/components/MessageBubble/BubblePartTool/index.vue`

Shell 输出选择顺序：

1. 工具已完成时，优先使用最终结果中的 `terminalOutput` 或 stdout/stderr。
2. PTY 执行中使用 `shellRunState.terminalContent`。
3. pipe 执行中按接收顺序拼接 `shellOutput[].text`。
4. 无输出时只显示命令。

这样可以实时展示 pipe 输出，同时避免瞬时缓存覆盖最终有界结果。

## 数据与并发语义

- 主进程 commandId 继续使用 `runtimeId + toolCallId` 编码，两个 Runtime 使用相同 toolCallId 时不会串流。
- 发布到会话 UI 前仅把 commandId 翻译为原始 toolCallId，不修改 stream、sequence、text 或 createdAt。
- pipe runner 的 sequence 是 stdout/stderr 共用的单调序号，Renderer 按事件到达顺序追加；重复或乱序防御不在本次新增，因为当前 IPC sender 保序，且已有数据类型没有重放语义。
- 工具完成后的迟到片段只在五秒路由宽限期内可能到达；最终结果优先级确保迟到实时缓存不会改变完成态展示。

## 错误与降级

- `onShellCommandOutput` 不存在：不订阅，Shell 最终结果展示保持现状。
- commandId 无路由：丢弃片段，不广播到其他会话。
- Session 没有订阅：事件总线不缓存输出，避免内存持续增长。
- 输出为空：不创建可见空行，但不改变主进程执行状态。
- stdout/stderr 包含终端控制序列：本次保持 pipe 原始文本语义，不引入 PTY projector。

## 测试设计

### Runtime 路由

- 普通 `interactionMode: none` Shell 请求注册 pipe 路由。
- 相同 toolCallId 的并发 Runtime 只收到各自输出。
- 输出 commandId 被翻译为原始 toolCallId。
- 未知、非托管或已清理路由的片段被丢弃。
- 输出触发累计字符数单调增加的 `shell_output` 工具进展。
- 缺少 `onShellCommandOutput` 的 preload 不导致初始化失败。

### 消息状态

- stdout/stderr 按片段接收顺序追加。
- 超过 80 个片段时只保留最后 80 个。
- 超过 12,000 字符时只保留尾部，并正确裁剪首个保留片段。
- commandId 不匹配时不修改消息。

### UI

- executing pipe Shell 显示实时片段文本。
- stdout/stderr 片段按照状态中的顺序展示。
- done 状态存在最终 stdout/stderr 时，以最终结果为准。
- PTY Screen Snapshot 展示行为保持不变。

### 回归验证

- Shell、Runtime events、BChat Shell 气泡相关 Vitest 测试通过。
- `pnpm exec tsc --noEmit` 通过。
- `pnpm exec eslint` 对修改文件检查通过。
- `pnpm exec stylelint` 对修改的 Vue 文件检查通过。

## 验收标准

1. 普通 pipe 命令产生输出后，BChat 在命令结束前显示对应内容。
2. 两个并发 Runtime 的 Shell 输出不会串到对方会话。
3. 实时输出内存上限同时受 80 个片段和 12,000 字符约束。
4. 工具完成后展示最终结构化输出，不受迟到实时片段影响。
5. PTY auto-default、发布门、安全分析、取消和最终结果契约没有变化。
6. 不新增针对具体 CLI 的分支或自动输入行为。
