# Chat Runtime 失败消息实时投影设计

## 背景

模型流执行失败时，Main 已将 assistant 消息持久化为 `loading: false`、`finished: true` 并写入错误 Part，但 Renderer 仍保留最后一次 `loading: true` 的内存消息。页面级 Session actor 同时因错误路径先收到 `chat:runtime:complete` 而结束 loading，形成页面与消息气泡状态不一致；刷新后重新读取持久化消息才恢复正确视图。

## 根因

`completeFailedRuntime` 复用了成功完成函数 `completeRuntime`。该函数清理 Runtime 后先广播 `chat:runtime:complete`，Renderer 随即注销 Runtime 路由；后续 `chat:runtime:error` 因路由已经不存在而被忽略。失败分支又直接调用消息写入器，没有广播最终 `chat:runtime:message-updated`。

## 设计

将 Runtime 资源清理从成功完成事件中拆为独立内部函数。成功路径继续在清理后广播 `chat:runtime:complete`；失败路径在清理后按以下顺序尽力广播：

1. `chat:runtime:message-updated`，携带已经成功落盘的失败 assistant 终态。
2. `chat:runtime:error`，驱动 Renderer Session actor 进入错误态并注销 Runtime 路由。

失败路径不再广播 `chat:runtime:complete`，避免同一个 Runtime 产生成功和失败两个互斥终态。事件监听异常不能逆转已完成的持久化、资源清理和写锁释放。

### Renderer 降级收敛

IPC 事件不能被视为绝对可靠。若 Renderer 收到 `chat:runtime:error` 时仍保留同一 Runtime 的 loading assistant，则克隆该消息并按 Main 相同规则收敛：未完成或等待用户的工具 Part 转为 failure、移除流式输入、写入错误内容，并将消息标记为 `loading: false`、`finished: true`。已有失败工具 Part 时不再追加重复错误 Part。

若 Main 的失败 assistant 写入失败，错误事件携带 `messagePersistenceFailed: true`。Renderer 在已经收到内存终态的情况下只补做持久化，不追加重复错误消息；正常落盘路径不做冗余整表写入。

### 清理边界

- 工具、确认和 Bridge 请求的初始 Renderer 通知失败时，必须同步移除 pending 记录、定时器和 Abort 监听器；确认请求还必须恢复任务时钟。
- 工具取消通知是旁路信号，异常不得阻止 Promise 终结或 Runtime 清理。
- 默认 Electron emitter 逐窗口发送，跳过已销毁 WebContents，并隔离单个窗口的发送异常。

## 测试

- Main Runtime 服务测试必须断言失败 assistant 的 `message-updated` 事件先于 `runtime:error`。
- 失败 Runtime 不得广播 `runtime:complete`。
- 最终消息事件必须包含 error Part、`loading: false` 和 `finished: true`。
- 终态持久化失败后 Runtime 与会话写锁仍必须释放，错误事件必须要求 Renderer 重试落盘。
- 缺失终态消息事件时，Renderer 必须收敛消息与待处理工具 Part，且不追加重复错误消息。
- 三类 Renderer 请求通知失败后不得残留 pending 投影，单个失效窗口不得阻塞健康窗口。
- 继续运行 Runtime 服务、BChat Session Runtime、TypeScript、ESLint 定向检查，确认既有成功、等待用户和等待 Child 流程不受影响。
