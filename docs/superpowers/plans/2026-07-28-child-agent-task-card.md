# Child Agent Task Card And Single-Task Cancellation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在原 `delegate_task` Tool Part 位置展示可恢复、可展开的 Child Agent 轻量任务卡片，并提供不影响 sibling Task、遵守 commit 不可逆边界的单 Task cooperative cancellation。

**Architecture:** Main 继续拥有 Task、Attempt、Event、Runtime、Confirmation、Changeset 和 Commit Journal 的权威事实；新增只读事务快照、显式 allowlist Projector 和提交后 Projection Pump，把轻量 Summary/Tombstone 通过既有 `chat:agent:event` 频道推送给 Renderer。Renderer 用应用级 Pinia Store 按 `taskSequence` 收敛列表、定向详情和事件，并以 `sessionId + assistantMessageId + toolCallId` 把 Task 固定回原消息位置。取消命令只持久化意图；Scheduler、Runtime、Overlay 和 FileCommitter 分别在自己的线性化边界收敛，Renderer 不做乐观 cancelled。

**Tech Stack:** TypeScript strict mode、Electron main/preload IPC、Vue 3、Pinia、better-sqlite3、AI SDK tool runtime、Vitest、Less。

## Global Constraints

- 以 `docs/superpowers/specs/2026-07-28-child-agent-task-card-design.md` 为规范源；本计划不重新解释或放宽其中的不变式。
- Task 是身份，Attempt 是执行，Event 是历史，Runtime 是可替换实例；Renderer 投影不能反向修改权威事实。
- 卡片唯一匹配键固定为 `sessionId + assistantMessageId + toolCallId`；数据库仍保留 `checkpointId + toolCallId` 唯一性，并新增 Checkpoint `assistantMessageId` 唯一性。
- `ChatAgentTaskSummarySnapshot` 只用于列表、事件和卡片收起态；时间线、criteria、usage、changeset 和 artifact 只通过 `getTask` 返回的 Detail 暴露。
- `taskSequence` 只能单调增加，但相邻 Application Event 可以跳号；Renderer 禁止把跳号解释为丢事件。
- tombstone 不进入默认列表；一旦被 Renderer 接受就不可被后续 live Summary 复活。
- Projector 必须逐字段构造新对象，禁止把内部记录 spread 后删字段；任何绝对路径、模型、权限、完整计划、overlay、journal 私有引用、原始工具输入输出、Prompt 或推理都不能进入 Renderer。
- artifact 只有 `visibility=user` 且 Main resolver 与 Renderer opener 都登记时才可打开；未登记 kind 只显示安全元数据。
- 单 Task 取消不能调用 Checkpoint 取消，不能释放 continuation fence、Primary reservation 或 sibling 的 lease、Runtime、确认、预算和结果。
- `committing` 的 journal 不可逆边界优先于迟到取消；`applying/applied` 禁止 hard abort FileCommitter、直接清 overlay 或虚报 cancelled。
- cancelled Task 必须拥有真实终态 Result；包括 Runtime 创建前取消和 Checkpoint 级联取消。
- 所有新增函数、接口和复杂分支添加 JSDoc，不使用 `any`；函数名不超过四个单词。
- Renderer 异步错误使用 `src/utils/asyncTo.ts`；Main 的 no-throw fan-out 使用独立 `try/catch` 或 `Promise.allSettled`，不能改变已提交业务结果。
- 每个 Task 先写失败测试、确认 RED、最小实现、确认 GREEN，再更新 `changelog/2026-07-28.md` 并独立提交。
- 只读核对可并行，任何共享文件写入和 Git 提交必须串行；Child Agent 深度保持一层且继承主模型。
- 本计划不打开生产 `controlledWriteChildEnabled`。

## File Responsibility Map

### Shared protocol and persistence

- `types/chat-agent.d.ts`: Renderer 公开 Task 协议、Application Event、查询/取消输入输出、无 Attempt 取消结果。
- `electron/main/modules/database/service.mts`: Checkpoint `assistantMessageId` 唯一审计、唯一索引和 Session 历史查询索引。
- `electron/main/modules/chat/agents/types.mts`: Store 只读快照、post-commit listener、单 Task 取消和工具事件接口。
- `electron/main/modules/chat/agents/store.mts`: 分页查询、同一只读事务投影、统一提交后通知、取消 CAS 和 rendezvous 事实。
- `electron/main/modules/chat/agents/contracts.mts`: 公开文本裁剪、Event 和无 Attempt 取消结果校验。
- `electron/main/modules/chat/agents/state.mts`: 取消相关合法迁移不变式。

### Main projection and commands

- `electron/main/modules/chat/agents/service.mts`: Summary/Detail Projector、cursor、Projection Pump、查询与取消应用服务。
- `electron/main/modules/chat/agents/executor.mts`: Child 工具开始/结束的裁剪事件。
- `electron/main/modules/chat/agents/ipc.mts`: 三个窄 IPC 的严格输入校验。
- `electron/preload/index.mts`: 查询、取消和既有 Agent Event 订阅。
- `types/electron-api.d.ts`: Renderer Electron API 声明。

### Renderer projection and card

- `src/stores/chat/agentTask.ts`: 应用级 Summary/Detail/tombstone Store、分页、恢复和复合索引。
- `src/hooks/useChat/useAgentTaskEvents.ts`: 应用根唯一 `task.updated` 监听。
- `src/hooks/useChat/useActorSystem.ts`: 只在 `useProvideActorSystem()` 注册 Task 监听。
- `src/components/BChat/index.vue`: 使用 `activeSessionId` 触发 Session 恢复并向下传递。
- `src/components/BChat/components/ConversationView.vue`: 透传 Session 身份。
- `src/components/BChat/components/MessageBubble.vue`: 识别 `delegate_task`，保持原 Tool Part 顺序。
- `src/components/BChat/components/MessageBubble/BubblePartAgentTask.vue`: 收起、展开、确认定位和取消交互。
- `src/components/BChat/utils/agentTaskPart.ts`: 保护性读取终态 Result 中的 `taskId`。
- `src/components/BChat/utils/agentArtifact.ts`: artifact kind 到安全 opener 的显式 registry。
- `src/stores/chat/confirmationQueue.ts`: 统一确认查找与显式恢复，不复制确认事实。

### Cooperative cancellation

- `electron/main/modules/chat/agents/scheduler.mts`: queued/active/not-found 取消仲裁。
- `electron/main/modules/chat/agents/coordinator.mts`: 单 Task cancel flight、Runtime abort、清理和终态归一化。
- `electron/main/modules/chat/agents/child-registry.mts`: 幂等释放单个 Task 的 Actor/Runtime。
- `electron/main/modules/chat/agents/confirmation-store.mts`: 只撤销目标 Task 的 pending confirmation。
- `electron/main/modules/chat/agents/file-commit.mts`: journal created 的安全取消、不可逆阶段 roll-forward 和迟到取消 warning。
- `electron/main/modules/chat/agents/budget.mts`: 只结算/释放目标 Task reservation。
- `electron/main/modules/chat/agents/service.mts`: 启动恢复时先完成 journal/overlay 清理，再允许 cancelled。

---

### Task 1: Build The Main-Owned Public Task Projection

**Files:**

- Modify: `types/chat-agent.d.ts`
- Modify: `electron/main/modules/database/service.mts`
- Modify: `electron/main/modules/chat/agents/types.mts`
- Modify: `electron/main/modules/chat/agents/store.mts`
- Modify: `electron/main/modules/chat/agents/contracts.mts`
- Modify: `electron/main/modules/chat/agents/service.mts`
- Modify: `test/electron/main/modules/database/agent-task-migration.test.ts`
- Modify: `test/electron/main/modules/chat/agents/store.test.ts`
- Modify: `test/electron/main/modules/chat/agents/service.test.ts`
- Create: `test/electron/main/modules/chat/agents/task-projection.test.ts`
- Modify: `changelog/2026-07-28.md`

**Interfaces:**

- Produces all public projection/query types from design sections 6.1 and 6.2.
- Produces `AgentTaskTerminalCursor`、`ListAgentTasksInput`、`AgentTaskListPage`、`AgentTaskProjectionRecord`、`AgentTaskProjector`.
- Consumes persisted Task、Checkpoint、current Attempt、latest 50 Task Events、Changeset、Confirmation、Journal and Result without consulting Child Registry.

- [x] **Step 1: Write failing database, Store and Projector tests**

Add tests with these exact behavioral assertions:

```ts
expect((): void => migrateDatabaseWithDuplicateAssistantMessages()).toThrow(
  'agent_checkpoint_assistant_message_duplicate'
);

expect(listResult.tasks.map((task): string => task.taskId)).toEqual([
  'task-active',
  'task-terminal-newest'
]);
expect(listResult.nextCursor).toEqual(expect.any(String));
expect(JSON.stringify(detail)).not.toMatch(
  /modelSnapshot|permissionSnapshot|targetPath|overlay|rollbackReference|Authorization/
);
expect(detail.timeline.entries).toHaveLength(50);
expect(detail.timeline.lastSequence).toBe(detail.taskSequence);
```

Also assert:

- two Checkpoints cannot bind the same `assistantMessageId`;
- the first page contains every active Task plus at most the requested terminal limit;
- subsequent pages contain only older terminal Tasks ordered by `updatedAt DESC, taskId DESC`;
- cursor is bound to Session and cannot be reused for another Session;
- default list omits tombstones, while directed get returns the minimal tombstone branch;
- same `toolCallId` in different Assistant messages or Sessions remains isolated;
- wrong Session returns `null` without revealing whether the Task exists;
- Summary omits timeline, criteria, usage, changeset and artifacts;
- Detail uses persisted Attempt status, `currentRuntimeId` and `finishedAt`;
- timeline is limited to 50 entries with correct `firstSequence/lastSequence/truncated`;
- unknown monetary cost remains `unknown`, and only `visibility=user` artifacts survive;
- recursive key/value scanning rejects forbidden keys, absolute paths and secret-looking values;
- changeset public phase follows the design’s journal-first priority table.

- [x] **Step 2: Run focused tests and verify RED**

Run:

```bash
pnpm exec vitest run test/electron/main/modules/chat/agents/task-projection.test.ts test/electron/main/modules/chat/agents/service.test.ts
```

Run SQLite-backed tests:

```bash
pnpm exec cross-env ELECTRON_RUN_AS_NODE=1 HOST=127.0.0.1 electron node_modules/vitest/vitest.mjs run test/electron/main/modules/database/agent-task-migration.test.ts test/electron/main/modules/chat/agents/store.test.ts
```

Expected: FAIL because the public types, unique index, paginated Store query and Projector do not exist.

- [x] **Step 3: Add the public protocol without reusing internal records**

Add the complete types specified in design section 6.1, including:

```ts
export type ChatAgentTaskListSnapshot = ChatAgentTaskSummarySnapshot;
export type ChatAgentTaskEventSnapshot =
  | ChatAgentTaskSummarySnapshot
  | ChatAgentTaskTombstoneSnapshot;
export type ChatAgentTaskSnapshot =
  | ChatAgentTaskDetailSnapshot
  | ChatAgentTaskTombstoneSnapshot;
export type ChatAgentGetTaskResult = ChatAgentTaskSnapshot | null;

export interface ChatAgentListTasksResult {
  readonly tasks: readonly ChatAgentTaskListSnapshot[];
  readonly nextCursor?: string;
}
```

Keep `projectionSchemaVersion: 1` and `taskSequence` on every Summary/Detail/Tombstone. Preserve the frozen public text and collection limits from design section 6.1. Export a single sanitizer from `contracts.mts`:

```ts
export function sanitizeAgentDisplayText(
  value: unknown,
  maxLength: number
): string | null;
```

It must remove control characters, redact secret patterns, enforce the requested maximum and return `null` for non-displayable input.

- [x] **Step 4: Audit and enforce Assistant Message uniqueness**

Change `createAgentTables()` to accept:

```ts
database: Pick<DatabaseInstance, 'exec' | 'prepare'>
```

Before creating the unique index, execute:

```sql
SELECT assistant_message_id
FROM chat_agent_delegation_checkpoints
GROUP BY assistant_message_id
HAVING COUNT(*) > 1
LIMIT 1
```

If a row exists, throw `agent_checkpoint_assistant_message_duplicate`; do not merge, delete or rewrite data. Only after the audit succeeds, create:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_agent_checkpoints_assistant_message
ON chat_agent_delegation_checkpoints(assistant_message_id);

CREATE INDEX IF NOT EXISTS idx_chat_agent_tasks_session_record_updated
ON chat_agent_tasks(session_id, record_state, updated_at DESC, task_id DESC);
```

Keep the audit immediately before the index statement during schema initialization so an existing duplicate always produces the stable protocol error instead of SQLite’s raw unique-index error.

- [x] **Step 5: Add stable Store projection reads**

Add these internal contracts:

```ts
export interface AgentTaskTerminalCursor {
  readonly updatedAt: string;
  readonly taskId: string;
}

export interface ListAgentTasksInput {
  readonly sessionId: string;
  readonly includeActive: boolean;
  readonly terminalBefore?: AgentTaskTerminalCursor;
  readonly terminalLimit: number;
}

export interface AgentTaskListPage {
  readonly active: readonly AgentTaskRecord[];
  readonly terminal: readonly AgentTaskRecord[];
  readonly hasMoreTerminal: boolean;
}

export interface AgentTaskProjectionRecord {
  readonly task: AgentTaskRecord;
  readonly checkpoint: AgentCheckpointRecord;
  readonly currentAttempt?: AgentAttemptRecord;
  readonly taskSequence: number;
  readonly events: readonly ChatAgentEvent[];
  readonly changeset?: AgentChangesetRecord;
  readonly confirmation?: AgentConfirmationRecord;
  readonly journal?: AgentCommitJournalRecord;
}
```

Expose:

```ts
listTasksBySession(input: ListAgentTasksInput): AgentTaskListPage;
getTaskProjection(taskId: string): AgentTaskProjectionRecord | null;
```

`getTaskProjection()` must read every field in one SQLite read transaction. Query `limit + 1` terminal rows to decide `hasMoreTerminal`. Never infer tombstone from a missing list row.

- [x] **Step 6: Implement the explicit allowlist Projector**

Export:

```ts
export interface AgentTaskProjector {
  projectSummary(taskId: string): ChatAgentTaskEventSnapshot | null;
  projectDetail(
    sessionId: string,
    taskId: string
  ): ChatAgentGetTaskResult;
  listTasks(input: ChatAgentListTasksInput): ChatAgentListTasksResult;
}

export interface AgentTaskProjectorDependencies {
  readonly store: AgentDelegationStore;
  readonly resolveResource: (
    resource: AgentResourceReference
  ) => ChatAgentTaskResourceSnapshot | null;
  readonly resolveArtifact: (
    artifact: AgentArtifactReference
  ) => ChatAgentTaskArtifactSnapshot | null;
}

export function createAgentTaskProjector(
  dependencies: AgentTaskProjectorDependencies
): AgentTaskProjector;
```

Build every output object field-by-field. Encode/decode the opaque cursor in Service and bind it to `sessionId + updatedAt + taskId`; reject malformed, oversized or cross-Session cursors. Apply the complete resource, error, artifact, cost, text, collection and serialized-byte limits from the design.

- [x] **Step 7: Run focused tests and verify GREEN**

Run the two commands from Step 2.

Expected: PASS.

- [x] **Step 8: Update changelog and commit**

Add under `## Added`:

```md
- 建立 Main-owned Child Task Summary/Detail 投影、Session 分页查询与 Assistant Message 唯一约束。
```

Commit:

```bash
git add types/chat-agent.d.ts electron/main/modules/database/service.mts electron/main/modules/chat/agents/types.mts electron/main/modules/chat/agents/store.mts electron/main/modules/chat/agents/contracts.mts electron/main/modules/chat/agents/service.mts test/electron/main/modules/database/agent-task-migration.test.ts test/electron/main/modules/chat/agents/store.test.ts test/electron/main/modules/chat/agents/service.test.ts test/electron/main/modules/chat/agents/task-projection.test.ts changelog/2026-07-28.md
git commit -m "feat(chat): 建立 Child Task 公开投影"
```

---

### Task 2: Publish Committed Task Updates Through Narrow IPC

**Files:**

- Modify: `types/chat-agent.d.ts`
- Modify: `electron/main/modules/chat/agents/types.mts`
- Modify: `electron/main/modules/chat/agents/store.mts`
- Modify: `electron/main/modules/chat/agents/executor.mts`
- Modify: `electron/main/modules/chat/agents/service.mts`
- Modify: `electron/main/modules/chat/agents/ipc.mts`
- Modify: `electron/main/modules/chat/runtime/stream/index.mts`
- Modify: `electron/main/modules/chat/runtime/stream/types.mts`
- Modify: `electron/preload/index.mts`
- Modify: `types/electron-api.d.ts`
- Modify: `test/electron/main/modules/chat/agents/delegation-foundation.test.ts`
- Modify: `test/electron/main/modules/chat/agents/store.test.ts`
- Modify: `test/electron/main/modules/chat/agents/executor.test.ts`
- Modify: `test/electron/main/modules/chat/agents/task-projection.test.ts`
- Modify: `test/electron/main/modules/chat/agents/service.test.ts`
- Modify: `test/electron/main/modules/chat/agents/ipc.test.ts`
- Modify: `test/electron/main/modules/chat/agents/read-runtime.test.ts`
- Modify: `test/electron/main/modules/chat/agents/startup-recovery.test.ts`
- Modify: `test/electron/main/modules/chat/agents/write-runtime.test.ts`
- Modify: `test/electron/main/modules/chat/runtime/main-boundary.test.ts`
- Modify: `test/electron/main/modules/chat/runtime/stream/executor.test.ts`
- Modify: `changelog/2026-07-28.md`

**Interfaces:**

- Produces `ChatAgentTaskUpdatedEvent` in the existing `ChatAgentApplicationEvent` union.
- Produces `subscribeTaskCommits()` and one Store-owned `runTaskTransaction()` post-commit boundary.
- Produces `AgentTaskProjectionPump`.
- Produces `chatAgentListTasks` and `chatAgentGetTask` preload/API methods; `chatAgentCancelTask` is added atomically with its coordinator behavior in Task 6.

- [x] **Step 1: Write failing post-commit, Tool Event and IPC tests**

Assert:

```ts
expect(publish).toHaveBeenCalledWith({
  schemaVersion: 1,
  type: 'task.updated',
  task: expect.objectContaining({ taskId: 'task-1', taskSequence: 4 }),
  taskSequence: 4
});

expect(committedMutation()).toEqual(expectedResult);
expect(throwingListener).toHaveBeenCalled();
expect(store.getTask('task-1')?.status).toBe('running');
```

Also cover:

- rollback emits no post-commit notification;
- one transaction with multiple Task Events produces one coalesced Summary;
- a synchronously throwing listener/enqueue does not change the mutation return value;
- async projector/publish failure does not roll back persisted facts;
- the next notification or query recovers the latest sequence;
- `tool.started` contains only task/attempt/runtime/tool call identity and tool name;
- `tool.completed` adds only `resultHash`, never input, output or raw error text;
- IPC rejects unknown keys, control characters, invalid identity length, unsafe limit and oversized cursor;
- wrong Session cannot list or get another Session Task;
- preload boundary exposes exactly the two query methods added by this Task and still uses the single Agent Event channel.

- [x] **Step 2: Run focused tests and verify RED**

Run:

```bash
pnpm exec vitest run test/electron/main/modules/chat/agents/task-projection.test.ts test/electron/main/modules/chat/agents/service.test.ts test/electron/main/modules/chat/agents/ipc.test.ts test/electron/main/modules/chat/agents/executor.test.ts test/electron/main/modules/chat/runtime/main-boundary.test.ts
```

Run the Store test with Electron Node:

```bash
pnpm exec cross-env ELECTRON_RUN_AS_NODE=1 HOST=127.0.0.1 electron node_modules/vitest/vitest.mjs run test/electron/main/modules/chat/agents/store.test.ts
```

Expected: FAIL because Store commit listeners, Pump, Tool Event writes and the new IPC surface do not exist.

- [x] **Step 3: Add one Store-owned post-commit boundary**

Add:

```ts
export type AgentTaskCommitListener = (taskId: string) => void;

subscribeTaskCommits(listener: AgentTaskCommitListener): () => void;
```

Implement a private generic boundary:

```ts
private runTaskTransaction<T>(operation: () => T): T;
```

Every public Store mutation that changes a Task or appends a Task Event must use this boundary. `appendEvent()` records the Task ID in the current transaction frame when `aggregateKind === 'task'`. Only the outermost successful transaction notifies listeners; rollback discards the frame. Notify each listener independently and swallow/report stable listener errors after commit.

- [x] **Step 4: Persist cropped Child Tool Events**

Reuse the existing `tool.started` and `tool.completed` event protocol. Add Store methods:

```ts
export interface RecordAgentToolStartedInput {
  readonly taskId: string;
  readonly attemptId: string;
  readonly runtimeId: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly occurredAt: string;
}

export interface RecordAgentToolCompletedInput
  extends RecordAgentToolStartedInput {
  readonly resultHash: string;
}

recordToolStarted(input: RecordAgentToolStartedInput): ChatAgentEvent;
recordToolCompleted(input: RecordAgentToolCompletedInput): ChatAgentEvent;
```

Add the same two callbacks to `ChildExecutorDependencies`. Wrap only the Child Runtime tool executor. Record `started` before execution and `completed` after normalizing the `AIToolExecutionResult`; hash the normalized result with `hashAgentPayload()`. Do not persist arguments, result data, model text or raw error messages.

- [x] **Step 5: Implement the coalescing no-throw Pump**

Export:

```ts
export interface AgentTaskProjectionPump {
  enqueue(taskId: string): void;
}

export function createTaskProjectionPump(input: {
  readonly projectSummary: (
    taskId: string
  ) => ChatAgentTaskEventSnapshot | null;
  readonly publish: (event: ChatAgentTaskUpdatedEvent) => void;
  readonly reportError: (code: string) => void;
  readonly schedule?: (flush: () => void) => void;
}): AgentTaskProjectionPump;
```

Use a `Set<string>` to coalesce one event-loop turn and a `Map<string, number>` for last-published sequence. A flush re-reads committed facts, skips non-new sequences, publishes Summary/Tombstone, and catches each task independently. `enqueue()` itself must never throw.

- [x] **Step 6: Add strict IPC, preload and API methods**

Register:

```text
chat:agent:list-tasks
chat:agent:get-task
```

Expose:

```ts
chatAgentListTasks(
  input: ChatAgentListTasksInput
): Promise<ChatAgentHandlerResult<ChatAgentListTasksResult>>;
chatAgentGetTask(
  input: ChatAgentGetTaskInput
): Promise<ChatAgentHandlerResult<ChatAgentGetTaskResult>>;
```

Use exact-key plain-object validation. `limit` must be a safe integer from 1 through 100; omit means 50. Keep not-found and Session mismatch indistinguishable. Add `ChatAgentTaskUpdatedEvent` to the existing union and reuse `chat:agent:event`.

- [x] **Step 7: Run focused tests and verify GREEN**

Run the two commands from Step 2.

Expected: PASS.

- [x] **Step 8: Update changelog and commit**

Add under `## Added`:

```md
- 通过统一 post-commit Pump、裁剪 Tool Event 和窄 IPC 发布 Child Task 实时投影。
```

Commit:

```bash
git add types/chat-agent.d.ts electron/main/modules/chat/agents/types.mts electron/main/modules/chat/agents/store.mts electron/main/modules/chat/agents/executor.mts electron/main/modules/chat/agents/service.mts electron/main/modules/chat/agents/ipc.mts electron/main/modules/chat/runtime/stream/index.mts electron/main/modules/chat/runtime/stream/types.mts electron/preload/index.mts types/electron-api.d.ts test/electron/main/modules/chat/agents/delegation-foundation.test.ts test/electron/main/modules/chat/agents/store.test.ts test/electron/main/modules/chat/agents/executor.test.ts test/electron/main/modules/chat/agents/task-projection.test.ts test/electron/main/modules/chat/agents/service.test.ts test/electron/main/modules/chat/agents/ipc.test.ts test/electron/main/modules/chat/agents/read-runtime.test.ts test/electron/main/modules/chat/agents/startup-recovery.test.ts test/electron/main/modules/chat/agents/write-runtime.test.ts test/electron/main/modules/chat/runtime/main-boundary.test.ts test/electron/main/modules/chat/runtime/stream/executor.test.ts changelog/2026-07-28.md docs/superpowers/plans/2026-07-28-child-agent-task-card.md
git commit -m "feat(chat): 发布 Child Task 实时投影"
```

---

### Task 3: Recover Renderer Task State Monotonically

**Files:**

- Create: `src/stores/chat/agentTask.ts`
- Create: `src/hooks/useChat/useAgentTaskEvents.ts`
- Modify: `src/hooks/useChat/useActorSystem.ts`
- Modify: `src/components/BChat/index.vue`
- Create: `test/stores/chat/agent-task.test.ts`
- Create: `test/hooks/use-agent-task-events.test.ts`
- Modify: `test/components/BChat/session-id-runtime.test.ts`
- Modify: `changelog/2026-07-28.md`

**Interfaces:**

- Produces the application-level `useChatAgentTaskStore`.
- Produces a collision-safe message/tool-call index.
- Produces one application-root `task.updated` listener.
- BChat activates Session snapshots with `activeSessionId`, not a stale prop.

- [x] **Step 1: Write failing Store and lifecycle tests**

Assert the exact apply outcomes:

```ts
export type ChatAgentTaskApplyOutcome =
  | 'applied'
  | 'stale'
  | 'identity_conflict'
  | 'schema_incompatible'
  | 'tombstone_conflict';
```

Cover:

- an event arriving before list response is not overwritten by the older Summary;
- duplicate, equal and lower sequence are ignored;
- a higher sequence jump is accepted without resync;
- immutable identity conflict does not update data or rebuild the index;
- a newer Summary invalidates older Detail;
- tombstone deletes live Detail, preserves cursor/index and cannot be reversed;
- a larger live sequence after tombstone returns `tombstone_conflict`;
- list omissions do not delete local Tasks;
- Session list failure preserves trusted data and marks stale;
- schema mismatch marks incompatible and does not recursively retry the same schema;
- concurrent ensure/list-next calls share one in-flight Promise;
- only the latest generation can update loaded/stale/next cursor;
- application root registers one listener, BChat unmount does not dispose it, and fallback actor system does not register it.

- [x] **Step 2: Run focused tests and verify RED**

Run:

```bash
pnpm exec vitest run test/stores/chat/agent-task.test.ts test/hooks/use-agent-task-events.test.ts test/components/BChat/session-id-runtime.test.ts
```

Expected: FAIL because the Store and hook do not exist.

- [x] **Step 3: Implement the collision-safe Store**

Export:

```ts
export function createTaskIndexKey(
  sessionId: string,
  assistantMessageId: string,
  toolCallId: string
): string;
```

Encode every segment as `<utf8-byte-length>:<value>` before concatenation. Implement state exactly as specified in design section 8.2 and actions:

```ts
applySummary(
  snapshot: ChatAgentTaskEventSnapshot
): ChatAgentTaskApplyOutcome;
applyDetail(
  snapshot: ChatAgentTaskDetailSnapshot
): ChatAgentTaskApplyOutcome;
applySessionPage(
  sessionId: string,
  page: ChatAgentListTasksResult
): void;
ensureSession(
  sessionId: string,
  options?: { readonly force?: boolean }
): Promise<void>;
ensureTask(
  sessionId: string,
  taskId: string
): Promise<ChatAgentTaskSnapshot | null>;
loadNextPage(sessionId: string): Promise<void>;
findTask(
  sessionId: string,
  assistantMessageId: string,
  toolCallId: string
): ChatAgentTaskEventSnapshot | undefined;
markSessionStale(sessionId: string): void;
```

Use `asyncTo()` for IPC calls. Keep in-flight Promise and generation maps outside serializable Pinia state. Never delete based on list absence.

- [x] **Step 4: Register one application-root listener**

Implement:

```ts
export function useAgentTaskEvents(): void;
```

Subscribe first, validate `event.taskSequence === event.task.taskSequence`, then call `applySummary()`. On mismatch, deduplicate one bounded Session recovery. Register this hook only in `useProvideActorSystem()`; do not add it to `useActorSystem()` fallback.

In `BChat/index.vue`, watch the authoritative `activeSessionId` and call `ensureSession()` when it becomes non-null. Component disposal must not stop the global listener or clear Store state.

- [x] **Step 5: Run focused tests and verify GREEN**

Run the command from Step 2.

Expected: PASS.

- [x] **Step 6: Update changelog and commit**

Add under `## Added`:

```md
- 新增应用级 Child Task Store，以单调 sequence 收敛实时事件、分页快照、详情与 tombstone。
```

Commit:

```bash
git add src/stores/chat/agentTask.ts src/hooks/useChat/useAgentTaskEvents.ts src/hooks/useChat/useActorSystem.ts src/components/BChat/index.vue test/stores/chat/agent-task.test.ts test/hooks/use-agent-task-events.test.ts test/components/BChat/session-id-runtime.test.ts changelog/2026-07-28.md
git commit -m "feat(chat): 恢复 Renderer Child Task 状态"
```

---

### Task 4: Render The Lightweight Card In The Original Tool Position

**Files:**

- Modify: `src/components/BChat/index.vue`
- Modify: `src/components/BChat/components/ConversationView.vue`
- Modify: `src/components/BChat/components/MessageBubble.vue`
- Create: `src/components/BChat/components/MessageBubble/BubblePartAgentTask.vue`
- Create: `src/components/BChat/utils/agentTaskPart.ts`
- Modify: `src/stores/chat/agentTask.ts`
- Modify: `test/components/BChat/conversation-view.component.test.ts`
- Modify: `test/components/BChat/message-bubble.component.test.ts`
- Create: `test/components/BChat/bubble-part-agent-task.component.test.ts`
- Modify: `test/components/BChat/session-id-runtime.test.ts`
- Modify: `test/stores/chat/agent-task.test.ts`
- Modify: `changelog/2026-07-28.md`

**Interfaces:**

- `ConversationView` and `MessageBubble` gain an explicit `sessionId: string | null` prop.
- `BubblePartAgentTask` receives `sessionId`、`assistantMessageId` and the original `ChatMessageToolPart`.
- `readTaskResultId()` extracts only a valid terminal Result `taskId`.

- [x] **Step 1: Write failing routing, matching and fallback tests**

Cover:

- `delegate_task` is routed to `BubblePartAgentTask` at the original part index;
- other tools still use `BubblePartTool`;
- running Tool Part without a result resolves by Session/Assistant Message/Tool Call index;
- terminal Result `taskId` cross-checks the index;
- mismatched identities show a stable protocol error without rendering either Task’s details;
- no projection, null Session or directed lookup failure falls back to the existing generic tool bubble;
- outer Tool Result success cannot override a projected Task failure;
- status has text and icon, not color-only meaning;
- terminal duration freezes while active elapsed time is labelled approximate;
- unknown monetary cost never renders as `$0`.

- [x] **Step 2: Run focused tests and verify RED**

Run:

```bash
pnpm exec vitest run test/components/BChat/conversation-view.component.test.ts test/components/BChat/message-bubble.component.test.ts test/components/BChat/bubble-part-agent-task.component.test.ts
```

Expected: FAIL because the card route and component do not exist.

- [x] **Step 3: Pass Session and Assistant Message identity**

Add `sessionId: string | null` to `ConversationView` and `MessageBubble`. `BChat/index.vue` must pass `activeSessionId`; `MessageBubble` must pass `message.id` as `assistantMessageId`.

Extend the render union with a complete new branch:

```ts
| {
    key: string;
    kind: 'agent-task';
    part: ChatMessageToolPart;
  }
```

Route only Tool Parts whose normalized name is exactly `delegate_task`. Preserve the original `key` and array order.

- [x] **Step 4: Add safe Result parsing and the collapsed card**

Export:

```ts
export function readTaskResultId(
  part: ChatMessageToolPart
): string | undefined;
```

Use `isPlainObject`/`isString`; never cast arbitrary `part.result.data`. The card first resolves the composite index, then cross-checks the terminal Result ID. Its collapsed state renders mode, task title, status, elapsed time, priority and one summary. Use `createNamespace()` and full BEM selectors; add file header/JSDoc comments.

- [x] **Step 5: Run focused tests and verify GREEN**

Run the command from Step 2.

Expected: PASS.

- [x] **Step 6: Update changelog and commit**

Add under `## Added`:

```md
- 在原 delegate_task Tool Part 位置展示 Child Agent 轻量任务卡片。
```

Commit:

```bash
git add src/components/BChat/index.vue src/components/BChat/components/ConversationView.vue src/components/BChat/components/MessageBubble.vue src/components/BChat/components/MessageBubble/BubblePartAgentTask.vue src/components/BChat/utils/agentTaskPart.ts src/stores/chat/agentTask.ts test/components/BChat/conversation-view.component.test.ts test/components/BChat/message-bubble.component.test.ts test/components/BChat/bubble-part-agent-task.component.test.ts test/components/BChat/session-id-runtime.test.ts test/stores/chat/agent-task.test.ts changelog/2026-07-28.md docs/superpowers/plans/2026-07-28-child-agent-task-card.md
git commit -m "feat(chat): 渲染 Child Agent 任务卡片"
```

---

### Task 5: Add Detail, Confirmation And Artifact Interactions

**Files:**

- Modify: `src/components/BChat/components/ConfirmationSheet.vue`
- Modify: `src/components/BChat/components/MessageBubble/BubblePartAgentTask.vue`
- Modify: `src/components/BChat/index.vue`
- Create: `src/components/BChat/utils/agentArtifact.ts`
- Modify: `src/stores/chat/confirmationQueue.ts`
- Modify: `src/hooks/useChat/useAgentConfirmationEvents.ts`
- Modify: `test/components/BChat/bubble-part-agent-task.component.test.ts`
- Modify: `test/components/BChat/confirmation-sheet.component.test.ts`
- Modify: `test/components/BChat/session-id-runtime.test.ts`
- Create: `test/components/BChat/agent-artifact.test.ts`
- Modify: `test/stores/chat/confirmation-queue.test.ts`
- Modify: `test/hooks/use-agent-confirmation-events.test.ts`
- Modify: `changelog/2026-07-28.md`

**Interfaces:**

- The card lazily calls `ensureTask()` and renders only public Detail.
- ConfirmationQueue provides exact Task/Attempt matching and explicit recovery.
- Artifact openers are a closed kind registry.

- [x] **Step 1: Write failing detail and interaction tests**

Cover:

- first expansion calls `ensureTask()` once;
- a newer Summary invalidates cached Detail and the next expansion reloads it;
- Detail order is contract, execution, timeline, completion, usage, changeset, artifacts;
- timeline shows the truncation notice and never renders raw payload;
- contradicted verification overrides a satisfied claim’s visual semantics;
- error code/phase/category/retryable are primary and message is auxiliary;
- `waiting_confirmation` selects exactly one pending confirmation matching Session/Task/Attempt;
- zero matches triggers one explicit recovery before retrying;
- multiple matches show a protocol error and select none;
- changeset `baseRevision/diffHash/operationSetHash` exactly matches the Confirmation snapshot;
- only `visibility=user` artifacts render, and only registered kinds render an open action;
- artifact open failure does not modify Task state.

- [x] **Step 2: Run focused tests and verify RED**

Run:

```bash
pnpm exec vitest run test/components/BChat/bubble-part-agent-task.component.test.ts test/components/BChat/agent-artifact.test.ts test/stores/chat/confirmation-queue.test.ts test/hooks/use-agent-confirmation-events.test.ts test/components/BChat/confirmation-sheet.component.test.ts test/components/BChat/session-id-runtime.test.ts
```

Expected: FAIL because lazy Detail, exact confirmation lookup and artifact registry do not exist.

- [x] **Step 3: Add exact confirmation lookup and recovery**

Add Store actions:

```ts
findAgent(
  sessionId: string,
  taskId: string,
  attemptId: string
): ChatConfirmationQueueItem[];
recoverAgent(): Promise<void>;
```

Move the reusable Main snapshot call out of the hook’s closed local function so both the hook and card can call the same deduplicated recovery. `findAgent()` must return only pending `source='agent'` entries whose snapshot identities all match.

- [x] **Step 4: Add the closed artifact registry**

Export:

```ts
export interface AgentArtifactOpener {
  readonly kind: string;
  open(reference: string): Promise<void> | void;
}

export function canOpenArtifact(
  artifact: ChatAgentTaskArtifactSnapshot
): boolean;

export function openAgentArtifact(
  artifact: ChatAgentTaskArtifactSnapshot
): Promise<void>;
```

Register only kinds with an existing safe navigation API. Do not reinterpret an unknown reference as a file path. When no opener is registered, render metadata without a button.

- [x] **Step 5: Render the complete public Detail**

On expansion, await `ensureTask(sessionId, taskId)`. Render the design section 9.3 order and limits. Confirmation selection must run zero/one/many logic. Compare all three changeset integrity fields before enabling confirmation navigation; mismatch is a protocol error.

- [x] **Step 6: Run focused tests and verify GREEN**

Run the command from Step 2.

Expected: PASS.

- [x] **Step 7: Update changelog and commit**

Add under `## Added`:

```md
- 为 Child Task 卡片补充按需详情、统一确认定位、成本与安全 artifact 展示。
```

Commit:

```bash
git add src/components/BChat/components/ConfirmationSheet.vue src/components/BChat/components/MessageBubble/BubblePartAgentTask.vue src/components/BChat/index.vue src/components/BChat/utils/agentArtifact.ts src/stores/chat/confirmationQueue.ts src/hooks/useChat/useAgentConfirmationEvents.ts test/components/BChat/bubble-part-agent-task.component.test.ts test/components/BChat/confirmation-sheet.component.test.ts test/components/BChat/session-id-runtime.test.ts test/components/BChat/agent-artifact.test.ts test/stores/chat/confirmation-queue.test.ts test/hooks/use-agent-confirmation-events.test.ts changelog/2026-07-28.md docs/superpowers/plans/2026-07-28-child-agent-task-card.md
git commit -m "feat(chat): 完善 Child Task 详情交互"
```

---

### Task 6: Implement Single-Task Cooperative Cancellation

**Files:**

- Modify: `types/chat-agent.d.ts`
- Modify: `electron/main/modules/chat/agents/contracts.mts`
- Modify: `electron/main/modules/chat/agents/result.mts`
- Modify: `electron/main/modules/chat/agents/state.mts`
- Modify: `electron/main/modules/chat/agents/types.mts`
- Modify: `electron/main/modules/chat/agents/store.mts`
- Modify: `electron/main/modules/chat/agents/scheduler.mts`
- Modify: `electron/main/modules/chat/agents/coordinator.mts`
- Modify: `electron/main/modules/chat/agents/executor.mts`
- Modify: `electron/main/modules/chat/agents/service.mts`
- Modify: `electron/main/modules/chat/agents/ipc.mts`
- Modify: `electron/main/modules/database/service.mts`
- Modify: `electron/preload/index.mts`
- Modify: `types/electron-api.d.ts`
- Modify: `electron/main/modules/chat/agents/child-registry.mts`
- Modify: `electron/main/modules/chat/agents/confirmation-store.mts`
- Modify: `electron/main/modules/chat/agents/budget.mts`
- Modify: `src/components/BChat/components/MessageBubble/BubblePartAgentTask.vue`
- Modify: `test/electron/main/modules/chat/agents/contracts.test.ts`
- Modify: `test/electron/main/modules/chat/agents/result.test.ts`
- Modify: `test/electron/main/modules/chat/agents/state.test.ts`
- Modify: `test/electron/main/modules/chat/agents/store.test.ts`
- Modify: `test/electron/main/modules/chat/agents/scheduler.test.ts`
- Modify: `test/electron/main/modules/chat/agents/coordinator.test.ts`
- Modify: `test/electron/main/modules/chat/agents/executor.test.ts`
- Modify: `test/electron/main/modules/chat/agents/service.test.ts`
- Modify: `test/electron/main/modules/chat/agents/startup-recovery.test.ts`
- Modify: `test/electron/main/modules/chat/agents/task-projection.test.ts`
- Modify: `test/electron/main/modules/chat/agents/ipc.test.ts`
- Modify: `test/electron/main/modules/chat/runtime/main-boundary.test.ts`
- Modify: `test/electron/main/modules/database/agent-task-migration.test.ts`
- Modify: `test/electron/main/modules/chat/agents/child-registry.test.ts`
- Modify: `test/electron/main/modules/chat/agents/confirmation-store.test.ts`
- Modify: `test/electron/main/modules/chat/agents/budget.test.ts`
- Modify: `test/components/BChat/bubble-part-agent-task.component.test.ts`
- Modify: `changelog/2026-07-28.md`

**Interfaces:**

- Produces `AgentPreAttemptCancellationResult` and `task.cancel_requested`.
- Produces Store CAS methods for request and no-Attempt terminal cancellation.
- Changes Scheduler cancellation from boolean to an explicit arbitration outcome.
- Produces Coordinator `cancelTask(taskId)`.
- Card applies only the returned authoritative Summary.
- Persists Attempt usage lower-bounds, cancellation finalization markers, and superseded Outbox facts for crash-safe recovery.

- [x] **Step 1: Write failing contract, Result, state and Store tests**

Add the exact discriminated result:

```ts
export interface AgentPreAttemptCancellationResult {
  readonly resultKind: 'pre_attempt_cancelled';
  readonly taskId: string;
  readonly agentId: string;
  readonly executionStatus: 'cancelled';
  readonly completion: {
    readonly level: 'none';
    readonly criteria: readonly AgentCriteriaResult[];
  };
  readonly summary: string;
  readonly warnings: readonly [];
  readonly artifacts: readonly [];
  readonly usage: AgentUsageAccounting;
  readonly error: AgentTaskError;
}
```

Assert:

- validator rejects unknown fields and requires zero usage with unknown monetary cost;
- `task.cancel_requested` accepts only `single_task|checkpoint_cascade`;
- created/planning/authorized/queued(start) cancellation writes request, cancelled Result/hash, terminal envelope, `child.result_recorded`, and optional `delegation.ready`/Outbox in one transaction;
- retry with the same `taskId + toolCallId + resultHash` is idempotent;
- request is appended once; repeated/cancelling calls do not duplicate it;
- normal completion CAS first yields `already_settled`;
- cancellation CAS first prevents late `cancelling -> completed`;
- Checkpoint cascade also creates a terminal cancelled Result rather than a result-less cancelled Task, but never creates a ready Primary resume Outbox.
- recovery `interruptCheckpoint()`/`interruptActive()` never leaves a result-less cancelled Task.

- [x] **Step 2: Run contract and Store tests and verify RED**

Run:

```bash
pnpm exec vitest run test/electron/main/modules/chat/agents/contracts.test.ts test/electron/main/modules/chat/agents/result.test.ts test/electron/main/modules/chat/agents/state.test.ts
```

Run:

```bash
pnpm exec cross-env ELECTRON_RUN_AS_NODE=1 HOST=127.0.0.1 electron node_modules/vitest/vitest.mjs run test/electron/main/modules/chat/agents/store.test.ts test/electron/main/modules/chat/agents/budget.test.ts
```

Expected: FAIL because the cancellation result and atomic Store methods do not exist.

- [x] **Step 3: Add cancellation contracts and Store CAS**

Extend:

```ts
export type AgentTaskResult =
  | ChatAgentResult
  | AgentPreAttemptFailureResult
  | AgentPreAttemptCancellationResult;
```

Add:

```ts
export interface RequestAgentTaskCancellationInput {
  readonly taskId: string;
  readonly requestKind: 'single_task' | 'checkpoint_cascade';
  readonly occurredAt: string;
}

export interface AgentTaskCancellationProjection {
  readonly previousStatus: AgentTaskStatus;
  readonly task: AgentTaskRecord;
  readonly disposition:
    | 'cancel_requested'
    | 'commit_in_progress'
    | 'already_settled';
}

export interface RecordPreAttemptCancellationInput
  extends RequestAgentTaskCancellationInput {
  readonly checkpointId: string;
  readonly toolCallId: string;
  readonly result: AgentPreAttemptCancellationResult;
  readonly resultHash: string;
}

requestTaskCancellation(
  input: RequestAgentTaskCancellationInput
): AgentTaskCancellationProjection;
recordPreAttemptCancellation(
  input: RecordPreAttemptCancellationInput
): AgentCheckpointRecord;
```

`requestTaskCancellation()` atomically writes `cancelRequestedAt + task.cancel_requested`; it preserves `committing`, moves applicable Attempt-bearing active states to `cancelling`, and never touches terminal Tasks. It must reject `created/planning/authorized/queued(start)` so those states cannot pass through a preliminary generic cancellation transaction. `recordPreAttemptCancellation()` is the only path that can cancel without an Attempt and must append the request exactly once while performing the complete rendezvous transaction.

Update `result.mts` so result validation is discriminated by `resultKind` before reading `attemptId`. A real Attempt result still requires exact Task/Actor/Attempt identity; `pre_attempt_failure` and `pre_attempt_cancelled` must prove that the Task has no current Attempt and that their criteria align with the immutable Contract.

Refactor `interruptCheckpoint()` and `interruptActive()` so recovery never writes `Task cancelled` without a Result. An unfinished Task without an Attempt receives a validated `AgentPreAttemptFailureResult` and becomes `failed`; an Attempt-bearing Task receives a failed `ChatAgentResult`, freezes its usage and becomes `failed`. Persist terminal envelopes and `child.result_recorded`, then finish the aggregate as `interrupted` without producing a ready Outbox.

Persist `usage_snapshot_json + usage_complete` on each Attempt, `cancellation_finalized_at` on cancelled Checkpoints, and `superseded_at` on invalidated Outbox rows. Recovery freezes only observed usage lower-bounds, marks incomplete crash usage in the Result error details, replays cancellation cleanup until the durable marker is written last, and never republishes stale `delegation.created` or `delegation.ready` events.

- [x] **Step 4: Make Scheduler arbitration explicit**

Replace boolean cancellation with:

```ts
export type AgentScheduleCancelOutcome =
  | 'not_found'
  | 'queued_cancelled'
  | 'active_signalled';

cancel(
  taskId: string,
  reason: string
): AgentScheduleCancelOutcome;
```

Use the scheduler’s existing serial dispatch boundary so queue removal and start/commit acquisition have one ordering. Never cancel entries belonging to sibling Tasks.

- [x] **Step 5: Write failing orchestration and cleanup tests**

Cover:

- queued(start) cancellation never starts Runtime;
- running cancellation sends cooperative signal first and hard-aborts only the target Runtime after grace;
- waiting confirmation revokes only the target pending confirmation;
- waiting confirmation remains cancellable after the request CAS and before pending confirmation revocation;
- queued(commit) preserves approved confirmation audit unchanged but removes only the target commit request, changeset and overlay;
- sibling Task continues and Checkpoint rendezvous completes normally;
- duplicate calls share one `cancelFlights` Promise;
- running late success is normalized to cancelled after cancellation CAS wins;
- cleanup failure produces structured `phase=recovery` failure and never a false cancelled;
- target lease, Registry, timer, budget reservation, overlay and in-flight maps are empty before the cancel workflow settles;
- required/optional cancelled results preserve their existing Primary continuation semantics.
- wrong Session cannot cancel or enumerate another Session’s Task;
- preload exposes `chatAgentCancelTask` only after Coordinator behavior exists.

- [x] **Step 6: Run orchestration tests and verify RED**

Run:

```bash
pnpm exec vitest run test/electron/main/modules/chat/agents/scheduler.test.ts test/electron/main/modules/chat/agents/coordinator.test.ts test/electron/main/modules/chat/agents/ipc.test.ts test/electron/main/modules/chat/runtime/main-boundary.test.ts test/electron/main/modules/chat/agents/child-registry.test.ts test/electron/main/modules/chat/agents/confirmation-store.test.ts test/components/BChat/bubble-part-agent-task.component.test.ts
```

Expected: FAIL because single-Task orchestration and Renderer cancel handling do not exist.

- [x] **Step 7: Implement Coordinator cancellation and no-throw cleanup**

Add:

```ts
cancelTask(
  taskId: string
): Promise<
  'cancel_requested' | 'commit_in_progress' | 'already_settled'
>;
```

Use this complete cancel-flight type:

```ts
type AgentTaskCancelDisposition =
  | 'cancel_requested'
  | 'commit_in_progress'
  | 'already_settled';

const cancelFlights = new Map<
  string,
  Promise<AgentTaskCancelDisposition>
>();
```

For queued(start), win Scheduler arbitration before the no-Attempt Store transaction. For running Runtime, persist intent, send cooperative abort, then hard-abort only that Runtime after grace.

For `waiting_confirmation`, persist the request and transition to `cancelling`, then allow `revokeConfirmation()` only when the confirmation is still pending and its Task is either `waiting_confirmation` or `cancelling` with a matching `cancelRequestedAt`; revoke, discard changeset and delete overlay for that Task only. For `queued(commit)`, win Scheduler commit-queue cancellation, persist the request, keep the approved confirmation immutable, discard the target changeset and delete its overlay. Never change an approved confirmation to revoked.

Implement one private workflow:

```ts
function cancelTaskInternal(
  taskId: string,
  requestKind: 'single_task' | 'checkpoint_cascade'
): Promise<AgentTaskCancelDisposition>;
```

The public `cancelTask(taskId)` delegates with `single_task`. Refactor Checkpoint cancellation to call the same private workflow for every active Child in parallel with `checkpoint_cascade`, rather than writing result-less cancelled states. A Task without an Attempt uses `recordPreAttemptCancellation()`; a Task with an Attempt freezes actual usage and records a normal cancelled `ChatAgentResult`. Each result must update `terminalResults[toolCallId]` and emit `child.result_recorded`.

For `single_task`, the last Child Result may produce `delegation.ready` and the ready Outbox through the existing rendezvous. For `checkpoint_cascade`, the final aggregate remains `cancelled`/`interrupted` under the existing Primary Turn cancellation protocol and must never enqueue a ready Primary resume. Use one shared bounded wait followed by per-Runtime escalation so total wait does not grow linearly with Child count.

Add an idempotent Registry method:

```ts
releaseTask(taskId: string): void;
```

In `finally`, execute lease release, Registry release, timer cleanup, `taskRuns` cleanup, cancel-flight cleanup and budget settlement independently. An Attempt settles actual usage; no-Attempt cancellation releases only that Task reservation. Never release the Checkpoint continuation fence.

- [x] **Step 8: Wire Service and card without optimistic state**

Register `chat:agent:cancel-task` with the same strict plain-object, exact-key, identity and cross-Session rules used by the query IPC. Expose:

```ts
chatAgentCancelTask(
  input: ChatAgentCancelTaskInput
): Promise<ChatAgentHandlerResult<ChatAgentCancelTaskResult>>;
```

Update `main-boundary.test.ts` only in this Task so the public method does not exist before its behavior is implemented. `service.cancelTask({ sessionId, taskId })` validates ownership, calls Coordinator, then re-projects and returns:

```ts
export interface ChatAgentCancelTaskResult {
  readonly disposition:
    | 'cancel_requested'
    | 'commit_in_progress'
    | 'already_settled';
  readonly task: ChatAgentTaskSummarySnapshot;
}
```

In the card, implement:

```ts
async function requestTaskCancel(): Promise<void>;
```

After a successful IPC response, call only `taskStore.applySummary(response.data.task)`. Do not mutate status optimistically. Disable duplicate requests once Summary has cancellation; use “请求取消” for `committing`.

- [x] **Step 9: Run all Task 6 tests and verify GREEN**

Run the commands from Steps 2 and 6.

Expected: PASS.

- [x] **Step 10: Update changelog and commit**

Add under `## Added`:

```md
- 支持单个 Child Task 的 cooperative cancellation，并保持 sibling Task、预算与续接围栏隔离。
```

Commit:

```bash
git add changelog/2026-07-28.md docs/superpowers/plans/2026-07-28-child-agent-task-card.md types/chat-agent.d.ts types/electron-api.d.ts electron/main/modules/chat/agents/child-registry.mts electron/main/modules/chat/agents/contracts.mts electron/main/modules/chat/agents/coordinator.mts electron/main/modules/chat/agents/executor.mts electron/main/modules/chat/agents/ipc.mts electron/main/modules/chat/agents/result.mts electron/main/modules/chat/agents/scheduler.mts electron/main/modules/chat/agents/service.mts electron/main/modules/chat/agents/store.mts electron/main/modules/chat/agents/types.mts electron/main/modules/database/service.mts electron/preload/index.mts src/components/BChat/components/MessageBubble/BubblePartAgentTask.vue test/components/BChat/bubble-part-agent-task.component.test.ts test/electron/main/modules/chat/agents/budget.test.ts test/electron/main/modules/chat/agents/child-registry.test.ts test/electron/main/modules/chat/agents/confirmation-store.test.ts test/electron/main/modules/chat/agents/contracts.test.ts test/electron/main/modules/chat/agents/coordinator.test.ts test/electron/main/modules/chat/agents/executor.test.ts test/electron/main/modules/chat/agents/file-commit.test.ts test/electron/main/modules/chat/agents/ipc.test.ts test/electron/main/modules/chat/agents/read-runtime.test.ts test/electron/main/modules/chat/agents/result.test.ts test/electron/main/modules/chat/agents/scheduler.test.ts test/electron/main/modules/chat/agents/service.test.ts test/electron/main/modules/chat/agents/startup-recovery.test.ts test/electron/main/modules/chat/agents/store.test.ts test/electron/main/modules/chat/agents/task-projection.test.ts test/electron/main/modules/chat/agents/write-overlay.test.ts test/electron/main/modules/chat/agents/write-runtime.test.ts test/electron/main/modules/chat/agents/write-tools.test.ts test/electron/main/modules/chat/runtime/main-boundary.test.ts test/electron/main/modules/database/agent-task-migration.test.ts
git commit -m "feat(chat): 支持单 Child Task 协作取消"
```

---

### Task 7: Enforce Commit Cancellation And Recovery Boundaries

**Files:**

- Modify: `types/chat-agent.d.ts`
- Modify: `electron/main/modules/chat/agents/contracts.mts`
- Modify: `electron/main/modules/chat/agents/types.mts`
- Modify: `electron/main/modules/chat/agents/store.mts`
- Modify: `electron/main/modules/chat/agents/file-commit.mts`
- Modify: `electron/main/modules/chat/agents/coordinator.mts`
- Modify: `electron/main/modules/chat/agents/service.mts`
- Modify: `electron/main/modules/chat/agents/write-overlay.mts`
- Modify: `electron/main/modules/database/service.mts`
- Modify: `test/electron/main/modules/chat/agents/contracts.test.ts`
- Modify: `test/electron/main/modules/chat/agents/store.test.ts`
- Modify: `test/electron/main/modules/chat/agents/file-commit.test.ts`
- Modify: `test/electron/main/modules/chat/agents/coordinator.test.ts`
- Modify: `test/electron/main/modules/chat/agents/startup-recovery.test.ts`
- Modify: `test/electron/main/modules/chat/agents/task-projection.test.ts`
- Modify: `test/electron/main/modules/chat/agents/service.test.ts`
- Modify: `test/electron/main/modules/chat/agents/ipc.test.ts`
- Modify: `test/electron/main/modules/chat/agents/write-overlay.test.ts`
- Modify: `test/electron/main/modules/database/agent-task-migration.test.ts`
- Modify: `test/components/BChat/bubble-part-agent-task.component.test.ts`
- Modify: `changelog/2026-07-28.md`

**Interfaces:**

- Splits journal cancellation from Task terminalization.
- Produces FileCommitter `cancelTask(taskId)` with an explicit disposition.
- Makes late cancellation converge to completed, commit_failed or manual recovery truth.
- Finishes end-to-end security, recovery and concurrency regression coverage.

- [x] **Step 1: Write failing journal-boundary tests**

Assert:

- `queued(commit) -> committing` and journal `created` remain one Store transaction;
- `created` with zero operation progress can cancel the journal through CAS/mutex;
- cancelling a journal does not terminalize Task before overlay deletion and Result persistence;
- `applying` and `applied` return `commit_in_progress`, never invoke Runtime hard abort and never delete overlay or recovery references;
- live commit uses `markJournalApplying` as the irreversible line;
- late cancel after irreversible line preserves successful commit and adds `cancel_arrived_too_late`;
- commit failure remains `commit_failed`;
- uncertain external state becomes `manual_recovery_required` with journal `manual_recovery`;
- startup recovery cleans a safely cancelled journal/overlay before recording Task cancelled;
- startup recovery finalizes every safely cancelled journal with a canonical cancelled Result before interrupting unrelated survivors;
- journal cancellation appends one validated `commit.journal_cancelled` Task Event so `taskSequence` advances and the Pump publishes the discarded phase;
- mixed startup recovery deletes only safe-cancel/orphan overlays and preserves manual-recovery or roll-forward neighbors;
- cleanup failure never publishes a false cancelled Summary.

- [x] **Step 2: Run focused tests and verify RED**

Run:

```bash
pnpm exec vitest run test/electron/main/modules/chat/agents/contracts.test.ts test/electron/main/modules/chat/agents/file-commit.test.ts test/electron/main/modules/chat/agents/coordinator.test.ts test/electron/main/modules/chat/agents/task-projection.test.ts test/electron/main/modules/chat/agents/service.test.ts test/electron/main/modules/chat/agents/ipc.test.ts test/electron/main/modules/chat/agents/write-overlay.test.ts test/components/BChat/bubble-part-agent-task.component.test.ts
```

Run SQLite-backed tests:

```bash
pnpm exec cross-env ELECTRON_RUN_AS_NODE=1 HOST=127.0.0.1 electron node_modules/vitest/vitest.mjs run test/electron/main/modules/chat/agents/store.test.ts test/electron/main/modules/chat/agents/startup-recovery.test.ts
```

Expected: FAIL because current `cancelCommitJournal()` terminalizes the Task before external cleanup and FileCommitter has no explicit cancel disposition.

- [x] **Step 3: Split journal cancellation from Task terminalization**

Refactor Store so the safe journal CAS performs only:

- journal `created -> cancelled`;
- changeset `committing -> discarded`;
- `unfinishedJournalCount - 1` with an underflow guard;
- journal/changeset audit Events;
- Task remains `committing` with `cancelRequestedAt` until overlay cleanup succeeds;
- no Result, terminal envelope, ready Event or ready Outbox is written yet.

Do not add `committing -> cancelling`; the existing legal `committing -> cancelled` edge is the final transition after cleanup.

Add and validate one Task Event:

```ts
type ChatAgentCommitJournalCancelledPayload = {
  readonly journalId: string;
  readonly changesetId: string;
};
```

Register it as `commit.journal_cancelled` in `ChatAgentEventType`, `ChatAgentTaskEventType` and `ChatAgentEventPayloadMap`. Append it in the safe journal CAS, map it to the public commit timeline code `journal_cancelled`, and rely on its new sequence to make the post-commit Pump publish the discarded changeset phase. Do not expose private journal references outside the fixed public code.

Change the Store return type to the fact this operation now owns:

```ts
cancelCommitJournal(
  input: CancelAgentCommitJournalInput
): AgentCommitJournalRecord;
```

- [x] **Step 4: Add FileCommitter cancellation arbitration**

Add:

```ts
export interface AgentFileCommitCancelResult {
  readonly disposition:
    | 'journal_cancelled'
    | 'commit_in_progress';
  readonly journal: AgentCommitJournalRecord;
}

cancelTask(taskId: string): Promise<AgentFileCommitCancelResult>;
```

Under the same commit mutex/CAS:

- journal `created` and zero applied operations may return `journal_cancelled`;
- `applying/applied/finalized/manual_recovery` returns `commit_in_progress`;
- FileCommitter never consumes the Runtime hard-abort timer;
- after `markJournalApplying`, commit/recovery owns convergence.

- [x] **Step 5: Finalize a safely cancelled commit only after cleanup**

Add a Store finalizer:

```ts
finalizeCommitCancellation(
  input: FinalizeAgentCommitCancellationInput
): AgentCheckpointRecord;
```

Add `finalizeCommitCancellation` to the narrow `AgentFileCommitStore` capability used by recovery; do not widen it to unrelated Store mutations.

It must require journal `cancelled`, changeset `discarded`, `unfinishedJournalCount === 0`, Task `committing` and zero applied operation progress. A live cancellation must already have a persisted request. After the caller has successfully deleted the target overlay, the finalizer constructs the canonical cancelled `ChatAgentResult` from the journal’s immutable `resultDraft`, transitions Attempt/Task to cancelled, writes Result/hash, terminal envelope and `child.result_recorded`, then applies the single-task-versus-checkpoint-cascade rendezvous rule from Task 6.

For startup recovery, allow the finalizer to append one `task.cancel_requested` with `requestKind='checkpoint_cascade'` when recovery cancelled a safe `created` journal that had no earlier request. Change startup order to:

1. collect `AgentJournalRecoveryResult[]` from `chatAgentFileCommitter.recover()`;
2. recover confirmation state;
3. discard orphan/private overlays;
4. call `finalizeCommitCancellation()` for each `status='cancelled'` recovery result;
5. only then call `interruptActive()` for remaining survivors.

Pass the journal recovery results into `recoverInterruptedWrites()` explicitly; do not rediscover cancellation by guessing Task status.

Replace the global overlay-root reset with:

```ts
export async function discardTaskOverlay(input: {
  readonly overlayRoot: string;
  readonly taskId: string;
  readonly attemptId: string;
}): Promise<void>;
```

Validate both identity segments, resolve beneath the canonical overlay root and delete only that Attempt directory. Build an explicit startup cleanup allowlist from:

- `status='cancelled'` journal recovery results and their persisted `resultDraft.attemptId`;
- active write Tasks with `unfinishedJournalCount === 0` and a persisted current Attempt.

Never include a Task whose journal is `applying`、`applied`、`manual_recovery` or otherwise requires roll-forward. A mixed recovery test must keep that neighbor’s overlay and private recovery references byte-for-byte intact.

- [x] **Step 6: Converge late cancellation truthfully**

Coordinator keeps `committing` while FileCommitter reports `commit_in_progress`. When commit resolves:

- success records the true completed Result plus `cancel_arrived_too_late`;
- deterministic failure records `commit_failed`;
- unknown external state records `manual_recovery_required` and keeps recovery references.

Deterministic failure uses the terminal journal state `failed` only when the journal is still `applying`, has zero persisted operation progress and every target remains at its immutable base hash. Existing progress, `applied` state, mixed targets or unknown target state remain `manual_recovery`. The additive SQLite migration must preserve all journal facts, immutable/no-delete triggers and the status index while extending the journal status constraint.

Renderer continues to show the returned Summary and later Event; it never converts `commit_in_progress` into cancelled locally.

- [x] **Step 7: Add end-to-end recovery, security and concurrency regression**

Complete the design section 14 matrix:

- Renderer reload restores active and historical cards;
- event-before-list, duplicate, reorder and sequence jumps converge;
- tombstone can be directed-recovered and never revived;
- waiting confirmation selects only the target;
- one Task cancel leaves sibling running and continuation waits for all results;
- Checkpoint cancellation still fans out in parallel and total wait does not grow linearly with Child count;
- recursive IPC scan rejects every forbidden key/value and absolute path;
- production controlled-write flag remains false.

- [x] **Step 8: Run focused and full verification**

Run the two commands from Step 2, then:

```bash
pnpm exec tsc --noEmit
pnpm electron:build-main
pnpm lint
pnpm lint:style
pnpm test
```

Expected: all commands exit 0. If `pnpm lint` or `pnpm lint:style` changes files, inspect the diff and rerun the corresponding command plus affected focused tests.

- [x] **Step 9: Update changelog and commit**

Add under `## Changed`:

```md
- 收紧 Child Task 在 commit journal 不可逆边界后的取消、恢复与真实终态收敛。
```

Commit:

```bash
git add types/chat-agent.d.ts electron/main/modules/chat/agents/contracts.mts electron/main/modules/chat/agents/types.mts electron/main/modules/chat/agents/store.mts electron/main/modules/chat/agents/file-commit.mts electron/main/modules/chat/agents/coordinator.mts electron/main/modules/chat/agents/service.mts electron/main/modules/chat/agents/write-overlay.mts electron/main/modules/database/service.mts test/electron/main/modules/chat/agents/contracts.test.ts test/electron/main/modules/chat/agents/store.test.ts test/electron/main/modules/chat/agents/file-commit.test.ts test/electron/main/modules/chat/agents/coordinator.test.ts test/electron/main/modules/chat/agents/startup-recovery.test.ts test/electron/main/modules/chat/agents/task-projection.test.ts test/electron/main/modules/chat/agents/service.test.ts test/electron/main/modules/chat/agents/ipc.test.ts test/electron/main/modules/chat/agents/write-overlay.test.ts test/electron/main/modules/database/agent-task-migration.test.ts test/components/BChat/bubble-part-agent-task.component.test.ts docs/superpowers/plans/2026-07-28-child-agent-task-card.md changelog/2026-07-28.md
git commit -m "fix(chat): 守住 Child 提交取消边界"
```

## Final Acceptance

- [x] `chat_agent_delegation_checkpoints.assistant_message_id` is audited before a unique index is created.
- [x] list/event/collapsed card carry Summary only; Detail is directed and lazy.
- [x] every Task mutation publishes only after commit and broadcast failure cannot change persisted business results.
- [x] Renderer accepts newer sequence, tolerates jumps, rejects identity conflicts and never revives tombstones.
- [x] `delegate_task` stays in the original Tool Part order and safely falls back when projection is unavailable.
- [x] confirmation, changeset integrity and artifact opening use existing trusted stores/registries.
- [x] single Task cancellation never cancels a sibling or releases the Primary continuation fence.
- [x] every cancelled Task has a terminal Result, including pre-Attempt and Checkpoint cascade paths.
- [x] journal `applying/applied` is never hard-aborted or misreported as cancelled.
- [x] Main/Renderer protocol output contains no forbidden internal or path data.
- [x] production `controlledWriteChildEnabled` remains false.
- [x] all focused tests, TypeScript, Main build, ESLint, Stylelint and full test suite pass.
