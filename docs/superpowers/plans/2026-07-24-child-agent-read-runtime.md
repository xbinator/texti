# Child Agent Read Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Primary 在一次 Turn 中自动委派最多六个单层 `pure_read` Child Task，并由专用 Child Runtime 在不写普通聊天消息的前提下执行、受控并行、回传结果和触发唯一一次 Primary 续接。

**Architecture:** 主进程按稳定 `agentId` 注册 Child Actor，并把可替换 Runtime 地址单独绑定到 Actor；Renderer 只消费 allowlist Checkpoint/Task 投影，不持有执行真相。主进程 Coordinator 负责重新校验计划、预算和资源范围，并拥有 Attempt、调度许可、AbortController 与 Child Runtime。Child executor 复用无持久化的 Runtime stream executor，以内存消息承载模型/工具循环，并在每次工具执行前经过冻结计划门禁。第一阶段只允许显式资源范围内的本地 `pure_read` 主进程工具；Renderer Bridge、`external_read`、写入和二次委派全部 fail-closed。

**Tech Stack:** TypeScript strict mode、Electron main/preload IPC、Vue 3、XState、AI SDK stream adapter、better-sqlite3、Vitest。

## Global Constraints

- 始终继承 Primary Runtime A 已冻结的 `modelSnapshot`，Renderer 和 Child 不能提交模型覆盖。
- 委派深度固定为一层；Child capability 永远移除 `delegate_task`、模型切换、会话管理和写入工具。
- `effectiveCapability = persistedCapability ∩ availableCapability ∩ role/policyCapability`，恢复时只能单调收缩。
- 连续恢复必须把上一次 effective projection 作为新的 ceiling；首次恢复显式传 `null`，后续不得因工具、权限、资源或预算重新可用而回扩。
- 第一阶段只授权 `effect.effect === 'pure_read'`、`runtime === 'main'`、`executionClass === 'direct'` 的工具。
- 第一阶段本地文件工具只读取显式声明的真实路径 scope；需要 Bridge、用户确认或工作区外扩权的调用直接拒绝。
- 每个 Turn 最多六个 Child Task，最多三个资源相容的 read Attempt 并行。
- Task 是身份，Attempt 是执行，Event 是历史，Runtime 是可替换实例。
- Contract snapshot 与 Execution Plan snapshot 写入后不可修改；每个新 Attempt 只能引用既有 `planHash`。
- Child executor 不获取 Session message lock，不调用 `ChatRuntime.send/continue`，不写 `chat_messages`。
- 取消先持久化意图，再传播 `AbortSignal`，宽限期后 hard abort；排队任务不得创建 Runtime。
- Task 预算属于 Turn 子额度；Primary 不能通过拆分 Child 绕过 Turn 或 Session 预算。
- `delegate_task` 保持 registry `internal`，只由主进程 feature flag 在可信 Primary 启动边界注入。
- 所有新增函数、接口和复杂分支都按仓库规范添加 JSDoc，不使用 `any`。
- 所有异步错误归一化使用 `src/utils/asyncTo.ts` 或主进程已有的结构化错误边界。

---

### Task 1: Add Authoritative Attempt Lifecycle Store APIs

**Files:**
- Modify: `electron/main/modules/chat/agents/types.mts`
- Modify: `electron/main/modules/chat/agents/store.mts`
- Modify: `test/electron/main/modules/chat/agents/store.test.ts`
- Modify: `test/electron/main/modules/chat/agents/delegation-foundation.test.ts`

**Interfaces:**
- Consumes: `AgentTaskRecord.executionPlanSnapshotHash`、现有 Task 状态机和 append-only Event。
- Produces: `AgentAttemptRecord`、`beginAttempt()`、`markAttemptRunning()`、`getAttempt()`、`listTaskAttempts()`，后续 Coordinator 不再直接写 `chat_agent_attempts`。

- [x] **Step 1: Write failing Store tests**

在 `store.test.ts` 中把测试专用原始 SQL 启动逻辑替换为期望的生产 API，并增加原子冲突断言：

```ts
const projection = store.beginAttempt({
  taskId,
  attemptId: `attempt-${taskId}`,
  runtimeId: `runtime-attempt-${taskId}`,
  parentRuntimeId: input.checkpoint.sourceRuntimeId,
  occurredAt
})

expect(projection).toMatchObject({
  task: {
    taskId,
    status: 'starting',
    currentAttemptId: `attempt-${taskId}`
  },
  attempt: {
    taskId,
    attemptNumber: 1,
    status: 'starting',
    runtimeSequence: 1
  }
})
expect(() => store.beginAttempt({
  taskId,
  attemptId: 'attempt-conflict',
  runtimeId: 'runtime-conflict',
  parentRuntimeId: input.checkpoint.sourceRuntimeId,
  occurredAt
})).toThrowError(expect.objectContaining({ reason: 'attempt_start_state_invalid' }))
```

再验证 `markAttemptRunning()` 同一事务更新 Task、Attempt，并追加带 `attemptId/runtimeId` 的 `runtime.started` Event；错误 Attempt 或 Runtime ID 必须保持数据库不变。

- [x] **Step 2: Run the Store tests and verify RED**

Run:

```bash
pnpm exec vitest run test/electron/main/modules/chat/agents/store.test.ts
```

Expected: FAIL，因为 `AgentDelegationStore` 尚无 Attempt lifecycle API。

- [x] **Step 3: Add public Attempt types and inputs**

在 `types.mts` 中移动当前 `store.mts` 私有 Attempt 类型，并定义精确输入：

```ts
export type AgentAttemptStatus =
  | 'starting'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'deadline_exceeded'
  | 'interrupted'

export interface AgentAttemptRecord {
  attemptId: string
  taskId: string
  attemptNumber: number
  parentRuntimeId: string
  planHash: string
  initialRuntimeId: string
  currentRuntimeId: string
  runtimeSequence: number
  status: AgentAttemptStatus
  startedAt?: string
  finishedAt?: string
  error?: AgentTaskError
  createdAt: string
}

export interface BeginAgentAttemptInput {
  taskId: string
  attemptId: string
  runtimeId: string
  parentRuntimeId: string
  occurredAt: string
}

export interface MarkAgentAttemptInput {
  taskId: string
  attemptId: string
  runtimeId: string
  occurredAt: string
}

export interface AgentAttemptProjection {
  task: AgentTaskRecord
  attempt: AgentAttemptRecord
}
```

把以下方法加入 `AgentDelegationStore`：

```ts
beginAttempt(input: BeginAgentAttemptInput): AgentAttemptProjection
markAttemptRunning(input: MarkAgentAttemptInput): AgentAttemptProjection
getAttempt(attemptId: string): AgentAttemptRecord | null
listTaskAttempts(taskId: string): AgentAttemptRecord[]
```

- [x] **Step 4: Implement atomic Attempt start and running acknowledgement**

`beginAttempt()` 必须在一个事务中：

1. 读取并验证 `queued(start)` Task、冻结计划和无活动 Attempt。
2. 用 `MAX(attempt_number) + 1` 分配不可回退的 `attemptNumber`。
3. 插入 `starting` Attempt。
4. CAS 更新 Task 为 `starting` 并绑定 `currentAttemptId`。
5. 追加带 `attemptId/runtimeId` 的 `task.status_changed` 与 `runtime.starting` Event。

`markAttemptRunning()` 必须同时把 Attempt 和 Task 从 `starting` 改为 `running`、写入 `startedAt`，并追加带 Attempt/Runtime 链接的 `runtime.started`。任何 CAS 失败都回滚。`appendEvent()` 因此需要接受可选的 `attemptId/runtimeId` 链接参数。

同步 Runtime 启动失败由服务合成零 usage 的失败结果；`recordTaskResult()` 必须允许 `starting → failed`，不能留下无法终态化的 Attempt。

- [x] **Step 5: Remove raw Attempt SQL from tests**

`store.test.ts` 和 `delegation-foundation.test.ts` 的 `startTask()` 只能通过 Store API 建立 Attempt；保留直接 SQL 仅用于显式损坏恢复测试。

- [x] **Step 6: Run focused Store verification**

Run:

```bash
pnpm exec cross-env ELECTRON_RUN_AS_NODE=1 HOST=127.0.0.1 electron node_modules/vitest/vitest.mjs run test/electron/main/modules/chat/agents/store.test.ts test/electron/main/modules/chat/agents/delegation-foundation.test.ts
```

Expected: PASS，且基础端到端测试不再自行插入 Attempt。

- [x] **Step 7: Commit Task 1**

```bash
git add electron/main/modules/chat/agents/types.mts electron/main/modules/chat/agents/store.mts test/electron/main/modules/chat/agents/store.test.ts test/electron/main/modules/chat/agents/delegation-foundation.test.ts
git commit -m "feat(chat): 增加 Child Attempt 生命周期"
```

---

### Task 2: Resolve Resources And Freeze Monotonic Read Execution Plans

**Files:**
- Create: `electron/main/modules/chat/agents/resource-scopes.mts`
- Create: `electron/main/modules/chat/agents/plan-compiler.mts`
- Create: `test/electron/main/modules/chat/agents/resource-scopes.test.ts`
- Create: `test/electron/main/modules/chat/agents/plan-compiler.test.ts`
- Modify: `electron/main/modules/chat/agents/contracts.mts`
- Modify: `electron/main/modules/chat/agents/store.mts`
- Modify: `electron/main/modules/chat/agents/types.mts`
- Modify: `electron/main/modules/chat/agents/service.mts`
- Modify: `test/electron/main/modules/chat/agents/contracts.test.ts`
- Modify: `test/electron/main/modules/chat/agents/delegation-foundation.test.ts`
- Modify: `test/electron/main/modules/chat/agents/result.test.ts`
- Modify: `test/electron/main/modules/chat/agents/service.test.ts`
- Modify: `test/electron/main/modules/chat/agents/state.test.ts`
- Modify: `test/electron/main/modules/chat/agents/store.test.ts`

**Interfaces:**
- Consumes: Contract snapshot、Continuation model snapshot、父 Runtime 冻结工具、共享 tool registry、权限/资源/预算依赖。
- Produces: 只能收缩的 `compileAgentPlan()` 与 `restoreAgentPlan()`；主进程通过 `authorizeTask()` 在单一事务中冻结 snapshot 和三段状态/Event 事实。

- [x] **Step 1: Write capability intersection tests**

覆盖以下事实：

```ts
const result = compileAgentPlan({
  task,
  checkpoint,
  parentToolNames: ['read_file', 'grep', 'write_file', 'delegate_task'],
  availableToolNames: ['read_file', 'grep', 'write_file', 'delegate_task'],
  permissionScopeIds: ['workspace:repo:read'],
  workspaceRoot: 'repo-root',
  budget: { tokenLimit: 800, costLimitUsd: 0.08, pricingVersion: 'test-v1' }
})

expect(result).toMatchObject({
  ok: true,
  plan: {
    capabilitySet: ['read_file'],
    modelSnapshot: checkpoint.continuationSnapshot.modelSnapshot,
    commitPolicy: { mode: 'none' }
  }
})
```

同时验证：

- `write_file`、`delegate_task`、`external_read` 和 unknown effect 被拒绝。
- 请求工具不在父 Runtime 冻结集合时不能进入计划。
- required 工具全部消失时返回 `capability_denied/plan_validation`。
- 文件资源规范化为真实路径 scope，符号链接不能越过父 workspace real root。
- `restoreAgentPlan()` 只返回 `persisted ∩ available ∩ currentPolicy`，不能加入新工具。
- `restoreAgentPlan()` 的后续调用必须继续与 `previousEffective` 求交，不能重新扩回 persisted 上限。
- 模型必须与 checkpoint 完全一致。

- [x] **Step 2: Run plan tests and verify RED**

Run:

```bash
pnpm exec vitest run test/electron/main/modules/chat/agents/resource-scopes.test.ts test/electron/main/modules/chat/agents/plan-compiler.test.ts
```

Expected: FAIL，因为资源 scope resolver 和计划编译器尚不存在。

- [x] **Step 3: Define compiler dependencies and result**

```ts
export interface AgentPlanCompilerDependencies {
  resolveScopes(
    resources: readonly AgentResourceReference[],
    workspaceRoot: string
  ): AgentScopeResolution | AgentScopeFailure
  getToolEntry(toolName: string): ToolRegistryEntry | undefined
  isToolAvailable(toolName: string): boolean
}

export interface AgentPlanCompileInput {
  task: AgentTaskRecord
  checkpoint: AgentCheckpointRecord
  parentToolNames: readonly string[]
  availableToolNames: readonly string[]
  permissionScopeIds: readonly string[]
  workspaceRoot: string
  budget: AgentBudgetSnapshot
}

export type AgentPlanCompileResult =
  | { ok: true; plan: AgentExecutionPlanSnapshot }
  | { ok: false; error: AgentTaskError }
```

- [x] **Step 4: Implement the exact intersection**

按下列顺序计算，并在每层后保持排序去重：

```text
contract.requestedTools
∩ parentToolNames
∩ availableToolNames
∩ registered direct main tools
∩ pure_read tools
∩ resource-resolver applicable tools
∩ current policy
```

`resource-scopes.mts` 先把 file/directory 引用解析成 realpath scope，拒绝不存在的资源、`unsaved://`、工作区外路径和符号链接逃逸。使用 `hashExecutionPlanSnapshot()` 生成 `planHash`。`validateExecutionPlanSnapshot()` 增加第一阶段的强约束：read plan 不接受 `external_read`，`commitPolicy.mode` 必须为 `none`，模型必须由调用方与 continuation 单独比较，不能仅校验形状。

- [x] **Step 5: Add service authorization entry**

增加不接受 Renderer 模型/权限/预算覆盖的内部方法：

```ts
authorizeReadTask(taskId: string): AgentTaskRecord
```

它从 Store、continuation context 与受信依赖读取输入，执行：

```text
created → planning → authorized(plan snapshot) → queued(start)
```

计划编译必须发生在写事务之前；Store 在单一事务内提交三段状态迁移、`plan.authorized` 与 `task.queued` Event，并拒绝通过通用 `transitionTask()` 拆分 read 授权。编译失败保持 `created` 并返回结构化错误，事务中间失败完整回滚，不能留下永久 `planning` 或半套授权历史。真实父权限与层级预算提供器接入前，生产默认授权必须 fail-closed，不能为每个 Child 合成独立额度。

- [x] **Step 6: Run plan, contract, service tests**

Run:

```bash
pnpm exec vitest run test/electron/main/modules/chat/agents/resource-scopes.test.ts test/electron/main/modules/chat/agents/plan-compiler.test.ts test/electron/main/modules/chat/agents/contracts.test.ts test/electron/main/modules/chat/agents/service.test.ts
pnpm exec cross-env ELECTRON_RUN_AS_NODE=1 HOST=127.0.0.1 electron node_modules/vitest/vitest.mjs run test/electron/main/modules/chat/agents/store.test.ts
```

Expected: PASS。

- [x] **Step 7: Commit Task 2**

```bash
git add electron/main/modules/chat/agents/resource-scopes.mts electron/main/modules/chat/agents/plan-compiler.mts electron/main/modules/chat/agents/contracts.mts electron/main/modules/chat/agents/types.mts electron/main/modules/chat/agents/store.mts electron/main/modules/chat/agents/service.mts test/electron/main/modules/chat/agents/resource-scopes.test.ts test/electron/main/modules/chat/agents/plan-compiler.test.ts test/electron/main/modules/chat/agents/contracts.test.ts test/electron/main/modules/chat/agents/delegation-foundation.test.ts test/electron/main/modules/chat/agents/result.test.ts test/electron/main/modules/chat/agents/service.test.ts test/electron/main/modules/chat/agents/state.test.ts test/electron/main/modules/chat/agents/store.test.ts changelog/2026-07-24.md docs/superpowers/plans/2026-07-24-child-agent-read-runtime.md
git commit -m "feat(chat): 编译冻结只读 Child 执行计划"
```

---

### Task 3: Add Main-Owned Coordinator And Outbox Dispatch

**Files:**
- Create: `electron/main/modules/chat/agents/coordinator.mts`
- Create: `electron/main/modules/chat/agents/child-registry.mts`
- Create: `test/electron/main/modules/chat/agents/coordinator.test.ts`
- Create: `test/electron/main/modules/chat/agents/child-registry.test.ts`
- Modify: `types/chat-agent.d.ts`
- Modify: `electron/main/modules/chat/agents/contracts.mts`
- Modify: `electron/main/modules/chat/agents/service.mts`
- Modify: `electron/main/modules/chat/agents/state.mts`
- Modify: `electron/main/modules/chat/agents/store.mts`
- Modify: `electron/main/modules/chat/agents/types.mts`
- Modify: `electron/main/index.mts`

**Interfaces:**
- Consumes: persisted `delegation.created` Outbox、Task/Checkpoint recovery snapshot、`authorizeReadTask()`。
- Produces: 按需创建的 Coordinator execution state，以及稳定 Actor/可替换 Runtime 分离的 Main-owned Child registry；同一 checkpoint 只协调一次，重放安全。

- [x] **Step 1: Write dispatcher idempotency tests**

测试同一 `delegation.created` 同时来自实时 publish 和启动恢复时：

```ts
await Promise.all([
  coordinator.accept({ checkpointId: 'checkpoint-1', sessionId: 'session-1', turnId: 'turn-1' }),
  coordinator.accept({ checkpointId: 'checkpoint-1', sessionId: 'session-1', turnId: 'turn-1' })
])

expect(authorizeReadTask).toHaveBeenCalledTimes(1)
expect(coordinator.getCheckpointState('checkpoint-1')).toBe('running')
```

再验证 tombstoned/terminal checkpoint 不启动，超过六个 Task 稳定失败，任一 required Task 计划失败仍为每个 Task 生成终态结果。Child registry 必须先 `ensureActor(task)`、再 `bindRuntime(address, planHash)`、最后才允许 executor start；Runtime 解绑不能删除稳定 Actor。

Coordinator 接入 Outbox 前必须先定义 pre-Attempt authorization failure 协议：不可重试的计划/资源/权限失败需要写入 Task error、审计 Event 与可供 Checkpoint rendezvous 的终态工具结果，不能反复重试或永久停留在 `created`。该协议不得伪造一个已执行 Attempt。

- [x] **Step 2: Run coordinator tests and verify RED**

Run:

```bash
pnpm exec vitest run test/electron/main/modules/chat/agents/coordinator.test.ts test/electron/main/modules/chat/agents/child-registry.test.ts
```

Expected: FAIL，因为 Coordinator 尚不存在。

- [x] **Step 3: Implement Coordinator boundary**

```ts
export interface AgentCoordinatorDependencies {
  listActive(): AgentDelegationRecoverySnapshot[]
  authorizeReadTask(taskId: string): AgentTaskRecord
  recordPreFailure(task: AgentTaskRecord, error: AgentTaskError): AgentCheckpointRecord
  enqueueTask(taskId: string): void
  cancelCheckpoint(checkpointId: string, reason: string): void
  now(): string
  registry: ChildActorRegistry
}

export interface AgentCoordinator {
  accept(payload: AgentDelegationCreatedPayload): Promise<void>
  recover(): Promise<void>
  cancel(checkpointId: string, reason: string): Promise<void>
  getCheckpointState(checkpointId: string): 'idle' | 'planning' | 'running' | 'terminal'
}

export interface ChildActorRegistry {
  ensureActor(task: AgentTaskRecord): ChildActorHandle
  bindRuntime(address: ChatRuntimeAddress, planHash: string): void
  unbindRuntime(runtimeId: string): void
  abortTask(taskId: string, reason: AgentTaskError): void
}
```

使用 checkpoint ID 作为 in-flight 去重键。`recover()` 只处理持久化非终态 snapshot，不根据 Renderer 当前状态猜测计划或 Runtime。`agentId` 是稳定 Child Actor 身份；`runtimeId` 只能绑定到一个完整地址，Runtime replacement 不能覆盖 Actor 或 Attempt 历史。

- [x] **Step 4: Dispatch internally before Renderer delivery**

`service.mts` 的 Outbox 发布拆成两个消费者：

1. Main internal Coordinator 接受持久化 payload。
2. BrowserWindow 仅收到 allowlist UI 事件。

Outbox 的 delivered 仍表示所有强制内部消费者成功接收；没有窗口不能阻止 Main Coordinator。主进程启动时在 IPC 注册前调用 `coordinator.recover()`，但保持现有“Provider 调用不可跨进程恢复”的中断规则。

- [x] **Step 5: Run coordinator and foundation tests**

Run:

```bash
pnpm exec vitest run test/electron/main/modules/chat/agents/coordinator.test.ts test/electron/main/modules/chat/agents/child-registry.test.ts test/electron/main/modules/chat/agents/service.test.ts test/electron/main/modules/chat/agents/delegation-foundation.test.ts
```

Expected: PASS。

- [x] **Step 6: Commit Task 3**

```bash
git add electron/main/modules/chat/agents/coordinator.mts electron/main/modules/chat/agents/child-registry.mts electron/main/modules/chat/agents/service.mts electron/main/index.mts test/electron/main/modules/chat/agents/coordinator.test.ts test/electron/main/modules/chat/agents/child-registry.test.ts test/electron/main/modules/chat/agents/service.test.ts test/electron/main/modules/chat/agents/delegation-foundation.test.ts
git commit -m "feat(chat): 增加主进程 Child 协调器"
```

---

### Task 4: Schedule Compatible Read Tasks By Resource Scope

**Files:**
- Create: `electron/main/modules/chat/agents/scheduler.mts`
- Create: `test/electron/main/modules/chat/agents/scheduler.test.ts`
- Modify: `electron/main/modules/chat/agents/coordinator.mts`

**Interfaces:**
- Consumes: authorized `queued(start)` Task、冻结 `resourceScopes`、priority/deadline/createdAt。
- Produces: 最多三个并行的共享 read lease、确定性队列和 AbortSignal。

- [x] **Step 1: Write deterministic scheduler tests**

覆盖：

- 三个 read Task 同时取得 lease，第四个排队。
- 完成顺序可以与入队顺序不同，释放后立即调度下一项。
- 排序键为 priority 降序、同优先级 createdAt 升序、taskId 升序；deadline 只负责到期拒绝，不能破坏同优先级 FIFO。
- 同一 Task 重复 enqueue 幂等。
- deadline 已到的排队 Task 不创建 Attempt。
- cancel 排队 Task 后不再启动。

```ts
const leases = await Promise.all([
  scheduler.enqueue(createReadRequest('task-1', 'normal')),
  scheduler.enqueue(createReadRequest('task-2', 'high')),
  scheduler.enqueue(createReadRequest('task-3', 'normal'))
])

expect(leases.filter((lease): boolean => lease.started)).toHaveLength(3)
expect(scheduler.activeCount()).toBe(3)
```

- [x] **Step 2: Run scheduler tests and verify RED**

Run:

```bash
pnpm exec vitest run test/electron/main/modules/chat/agents/scheduler.test.ts
```

Expected: FAIL。

- [x] **Step 3: Implement scheduler**

```ts
export interface AgentScheduleRequest {
  taskId: string
  priority: AgentTaskPriority
  deadlineAt: string
  createdAt: string
  resourceScopes: readonly string[]
  mode: 'read'
}

export interface AgentReadLease {
  taskId: string
  signal: AbortSignal
  release(): void
}

export interface AgentReadScheduler {
  enqueue(request: AgentScheduleRequest): Promise<AgentReadLease>
  cancel(taskId: string, reason: string): boolean
  activeCount(): number
  queuedCount(): number
}
```

scope 先规范化和排序，lease 以 Task 为单位一次性获取全部 scope，避免部分持有。当前只有共享 read lease，因此 scope 重叠仍兼容；结构保留 `read/write-intent/exclusive-commit` 判定位置供下一阶段扩展。

- [x] **Step 4: Bind scheduler to Coordinator**

Coordinator 只在 lease 已取得后调用 `beginAttempt()`，并把 lease 的 signal 传给 Child executor。Runtime 终态、启动失败、取消和 deadline 都必须在 `finally` 中释放一次 lease。

- [x] **Step 5: Run scheduler/coordinator tests**

Run:

```bash
pnpm exec vitest run test/electron/main/modules/chat/agents/scheduler.test.ts test/electron/main/modules/chat/agents/coordinator.test.ts
```

Expected: PASS。

- [x] **Step 6: Commit Task 4**

```bash
git add electron/main/modules/chat/agents/scheduler.mts electron/main/modules/chat/agents/coordinator.mts test/electron/main/modules/chat/agents/scheduler.test.ts test/electron/main/modules/chat/agents/coordinator.test.ts
git commit -m "feat(chat): 调度并行只读 Child 任务"
```

---

### Task 5: Execute A Child Without Chat Message Persistence

**Files:**
- Create: `electron/main/modules/chat/agents/executor.mts`
- Create: `electron/main/modules/chat/agents/read-tools.mts`
- Create: `test/electron/main/modules/chat/agents/executor.test.ts`
- Modify: `electron/main/modules/chat/runtime/stream/types.mts`
- Modify: `electron/main/modules/chat/runtime/stream/index.mts`
- Modify: `test/electron/main/modules/chat/runtime/stream.test.ts`

**Interfaces:**
- Consumes: Attempt、frozen plan、minimal task package、model resolver、stream executor、restricted main read tool executor、AbortSignal。
- Produces: `ChatAgentResult`，不写 `chat_messages`，不直接续接 Primary。

- [x] **Step 1: Write pre-tool guard tests**

在 Runtime stream 测试中增加：

```ts
const guardToolCall = vi.fn(async (): Promise<AIToolExecutionResult | null> => {
  return createMainToolFailureResult('read_file', 'PERMISSION_DENIED', 'Tool is outside the frozen Child plan')
})
const executor = createRuntimeStreamExecutor({
  resolver,
  streamText,
  executeMainTool,
  guardToolCall
})

await executor(input, updateAssistant)

expect(executeMainTool).not.toHaveBeenCalled()
expect(assistantMessage.parts).toContainEqual(expect.objectContaining({
  type: 'tool',
  status: 'done',
  result: expect.objectContaining({ status: 'failed' })
}))
```

Provider 自带 `tool-result` 也不能绕过计划：Child executor 不向 Provider 注册可执行工具，任何非本地执行来源都形成 `protocol_error`。

- [x] **Step 2: Run stream tests and verify RED**

Run:

```bash
pnpm exec vitest run test/electron/main/modules/chat/runtime/stream.test.ts
```

Expected: FAIL，因为 stream executor 尚无主进程工具授权回调。

- [x] **Step 3: Add the mandatory tool authorization hook**

```ts
export interface RuntimeToolGuardInput {
  runtime: ActiveChatRuntime
  toolCallId: string
  toolName: string
  input: unknown
}

export type RuntimeToolGuard = (
  input: RuntimeToolGuardInput
) => Promise<AIToolExecutionResult | null>
```

`stream/index.mts` 在读取 Provider tool-result 或调用任何 executor 之前检查。`null` 表示允许，返回规范化结果表示拒绝。默认 Primary adapter 不提供 guard；Child adapter 校验 capability、effect、resource scope、permission、deadline 和 signal。Provider 自带结果也不能绕过该门禁。

- [x] **Step 4: Write Child executor tests**

测试专用 stream 先调用 `read_file`，再输出最终摘要。断言：

- update callback 只更新内存对象。
- message writer、Session lock 和 Renderer Bridge 均未调用。
- 模型 resolver 收到 frozen model。
- 超范围路径、未声明工具、`delegate_task` 和写工具在执行前失败。
- AbortSignal 中止后产生 `cancelled` 结果。
- token 超限产生带真实 usage 的 `budget_exceeded` 结果。

- [x] **Step 5: Run Child executor tests and verify RED**

Run:

```bash
pnpm exec vitest run test/electron/main/modules/chat/agents/executor.test.ts
```

Expected: FAIL，因为 `executor.mts` 尚不存在。

- [x] **Step 6: Implement restricted read tool execution**

`read-tools.mts` 仅分发 `read_file`、`read_directory`、`glob` 和 `grep`。每次调用：

1. 从 registry 重新读取 effect 和 resolver。
2. 对输入解析真实路径。
3. 验证目标落入 plan 的显式 scope。
4. 拒绝 `unsaved://`、工作区外确认、Bridge fallback 与全部非 `pure_read` 工具。
5. 返回现有 `AIToolExecutionResult` allowlist。

- [x] **Step 7: Implement `ChildTaskRuntimeExecutor`**

```ts
export interface ChildRuntimeInput {
  task: AgentTaskRecord
  attempt: AgentAttemptRecord
  checkpoint: AgentCheckpointRecord
  signal: AbortSignal
}

export interface ChildTaskRuntimeExecutor {
  execute(input: ChildRuntimeInput): Promise<ChatAgentResult>
  abort(runtimeId: string, reason: string): void
}
```

使用最小系统约束、Task 目标、验收标准、资源引用和冻结 capability 构造内存 source messages。循环调用 `createRuntimeStreamExecutor()`，累计 usage/tool rounds，直到最终文本或预算/deadline/cancel 终态。默认 criteria verification 为 `unverified`；只有受信 tool evidence validator 可以升级为 `verified`。

- [x] **Step 8: Allow honest budget-exceeded accounting**

修改结果预算校验：正常 completed 结果不得超过计划；`executionStatus === 'failed'` 且 `error.code === 'budget_exceeded'` 时允许持久化真实超限 usage，不能把实际值裁成预算上限或伪造为零。

- [x] **Step 9: Run executor and stream verification**

Run:

```bash
pnpm exec vitest run test/electron/main/modules/chat/agents/executor.test.ts test/electron/main/modules/chat/runtime/stream.test.ts test/electron/main/modules/chat/agents/result.test.ts
```

Expected: PASS。

- [x] **Step 10: Commit Task 5**

```bash
git add electron/main/modules/chat/agents/executor.mts electron/main/modules/chat/agents/read-tools.mts electron/main/modules/chat/runtime/stream/types.mts electron/main/modules/chat/runtime/stream/index.mts electron/main/modules/chat/agents/result.mts test/electron/main/modules/chat/agents/executor.test.ts test/electron/main/modules/chat/runtime/stream.test.ts test/electron/main/modules/chat/agents/result.test.ts
git commit -m "feat(chat): 增加无消息持久化 Child 执行器"
```

---

### Task 6: Connect Cancellation, Deadline, Budget And Rendezvous

**Files:**
- Create: `electron/main/modules/chat/agents/budget.mts`
- Create: `test/electron/main/modules/chat/agents/budget.test.ts`
- Modify: `electron/main/modules/database/service.mts`
- Modify: `electron/main/modules/chat/agents/coordinator.mts`
- Modify: `electron/main/modules/chat/agents/service.mts`
- Modify: `electron/main/modules/chat/agents/store.mts`
- Modify: `test/electron/main/modules/database/agent-task-migration.test.ts`
- Modify: `test/electron/main/modules/chat/agents/coordinator.test.ts`
- Modify: `test/electron/main/modules/chat/agents/service.test.ts`

**Interfaces:**
- Consumes: Scheduler lease、Attempt、executor result、existing `recordTaskResult()` 和 Checkpoint cancellation。
- Produces: bounded cooperative cancellation、budget reservation/settlement、每个 Task 一个终态结果以及现有 Primary B rendezvous。

- [x] **Step 1: Write hierarchical budget tests**

验证：

- Primary resume reservation 先从 Turn budget 扣除。
- 六个 Child 的 reservation 总和不能超过剩余额度。
- Attempt 完成按实际 usage 结算并归还未使用额度。
- 拆分多个 Task 不产生新 Turn budget。
- pricing unknown 保持 unknown。

- [x] **Step 2: Run budget tests and verify RED**

Run:

```bash
pnpm exec vitest run test/electron/main/modules/chat/agents/budget.test.ts
```

Expected: FAIL。

- [x] **Step 3: Implement budget ledger**

```ts
export interface AgentBudgetLedger {
  reserveResume(checkpointId: string, budget: AgentBudgetSnapshot): void
  reserveTask(taskId: string, budget: AgentBudgetSnapshot): void
  settleAttempt(taskId: string, usage: AgentUsageAccounting): void
  releaseTask(taskId: string): void
  remainingTurnTokens(checkpointId: string): number
}
```

新增 `chat_agent_budget_reservations` 持久化表，字段至少包含 `reservationId/sessionId/turnId/checkpointId/taskId/kind/reserved/used/status/createdAt/updatedAt`。ledger 由 checkpoint/Turn 持有，不由 Child 创建；授权前在同一数据库事务中验证所有 active reservation，所有 reservation 操作串行执行。Main 重启后即使 Checkpoint 被安全中断，reservation 仍能按持久化状态结算或释放，不能泄漏 Turn/Session 额度。

Task 6 同时把 ledger 与父权限 ceiling 组合成生产 `resolveReadLimits` 依赖并注入默认 Agent service；在这一步完成前，Task 2 的生产默认 resolver 持续 fail-closed，Coordinator 测试只能显式注入可信 fixture。

- [x] **Step 4: Write cancellation/deadline integration tests**

覆盖排队、starting、running 三种取消：

- 排队取消不创建 Attempt/Runtime。
- starting/running 先持久化 `cancelling`，再触发 signal。
- Child 在宽限期内返回 cancelled 时正常记录。
- 宽限期后 hard abort，仍生成稳定 cancelled 或 interrupted result。
- cancel checkpoint 后仍允许 Child result 写入 `cancelling` checkpoint，全部终态后 checkpoint 收敛 cancelled，不再启动 Primary B。
- deadline 使用 `min(task deadline, turn deadline, system child limit)`。

- [x] **Step 5: Fix cancellation/result state compatibility**

`recordTaskResult()` 必须接受 checkpoint `waiting_children` 或 `cancelling`。后者只汇合终态结果并推动取消收敛，绝不生成 `delegation.ready` 或启动 Runtime B。

- [x] **Step 6: Connect full execution**

Coordinator 对每个 Task 执行：

```text
authorize/reserve
→ enqueue/acquire lease
→ beginAttempt
→ register runtime address
→ execute Child
→ validate/recordTaskResult
→ settle budget
→ unregister runtime/release lease
```

所有异常都转换为完整 `ChatAgentResult`，不能让 required 或 optional Task 永久缺少 result envelope。

- [x] **Step 7: Run integration tests**

Run:

```bash
pnpm exec vitest run test/electron/main/modules/chat/agents/budget.test.ts test/electron/main/modules/chat/agents/coordinator.test.ts test/electron/main/modules/chat/agents/service.test.ts test/electron/main/modules/chat/agents/store.test.ts
```

Expected: PASS。

- [x] **Step 8: Commit Task 6**

```bash
git add electron/main/modules/chat/agents/budget.mts electron/main/modules/database/service.mts electron/main/modules/chat/agents/coordinator.mts electron/main/modules/chat/agents/service.mts electron/main/modules/chat/agents/store.mts test/electron/main/modules/chat/agents/budget.test.ts test/electron/main/modules/database/agent-task-migration.test.ts test/electron/main/modules/chat/agents/coordinator.test.ts test/electron/main/modules/chat/agents/service.test.ts test/electron/main/modules/chat/agents/store.test.ts
git commit -m "feat(chat): 接通 Child 取消预算与结果汇合"
```

---

### Task 7: Recover Main Child State And Gate Primary Delegation

**Files:**
- Modify: `electron/main/modules/chat/agents/coordinator.mts`
- Modify: `electron/main/modules/chat/agents/child-registry.mts`
- Modify: `electron/main/modules/chat/agents/service.mts`
- Modify: `electron/main/modules/chat/runtime/service.mts`
- Modify: `electron/main/index.mts`
- Create: `test/electron/main/modules/chat/agents/startup-recovery.test.ts`
- Modify: `test/electron/main/modules/chat/runtime/main-boundary.test.ts`

**Interfaces:**
- Consumes: Main-owned Child registry、持久化 Task/Attempt/Outbox、主进程 feature flag、共享 delegate tool definition。
- Produces: Renderer 重载不影响的 Child execution state，以及仅对可信 Primary 开启的 `delegate_task`。

- [x] **Step 1: Write recovery tests**

验证：

- Renderer 重载不终止 Main Child Runtime、lease、Actor 或 Attempt。
- 同一进程内 pending `delegation.created` Outbox 可以幂等重投给 Coordinator。
- Main 重启时 queued/running read Attempt 按当前首版协议终态化为 interrupted，不猜测恢复 Provider stream。
- interrupted Checkpoint 不消费旧 Outbox、不创建第二个 Runtime，也会释放持久化预算 reservation。
- plan schema/policy/hash 不支持时 fail closed，capability 恢复只能收缩。

- [x] **Step 2: Run recovery tests and verify RED**

Run:

```bash
pnpm exec vitest run test/electron/main/modules/chat/agents/startup-recovery.test.ts
```

Expected: FAIL，直到 Coordinator 与现有启动中断顺序接通。

- [x] **Step 3: Implement recovery order**

主进程启动顺序固定为：

```text
initialize database
→ interrupt unrecoverable Provider runtimes/checkpoints
→ settle or release their reservations
→ rebuild safe in-process Coordinator state
→ drain eligible pending delegation.created outbox
→ register IPC
→ create windows
```

旧 running Attempt 不重放；同一进程中的 Renderer reload 只重新获取公开 snapshot，不改变 Main Child Actor/Runtime。

- [x] **Step 4: Write feature flag boundary tests**

验证：

- flag 关闭时 Renderer 伪造 `delegate_task` 被拒绝。
- flag 开启时公开 `send()` 先执行完整 Renderer 输入校验，再由 Main 克隆工具集合并注入 registry 中的 delegate definition。
- `startTrustedPrimary()` 只接受已经由 Main 组装的内部输入。
- Child Runtime、Renderer tool catalog 和 continuation 永远不能自行注入 delegate。
- flag 开启不改变其他工具或未委派聊天。

- [x] **Step 5: Implement main-owned feature injection**

feature flag 默认为 false，并包含固定 `pureReadChildEnabled=true` 与 `maxParallelReadChildren=3`。公开 `send()` 必须先调用现有 Renderer 输入校验，确认输入不含 internal/deferred 工具，再由 Main 使用共享 registry 的可信 definition 克隆增强 Runtime 输入。不得接受 Renderer 提供的 delegate definition、execution class、effect 或 permission 元数据。

- [x] **Step 6: Run recovery and boundary tests**

Run:

```bash
pnpm exec vitest run test/electron/main/modules/chat/agents/startup-recovery.test.ts test/electron/main/modules/chat/runtime/main-boundary.test.ts
```

Expected: PASS。

- [x] **Step 7: Commit Task 7**

```bash
git add electron/main/modules/chat/agents/coordinator.mts electron/main/modules/chat/agents/child-registry.mts electron/main/modules/chat/agents/service.mts electron/main/modules/chat/runtime/service.mts electron/main/index.mts test/electron/main/modules/chat/agents/startup-recovery.test.ts test/electron/main/modules/chat/runtime/main-boundary.test.ts
git commit -m "feat(chat): 恢复 Child 状态并受控开放委派"
```

---

### Task 8: Verify Real Read Delegation End To End

**Files:**
- Create: `test/electron/main/modules/chat/agents/read-runtime.test.ts`
- Modify: `package.json`
- Modify: `docs/development/chat-multi-session-and-multi-agent-extension.md`
- Modify: `docs/ai-tools/tool-development-guide.md`
- Modify: `CONTEXT.md`
- Modify: `changelog/2026-07-27.md`

**Interfaces:**
- Consumes: 完整只读 Child pipeline。
- Produces: 一次 Primary A → 三个乱序 Child → 一个 Primary B 的真实 SQLite/Runtime 回归证据。

- [x] **Step 1: Write the end-to-end test**

使用真实 SQLite 和可控 stream stub：

1. Primary A 在同一步提交三个 `delegate_task`。
2. 三个 Child 均继承 Primary 模型，读取三个显式文件 scope。
3. Child 完成顺序为 2、3、1。
4. 每个 Child 使用专用 Runtime，不写普通消息。
5. Checkpoint 按原 toolCallId 顺序汇合结果。
6. Primary B 只启动一次并形成唯一用户可见回答。

断言 `chat_messages` 只含 Primary user/assistant，`chat_agent_attempts` 含三个 Attempt，活动 scheduler/Runtime/lease 最终均为零。

- [x] **Step 2: Run end-to-end test and verify RED if any wiring is missing**

Run:

```bash
pnpm exec cross-env ELECTRON_RUN_AS_NODE=1 HOST=127.0.0.1 electron node_modules/vitest/vitest.mjs run test/electron/main/modules/chat/agents/read-runtime.test.ts
```

Expected before final wiring: FAIL 在具体缺失边界；修复只限本计划已定义接口。

- [x] **Step 3: Complete minimal integration wiring**

接通 test 暴露的缺失依赖，不新增 `external_read`、写入、任务卡片 UI 或 commit journal 行为。

- [x] **Step 4: Update architecture documentation**

记录：

- Main Child Actor registry 保存稳定身份，Runtime 地址是可替换绑定；Renderer 只消费公开投影。
- 第一阶段可用工具与 fail-closed 条件。
- Capability 单调恢复、Attempt lifecycle、max-three read scheduler。
- feature flag 默认关闭和可信注入边界。
- 写入 Child、ConfirmationQueue、commit journal 和轻量任务卡片仍属于下一计划。

- [x] **Step 5: Run focused and full verification**

Run:

```bash
pnpm exec vitest run test/electron/main/modules/chat/agents test/electron/main/modules/chat/runtime test/hooks/use-agent-delegation-events.test.ts
pnpm run test:database
pnpm exec tsc --noEmit
pnpm lint
pnpm lint:style
pnpm build
pnpm test
```

Expected: 全部通过；不存在 Child transcript、活动 lease、未终态 Attempt、重复 Primary B 或未说明的 lint 修复。

- [x] **Step 6: Audit invariants**

Run:

```bash
rg -n "\bany\b|skipMessages|delegate_task|external_read|staged_file_write" \
  types/chat-agent.d.ts \
  electron/main/modules/chat/agents \
  electron/main/modules/chat/runtime \
  src/ai/chat \
  src/hooks/useChat \
  shared/ai/tools
```

逐条确认：

- 没有 `any`、`skipMessages` 或由 Renderer 提交的模型/权限/计划覆盖。
- Child capability 没有 `delegate_task`、写工具和 external read。
- Child 没有写 `chat_messages` 或获取 Session message lock。
- Attempt 只由 Store API 创建，Runtime 启动前已注册身份和许可。
- cancel/deadline 的每条路径都释放 Runtime、lease 和预算。
- checkpoint 只在 `waiting_children` 生成 ready，`cancelling` 不续接 Primary。
- 结果顺序按原 toolCallId，而不是 Child 完成顺序。
- tool exposure 仍为 registry `internal`，feature flag 默认关闭。

- [x] **Step 7: Commit Task 8**

```bash
git add test/electron/main/modules/chat/agents/read-runtime.test.ts package.json docs/development/chat-multi-session-and-multi-agent-extension.md docs/ai-tools/tool-development-guide.md CONTEXT.md changelog/2026-07-27.md
git commit -m "test(chat): 验证只读 Child 委派闭环"
```

---

## Series Handoff

本计划完成后，下一份计划实现：

1. Task overlay 与 `staged_file_write` changeset。
2. `baseRevision + diffHash + operationSetHash + planHash` 完整性。
3. 应用级 ConfirmationQueue 和重载恢复。
4. 三阶段 commit journal、原子文件替换、commit validation 与恢复。
5. `write-intent/exclusive-commit` 资源门禁。
6. 轻量任务卡片、artifact visibility 与已裁剪 Event 时间线。

在上述边界完整验证前，write Child、即时外部副作用和 UI 提交入口保持关闭。
