# [Chat Runtime 长任务活性与进展] Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除 Chat Runtime 的 300 秒任务级硬上限，用主进程统一 Watchdog 管理 Renderer、Main 和支持进度通知的 MCP 工具；长任务有活性即可继续，无实质进展时提示用户，无响应时可靠中止。

**Architecture:** 主进程创建每个 `runtimeId + toolCallId` 唯一的 `ToolExecutionWatchdog`。执行边界只能提交带序号的活动事件，Watchdog 使用主进程单调时钟判断活性、实质进展与等待状态，并把节流后的安全快照投影到消息 Part。Chat Runtime 只保留 90 秒模型流停滞边界；非 Chat Runtime 的一次性 AI 调用继续保留 300 秒总时限。

**Tech Stack:** TypeScript、Electron IPC、Vue 3、Pinia、Vercel AI SDK 7、Model Context Protocol SDK 1.29、Vitest、lodash-es。

**Design:** `docs/superpowers/specs/2026-08-03-chat-runtime-long-task-liveness-design.md`

## Global Constraints

- 严格按 TDD 顺序：先写失败测试并确认失败原因，再写最小实现，再运行定向测试。
- 本次工作不执行 `git commit`、不创建提交、不推送；每个任务只做 review checkpoint，最终由用户自行提交。
- 所有新增 `.ts`、`.mts`、`.vue` 文件和函数、接口、复杂逻辑遵守 `AGENTS.md` 的文件头、JSDoc、显式参数/返回类型和禁用 `any` 要求。
- Renderer 异步错误归一化使用 `src/utils/asyncTo.ts` 的 `asyncTo`；不得新增异步 `try/catch` 日志分支。
- Watchdog 参数第一版写成主进程内部常量：默认心跳 15 秒、活性窗口 60 秒、无进展提醒 60 秒、Renderer 开始确认 30 秒、取消宽限期 5 秒、心跳接收上限每秒一次、进展持久化上限每秒一次、活动消息最多 500 个 Unicode 字符。
- 主进程超时判断使用 `performance.now()`；跨进程 `occurredAt` 只用于显示和诊断。持久化时间戳使用 `Date.now()`。
- `heartbeat` 不写数据库；重复进展不更新实质进展时间；`loading` 不参与任何 Watchdog 计时。
- 每完成一个任务运行 `git diff --check`。发现与本计划无关的既有改动时保留，不清理、不覆盖。

## Task 1: 定义稳定的活动、快照、控制与错误契约

**Files:**

- Modify: `types/ai.d.ts`
- Modify: `types/chat.d.ts`
- Modify: `types/chat-runtime.d.ts`
- Modify: `types/electron-api.d.ts`
- Modify: `electron/preload/index.mts`
- Modify: `test/electron/main/modules/chat/runtime/shared-types.test.ts`
- Modify: `test/electron/main/modules/chat/runtime/ipc.test.ts`

- [ ] **Step 1: 写共享契约的失败测试**

在 `test/electron/main/modules/chat/runtime/shared-types.test.ts` 添加编译期 fixture 和运行时构造测试，固定以下约束：

```ts
/**
 * 合法的 Renderer 工具实质进展事件。
 */
const progressInput: ChatRuntimeSubmitToolActivityInput = {
  runtimeId: 'runtime-1',
  toolCallId: 'tool-1',
  sequence: 2,
  occurredAt: 1_000,
  activity: {
    kind: 'progress',
    progress: {
      phase: 'scan',
      completed: 3,
      total: 10,
      message: '已扫描 3 个目录',
    },
  },
}

/**
 * 合法的单工具控制输入。
 */
const stopInput: ChatRuntimeControlToolInput = {
  runtimeId: 'runtime-1',
  toolCallId: 'tool-1',
  action: 'stop',
}

expect(progressInput.activity.kind).toBe('progress')
expect(stopInput.action).toBe('stop')
```

同时用 `@ts-expect-error` 固定外部等待必须同时包含 `reason`、`retryAt` 和 `deadlineAt`，错误码联合类型必须接受 `TOOL_UNRESPONSIVE`、`EXTERNAL_WAIT_TIMEOUT`、`USER_CANCELLED`、`RUNTIME_INTERRUPTED`。

- [ ] **Step 2: 运行测试并确认契约尚不存在**

Run: `pnpm exec vitest run test/electron/main/modules/chat/runtime/shared-types.test.ts`

Expected: FAIL，错误指向新增的 `ChatRuntimeSubmitToolActivityInput`、`ChatRuntimeControlToolInput` 或活动快照类型未定义，而不是测试环境错误。

- [ ] **Step 3: 添加共享类型**

在 `types/chat-runtime.d.ts` 定义判别联合：

```ts
/** 工具活动状态。 */
type ChatToolActivityState =
  | 'starting'
  | 'executing'
  | 'running_idle'
  | 'waiting_user'
  | 'waiting_external'
  | 'stopping'
  | 'interrupted'

/** 可持久化的工具进展快照。 */
interface ChatToolProgressSnapshot {
  /** 稳定阶段标识。 */
  phase: string
  /** 已完成工作量。 */
  completed?: number
  /** 总工作量。 */
  total?: number
  /** 面向用户的短说明。 */
  message?: string
  /** 本次进展新增或更新的安全产物引用。 */
  artifacts?: ChatToolArtifactRef[]
  /** 主进程接受进展的墙钟时间。 */
  updatedAt: number
}

/** 不包含产物正文的安全引用。 */
interface ChatToolArtifactRef {
  /** 产物稳定标识。 */
  id: string
  /** 产物类型。 */
  kind: string
  /** 面向用户的短名称。 */
  label?: string
}

/** 工具等待外部条件的有限期限。 */
interface ChatToolExternalWait {
  /** 等待原因。 */
  reason: string
  /** 允许下一次重试的墙钟时间。 */
  retryAt: number
  /** 最晚等待截止时间。 */
  deadlineAt: number
}

/** 工具卡片持久化的最后活动状态。 */
interface ChatToolActivitySnapshot {
  /** 当前活动状态。 */
  state: ChatToolActivityState
  /** 最后接受的执行器序号。 */
  sequence: number
  /** 最后实质进展的墙钟时间。 */
  lastProgressAt?: number
  /** 最后安全进展快照。 */
  progress?: ChatToolProgressSnapshot
  /** 等待用户时的简短原因。 */
  userPrompt?: string
  /** 等待外部条件的信息。 */
  externalWait?: ChatToolExternalWait
  /** 用户确认继续等待的时间。 */
  idleAcknowledgedAt?: number
}

/** 执行器可提交的工具活动联合。 */
type ChatRuntimeToolActivity =
  | { kind: 'started' }
  | { kind: 'heartbeat' }
  | { kind: 'progress'; progress: Omit<ChatToolProgressSnapshot, 'updatedAt'> }
  | { kind: 'waiting_user'; prompt: string }
  | { kind: 'waiting_external'; wait: ChatToolExternalWait }
  | { kind: 'resumed' }

/** Renderer 到主进程的活动事件。 */
interface ChatRuntimeSubmitToolActivityInput {
  /** 所属 Runtime。 */
  runtimeId: string
  /** 所属工具调用。 */
  toolCallId: string
  /** 单执行器严格递增序号。 */
  sequence: number
  /** 执行器观察到事件的墙钟时间，仅用于诊断。 */
  occurredAt: number
  /** 不包含终态的活动。 */
  activity: ChatRuntimeToolActivity
}

/** 用户针对一个在途工具的控制。 */
interface ChatRuntimeControlToolInput {
  /** 所属 Runtime。 */
  runtimeId: string
  /** 所属工具调用。 */
  toolCallId: string
  /** 继续等待或停止。 */
  action: 'continue_waiting' | 'stop'
}
```

活动提交联合必须包含 `started`、`heartbeat`、`progress`、`waiting_user`、`waiting_external`、`resumed`；终态继续由现有工具结果协议负责，避免活动事件与结果事件竞争终态。控制动作只允许 `continue_waiting | stop`。

在 `types/chat.d.ts` 的 `ChatMessageToolPart` 增加可选 `activity?: ChatToolActivitySnapshot`，保留现有 `status` 字段兼容消息渲染。在 `types/ai.d.ts` 扩展稳定错误码，并为 `AIToolContext` 增加只读活动上报器：

```ts
/** 工具内部可用的受限活动上报器。 */
interface AIToolActivityReporter {
  /** 上报存活，不代表实质进展。 */
  heartbeat(): void
  /** 上报新的实质进展。 */
  progress(progress: Omit<ChatToolProgressSnapshot, 'updatedAt'>): void
  /** 进入等待用户状态。 */
  waitUser(prompt: string): void
  /** 进入有限期限的外部等待状态。 */
  waitExternal(wait: ChatToolExternalWait): void
  /** 从等待状态恢复执行。 */
  resume(): void
}
```

- [ ] **Step 4: 增加 preload 与 Electron API 方法签名**

在 `types/electron-api.d.ts` 与 `electron/preload/index.mts` 暴露并保持一一对应：

```ts
chatRuntimeSubmitToolActivity(
  input: ChatRuntimeSubmitToolActivityInput,
): Promise<ChatRuntimeHandlerResult<void>>
chatRuntimeControlTool(
  input: ChatRuntimeControlToolInput,
): Promise<ChatRuntimeHandlerResult<void>>
```

只使用新的 IPC channel，不让 Renderer 直接访问 Watchdog 内部状态或截止时间。

- [ ] **Step 5: 运行契约与 preload 测试**

Run: `pnpm exec vitest run test/electron/main/modules/chat/runtime/shared-types.test.ts test/electron/main/modules/chat/runtime/ipc.test.ts`

Expected: PASS；类型 fixture、preload 方法名与 IPC 参数结构一致。

- [ ] **Step 6: Review checkpoint**

Run: `git diff --check`

Expected: PASS；仅保留未提交改动，不运行任何提交命令。

## Task 2: 以纯状态机实现主进程 ToolExecutionWatchdog

**Files:**

- Create: `electron/main/modules/chat/runtime/controllers/tool-watchdog.mts`
- Test: `test/electron/main/modules/chat/runtime/tool-watchdog.test.ts`

- [ ] **Step 1: 用可控时钟写完整失败测试矩阵**

测试使用 fake timers，并注入单调时钟和墙钟：

```ts
/** 测试用可控 Watchdog 时钟。 */
const clock: ToolWatchdogClock = {
  monotonicNow: (): number => performance.now(),
  wallNow: (): number => Date.now(),
}

const watchdogs = createToolWatchdogs({
  clock,
  heartbeatMs: 15_000,
  livenessMs: 60_000,
  idleMs: 60_000,
  cancelGraceMs: 5_000,
})
```

逐条固定行为：

- `start()` 初始为 `starting`，60 秒没有 `started` 时以 `TOOL_UNRESPONSIVE` 中止。
- `started` 转到 `executing`；`heartbeat` 只刷新活性时间。
- 新的 `progress` 同时刷新活性和实质进展；完全相同的快照只刷新活性。
- 只有心跳、60 秒没有实质进展时进入 `running_idle`，`settled` 不结束。
- `continue_waiting` 回到 `executing` 并重置提醒窗口，但不改变 `lastProgressAt`。
- `waiting_user` 暂停两个时钟；`resumed` 使用进入等待前的剩余时间。
- `waiting_external` 缺少字段、`deadlineAt <= retryAt` 或期限已过时被拒绝；有效等待到期返回 `EXTERNAL_WAIT_TIMEOUT`。
- `waiting_external` 暂停普通活性与无进展提醒，`retryAt` 之前的 `resumed` 被拒绝；到 `deadlineAt` 仍未恢复时返回 `EXTERNAL_WAIT_TIMEOUT`。
- 乱序序号、错误 Runtime、错误 toolCall、终态后的事件均返回 `false` 且不能续期。
- 心跳每个工具每秒最多接受一次；消息截断为最多 500 个 Unicode 字符。
- `stop` 先投影 `stopping`、中止根信号，5 秒后仍未 `finish` 时将 `settled` 收敛为 `USER_CANCELLED`。
- `clearRuntime` 清理全部定时器并把未结束调用收敛为 `RUNTIME_INTERRUPTED`。

- [ ] **Step 2: 确认状态机测试失败**

Run: `pnpm exec vitest run test/electron/main/modules/chat/runtime/tool-watchdog.test.ts`

Expected: FAIL，原因是 `createToolWatchdogs` 与相关接口尚不存在。

- [ ] **Step 3: 实现 Watchdog 公开边界**

文件顶部包含说明注释。公开对象限制为以下能力：

```ts
/** 单个工具调用的 Watchdog 租约。 */
export interface ToolWatchdogLease {
  /** Watchdog 终止工具时触发的信号。 */
  readonly signal: AbortSignal
  /** Watchdog 主动收敛时返回的结构化工具结果。 */
  readonly settled: Promise<AIToolExecutionResult>
  /** Main 或 MCP 执行器提交内部活动。 */
  report(activity: ChatRuntimeToolActivity): boolean
  /** 工具自然完成后释放租约。 */
  finish(): void
}

/** Runtime 级 Watchdog 注册表。 */
export interface ToolWatchdogs {
  start(input: StartToolWatchdogInput): ToolWatchdogLease
  submit(input: ChatRuntimeSubmitToolActivityInput): boolean
  control(input: ChatRuntimeControlToolInput): boolean
  read(runtimeId: string, toolCallId: string): ChatToolActivitySnapshot | null
  clear(runtimeId: string, code: 'RUNTIME_INTERRUPTED' | 'USER_CANCELLED'): void
}
```

内部 key 使用不可歧义的二级 `Map<runtimeId, Map<toolCallId, Entry>>`。定时器始终由入口对象持有并在 `finish`、`clear`、终态时清除。不得把定时器、AbortController 或原始活动事件写进消息。

- [ ] **Step 4: 实现实质进展判定与节流投影**

用 `lodash-es` 的 `isEqual` 比较规范化后的 `phase/completed/total/message/artifacts`。只有不同快照更新 `lastProgressAt`。每个入口保存 `lastPersistTick` 与待写快照：

- `starting`、`running_idle`、等待状态、`stopping` 立即调用 `onChange(snapshot, true)`。
- 新进展立即更新内存，但 `onChange(snapshot, false)` 每秒最多一次；窗口内的新进展合并成最后一份。
- `heartbeat` 不调用 `onChange`。
- `message` 使用 `Array.from(message).slice(0, 500).join('')`，按 Unicode code point 截断。

- [ ] **Step 5: 运行状态机测试**

Run: `pnpm exec vitest run test/electron/main/modules/chat/runtime/tool-watchdog.test.ts`

Expected: PASS，fake timers 结束后 `vi.getTimerCount()` 为 0。

- [ ] **Step 6: Review checkpoint**

Run: `git diff --check`

Expected: PASS；不提交代码。

## Task 3: 把活动快照投影到 Runtime 消息，并让 Watchdog 成为工具超时唯一事实来源

**Files:**

- Modify: `electron/main/modules/chat/runtime/types.mts`
- Modify: `electron/main/modules/chat/runtime/service.mts`
- Modify: `electron/main/modules/chat/runtime/stream/message-parts.mts`
- Modify: `electron/main/modules/chat/runtime/stream/types.mts`
- Modify: `electron/main/modules/chat/runtime/stream/index.mts`
- Modify: `electron/main/modules/chat/runtime/stream/tools.mts`
- Modify: `electron/main/modules/chat/runtime/tools/index.mts`
- Modify: `electron/main/modules/chat/runtime/controllers/confirmation.mts`
- Modify: `test/electron/main/modules/chat/runtime/stream/message-parts.test.ts`
- Modify: `test/electron/main/modules/chat/runtime/stream/tools.test.ts`
- Modify: `test/electron/main/modules/chat/runtime/stream/executor.test.ts`
- Modify: `test/electron/main/modules/chat/runtime/service.test.ts`

- [ ] **Step 1: 写消息投影与工具竞态失败测试**

固定以下回归场景：

- `applyToolActivity` 只更新目标 `toolCallId`，不改变其他 Part。
- `heartbeat` 不触发消息持久化；新的节流进展会更新 `part.activity`。
- 工具成功或失败结果落盘后清除非终态活动，现有 `status/output/error` 保持兼容。
- MCP progress 早于 tool-call Part 到达时先缓存在 `toolCallId` Map；Part 创建后只应用最后快照并删除缓存。
- Main/Renderer 工具自然完成时调用 `lease.finish()`；Watchdog 先收敛时底层收到 abort，返回 Watchdog 的结构化错误。
- 用户确认期间状态为 `waiting_user`，不再调用已删除的任务时钟暂停方法。
- Runtime 清理先关闭 Watchdog，再清除 Renderer/确认/bridge 请求。

- [ ] **Step 2: 确认定向测试失败**

Run: `pnpm exec vitest run test/electron/main/modules/chat/runtime/stream/message-parts.test.ts test/electron/main/modules/chat/runtime/stream/tools.test.ts test/electron/main/modules/chat/runtime/stream/executor.test.ts test/electron/main/modules/chat/runtime/service.test.ts`

Expected: FAIL，现有执行器仍使用固定工具总时限，消息 Part 也没有活动投影。

- [ ] **Step 3: 增加消息 Part 纯更新函数**

在 `stream/message-parts.mts` 增加：

```ts
/**
 * 更新单个工具 Part 的安全活动快照。
 * @param parts - 当前消息 Part。
 * @param toolCallId - 目标工具调用。
 * @param activity - Watchdog 已验证的活动快照。
 * @returns 结构共享的新 Part 数组；目标不存在时返回原数组。
 */
export function applyToolActivity(
  parts: ChatMessagePart[],
  toolCallId: string,
  activity: ChatToolActivitySnapshot,
): ChatMessagePart[]
```

不得持久化原始事件、心跳、AbortSignal 或工具输入。终态结果沿用现有 `appendToolResult`，只删除该 Part 的临时活动状态或投影 `interrupted` 解释信息。

- [ ] **Step 4: 在 ChatRuntimeService 创建唯一 Watchdog 注册表**

`createChatRuntimeService` 每个服务实例只创建一个 `toolWatchdogs`。向 stream executor 传递注册表，`cleanupRuntime` 顺序固定为：

1. `toolWatchdogs.clear(runtimeId, reasonCode)`；
2. 拒绝 Renderer、确认和 bridge pending 请求；
3. 释放 Runtime、会话锁和内存 Map。

活动投影回调更新当前 assistant Part，立即事件直接持久化；普通进展通过 Watchdog 每秒一次的回调进入现有 `persistAssistant` 串行写链，禁止新建并行数据库写队列。

- [ ] **Step 5: 用租约替换 Main/Renderer 固定执行竞态**

在 `stream/tools.mts` 让安全执行函数接收 `ToolWatchdogLease`，合并 Runtime signal 与 lease signal，竞态只包含实际执行 Promise 和 `lease.settled`：

```ts
const result = await Promise.race([
  executeTool(combinedSignal),
  lease.settled,
])
lease.finish()
return result
```

组合信号使用 `AbortSignal.any`；项目目标 Electron/Node 版本若缺少原生类型，则增加有清理函数的局部 helper，不引入轮询。删除 `createPausableToolTimeout` 和 `timeoutControls`。Renderer 的 30 秒开始确认仍暂留在 controller，Task 4 再拆分。

Main 工具租约创建后由执行边界立即报告 `started`，并每 15 秒报告一次 heartbeat；自然完成、失败或 abort 时清理 timer。Renderer 租约等待 Renderer 自己的 `started`，不得由主进程代发。MCP 租约按 Task 6 的首个 progress 动态升级规则创建。

- [ ] **Step 6: 迁移 Main 工具确认等待**

Main 工具输入通过不可枚举属性获得 `AIToolActivityReporter`。`requestConfirmation` 前调用 `waitUser(prompt)`，确认成功后调用 `resume()`；拒绝时返回 `USER_CANCELLED`。`confirmation.mts` 删除 `pauseRuntimeTaskClock/resumeRuntimeTaskClock` 调用。

不可枚举属性的测试必须验证 `JSON.stringify(input)` 与重复工具比较输入中都没有 reporter。

- [ ] **Step 7: 运行 Runtime 定向测试**

Run: `pnpm exec vitest run test/electron/main/modules/chat/runtime/stream/message-parts.test.ts test/electron/main/modules/chat/runtime/stream/tools.test.ts test/electron/main/modules/chat/runtime/stream/executor.test.ts test/electron/main/modules/chat/runtime/service.test.ts`

Expected: PASS；Watchdog 是支持活动协议工具唯一的超时收敛源。

- [ ] **Step 8: Review checkpoint**

Run: `git diff --check`

Expected: PASS；不提交代码。

## Task 4: 拆分 Renderer 开始确认边界并接通活动与控制 IPC

**Files:**

- Modify: `electron/main/modules/chat/runtime/controllers/renderer-tool.mts`
- Modify: `electron/main/modules/chat/runtime/service.mts`
- Modify: `electron/main/modules/chat/runtime/ipc.mts`
- Modify: `electron/preload/index.mts`
- Create: `test/electron/main/modules/chat/runtime/renderer-tool.test.ts`
- Modify: `test/electron/main/modules/chat/runtime/ipc.test.ts`
- Modify: `test/electron/main/modules/chat/runtime/stream/tools.test.ts`

- [ ] **Step 1: 写 Renderer controller 失败测试**

覆盖：

- 请求发出后 30 秒内没有 `started`，返回现有 Renderer 不可达错误并发出取消事件。
- `started` 在 30 秒内到达后清除开始确认 timer；工具运行超过 60 秒不会被 controller 自己终止。
- 后续心跳/进展仅在 pending 的 `runtimeId + toolCallId` 精确匹配时转交 Watchdog。
- 最终结果只允许提交一次；结果、Runtime abort 或 Watchdog stop 都会清除 pending 和 timer。
- 晚到活动和乱序活动返回 `{ accepted: false }`。

- [ ] **Step 2: 确认测试失败**

Run: `pnpm exec vitest run test/electron/main/modules/chat/runtime/renderer-tool.test.ts test/electron/main/modules/chat/runtime/ipc.test.ts test/electron/main/modules/chat/runtime/stream/tools.test.ts`

Expected: FAIL，现有 30 秒 timer 仍覆盖整个 Renderer 工具执行周期，且活动 IPC 不存在。

- [ ] **Step 3: 把固定 timer 改为开始确认 timer**

`PendingRendererToolRequest` 增加 `started: boolean`。`acceptActivity(input)` 只在合法的首个 `started` 事件清理 timer 并返回 `true`，不会重建执行总时限。结果提交前若从未开始也允许收敛，以兼容立即失败的 Renderer 工具。

控制器仍负责请求 Promise 生命周期；Watchdog 负责开始后的活性和进展判断。两者不得创建覆盖相同执行阶段的 timer。

- [ ] **Step 4: 注册活动与单工具控制 IPC**

在 `ipc.mts`、主进程 handler 与 preload 暴露层使用并测试以下精确 channel 字符串：

```ts
'chat:runtime:tool-activity'
'chat:runtime:tool-control'
```

活动 handler 先由 Renderer controller 验证该执行请求属于当前窗口和当前 pending 调用，再交给 `toolWatchdogs.submit(input)`；控制 handler 验证 Runtime 所属会话后调用 `toolWatchdogs.control(input)`。`stop` 只中止目标工具，不能调用全局 `abortRuntime`。

- [ ] **Step 5: 运行 Renderer 主进程测试**

Run: `pnpm exec vitest run test/electron/main/modules/chat/runtime/renderer-tool.test.ts test/electron/main/modules/chat/runtime/ipc.test.ts test/electron/main/modules/chat/runtime/stream/tools.test.ts`

Expected: PASS；确认开始后 advancing fake timer 超过 60 秒不会触发 controller 固定超时，Watchdog 无活动测试仍会在 60 秒收敛。

- [ ] **Step 6: Review checkpoint**

Run: `git diff --check`

Expected: PASS；不提交代码。

## Task 5: Renderer 执行器上报心跳/进展，并提供工具卡片控制

**Files:**

- Modify: `src/hooks/useChat/useRuntimeEvents.ts`
- Modify: `src/hooks/useChat/useRuntimeRecovery.ts`
- Modify: `src/ai/tools/stream.ts`
- Modify: `src/components/BChat/components/MessageBubble.vue`
- Modify: `src/components/BChat/components/MessageBubble/BubblePartTool/index.vue`
- Modify: `src/components/BChat/utils/submitAction.ts`
- Modify: `src/components/BChat/hooks/useChatSubmitter.ts`
- Modify: `src/components/BChat/hooks/useChatWorkflow.ts`
- Modify: `test/hooks/use-runtime-events.test.ts`
- Modify: `test/hooks/use-runtime-recovery.test.ts`
- Modify: `test/components/BChat/runtime-event-test-utils.ts`
- Modify: `test/components/BChat/runtime-event-test-utils.test.ts`
- Create: `test/components/BChat/bubble-part-tool-activity.component.test.ts`

- [ ] **Step 1: 写 Renderer 活动桥失败测试**

用 fake timers 固定：

- 收到 `tool-request` 后，在执行工具前先发送序号 1 的 `started`。
- 执行期间每 15 秒发送递增序号的 `heartbeat`；结束和 abort 后 timer 清零。
- 工具 reporter 的 `progress` 使用同一序号生成器，不产生重复序号。
- Shell 会话只有收到新的 stdout/stderr 片段或命令阶段变化时发送 `progress`；没有新输出只发送 heartbeat。
- 提交最终结果失败仍清理 heartbeat 与 AbortController。
- 恢复快照里的不可恢复 Renderer 工具提交 `RUNTIME_INTERRUPTED`，不再使用 `EDITOR_UNAVAILABLE` 假装执行器可重建。

- [ ] **Step 2: 写工具卡片失败测试**

挂载 `BubblePartTool`，逐个断言：

- `executing` 显示最新 phase、数量和 message。
- `running_idle` 显示“仍在运行”、最后进展时间、“继续等待”和“停止”。
- `waiting_user`、`waiting_external`、`stopping`、`interrupted` 使用不同文案。
- 点击“继续等待”提交 `continue_waiting`；点击“停止”提交 `stop`，参数精确包含当前 runtime/toolCall。
- 没有 `runtimeId` 或 Part 已终态时不渲染控制按钮。

- [ ] **Step 3: 确认测试失败**

Run: `pnpm exec vitest run test/hooks/use-runtime-events.test.ts test/hooks/use-runtime-recovery.test.ts test/components/BChat/runtime-event-test-utils.test.ts test/components/BChat/bubble-part-tool-activity.component.test.ts`

Expected: FAIL，Renderer 尚未发送活动事件，工具卡片也没有新状态和控制动作。

- [ ] **Step 4: 扩展 Renderer 工具执行元数据**

在 `src/ai/tools/stream.ts` 将 reporter 放入现有 `ToolExecutionMetadata` 并传到 `AIToolContext`：

```ts
/** Renderer 工具的 Runtime 元数据。 */
interface ToolExecutionMetadata {
  /** Runtime 标识。 */
  runtimeId?: string
  /** 工具调用标识。 */
  toolCallId?: string
  /** 取消信号。 */
  abortSignal?: AbortSignal
  /** 受限活动上报器。 */
  activity?: AIToolActivityReporter
}
```

`useRuntimeEvents` 为每次调用创建闭包内 sequence，先提交 `started`，再启动 15 秒 heartbeat。`progress`、等待和恢复都通过同一 `submitActivity` helper，helper 负责递增序号和附加 `occurredAt: Date.now()`。

- [ ] **Step 5: 映射 Shell 语义进展**

Shell session 事件保持现有 Runtime 归属检查。新输出将 `phase: 'shell_output'`、累积字符数作为 `completed`、最后一段截断摘要作为 message；进程启动和退出使用不同 phase。相同累积计数不得再次报告 progress。

不得把完整 shell 输出写进活动 message；完整结果仍走现有工具结果通道。

- [ ] **Step 6: 增加工具卡片控制动作**

`MessageBubble.vue` 把消息 `runtimeId` 和现有 `submitAction` 传给 `BubblePartTool`。`submitAction.ts` 增加具名 action 工厂，最终调用：

```ts
await window.electronAPI.chatRuntimeControlTool({
  runtimeId,
  toolCallId,
  action,
})
```

按钮请求期间只禁用当前工具卡片，不修改全局 Runtime loading。UI 只读取持久化 `part.activity`；不得用 spinner 或组件挂载时间推导活性。

- [ ] **Step 7: 运行 Renderer 定向测试**

Run: `pnpm exec vitest run test/hooks/use-runtime-events.test.ts test/hooks/use-runtime-recovery.test.ts test/components/BChat/runtime-event-test-utils.test.ts test/components/BChat/bubble-part-tool-activity.component.test.ts`

Expected: PASS；所有 heartbeat interval 和事件订阅在测试结束后释放。

- [ ] **Step 8: 运行样式检查**

Run: `pnpm exec stylelint 'src/components/BChat/**/*.{vue,less,css}'`

Expected: PASS；新样式使用 `createNamespace` 生成的完整 BEM 类名，不新增 `&__xxx` 或 `&--xxx`。

- [ ] **Step 9: Review checkpoint**

Run: `git diff --check`

Expected: PASS；不提交代码。

## Task 6: 把 MCP 进度通知和兼容工具接入分层策略

**Files:**

- Modify: `electron/main/modules/ai/service.mts`
- Modify: `electron/main/modules/ai/tool-loop-policy.mts`
- Modify: `electron/main/modules/mcp/client.mts`
- Modify: `electron/main/modules/mcp/session.mts`
- Modify: `electron/main/modules/mcp/tools.mts`
- Modify: `electron/main/modules/chat/runtime/stream/types.mts`
- Modify: `electron/main/modules/chat/runtime/stream/index.mts`
- Create: `test/electron/main/modules/mcp/client.test.ts`
- Create: `test/electron/main/modules/mcp/tools.test.ts`
- Modify: `test/electron/main/modules/ai/service.test.ts`
- Modify: `test/electron/main/modules/ai/tool-loop-policy.test.ts`

- [ ] **Step 1: 写 MCP 与策略失败测试**

覆盖：

- AI SDK 传入的 `toolCallId` 能关联同一 Runtime 工具调用；首个 MCP progress 到达时将该调用从兼容静态超时升级为 Watchdog 租约。
- MCP `onprogress` 的新 `progress/total/message` 映射为统一 `progress`；完全相同通知映射为 heartbeat，不伪造实质进展。
- MCP 调用合并 SDK abort signal 与 Watchdog signal；Watchdog 无活动超时时底层 MCP request 收到 abort。
- 首个进度在 60 秒兼容窗口内到达后清除静态 timer；支持进度的 MCP 工具运行超过 60 秒但持续报告有效活动时不被静态 `toolMs` 终止。
- 没有进度能力的 MCP 工具与 Tavily 仍受 60 秒兼容超时保护，错误保持 `TOOL_TIMEOUT`。
- Runtime AI SDK timeout 只有 `chunkMs: 90_000`；非 Runtime timeout 仍有 `totalMs: 300_000` 与 `toolMs: 60_000`。

- [ ] **Step 2: 确认测试失败**

Run: `pnpm exec vitest run test/electron/main/modules/mcp/client.test.ts test/electron/main/modules/mcp/tools.test.ts test/electron/main/modules/ai/service.test.ts test/electron/main/modules/ai/tool-loop-policy.test.ts`

Expected: FAIL，MCP request options 尚未接收进度回调，Runtime 策略仍含固定 tool/total timeout。

- [ ] **Step 3: 拆分 Runtime 与直接调用超时常量**

在 `tool-loop-policy.mts` 使用明确命名：

```ts
/** 非 Chat Runtime 一次性 AI 调用的固定保护。 */
export const AI_DIRECT_REQUEST_TIMEOUT = {
  totalMs: 300_000,
  chunkMs: 90_000,
  toolMs: 60_000,
} as const

/** Chat Runtime 模型流只保留停滞检测。 */
export const AI_RUNTIME_STREAM_TIMEOUT = {
  chunkMs: 90_000,
} as const

/** 不支持活动协议的工具兼容超时。 */
export const AI_LEGACY_TOOL_TIMEOUT_MS = 60_000
```

禁止用 `Math.min(toolTimeout, totalTimeout)` 重新制造 Runtime 工具总时限。

- [ ] **Step 4: 向 AI Service 传入受限活动桥**

Runtime stream call options 增加仅内部使用的 `toolActivity` bridge。MCP execute 收到 AI SDK `toolCallId` 后进入 60 秒兼容观察期；首个合法 MCP progress 到达时向 bridge 获取 lease、把该 progress 作为租约首个事件并清除兼容 timer，最终完成时调用 `finish()`。Renderer schema-only 工具不在 AI Service 内启动第二个 lease，避免同一 toolCall 重复注册。

- [ ] **Step 5: 映射 MCP SDK RequestOptions**

`client.mts`/`session.mts` 的 `callTool` 增加明确 options 类型，向 MCP SDK 传递 `signal`、`onprogress`、`timeout: 65_000`、`resetTimeoutOnProgress: true`，并且不设置 `maxTotalTimeout`。`onprogress` 会让 SDK 自动携带 `progressToken`。活动协议生效后由 Watchdog 60 秒无活动边界负责；65 秒 SDK timeout 只作为通道故障兜底，不能比 Watchdog 更早收敛。

MCP 协议没有可依赖的工具级“支持 progress”发现标志，因此调用先按旧工具处理：首个 progress 到达前由 `AI_LEGACY_TOOL_TIMEOUT_MS` 的局部 timer 保护并在到期时返回 `TOOL_TIMEOUT`；首个 progress 到达后清除该 timer、启动 Watchdog，并把 Watchdog signal 转发到本次 MCP request 的局部 AbortController。不得根据 MCP 连接仍在线推导工具存活，也不得同时保留兼容 timer 和 Watchdog timer。

- [ ] **Step 6: 给 Tavily 保留局部兼容超时**

AI SDK Runtime 级 `toolMs` 删除后，Tavily HTTP execute 自己合并调用 signal 与 `AbortSignal.timeout(AI_LEGACY_TOOL_TIMEOUT_MS)`。超时归一化为 `TOOL_TIMEOUT`，用户/Runtime abort 保持 `USER_CANCELLED` 或既有取消语义。

- [ ] **Step 7: 运行 MCP 与 AI 策略测试**

Run: `pnpm exec vitest run test/electron/main/modules/mcp/client.test.ts test/electron/main/modules/mcp/tools.test.ts test/electron/main/modules/ai/service.test.ts test/electron/main/modules/ai/tool-loop-policy.test.ts`

Expected: PASS；支持进度和兼容工具走不同、明确且不重叠的超时路径。

- [ ] **Step 8: Review checkpoint**

Run: `git diff --check`

Expected: PASS；不提交代码。

## Task 7: 移除 Chat Runtime 300 秒任务时钟，同时保留直接 AI 调用保护

**Files:**

- Delete: `electron/main/modules/chat/runtime/task-clock.mts`
- Modify: `electron/main/modules/chat/runtime/types.mts`
- Modify: `electron/main/modules/chat/runtime/service.mts`
- Modify: `electron/main/modules/chat/runtime/stream/types.mts`
- Modify: `electron/main/modules/chat/runtime/stream/index.mts`
- Modify: `electron/main/modules/chat/runtime/compaction/executor.mts`
- Modify: `electron/main/modules/chat/runtime/compaction/summary-generator.mts`
- Modify: `electron/main/modules/ai/service.mts`
- Test: `test/electron/main/modules/chat/runtime/service.test.ts`
- Test: `test/electron/main/modules/chat/runtime/stream/executor.test.ts`
- Test: `test/electron/main/modules/chat/runtime/compaction/executor.test.ts`
- Test: `test/electron/main/modules/ai/service.test.ts`

- [ ] **Step 1: 写超过 300 秒仍可推进的失败测试**

使用 fake timers 验证：

- Runtime 模型分段、工具进展、续轮累计墙钟超过 300 秒，只要每段模型流在 90 秒内有 chunk、工具在 60 秒内有活动，就能正常完成。
- 自动与手动 compaction 不再收到 Runtime task deadline；每次摘要调用仍由 `AI_DIRECT_REQUEST_TIMEOUT.totalMs` 单独保护。
- Chat Runtime stream options 不再包含 `totalTimeoutMs`。
- 非 Runtime `generateText/streamText` 在 300 秒截止时仍被中止。
- 代码与错误文案中不再出现“本次 AI 任务已达到固定的 300 秒总时限”。

- [ ] **Step 2: 确认测试失败**

Run: `pnpm exec vitest run test/electron/main/modules/chat/runtime/service.test.ts test/electron/main/modules/chat/runtime/stream/executor.test.ts test/electron/main/modules/chat/runtime/compaction/executor.test.ts test/electron/main/modules/ai/service.test.ts`

Expected: FAIL，现有 `taskDeadlineAt`、`totalTimeoutMs` 和硬编码 300 秒错误仍然生效。

- [ ] **Step 3: 删除 Runtime 任务时钟**

删除 `task-clock.mts`，并移除 `ActiveChatRuntime` 的：

```ts
taskDeadlineAt
taskPausedAt
taskPausedDurationMs
taskPauseDepth
```

移除 `getRuntimeTaskTimeout`、`prepareContextBeforeDeadline` 和所有 pause/resume 调用。`prepareRequestContext` 直接执行现有上下文准备逻辑，失败继续走原错误归一化，不再构造固定 300 秒提示。

- [ ] **Step 4: 从 Runtime stream 与 compaction 移除总截止参数**

删除 `ChatRuntimeStreamExecutorInput.totalTimeoutMs` 和 `RuntimeStreamCallOptions.totalTimeoutMs`。Runtime 调用 AI Service 时只传 `runtimeToolLoop: true`、`forceFinal`、`toolActivity`。

自动/手动 compaction 不再传 `taskDeadlineAt`。`summary-generator.mts` 直接调用非 Runtime `generateText`，因此单次摘要仍自然继承 300 秒直接调用保护，而不是继承用户任务累计时间。

- [ ] **Step 5: 保证 AI Service 只对直接调用创建总 deadline signal**

`AIServiceCallOptions.runtimeToolLoop === true` 时不创建 `totalMs` deadline signal，只组合调用方 signal 与模型 `chunkMs` 策略；其他调用继续使用 `AI_DIRECT_REQUEST_TIMEOUT.totalMs`。

- [ ] **Step 6: 全仓检查旧语义**

Run: `rg -n "AI_TASK_TIMEOUT_MS|taskDeadlineAt|taskPausedAt|taskPauseDepth|totalTimeoutMs|固定的 300 秒总时限" electron/main/modules/chat electron/main/modules/ai test/electron/main/modules/chat test/electron/main/modules/ai`

Expected: 没有 Chat Runtime 任务级命中；允许测试名或直接 AI 调用常量出现 `300_000`，但不得复用旧的模糊常量名。

- [ ] **Step 7: 运行 Runtime 与直接调用测试**

Run: `pnpm exec vitest run test/electron/main/modules/chat/runtime/service.test.ts test/electron/main/modules/chat/runtime/stream/executor.test.ts test/electron/main/modules/chat/runtime/compaction/executor.test.ts test/electron/main/modules/ai/service.test.ts`

Expected: PASS；Runtime 超过 300 秒继续，直接调用 300 秒保护仍生效。

- [ ] **Step 8: Review checkpoint**

Run: `git diff --check`

Expected: PASS；不提交代码。

## Task 8: 补齐 Main 长工具进展、取消宽限期和恢复语义

**Files:**

- Modify: `electron/main/modules/chat/runtime/tools/file-search.mts`
- Modify: `electron/main/modules/chat/runtime/tools/subprocess-runner.mts`
- Modify: `electron/main/modules/chat/runtime/service.mts`
- Modify: `test/electron/main/modules/chat/runtime/file-search.test.ts`
- Create: `test/electron/main/modules/chat/runtime/subprocess-runner.test.ts`
- Modify: `test/electron/main/modules/chat/runtime/recovery-requests.test.ts`

- [ ] **Step 1: 写 Main 工具与恢复失败测试**

覆盖：

- 文件搜索在扫描开始、每批新命中和完成阶段上报不同 progress；等待下一批期间只 heartbeat。
- 子进程新 stdout/stderr 增加累积字节数并上报 progress；重复空输出不更新进展。
- 用户停止或 Watchdog 超时时先发送 AbortSignal；子进程 5 秒内退出时不强杀。
- 5 秒仍未退出时只 kill 当前 runner 明确持有的 PID/进程组，不能使用名称匹配或宽泛 kill。
- Runtime recovery 遇到持久化 `starting/executing/running_idle/waiting_* /stopping` 且没有恢复契约的 Part，标记 `interrupted` 并生成 `RUNTIME_INTERRUPTED` 结构化结果。
- recovery 不从持久化 heartbeat 重建计时器，也不复活旧 Promise。

- [ ] **Step 2: 确认测试失败**

Run: `pnpm exec vitest run test/electron/main/modules/chat/runtime/file-search.test.ts test/electron/main/modules/chat/runtime/subprocess-runner.test.ts test/electron/main/modules/chat/runtime/recovery-requests.test.ts`

Expected: FAIL，Main 工具尚未报告语义进展，恢复仍使用旧的 pending request 失败语义。

- [ ] **Step 3: 在长 Main 工具报告真实进展**

文件搜索的 `completed` 使用已扫描目录/文件数，`total` 只在能够可靠获得时填写。子进程的 `completed` 使用累计输出字节，phase 区分 `spawn`、`running`、`exiting`。任何 message 都只保留安全摘要，不包含完整命令、环境变量或输出。

计算密集但当前没有新状态时由执行边界统一 heartbeat timer 证明存活；工具实现不得用重复 progress 冒充推进。

- [ ] **Step 4: 实现 5 秒精确取消宽限期**

复用 `subprocess-runner.mts` 已持有的 child 引用。Abort 时先请求正常终止并进入 `stopping`；注册一次性 5 秒 timer，child `exit/close` 时清除；到期后只强制终止该 child。所有完成、错误、取消路径都移除 listener 和 timer。

- [ ] **Step 5: 收敛恢复状态**

恢复扫描消息时，只修改非终态工具 Part。投影：

```ts
activity: {
  ...part.activity,
  state: 'interrupted',
}
```

并写入 `RUNTIME_INTERRUPTED` 工具错误，保证模型和 UI 都能解释中断原因。已有 checkpoint 的工具本轮同样不自动续跑，因为设计明确不复活旧执行链。

- [ ] **Step 6: 运行 Main 工具与恢复测试**

Run: `pnpm exec vitest run test/electron/main/modules/chat/runtime/file-search.test.ts test/electron/main/modules/chat/runtime/subprocess-runner.test.ts test/electron/main/modules/chat/runtime/recovery-requests.test.ts`

Expected: PASS；fake timers、child listener 和 Watchdog entry 全部释放。

- [ ] **Step 7: Review checkpoint**

Run: `git diff --check`

Expected: PASS；不提交代码。

## Task 9: 完成端到端回归、静态检查和 Changelog

**Files:**

- Modify: `changelog/2026-08-03.md`
- Test: `test/electron/main/modules/chat/runtime/tool-watchdog.test.ts`
- Test: `test/electron/main/modules/chat/runtime/service.test.ts`
- Test: `test/electron/main/modules/chat/runtime/recovery-requests.test.ts`
- Test: `test/hooks/use-runtime-events.test.ts`
- Test: `test/components/BChat/bubble-part-tool-activity.component.test.ts`

- [ ] **Step 1: 增加一条完整端到端 fake-time 场景**

场景必须按真实边界串联：Runtime 开始 → 模型分片 → Renderer started → 15 秒 heartbeat → 新 progress → 累计超过 300 秒 → 60 秒只有 heartbeat 进入 `running_idle` → 用户继续等待 → 新 progress 恢复 `executing` → 工具完成 → 模型续轮完成。断言没有 300 秒任务错误、没有固定工具超时、数据库只持久化节流进展和状态变化。

再增加无活动分支：started 后 60 秒无 heartbeat/progress → `TOOL_UNRESPONSIVE` → Renderer abort → 工具错误进入模型续轮。

- [ ] **Step 2: 更新 Changelog**

在 `changelog/2026-08-03.md`：

- `Added` 记录 ToolExecutionWatchdog、Renderer/MCP 活动协议和工具卡片状态控制。
- `Changed` 记录 Chat Runtime 删除 300 秒任务总时限、Runtime 模型流只保留 90 秒停滞边界、非 Runtime 直接调用仍保留 300 秒。
- `Test` 记录状态机、跨边界活动、取消、恢复、超过 300 秒和 UI 状态矩阵。

引用全部使用仓库相对路径，不写本机绝对路径。

- [ ] **Step 3: 运行 Chat Runtime 与 Renderer 回归集合**

Run: `pnpm exec vitest run test/electron/main/modules/chat/runtime test/electron/main/modules/ai/service.test.ts test/electron/main/modules/ai/tool-loop-policy.test.ts test/electron/main/modules/mcp test/hooks/use-runtime-events.test.ts test/hooks/use-runtime-recovery.test.ts test/components/BChat/bubble-part-tool-activity.component.test.ts`

Expected: PASS；无未处理 rejection、未释放 fake timer 或进程 listener。

- [ ] **Step 4: 运行 TypeScript 检查**

Run: `pnpm exec tsc --noEmit`

Expected: PASS；无 `any`、未使用参数或 Electron API 类型漂移。

- [ ] **Step 5: 运行 ESLint**

Run: `pnpm exec eslint src electron test --ext .vue,.ts,.tsx,.js,.jsx,.mts`

Expected: PASS；若项目 ESLint 配置不接受 `electron/test/.mts` 范围，则再运行仓库规范命令 `pnpm exec eslint src --ext .vue,.ts,.tsx,.js,.jsx`，并把范围限制记录在最终验证说明中，不能把配置错误误报成实现通过。

- [ ] **Step 6: 运行 Stylelint**

Run: `pnpm exec stylelint 'src/**/*.{vue,less,css}'`

Expected: PASS。

- [ ] **Step 7: 运行完整测试**

Run: `pnpm test`

Expected: PASS；若完整套件存在与本改动无关的既有失败，记录精确测试名、错误和定向测试证据，不修改无关代码。

- [ ] **Step 8: 最终 diff 审查**

Run: `git diff --check && git status --short`

Expected: `git diff --check` PASS；状态只包含本功能与用户原有改动。检查没有提交、没有暂存、没有生成物、没有硬编码本机绝对路径。

## Completion Criteria

- Chat Runtime 在真实活动持续存在时可以运行超过 300 秒并正常完成。
- 模型流连续 90 秒没有数据仍会中止；支持活动协议的工具连续 60 秒没有活动会返回 `TOOL_UNRESPONSIVE`。
- 只有心跳、60 秒无实质进展时进入 `running_idle`，不会自动中止；“继续等待”不伪造进展。
- 等待用户暂停计时；外部等待必须有有限 deadline，并在到期时返回 `EXTERNAL_WAIT_TIMEOUT`。
- Renderer 30 秒只负责开始确认；MCP 进度、Main 工具进展和取消信号均接入同一 Watchdog 语义。
- 非 Chat Runtime 一次性 AI 调用继续保留 300 秒保护。
- Runtime 恢复把不可恢复的在途工具标为 `interrupted`，没有旧心跳复活执行链。
- 定向测试、TypeScript、ESLint、Stylelint 和完整测试均有可复核输出。
- 工作区保留为未提交状态，由用户自行审查和提交。
