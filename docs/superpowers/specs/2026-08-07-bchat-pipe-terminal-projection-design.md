# BChat Pipe Shell 稳定终端投影修复设计

## 背景与已核实根因

普通 pipe Shell 命令会把 stdout/stderr 原始 chunk 实时发送给 BChat。截图中的大块字符并非乱码：`skills@1.5.18` 的 CLI 源码本身会打印由 `█` 字符组成的 `SKILLS` 标志。实际存在四个独立问题：

1. pipe 的 `console.log()` 只写入 LF（`\n`），而复用的 xterm projector 使用默认 `convertEol: false`。换行只下移、不回到第 0 列，因而每行逐步向右错位。
2. `@clack/prompts` 的 spinner 会分别写入“清屏”和“重绘”片段。当前 runner 每处理一个原始 chunk 就发布一次完整屏幕，renderer 会看到空屏、半帧和完整帧，形成闪烁。
3. Runtime 工具活动持久化会周期性发送 `messageUpdated`。当前历史合并以新 `parts` 整体替换旧 `parts`，会删除仅存在于 renderer 的 `shellRunState` 和 `shellOutput`；下一条 Shell 事件又将其恢复，形成周期性消失与重现。
4. `ToolShellDisplay` 使用 `white-space: pre-wrap` 和较宽行高。终端字符网格会被浏览器二次换行，块字符和框线的垂直间距也被放大。

另一个独立事实是：命令缺少 `-y` 时，`skills add` 在非 TTY 环境仍可能等待交互。正确的非交互命令是：

```bash
npx skills add https://github.com/juneyaooo/nihaisha-tcm --skill nihaisha -y
```

这与终端显示修复无关，不能通过自动输入或 PTY 能力掩盖。

## 目标

- 普通 pipe 命令按终端语义解释 LF、光标移动和清除序列。
- stdout/stderr 原始 chunk 保持实时、连续、有序，不因画面合并而延迟或丢失。
- 擦除与重绘只向 renderer 发布最新稳定屏幕，不展示空白中间帧。
- Runtime 的持久化消息更新不能擦除执行中 Shell 的临时终端状态。
- 终端文本保持固定字符网格，不由浏览器按容器宽度二次折行。
- 最终完成态继续使用结构化 `terminalOutput`，投影失败时无损降级。

## 非目标

- 不把普通 pipe 命令切换为 PTY。
- 不启用或修改 `TIBIS_SHELL_AUTO_DEFAULT_CAPABILITY`。
- 不向命令写入 Enter、`y` 或其他自动输入。
- 不通过 `CI`、`NO_COLOR`、`TERM=dumb` 等环境变量改变第三方 CLI 行为。
- 不隐藏 `skills` CLI 有意输出的块字符标志。
- 不改变 Shell 命令退出码、取消、超时、安全分析或原始 stdout/stderr 语义。
- 不改动所有工具只展示活动状态、并保留“继续等待/停止”按钮的既有行为。

## 方案比较

### 方案 A：原始输出与终端画面使用独立通道（采用）

pipe runner 立即发送原始 stdout/stderr chunk，同时把相同数据串行写入 headless terminal。投影后的 Screen Snapshot 复用现有 `shell:run-event` / `terminal_update` 通道，以 16ms trailing settle、50ms 最大等待发布稳定帧，并在运行中抑制清屏与重绘之间的瞬时空帧。

优点：原始流不受渲染节流影响；PTY 与 pipe 共用同一种画面事件；空屏和半帧不会成为独立 UI 帧；chunk 不再复制完整快照。

缺点：pipe 也会产生 Shell run-event，需要把现有 PTY 专属注释和测试改为通用 Shell 语义。

### 方案 B：延迟并批量发送原始 chunk

runner 暂存 50ms 内的原始 chunk，同步发送整批，只在最后一个 chunk 附带 Screen Snapshot。

优点：沿用当前 `terminalContent` chunk 字段，接口改动较少。

缺点：原始 stdout/stderr 不再即时；传输与 UI 刷新耦合；持续高频输出需要额外处理最大延迟和缓冲上限。

### 方案 C：禁用动画或切换 PTY

设置 CLI 环境变量，或让普通命令进入 `auto-default` PTY。

优点：局部代码改动少。

缺点：改变命令运行环境或能力边界；不同 CLI 行为不一致；不能修复 Runtime 消息覆盖临时态的问题。

采用方案 A。

## 架构与数据流

```text
child stdout/stderr
  ├─ raw sink ──> shell:output ──> shellOutput（实时诊断回退）
  └─ high/low watermark ──> serial projector ──> trailing settle ──> terminal_update ──> shellRunState（当前屏幕）

process exit ──> 等待 stdio close
  └─ await projector queue ──> flush latest stable frame ──> terminalOutput + finished event/result
```

原始输出和画面事件各自使用单调序号，但不互相比较。`shellOutput` 只承担原始诊断与 projector 失败回退；`shellRunState` 只承担当前终端屏幕。

## 主进程设计

### `electron/main/modules/shell/interaction/screen-projector.mts`

`ScreenProjectorOptions` 增加可选 `convertEol`。headless terminal 将该值传入 xterm：

- PTY 不传或传 `false`，保留 PTY 驱动提供 CRLF/ONLCR 的现有语义。
- 普通 pipe 传 `true`，让 LF 同时回到第 0 列。

### `electron/main/modules/shell/runner.mts`

- 普通 pipe 创建 100 列、30 行、`convertEol: true` 的 projector。
- stdout/stderr 到达时立即更新原始有界缓冲并调用 raw output sink；projector 失败不能阻塞这条路径。
- 同一条 Promise 队列按原始到达顺序写入 projector，避免 stdout/stderr 交错时乱序。
- 每次成功写入后读取最新 Screen Snapshot，但只更新 `pendingTerminalContent`。
- 画面发布使用 `lodash-es` 的 trailing debounce：最后一次变化 16ms 后发布，`maxWait: 50` 保证持续输出时不会无限饥饿。
- 运行期间若已发布非空画面，则清屏后尚未重绘产生的空 Snapshot 不覆盖当前画面；后续非空帧仍按 trailing settle 发布。最终结构化 `terminalOutput` 不受该显示策略影响。
- 重复画面不再次发送，减少 Vue 更新。
- 投影积压字符数达到 1 MiB 时暂停 stdout/stderr，降至 512 KiB 后恢复；这对 child 施加自然背压，保留数据和顺序，同时限制闭包队列占用。
- 正常路径在 child `close` 后生成结果，不能在 `exit` 时结束，因为 `exit` 不保证 stdio 已关闭；取消和超时的强制兜底仍可直接收敛。
- 正常退出、取消和超时在生成结果前等待投影队列并立即 flush 最后一帧，再生成最终 `terminalOutput`。
- pipe 与 PTY 一样发送有序 `finished` run-event，使 renderer 可以及时回收路由；Promise 返回同一结构化结果。
- child error 保持原有 reject 语义，但在释放前 flush 已完成的最后画面。
- projector 创建、写入、快照、最终投影或释放失败时，只关闭显示旁路；raw chunk、命令生命周期和原始结果保持不变。

### 类型与 IPC

- `ShellCommandOutputChunk`、`ElectronShellCommandOutputChunk` 和 `ChatMessageShellOutputChunk` 删除上一版临时加入的 `terminalContent` 字段。原始 chunk 不再携带完整屏幕。
- `ShellRunEvent` / `ElectronShellRunEvent` 的语义从“PTY 事件”扩展为“Shell 有序画面与生命周期事件”，事件结构不变。
- `ShellCommandRunResult.terminalOutput` 保持为任意输出模式可提供的有界终端投影。
- 既有 `shell:output` 和 `shell:run-event` IPC 名称不变。

## Renderer 设计

### `src/hooks/useChat/useRuntimeEvents.ts`

- raw pipe chunk 继续即时路由到 `shellCommandOutput`，并按原始累计字符上报工具活动。
- pipe 的 `terminal_update` 只更新 UI 屏幕，不再次上报同一份工具进展，避免 raw 与画面通道对同一输出重复触发持久化。
- PTY 没有 raw chunk，仍由 `terminal_update` 上报工具进展。
- `finished` 对两种输出模式都结束 Shell 路由。

区分方式使用路由已有的 `outputChars`：值大于 0 表示 pipe raw 通道已经承担进展上报；值为 0 时 terminal update 继续承担 PTY 进展上报。

### `src/components/BChat/utils/messageHelper.ts`

- `shellOutputPart` 只保存有界原始 chunk，不再写 `shellRunState`。
- `shellRunEventPart` 继续按 run-event sequence 单调应用 `terminal_update`、`auto_answer` 和 `finished`。
- 如果 `finished` 到达时该 part 从未建立 `shellRunState`，忽略该显示事件；完成态随后由权威工具结果渲染，不能凭空创建会遮盖 raw fallback 的空终端状态。

### `src/components/BChat/hooks/useChatHistory.ts`

`upsertLiveMessage` 在合并同一条执行中消息时，按 `toolCallId` 匹配 Shell 工具片段：

- incoming part 未携带 `shellOutput` 时，保留当前原始输出缓冲。
- incoming part 未携带 `shellRunState` 时，保留当前画面状态。
- incoming part 已提供字段时，以 incoming 为准。
- incoming part 已是 `done` 时不再保留临时字段，完成态以结构化工具结果为唯一权威来源。

只合并这两个 renderer 临时字段，不深度合并其他 part 状态，避免掩盖 Main 的权威更新。

### `src/components/BChat/components/MessageBubble/BubblePartTool/index.vue`

执行态只要 `shellRunState` 存在，就把其中的 `terminalContent` 视为权威值，即使它是空字符串。不能因空屏而回退到包含控制序列的 raw 输出。

完成态继续优先显示结构化 `terminalOutput`；不存在时回退 stdout/stderr。

### `ToolShellDisplay.vue`

- 输出使用 `white-space: pre`，不允许浏览器二次换行。
- 保留横向滚动容器，让固定列宽终端内容可以完整查看。
- 使用紧凑终端行高，并显式保持正常 `word-break` / `overflow-wrap`，提高块字符和框线连续性。

## 错误处理与资源清理

- projector 创建失败：raw 输出立即照常发送，最终结果省略 `terminalOutput`。
- projector 写入或快照失败：释放 projector，后续仅保留 raw 输出。
- `terminal_update` sink 抛错：忽略显示旁路错误，命令继续。
- Runtime message update 到达时：只保留执行中同一 `toolCallId` 的临时 Shell 字段。
- renderer 收到空 Screen Snapshot：显示空屏，不回退 raw。
- 命令结束：等待 `close` 与投影队列，flush pending、取消 trailing timer、恢复被暂停的流、释放 projector，并确保最多释放一次。

## 性能与边界

- projector 仍使用固定 100×30 终端和现有 scrollback 上限。
- 实时 Screen Snapshot 仍限制为 12,000 字符；最终投影遵守请求 `maxOutputChars`。
- pipe raw chunk 保持现有 80 条、12,000 字符的 renderer 缓冲边界。
- 画面事件在静止 16ms 后发布，连续输出至少每 50ms 发布一次；不会因 debounce 不断重置而永远不刷新。
- 排队等待 projector 的文本受 1 MiB/512 KiB 高低水位控制；raw 输出不丢弃，但 child 可能在高水位期间因 pipe 背压短暂停顿。
- 不在每个 raw chunk 中复制 Screen Snapshot，降低 IPC 与消息对象内存放大。

## 测试设计

### Projector 与 runner

- `convertEol: true` 时，`alpha\nbeta\ngamma` 三行都从第 0 列开始；默认配置保持 PTY 行为。
- pipe raw chunks 立即、有序、原样到达 output sink，且不含画面字段。
- 同一 50ms 窗口内的清屏和重绘只产生最后一个 `terminal_update`。
- `exit` 后到 `close` 前到达的 stdout/stderr 尾部仍进入 raw、投影和最终结果；`finished` 只能在 `close` 后出现。
- 清屏跨越旧固定窗口边界、随后 16ms 内重绘时，不发布空 `terminal_update`。
- 投影积压跨越 1 MiB 时暂停两条输出流，降至 512 KiB 后恢复，且不丢失投影顺序。
- `close` 前 flush 最后画面，随后产生 `finished`，最终 `terminalOutput` 与最后画面一致。
- projector 创建/写入失败时 raw 输出和最终命令结果不受影响。

### Renderer

- pipe raw 与 terminal update 使用各自路径，且 pipe terminal update 不重复上报活动。
- `messageUpdated` 替换 `parts` 时保留执行中 Shell 的 `shellOutput` 与 `shellRunState`；done part 不保留。
- 存在空 `shellRunState` 时不回退 raw 文本。
- 只收到 `finished` 且不存在既有 `shellRunState` 时不创建空状态。
- 终端输出 CSS 使用固定预格式化布局，不启用 `pre-wrap`。

### 回归验证

- Shell runner、screen projector、PTY runner、Runtime route、聊天历史和 Shell 气泡测试通过。
- Renderer 与 Electron TypeScript 检查通过。
- ESLint、Stylelint 和 `git diff --check` 通过。
- `TIBIS_SHELL_AUTO_DEFAULT_CAPABILITY` 无改动。

## 风险与替代解释

- 固定 100 列可能在窄卡片中产生横向滚动，这是终端字符网格稳定性的明确取舍，不是响应式正文布局。
- trailing settle 不能识别第三方 CLI 的全部语义边界，因此运行中主动清屏并长期保持空白时会暂时保留上一非空帧；这是非交互 pipe 展示稳定性优先的明确取舍，最终结果仍保持真实投影。
- 高水位背压会让极高输出量命令短暂停止写 pipe，但比丢弃输出或让投影 Promise 闭包无限增长更符合保真目标。
- 若修复后仍出现整张卡片闪烁，需要用 Vue 生命周期探针验证是否存在未发现的 key 变化；当前代码证据显示 `part.id` 稳定，未支持“组件反复卸载”的解释。
- `-y` 解决非交互等待，不能解决错位或闪烁；两者必须分开验证。

## 验收标准

1. `skills` 块字符标志保持可读、左对齐，不出现逐行右移或浏览器二次折行。
2. spinner 擦除与重绘不显示空白中间帧，终端卡片高度不随历史帧增长。
3. Runtime 周期性 `messageUpdated` 不再让终端区域消失后重现。
4. pipe stdout/stderr chunk 仍实时连续到达，stream、sequence 和原始文本不变。
5. 命令完成后显示无控制序列的最终投影。
6. projector 失败时命令仍完成并回退 raw 输出。
7. 不启用 PTY、auto-default、自动输入或 `TIBIS_SHELL_AUTO_DEFAULT_CAPABILITY`。
8. 所有工具仍只展示活动状态，并保留现有“继续等待/停止”按钮逻辑。
9. `exit` 与 `close` 之间的尾部输出不会丢失，`finished` 不会提前让 renderer 删除路由。
10. 持续高输出时投影队列有明确内存边界，并在积压消退后自动恢复流。
