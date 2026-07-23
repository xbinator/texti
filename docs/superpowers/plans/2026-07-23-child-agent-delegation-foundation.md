# Child Agent 持久化委派基础 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立默认关闭的持久化委派基础，使 Primary Runtime A 能把 `delegate_task` 契约、原工具调用、Task、Checkpoint 与 Outbox 原子落库后安全挂起，并在内部收到全部终态结果后只创建一次 Primary Runtime B 完成同一 Turn。

**Architecture:** 主进程 `ChatAgentDelegationService` 和 SQLite Store 是 Task、Checkpoint、Event 与续接事实来源；Chat Runtime 只识别 `deferred-coordination` 工具并切断当前 Provider 生命周期，不等待普通 renderer-tool Promise。Renderer Actor System 投影 `waiting_children`、注册 Runtime B 路由并发起幂等续接；真实 Child 模型执行器、Capability Plan 编译、资源调度、受控写入、确认队列和任务卡片不在本计划启用。

**Tech Stack:** TypeScript strict、Electron main/preload IPC、better-sqlite3、Vue 3 Composition API、XState、AI SDK v7、Vitest

## Global Constraints

- 本计划是系列实施的第一个可独立验证阶段；完成后 `delegate_task` 仍保持 `internal` 暴露级别，不进入 BChat 活动工具集。
- 本阶段不运行真实 Child 模型。集成测试通过主进程内部 `recordTaskResult` 接口写入确定性终态结果；下一计划的 `ChildTaskRuntimeExecutor` 复用该接口。
- 本阶段只接受 `mode: 'read'` 的基础契约。类型和工具 Schema 保留完整 `read | write` 设计，但 `write` 在验证阶段稳定返回 `capability_denied`，不能创建 Checkpoint。
- 不使用普通 `ChatRuntime.send`、`continue` 或 `chat_messages` 存储 Child transcript。
- `delegate_task` 不进入 generic renderer-tool Promise，不受现有 30 秒 renderer-tool timeout 覆盖。
- Task Contract、Continuation Snapshot 和未来的 Execution Plan Snapshot 是不可变快照；能力恢复只能收缩，不能根据当前环境猜测升级。
- Runtime A 释放 Session 消息写入锁后，`turnContinuationFence` 仍阻止新 Turn、compact、rollback 和历史修改越过悬空 tool call。
- Checkpoint 的 CAS、结果 identity 和 Outbox delivery 必须幂等；重复事件或 Renderer 重载不能创建第二个 Runtime B。
- 主进程重启不自动重新调用模型；非终态 Checkpoint 收敛为 `interrupted`，保留 Task、Event 和已完成结果。
- 持久化数据按 allowlist 裁剪，不写入 Provider 密钥、Authorization header、环境变量、完整配置对象或未授权文件内容。
- 不使用 `any`；所有新增函数、类型、接口、状态迁移和复杂逻辑均按 `AGENTS.md` 添加文件头及准确 JSDoc。
- Renderer 异步调用统一使用 `src/utils/asyncTo.ts` 的 `asyncTo`。
- 文档内只使用仓库相对路径；每个行为提交同步更新测试，最终更新 `changelog/2026-07-23.md`。
- 本次执行位于 `codex/child-agent-delegation` 功能分支，由执行 Agent 按已完成的功能边界提交；不使用 `git commit --amend`，后续 Task 继续保持写入串行、只读审查并行。
- 当前工作区可能包含用户的并行改动。只修改任务列出的精确文件；不得覆盖、暂存或整理无关变更。
- 每个 Task 严格执行 RED → GREEN → REFACTOR；在对应 RED 命令未出现预期失败前不写实现。

---

## Delivery Boundary

本计划交付以下闭环：

```text
Primary Runtime A
  → 识别 delegate_task
  → 原子提交 assistant tool call + Task + Checkpoint + Outbox
  → waiting_children
  → 释放 Runtime A / Session 写锁
  → 内部 recordTaskResult
  → Checkpoint CAS ready_to_resume → resuming
  → 注册 Primary Runtime B
  → 按原 toolCallId 注入结构化结果
  → force-final 续接
  → 完成 Checkpoint并释放 turnContinuationFence
```

本计划明确不交付以下能力：

- 真实 `ChildTaskRuntimeExecutor` 和无聊天消息执行内核。
- Coordinator 的 Capability Intersection、Execution Plan 编译和 Child Actor。
- 并行只读调度、resource scope lease、deadline 执行和 budget accounting。
- 文件 overlay、changeset、diff integrity、commit journal 和恢复协议。
- ConfirmationQueue 与轻量任务卡片。

上述能力不能以临时分支塞入本计划；分别在后续只读 Child 执行计划和受控写入计划中实现。

---

## Shared Contracts

所有 Task 使用以下 Runtime 地址，不再用不完整地址推断层级：

```typescript
/** One immutable address for a concrete chat Runtime instance. */
export interface ChatRuntimeAddress {
  /** Owning chat session. */
  sessionId: string;
  /** Stable turn shared by Runtime A and Runtime B. */
  turnId: string;
  /** Stable actor identity. */
  agentId: string;
  /** Concrete replaceable Runtime identity. */
  runtimeId: string;
  /** Stable parent actor when the Runtime belongs to a Child. */
  parentAgentId?: string;
  /** Runtime that created this delegated execution. */
  parentRuntimeId?: string;
  /** Root Runtime of the Turn tree. */
  rootRuntimeId: string;
  /** Previous Runtime of the same actor when this is a continuation. */
  continuationOfRuntimeId?: string;
}
```

基础 Task 与 Checkpoint 状态使用：

```typescript
export type AgentTaskStatus =
  | 'created'
  | 'planning'
  | 'authorized'
  | 'queued'
  | 'starting'
  | 'running'
  | 'waiting_confirmation'
  | 'committing'
  | 'cancelling'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'deadline_exceeded'
  | 'commit_failed';

export type AgentCheckpointStatus =
  | 'preparing'
  | 'waiting_children'
  | 'ready_to_resume'
  | 'resuming'
  | 'cancelling'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted';
```

基础 Checkpoint 合法迁移固定为：

```text
preparing → waiting_children
waiting_children → ready_to_resume | cancelling | interrupted
ready_to_resume → resuming | cancelling | interrupted
resuming → completed | failed | interrupted
cancelling → cancelled | interrupted
```

任何终态没有出边；取消采用 cooperative cancellation 请求语义。本阶段没有活动 Child Runtime，但仍必须先持久化 `cancelling` 和取消请求 Event，再在确认没有活动 Attempt、journal 或 Runtime 后进入 `cancelled`，不能增加直达终态的特例。

---

### Task 1: Complete Runtime Lineage and Deferred Tool Metadata

**Files:**

- Modify: `types/chat-runtime.d.ts`
- Modify: `src/ai/chat/types.ts`
- Modify: `electron/main/modules/chat/runtime/types.mts`
- Modify: `electron/main/modules/chat/runtime/runners/factory.mts`
- Modify: `src/components/BChat/hooks/useChatRuntimeLauncher.ts`
- Modify: `shared/ai/tools/types.ts`
- Create: `shared/ai/tools/DelegateTaskTool/index.ts`
- Modify: `shared/ai/tools/index.ts`
- Modify: `src/ai/tools/catalog/runtimeTools.ts`
- Modify: `test/electron/main/modules/chat/runtime/shared-types.test.ts`
- Modify: `test/electron/main/modules/chat/runtime/factory.test.ts`
- Modify: `test/ai/tools/tool-registry.test.ts`
- Modify: `test/components/BChat/session-id-runtime.test.ts`

**Interfaces:**

- Produces: `ChatRuntimeAddress` and complete lineage fields on Runtime commands and events.
- Produces: `ToolExecutionClass`, `AgentToolEffectMetadata`, and `ToolRegistryEntry.executionClass/effect`.
- Produces: schema-only `delegateTaskToolRegistryEntry` with `exposure: 'internal'`.
- Preserves: existing tool ownership and current BChat tool list.

- [x] **Step 1: Add failing Runtime lineage tests**

In `test/electron/main/modules/chat/runtime/factory.test.ts`, update the Runtime fixture and assert:

```typescript
expect(runtime).toMatchObject({
  sessionId: 'session-1',
  turnId: 'turn-1',
  agentId: 'primary',
  runtimeId: 'runtime-b',
  rootRuntimeId: 'runtime-a',
  continuationOfRuntimeId: 'runtime-a'
});
```

In `test/components/BChat/session-id-runtime.test.ts`, assert the launcher returns and registers the complete address before `window.electronAPI.chatRuntime.send`:

```typescript
expect(registerRuntime).toHaveBeenCalledWith(
  expect.objectContaining({
    sessionId: 'session-1',
    turnId: expect.any(String),
    agentId: 'primary',
    runtimeId: expect.any(String),
    rootRuntimeId: expect.any(String)
  }),
  expect.any(Object)
);
expect(registerRuntime.mock.invocationCallOrder[0]).toBeLessThan(send.mock.invocationCallOrder[0]);
```

- [x] **Step 2: Add failing registry metadata tests**

In `test/ai/tools/tool-registry.test.ts`, assert:

```typescript
expect(getToolRegistryEntry('delegate_task')).toMatchObject({
  runtime: 'coordinator',
  group: 'agent',
  exposure: 'internal',
  executionClass: 'deferred-coordination',
  effect: {
    effect: 'pure_read',
    resourceScopeResolver: 'delegate-contract',
    reversible: true
  }
});
expect(getToolNamesByExposure('chat-default')).not.toContain('delegate_task');
expect(TOOL_REGISTRY.every((entry) => entry.executionClass && entry.effect)).toBe(true);
```

Add a Schema assertion for required `task`, `acceptanceCriteria`, `mode`, `resources`, `requestedTools`, `required`, and `priority`, plus optional ISO `deadlineAt`.

- [x] **Step 3: Run Task 1 tests and verify RED**

```bash
pnpm exec vitest run \
  test/electron/main/modules/chat/runtime/shared-types.test.ts \
  test/electron/main/modules/chat/runtime/factory.test.ts \
  test/ai/tools/tool-registry.test.ts \
  test/components/BChat/session-id-runtime.test.ts
```

Expected: FAIL because complete Runtime lineage, `internal` exposure, execution class, effect metadata, and `delegate_task` do not exist.

- [x] **Step 4: Add complete Runtime address types**

Add `ChatRuntimeAddress` from Shared Contracts to `types/chat-runtime.d.ts`. Make send/continue inputs and `ChatRuntimeEventBase` carry the address fields. Replace the duplicate renderer shape with:

```typescript
/** Renderer routing address; identical to the shared Runtime address. */
export type ChatActorAddress = ChatRuntimeAddress;
```

Update `ActiveChatRuntime`, Runtime factory inputs, fixtures, and launcher return type to use the same address. For an initial Primary Runtime, set `rootRuntimeId = runtimeId`; for Runtime B, retain Runtime A's `rootRuntimeId` and set `continuationOfRuntimeId = sourceRuntimeId`.

- [x] **Step 5: Add execution/effect metadata to every registry entry**

Extend `shared/ai/tools/types.ts`:

```typescript
/** Tool scheduling behavior owned by the main process. */
export type ToolExecutionClass = 'direct' | 'deferred-coordination';

/** Main-process side-effect classification used by future Child plans. */
export interface AgentToolEffectMetadata {
  /** Observable side-effect category. */
  effect: 'pure_read' | 'external_read' | 'staged_file_write' | 'transactional_write' | 'immediate_side_effect' | 'unknown';
  /** Registered resolver name; never supplied by Renderer. */
  resourceScopeResolver: string;
  /** Commit adapter for a transactional domain. */
  commitAdapter?: string;
  /** Whether a completed action has a defined reversal. */
  reversible: boolean;
}
```

Add `'coordinator'` to `ToolRuntimeOwner`, `'agent'` to `ToolRuntimeGroup`, and `'internal'` to `ToolExposure`. Require `executionClass` and `effect` on `ToolRegistryEntry`.

Classify existing local reads as `pure_read`, external reads as `external_read`, file edit/write as `staged_file_write`, and existing direct settings/MCP/document/WebView mutations as `immediate_side_effect`. This metadata describes safety facts; it does not change current Primary execution behavior in this task.

- [x] **Step 6: Add the internal delegate_task schema**

Create `shared/ai/tools/DelegateTaskTool/index.ts`:

```typescript
/** Schema-only deferred task delegation tool; activation is intentionally separate. */
export const delegateTaskToolRegistryEntry = {
  runtime: 'coordinator',
  group: 'agent',
  exposure: 'internal',
  executionClass: 'deferred-coordination',
  effect: {
    effect: 'pure_read',
    resourceScopeResolver: 'delegate-contract',
    reversible: true
  },
  definition: {
    name: 'delegate_task',
    description: 'Submit one bounded task contract for controlled Child Agent execution.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['task', 'acceptanceCriteria', 'mode', 'resources', 'requestedTools', 'required', 'priority'],
      properties: {
        task: { type: 'string', minLength: 1 },
        acceptanceCriteria: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
        mode: { type: 'string', enum: ['read', 'write'] },
        resources: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'reference'],
            properties: {
              kind: { type: 'string', enum: ['file', 'directory', 'document', 'webview', 'resource'] },
              reference: { type: 'string', minLength: 1 },
              revision: { type: 'string', minLength: 1 }
            }
          }
        },
        requestedTools: { type: 'array', uniqueItems: true, items: { type: 'string', minLength: 1 } },
        required: { type: 'boolean' },
        priority: { type: 'string', enum: ['low', 'normal', 'high'] },
        deadlineAt: { type: 'string', format: 'date-time' }
      }
    }
  }
} satisfies ToolRegistryEntry;
```

Export registry-entry lookup by name so the stream can inspect `executionClass` without relying on name-only branching. Keep catalog generation from returning `internal` tools to normal chat exposure.

- [x] **Step 7: Re-run Task 1 tests**

```bash
pnpm exec vitest run \
  test/electron/main/modules/chat/runtime/shared-types.test.ts \
  test/electron/main/modules/chat/runtime/factory.test.ts \
  test/ai/tools/tool-registry.test.ts \
  test/components/BChat/session-id-runtime.test.ts
```

Expected: PASS; existing active chat tool snapshots remain unchanged.

- [x] **Step 8: Commit Task 1**

```bash
git add types/chat-runtime.d.ts src/ai/chat/types.ts electron/main/modules/chat/runtime/types.mts electron/main/modules/chat/runtime/runners/factory.mts src/components/BChat/hooks/useChatRuntimeLauncher.ts shared/ai/tools/types.ts shared/ai/tools/DelegateTaskTool/index.ts shared/ai/tools/index.ts src/ai/tools/catalog/runtimeTools.ts test/electron/main/modules/chat/runtime/shared-types.test.ts test/electron/main/modules/chat/runtime/factory.test.ts test/ai/tools/tool-registry.test.ts test/components/BChat/session-id-runtime.test.ts
git commit -m "refactor(chat): 补全运行时地址与工具执行元数据"
```

---

### Task 2: Persist Immutable Tasks, Checkpoints, Events, and Outbox

**Files:**

- Create: `types/chat-agent.d.ts`
- Modify: `electron/main/modules/database/service.mts`
- Create: `electron/main/modules/chat/agents/contracts.mts`
- Create: `electron/main/modules/chat/agents/state.mts`
- Create: `electron/main/modules/chat/agents/store.mts`
- Create: `electron/main/modules/chat/agents/types.mts`
- Create: `test/electron/main/modules/database/agent-task-migration.test.ts`
- Create: `test/electron/main/modules/chat/agents/contracts.test.ts`
- Create: `test/electron/main/modules/chat/agents/state.test.ts`
- Create: `test/electron/main/modules/chat/agents/store.test.ts`
- Modify: `package.json`

**Interfaces:**

- Produces: typed `DelegateTaskInput`, `ChatAgentResult`, immutable snapshot records, Event schema, and stable machine error fields.
- Produces: synchronous `AgentDelegationStore` over the existing better-sqlite3 transaction domain.
- Consumes later: a synchronous `persistAssistant(): void` callback so message tail and delegation facts commit together.

- [x] **Step 1: Add failing contract validation tests**

Create `test/electron/main/modules/chat/agents/contracts.test.ts`:

```typescript
it('normalizes a bounded read contract without widening requested resources', (): void => {
  const result = validateFoundationContract({
    task: 'Inspect one runtime file',
    acceptanceCriteria: ['Report the lock owner'],
    mode: 'read',
    resources: [{ kind: 'file', reference: 'electron/main/modules/chat/runtime/service.mts' }],
    requestedTools: ['read_file'],
    required: true,
    priority: 'normal'
  });

  expect(result.ok).toBe(true);
  if (result.ok) expect(Object.isFrozen(result.contract)).toBe(true);
});

it.each([
  ['write mode', { mode: 'write' }],
  ['empty criteria', { acceptanceCriteria: [] }],
  ['empty resources', { resources: [] }],
  ['delegate recursion', { requestedTools: ['delegate_task'] }]
])('rejects %s in the foundation phase', (_name, patch): void => {
  expect(validateFoundationContract({ ...validContract, ...patch })).toMatchObject({
    ok: false,
    error: { phase: 'contract_validation', retryable: false }
  });
});
```

Also test invalid deadlines, unknown keys, duplicate requested tools, and structured-clone serialization.

- [x] **Step 2: Add failing legal-transition tests**

Create `test/electron/main/modules/chat/agents/state.test.ts`. Cover every legal transition in the design and representative illegal shortcuts:

```typescript
expect(canTransitionTask('created', 'planning')).toBe(true);
expect(canTransitionTask('planning', 'authorized')).toBe(true);
expect(canTransitionTask('queued', 'starting', { queuePhase: 'start' })).toBe(true);
expect(canTransitionTask('queued', 'committing', { queuePhase: 'commit' })).toBe(true);
expect(canTransitionTask('created', 'completed')).toBe(false);
expect(canTransitionTask('authorized', 'running')).toBe(false);
expect(canTransitionTask('completed', 'running')).toBe(false);

expect(canTransitionCheckpoint('waiting_children', 'cancelling')).toBe(true);
expect(canTransitionCheckpoint('cancelling', 'cancelled')).toBe(true);
expect(canTransitionCheckpoint('cancelled', 'resuming')).toBe(false);
```

Assert `planning → authorized` requires a complete immutable Execution Plan Snapshot, `recordTaskResult` accepts only `running` or stable cancellation/commit terminalization paths, and all Task/Checkpoint terminal states have no outgoing transitions.

- [x] **Step 3: Add failing migration and immutable-store tests**

Create `test/electron/main/modules/database/agent-task-migration.test.ts`. Initialize a legacy database and assert the five additive tables and indexes exist without changing existing chat rows:

```typescript
expect(tableNames).toEqual(
  expect.arrayContaining(['chat_agent_tasks', 'chat_agent_attempts', 'chat_agent_delegation_checkpoints', 'chat_agent_events', 'chat_agent_outbox'])
);
```

Create `test/electron/main/modules/chat/agents/store.test.ts` with an injected in-memory database. Verify:

```typescript
store.prepareDelegation(preparedInput, persistAssistant);

expect(persistAssistant).toHaveBeenCalledTimes(1);
expect(store.getTask('task-1')?.contractSnapshot).toEqual(preparedInput.tasks[0].contractSnapshot);
expect(store.getCheckpoint('checkpoint-1')).toMatchObject({
  status: 'waiting_children',
  version: 1,
  recordState: 'active'
});
expect(store.listEvents('checkpoint', 'checkpoint-1').map((event) => event.sequence)).toEqual([1, 2]);
expect(store.listPendingOutbox()).toHaveLength(1);
```

Attempt a second insert with the same `taskId` but different `contractSnapshotHash` and expect `protocol_error`. Test rollback by throwing in `persistAssistant`; no Task, Checkpoint, Event, or Outbox row may remain.

Move a Task through `created → planning → authorized → queued(start) → starting → running`, supplying its Execution Plan Snapshot exactly once at authorization. Assert later attempts to update the snapshot or plan hash fail with `protocol_error`.

Tombstone tests must prove:

- active Tasks, Tasks with a live Attempt, Tasks referenced by a nonterminal Checkpoint, and Tasks owning an unfinished journal cannot be tombstoned.
- an eligible terminal Task changes only `recordState: active → tombstoned`, preserves snapshots/result/events, and appends `task.tombstoned`.
- no Store method physically deletes a Task.

- [x] **Step 4: Run Task 2 tests and verify RED**

```bash
pnpm exec vitest run \
  test/electron/main/modules/chat/agents/contracts.test.ts \
  test/electron/main/modules/chat/agents/state.test.ts \
  test/electron/main/modules/chat/agents/store.test.ts
pnpm run test:database
```

Expected: FAIL because Agent contracts, legal transition guards, tables, Store, and the second database migration test are absent.

- [x] **Step 5: Define shared immutable contracts**

Add `types/chat-agent.d.ts` with documented types. Keep execution status separate from completion:

```typescript
/** Explicit resource reference included in an immutable task contract. */
export interface AgentResourceReference {
  /** Resource domain understood by a registered scope resolver. */
  kind: 'file' | 'directory' | 'document' | 'webview' | 'resource';
  /** Stable repository-relative path or domain identifier. */
  reference: string;
  /** Optional caller-observed revision used for later validation. */
  revision?: string;
}

/** Structured terminal result consumed by Primary Runtime B. */
export interface ChatAgentResult {
  taskId: string;
  agentId: string;
  attemptId: string;
  executionStatus: 'completed' | 'failed' | 'cancelled' | 'deadline_exceeded' | 'commit_failed';
  completion: {
    level: 'full' | 'partial' | 'none';
    criteria: AgentCriteriaResult[];
  };
  summary: string;
  output?: unknown;
  warnings: AgentTaskWarning[];
  artifacts: AgentArtifactReference[];
  changeset?: AgentChangesetResult;
  usage: AgentUsageAccounting;
  error?: AgentTaskError;
}
```

Include evidence claim/verification, artifact ownership/visibility, cost accounting with `pricingVersion`, and error `code/phase/category/retryable/details`. `message` remains display-only. Define immutable `AgentTaskContractSnapshot` and `AgentDelegationContinuationSnapshot`; reserve `planSchemaVersion`, `policyVersion`, `planHash`, and `capabilitySet` fields even though execution-plan compilation starts in the next plan.

Define the Event envelope explicitly:

```typescript
/** Append-only, schema-versioned history record for one aggregate. */
export interface ChatAgentEvent<TType extends ChatAgentEventType> {
  eventId: string;
  aggregate: { kind: 'task' | 'checkpoint'; id: string };
  taskId?: string;
  checkpointId?: string;
  sequence: number;
  attemptId?: string;
  runtimeId?: string;
  type: TType;
  occurredAt: string;
  source: 'primary' | 'coordinator' | 'child' | 'runtime' | 'user' | 'system';
  schemaVersion: number;
  payload: ChatAgentEventPayloadMap[TType];
}
```

Each payload is a discriminated, structured-clone-safe allowlist. Task Events require `taskId`, Checkpoint Events require `checkpointId`, and cross-aggregate links contain stable IDs only.

- [x] **Step 6: Add additive SQLite schema**

In `electron/main/modules/database/service.mts`, create:

```sql
CREATE TABLE IF NOT EXISTS chat_agent_tasks (
  task_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  parent_agent_id TEXT NOT NULL,
  root_runtime_id TEXT NOT NULL,
  checkpoint_id TEXT NOT NULL,
  tool_call_id TEXT NOT NULL,
  contract_snapshot_json TEXT NOT NULL,
  contract_snapshot_hash TEXT NOT NULL,
  execution_plan_snapshot_json TEXT,
  execution_plan_snapshot_hash TEXT,
  status TEXT NOT NULL,
  priority TEXT NOT NULL,
  deadline_at TEXT,
  current_attempt_id TEXT,
  result_json TEXT,
  result_hash TEXT,
  error_json TEXT,
  record_state TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Add `chat_agent_attempts`, `chat_agent_delegation_checkpoints`, `chat_agent_events`, and `chat_agent_outbox` with the immutable/mutable split from the design spec. Required constraints include:

- unique `(checkpoint_id, tool_call_id)` on Tasks.
- unique `(aggregate_kind, aggregate_id, sequence)` on Events.
- unique `event_id` and Outbox `dedupe_key`.
- Checkpoint `status`, `version`, `terminal_results_json`, `resume_runtime_id`, `record_state`.
- Outbox immutable `payload_json/payload_hash/schema_version`, plus mutable `delivery_status/attempt_count/delivered_at`.
- no update path for identity, contract snapshot, continuation snapshot, or their hashes.

Update `DatabaseTableName` and `package.json` so `pnpm run test:database` runs both database migration test files under Electron's Node ABI.

- [x] **Step 7: Implement canonical validation and hashes**

In `contracts.mts`, parse unknown input field-by-field, trim human text, reject unknown keys and recursion, sort only set-like fields, preserve acceptance-criteria and resource order, then deep-freeze the normalized clone. Hash a versioned canonical JSON envelope:

```typescript
const hashInput = {
  schemaVersion: AGENT_CONTRACT_SCHEMA_VERSION,
  contract: normalizedContract
};
```

Do not include mutable status, timestamps, result, available capability, or display messages in snapshot hashes.

- [x] **Step 8: Implement explicit state guards**

In `state.mts`, encode legal transitions as exhaustive typed maps rather than scattered conditionals. The full Task transition set is:

```text
created → planning
planning → authorized | failed
authorized → queued(start)
queued(start) → starting
starting → running | failed
running(read) → completed | failed
running(write) → waiting_confirmation | queued(commit) | completed | failed
waiting_confirmation → queued(commit) | queued(start) | failed
queued(commit) → committing | queued(start)
committing → completed | cancelled | commit_failed
任意非终态且非 committing → cancelling
cancelling → cancelled | failed
任意非 committing 状态 → deadline_exceeded
```

`queued` transitions require an explicit `queuePhase`. Store mutations call these guards inside the same transaction as status projection and Event append. `planning → authorized` atomically writes the Execution Plan Snapshot and hash for the first and only time. A later Attempt may reference that plan hash but cannot replace the snapshot.

- [x] **Step 9: Implement the transactional Store**

Expose:

```typescript
/** Persistence boundary for delegation facts and compare-and-swap transitions. */
export interface AgentDelegationStore {
  prepareDelegation(input: PrepareDelegationInput, persistAssistant: () => void): void;
  transitionTask(input: TransitionAgentTaskInput): AgentTaskRecord;
  recordTaskResult(input: RecordTaskResultInput): AgentCheckpointRecord;
  claimResume(input: ClaimCheckpointInput): AgentCheckpointRecord | null;
  finalizeResume(input: FinalizeCheckpointInput): AgentCheckpointRecord;
  cancelCheckpoint(input: CancelCheckpointInput): AgentCheckpointRecord;
  tombstoneTask(input: TombstoneAgentTaskInput): AgentTaskRecord;
  listPendingOutbox(): AgentOutboxRecord[];
  markOutboxDelivered(input: DeliverAgentOutboxInput): AgentOutboxRecord;
  interruptActive(reason: AgentTaskError): number;
  listActive(): AgentDelegationRecoverySnapshot[];
}
```

`prepareDelegation` uses the existing exported database `transaction` and performs this exact order inside one transaction:

1. Insert immutable Task rows in original tool-call order.
2. Insert Checkpoint as `preparing`.
3. Append `delegation.checkpoint_created` Event sequence 1.
4. Invoke `persistAssistant`.
5. Transition `preparing → waiting_children`, version `0 → 1`.
6. Append `primary.suspended` Event sequence 2.
7. Insert immutable `delegation.created` Outbox row.

Any error rolls back all seven operations. Store methods parse persisted JSON using validators and return `protocol_error` instead of unsafe type assertions.

- [x] **Step 10: Re-run Task 2 tests**

```bash
pnpm exec vitest run \
  test/electron/main/modules/chat/agents/contracts.test.ts \
  test/electron/main/modules/chat/agents/state.test.ts \
  test/electron/main/modules/chat/agents/store.test.ts
pnpm run test:database
```

Expected: PASS, including transaction rollback and immutable snapshot mismatch cases.

- [x] **Step 11: Commit Task 2**

```bash
git add types/chat-agent.d.ts electron/main/modules/database/service.mts electron/main/modules/chat/agents/contracts.mts electron/main/modules/chat/agents/state.mts electron/main/modules/chat/agents/store.mts electron/main/modules/chat/agents/types.mts test/electron/main/modules/database/agent-task-migration.test.ts test/electron/main/modules/chat/agents/contracts.test.ts test/electron/main/modules/chat/agents/state.test.ts test/electron/main/modules/chat/agents/store.test.ts package.json
git commit -m "feat(chat): 增加委派任务持久化模型"
```

---

### Task 3: Detect Deferred Calls Without Exposing Partial Tool State

**Files:**

- Create: `electron/main/modules/chat/runtime/stream/deferred-tools.mts`
- Modify: `electron/main/modules/chat/runtime/stream/types.mts`
- Modify: `electron/main/modules/chat/runtime/types.mts`
- Modify: `electron/main/modules/chat/runtime/stream/message-parts.mts`
- Modify: `electron/main/modules/chat/runtime/stream/index.mts`
- Modify: `electron/main/modules/chat/runtime/service.mts`
- Create: `test/electron/main/modules/chat/runtime/stream/deferred-tools.test.ts`
- Modify: `test/electron/main/modules/chat/runtime/stream/executor.test.ts`
- Modify: `test/electron/main/modules/chat/runtime/service.test.ts`

**Interfaces:**

- Produces: `ChatRuntimeDelegationSuspension` from a stream round.
- Produces: filtered assistant snapshots that exclude uncommitted deferred parts.
- Consumes: registry `executionClass`, not a hard-coded renderer timeout exception.

- [x] **Step 1: Add failing deferred-part visibility tests**

Create `test/electron/main/modules/chat/runtime/stream/deferred-tools.test.ts`:

```typescript
it('keeps deferred input private until the delegation transaction commits', (): void => {
  const working = assistantWithParts([textPart('analysis'), toolPart('call-1', 'delegate_task', 'input-available')]);

  expect(createPersistableAssistant(working, new Set(['call-1'])).parts).toEqual([textPart('analysis')]);
  expect(working.parts).toHaveLength(2);
});
```

Add tests for input streaming, provider metadata preservation in the working clone, immutable cloning, and multiple deferred IDs.

- [x] **Step 2: Add failing stream control tests**

In `stream/executor.test.ts`, emit a `delegate_task` call and assert:

```typescript
expect(result).toMatchObject({
  shouldContinue: false,
  suspension: {
    toolCalls: [{ toolCallId: 'call-1', toolName: 'delegate_task' }]
  }
});
expect(executeRendererTool).not.toHaveBeenCalled();
expect(executeMainTool).not.toHaveBeenCalled();
```

Add deterministic mixed-step cases:

- A single model step may contain one or more `delegate_task` calls.
- Every tool call in that step must be `deferred-coordination`.
- A direct call before or after a deferred call makes the whole delegation set invalid with `protocol_error`; no deferred Task is persisted.
- No tool call after the first deferred call executes.

- [x] **Step 3: Add a failing service atomicity test**

In `service.test.ts`, inject a delegation `prepare` failure and assert the persisted assistant does not contain the deferred tool part. Then let `prepare` succeed and assert the full part, Tasks, Checkpoint, and outbox become visible together.

- [x] **Step 4: Run Task 3 tests and verify RED**

```bash
pnpm exec vitest run \
  test/electron/main/modules/chat/runtime/stream/deferred-tools.test.ts \
  test/electron/main/modules/chat/runtime/stream/executor.test.ts \
  test/electron/main/modules/chat/runtime/service.test.ts
```

Expected: FAIL because stream rounds cannot return a suspension and currently persist/execute tool parts immediately.

- [x] **Step 5: Add deferred stream result types**

Add:

```typescript
/** One deferred tool call captured at the Provider boundary. */
export interface ChatRuntimeDeferredToolCall {
  toolCallId: string;
  toolName: 'delegate_task';
  input: unknown;
  argumentsHash: string;
  providerMetadataHash?: string;
}

/** Control result that ends Runtime A without producing a model-visible tool result. */
export interface ChatRuntimeDelegationSuspension {
  toolCalls: readonly ChatRuntimeDeferredToolCall[];
}
```

Extend `ChatRuntimeStreamExecutorResult` with optional `suspension`. This is internal control data and never becomes `output` for the model.

- [x] **Step 6: Buffer and filter deferred parts**

At `tool-input-start`, resolve the registry entry. Track `deferredToolCallIds` for `deferred-coordination`; continue mutating the in-memory assistant so the final atomic callback has exact input/provider metadata, but call `updateAssistant` with:

```typescript
const persistedMessage = createPersistableAssistant(assistantMessage, deferredToolCallIds);
```

The helper must use `structuredClone`, remove only matching tool-call parts, and never mutate the working message.

At `tool-call`, parse the full contract through `validateFoundationContract`, collect the suspension, and skip main/renderer execution. At the end of the round, do not rewrite deferred parts into unknown tool failures.

- [x] **Step 7: Enforce the mixed-step policy before side effects**

Before dispatching any tool call in a step, inspect all completed calls once their definitions are available. If direct and deferred execution classes coexist:

- Do not create Tasks or a Checkpoint.
- Do not dispatch any call positioned at or after the first deferred call.
- Return stable `protocol_error` for deferred parts and let normal Runtime completion expose the error.
- Cover Provider chunk orders in which tool definitions arrive incrementally.

This conservative rule prevents a model step from committing unrelated effects before its delegation boundary. A later plan may support an explicit ordered multi-boundary protocol; this phase does not infer one.

- [x] **Step 8: Re-run Task 3 tests**

```bash
pnpm exec vitest run \
  test/electron/main/modules/chat/runtime/stream/deferred-tools.test.ts \
  test/electron/main/modules/chat/runtime/stream/executor.test.ts \
  test/electron/main/modules/chat/runtime/service.test.ts
```

Expected: PASS; ordinary direct main/renderer tools retain existing behavior.

- [x] **Step 9: Commit Task 3**

```bash
git add electron/main/modules/chat/runtime/stream/deferred-tools.mts electron/main/modules/chat/runtime/stream/types.mts electron/main/modules/chat/runtime/types.mts electron/main/modules/chat/runtime/stream/message-parts.mts electron/main/modules/chat/runtime/stream/index.mts electron/main/modules/chat/runtime/service.mts test/electron/main/modules/chat/runtime/stream/deferred-tools.test.ts test/electron/main/modules/chat/runtime/stream/executor.test.ts test/electron/main/modules/chat/runtime/service.test.ts
git commit -m "feat(chat): 增加延迟委派流边界"
```

---

### Task 4: Suspend Runtime A and Hold a Logical Turn Fence

**Files:**

- Create: `electron/main/modules/chat/agents/service.mts`
- Modify: `electron/main/modules/chat/agents/store.mts`
- Modify: `electron/main/modules/chat/agents/types.mts`
- Modify: `electron/main/modules/chat/ipc.mts`
- Modify: `electron/main/modules/chat/service.mts`
- Modify: `electron/main/modules/chat/runtime/infrastructure/locks.mts`
- Modify: `electron/main/modules/chat/runtime/service.mts`
- Modify: `electron/main/modules/chat/runtime/stream/index.mts`
- Modify: `electron/main/modules/chat/runtime/ipc.mts`
- Modify: `electron/main/index.mts`
- Modify: `electron/main/modules/index.mts`
- Modify: `types/chat-runtime.d.ts`
- Create: `test/electron/main/modules/chat/agents/service.test.ts`
- Modify: `test/electron/main/modules/chat/agents/store.test.ts`
- Modify: `test/electron/main/modules/chat/runtime/locks.test.ts`
- Modify: `test/electron/main/modules/chat/runtime/service.test.ts`
- Modify: `test/electron/main/modules/chat/runtime/ipc.test.ts`

**Interfaces:**

- Produces: `ChatAgentDelegationService.prepareDelegation`.
- Produces: `ChatRuntimeCompletionReason = 'completed' | 'awaiting_user_input' | 'waiting_children'`.
- Produces: resource-scoped lock registry API for a Session history continuation fence.
- Preserves: Runtime A cleanup and writing-lock release.

- [x] **Step 1: Add failing continuation-fence tests**

In `locks.test.ts`:

```typescript
const fence = locks.acquireContinuationFence({
  scope: 'session:session-1/history',
  checkpointId: 'checkpoint-1'
});

expect(locks.acquireWritingLock('session-1')).toBeNull();
expect(locks.acquireWritingLock('session-2')).not.toBeNull();
expect(locks.acquireContinuationWritingLock('session-1', 'checkpoint-1')).not.toBeNull();

fence.release();
expect(locks.acquireWritingLock('session-1')).not.toBeNull();
```

Also assert compact, rollback, branch/history mutation guards reject the fenced Session with a stable `TURN_WAITING_CHILDREN` code.

- [x] **Step 2: Add failing suspend-order tests**

In `service.test.ts`, capture call order:

```typescript
expect(prepareDelegation.mock.invocationCallOrder[0]).toBeLessThan(completeEvent.mock.invocationCallOrder[0]);
expect(completeEvent).toHaveBeenCalledWith('complete', expect.objectContaining({ reason: 'waiting_children' }));
expect(releaseWritingLock).toHaveBeenCalledAfter(prepareDelegation);
```

Inject a Store failure and assert Runtime A does not emit `waiting_children`, the fence is not acquired, and its assistant does not expose the deferred part.

- [x] **Step 3: Run Task 4 tests and verify RED**

```bash
pnpm exec vitest run \
  test/electron/main/modules/chat/agents/service.test.ts \
  test/electron/main/modules/chat/runtime/locks.test.ts \
  test/electron/main/modules/chat/runtime/service.test.ts \
  test/electron/main/modules/chat/runtime/ipc.test.ts
```

Expected: FAIL because the service, completion reason, and continuation fence do not exist.

- [x] **Step 4: Implement resource-scoped continuation fences**

Extend the lock registry with a normalized `session:<sessionId>/history` scope and owner `checkpointId`. A normal write acquisition fails while an active fence exists. A continuation acquisition and internal history mutation succeed only when the supplied `checkpointId` equals the fence owner; Renderer IPC never accepts or forwards this owner.

Use a two-phase reservation before persistence. An inactive reservation wins the resource-scope race without blocking history; Store failure releases it, while Store success synchronously promotes the same token to an active fence. Keep the ordinary Session writing lock short-lived and separate. Runtime A never retains it while waiting for Child results.

- [x] **Step 5: Implement the delegation service preparation boundary**

`ChatAgentDelegationService.prepareDelegation` must:

1. Verify caller address is `agentId === 'primary'` and has no `parentAgentId`.
2. Validate every contract and assign stable `taskId`, `agentId`, and one `checkpointId`.
3. Build the immutable continuation snapshot with schema/policy version, model snapshot, exact source message revision, context/tool-schema hashes, ordered tool-call references, reserved resume budget, and Turn deadline.
4. Store only an in-memory, allowlisted `ContinuationRuntimeContext` keyed by checkpoint. Do not persist credentials or full runtime configuration.
5. Reserve the logical fence before Store mutation; an active or reserved scope conflict must fail before creating persistent facts.
6. Call `store.prepareDelegation` with `chatSessionManager.updateMessage` as the synchronous message callback; release the inactive reservation if the transaction fails.
7. Promote the reservation to an active fence after commit, then publish the persisted Outbox event to the app event emitter.

Reservation promotion is a synchronous token transfer without a second acquisition race, so a committed checkpoint cannot be left without its fence. Keep targeted `interruptCheckpoint` recovery for other committed-checkpoint repair paths, not normal prepare compensation.

- [x] **Step 6: End Runtime A with waiting_children**

When a stream round returns `suspension`:

```typescript
const checkpoint = delegationService.prepareDelegation({
  runtime,
  assistantMessage,
  suspension,
  continuationContext
});
await completeRuntime(runtime.runtimeId, 'waiting_children', checkpoint.checkpointId);
```

`completeRuntime` still removes the active Runtime, aborts or rejects pending bridge/renderer requests, and releases the Session writing lock. It must not finalize the assistant message as completed and must not release the continuation fence.

Expose `waiting_children` in main/preload event types but do not start Runtime B in this task.

- [x] **Step 7: Add startup interruption recovery**

After database initialization and before normal IPC traffic, call:

```typescript
delegationService.interruptUnrecoverableCheckpoints();
```

This moves recoverable persisted `waiting_children`, `ready_to_resume`, and `resuming` checkpoints from a prior main process to terminal `interrupted`, appends Events, and leaves results auditable. After interruption, read `listActive()` again: journal-blocked survivors must retain or rebuild their resource-scope fence without restoring volatile continuation context. A survivor fence conflict aborts startup before IPC registration. Recovery never recreates Runtime B.

- [x] **Step 8: Re-run Task 4 tests**

```bash
pnpm exec vitest run \
  test/electron/main/modules/chat/agents/service.test.ts \
  test/electron/main/modules/chat/runtime/locks.test.ts \
  test/electron/main/modules/chat/runtime/service.test.ts \
  test/electron/main/modules/chat/runtime/ipc.test.ts
```

Expected: PASS; Runtime A disappears from active runtimes, its write lock is free, and its logical fence remains.

- [ ] **Step 9: Commit Task 4**

```bash
git add electron/main/modules/chat/agents/service.mts electron/main/modules/chat/runtime/infrastructure/locks.mts electron/main/modules/chat/runtime/service.mts electron/main/modules/chat/runtime/ipc.mts electron/main/modules/index.mts types/chat-runtime.d.ts test/electron/main/modules/chat/agents/service.test.ts test/electron/main/modules/chat/runtime/locks.test.ts test/electron/main/modules/chat/runtime/service.test.ts test/electron/main/modules/chat/runtime/ipc.test.ts
git commit -m "feat(chat): 支持 Primary 挂起与续接栅栏"
```

---

### Task 5: Record Terminal Results and Resume Primary Exactly Once

**Files:**

- Modify: `electron/main/modules/chat/agents/store.mts`
- Modify: `electron/main/modules/chat/agents/service.mts`
- Create: `electron/main/modules/chat/agents/result.mts`
- Modify: `electron/main/modules/chat/runtime/messages/continuation.mts`
- Modify: `electron/main/modules/chat/runtime/service.mts`
- Modify: `electron/main/modules/chat/runtime/runners/factory.mts`
- Modify: `types/chat-agent.d.ts`
- Create: `test/electron/main/modules/chat/agents/result.test.ts`
- Modify: `test/electron/main/modules/chat/agents/store.test.ts`
- Modify: `test/electron/main/modules/chat/agents/service.test.ts`
- Modify: `test/electron/main/modules/chat/runtime/service.test.ts`

**Interfaces:**

- Produces: internal `recordTaskResult`, `claimPrimaryResume`, and `resumePrimary`.
- Produces: normalized result injection by original `toolCallId`.
- Guarantees: one Checkpoint creates at most one Runtime B.

- [ ] **Step 1: Add failing result validation tests**

Create `result.test.ts` and assert:

```typescript
expect(validateAgentResult(validResult)).toMatchObject({
  ok: true,
  result: {
    executionStatus: 'completed',
    completion: { level: 'partial' }
  }
});
```

Reject:

- `completion.level = full` with a required criterion unverified.
- artifact owner that does not match Task/Agent/Attempt.
- user-visible internal journal artifacts.
- `completed` write result without a finalized changeset reference.
- unsupported error phase or machine logic that depends on `error.message`.
- non-finite/negative usage and fake zero currency cost when pricing is unknown.

- [ ] **Step 2: Add failing result identity and rendezvous tests**

In `store.test.ts`:

```typescript
advanceTaskToRunning(store, 'task-1', createFrozenReadPlan());

const first = store.recordTaskResult({
  taskId: 'task-1',
  toolCallId: 'call-1',
  result: validResult,
  resultHash
});
const duplicate = store.recordTaskResult({
  taskId: 'task-1',
  toolCallId: 'call-1',
  result: structuredClone(validResult),
  resultHash
});

expect(duplicate).toEqual(first);
expect(() => store.recordTaskResult({ taskId: 'task-1', toolCallId: 'call-1', result: changedResult, resultHash: 'different' })).toThrowError(/protocol_error/);
```

For two tool calls completed in reverse order, assert `ready_to_resume` occurs only after both are terminal and persisted order remains `call-1`, `call-2`.

- [ ] **Step 3: Add failing single-resume tests**

Race two `claimPrimaryResume` calls with the same Checkpoint version:

```typescript
expect([claimA, claimB].filter(Boolean)).toHaveLength(1);
expect(store.getCheckpoint('checkpoint-1')).toMatchObject({
  status: 'resuming',
  resumeRuntimeId: expect.any(String)
});
```

Assert Runtime B:

- shares `sessionId`, `turnId`, `agentId`, and `rootRuntimeId`.
- has a new `runtimeId`.
- sets `continuationOfRuntimeId` to Runtime A.
- injects results into original tool parts by `toolCallId` order.
- uses the frozen model snapshot and `forceFinal`.
- has an empty active tool set in this foundation phase.

- [ ] **Step 4: Run Task 5 tests and verify RED**

```bash
pnpm exec vitest run \
  test/electron/main/modules/chat/agents/result.test.ts \
  test/electron/main/modules/chat/agents/store.test.ts \
  test/electron/main/modules/chat/agents/service.test.ts \
  test/electron/main/modules/chat/runtime/service.test.ts
```

Expected: FAIL because result validation, terminal-result identity, CAS claim, and Runtime B continuation do not exist.

- [ ] **Step 5: Implement terminal result validation**

Validate claims separately from verification. Compute effective completion from criteria:

```typescript
function deriveCompletion(criteria: readonly AgentCriteriaResult[]): AgentCompletionLevel {
  const effective = criteria.filter((criterion) => criterion.claim.status === 'satisfied' && criterion.verification.status === 'verified');
  if (effective.length === criteria.length) return 'full';
  if (effective.length > 0) return 'partial';
  return 'none';
}
```

The main process overwrites an inconsistent Child-supplied level with the derived level and records a warning; contradicted evidence cannot count as completion.

- [ ] **Step 6: Implement idempotent result recording**

`recordTaskResult` runs in one transaction:

1. Resolve `(taskId, checkpointId, toolCallId)` and reject mismatched identity.
2. Require the Task to be in `running`, `cancelling`, or `committing` according to the submitted terminal result; `created → completed` is always a protocol error.
3. Validate and canonical-hash the result.
4. If absent, perform the legal terminal Task transition, persist result, and append `child.result_recorded`.
5. If present with the same hash, return the existing projection.
6. If present with another hash, append `protocol_error` and reject.
7. When every ordered tool call has a terminal result, CAS `waiting_children → ready_to_resume`, increment version, append `delegation.ready`, and enqueue a deduplicated `delegation.ready` Outbox event.

- [ ] **Step 7: Implement CAS resume and exact tool-result injection**

`claimPrimaryResume` accepts only `checkpointId`, `expectedVersion`, and a freshly allocated `resumeRuntimeId`. The Store update predicate includes status and version:

```sql
UPDATE chat_agent_delegation_checkpoints
SET status = 'resuming', version = version + 1, resume_runtime_id = ?, updated_at = ?
WHERE checkpoint_id = ? AND status = 'ready_to_resume' AND version = ?;
```

After a successful claim, read the immutable continuation snapshot and in-memory context, verify source revision/context/tool-schema/model hashes, then rebuild the assistant tool parts. Serialize each `ChatAgentResult` as a structured tool result in original call order.

Start Runtime B using the fence-owner acquisition, frozen model, `forceFinal: true`, and no tools. On completion, transition `resuming → completed`, append `delegation.completed`, release the fence, and remove volatile continuation context. On validation/start failure, transition to `failed` or `interrupted`, persist the stable error, and release the fence only after the assistant is safely terminal.

- [ ] **Step 8: Re-run Task 5 tests**

```bash
pnpm exec vitest run \
  test/electron/main/modules/chat/agents/result.test.ts \
  test/electron/main/modules/chat/agents/store.test.ts \
  test/electron/main/modules/chat/agents/service.test.ts \
  test/electron/main/modules/chat/runtime/service.test.ts
```

Expected: PASS; reverse completion order still produces one Runtime B with original tool-call order.

- [ ] **Step 9: Commit Task 5**

```bash
git add electron/main/modules/chat/agents/store.mts electron/main/modules/chat/agents/service.mts electron/main/modules/chat/agents/result.mts electron/main/modules/chat/runtime/messages/continuation.mts electron/main/modules/chat/runtime/service.mts electron/main/modules/chat/runtime/runners/factory.mts types/chat-agent.d.ts test/electron/main/modules/chat/agents/result.test.ts test/electron/main/modules/chat/agents/store.test.ts test/electron/main/modules/chat/agents/service.test.ts test/electron/main/modules/chat/runtime/service.test.ts
git commit -m "feat(chat): 增加委派结果汇合与单次续接"
```

---

### Task 6: Project waiting_children Through IPC and the Actor System

**Files:**

- Create: `electron/main/modules/chat/agents/ipc.mts`
- Modify: `electron/main/modules/index.mts`
- Modify: `electron/preload/index.mts`
- Modify: `types/electron-api.d.ts`
- Modify: `types/chat-agent.d.ts`
- Modify: `src/ai/chat/machine/agentMachine.ts`
- Modify: `src/ai/chat/machine/turnMachine.ts`
- Modify: `src/ai/chat/machine/sessionMachine.ts`
- Modify: `src/ai/chat/machine/supervisorMachine.ts`
- Modify: `src/ai/chat/machine/selectors.ts`
- Modify: `src/ai/chat/actorSystem.ts`
- Modify: `src/hooks/useChat/useRuntimeEvents.ts`
- Create: `src/hooks/useChat/useAgentDelegationEvents.ts`
- Modify: `src/hooks/useChat/useActorSystem.ts`
- Create: `test/electron/main/modules/chat/agents/ipc.test.ts`
- Modify: `test/ai/chat/agent-machine.test.ts`
- Modify: `test/ai/chat/turn-machine.test.ts`
- Modify: `test/ai/chat/session-machine.test.ts`
- Modify: `test/ai/chat/supervisor-machine.test.ts`
- Create: `test/hooks/use-agent-delegation-events.test.ts`
- Modify: `test/hooks/use-runtime-events.test.ts`
- Modify: `test/hooks/use-runtime-recovery.test.ts`

**Interfaces:**

- Produces: application-level delegation snapshots/events and explicit resume/cancel IPC.
- Produces: `waitingChildren` Actor states distinct from `waitingForUser`.
- Preserves: BChat unmount independence because listeners live under `useActorSystem`.

- [ ] **Step 1: Add failing Actor transition tests**

For Primary Agent:

```typescript
actor.send({ type: 'runtime.suspended', runtimeId: 'runtime-a', checkpointId: 'checkpoint-1' });
expect(actor.getSnapshot().matches('waitingChildren')).toBe(true);
expect(actor.getSnapshot().hasTag('abortable')).toBe(true);
```

For Turn and Session, assert `waitingChildren`:

- does not have `acceptsInput`.
- remains abortable.
- returns to running only for a matching Checkpoint resume event.
- ignores late completion from Runtime A.
- reaches cancelled after a persisted cancel completion event.

- [ ] **Step 2: Add failing IPC and Renderer reload tests**

Expose only:

```typescript
interface ChatAgentAPI {
  listActive(): Promise<ChatAgentRecoverySnapshot[]>;
  resumePrimary(input: ChatAgentResumePrimaryInput): Promise<ChatRuntimeStartResult>;
  cancelCheckpoint(input: ChatAgentCancelCheckpointInput): Promise<ChatAgentCheckpointSnapshot>;
  onEvent(listener: (event: ChatAgentApplicationEvent) => void): () => void;
}
```

Test that `resumePrimary` never accepts model, messages, tools, capability, or result payload from Renderer. The main process resolves all of those from the frozen Checkpoint.

In `use-agent-delegation-events.test.ts`, load a `ready_to_resume` snapshot twice and assert only one resume request survives local dedupe; main-process CAS remains the authoritative duplicate guard.

- [ ] **Step 3: Run Task 6 tests and verify RED**

```bash
pnpm exec vitest run \
  test/electron/main/modules/chat/agents/ipc.test.ts \
  test/ai/chat/agent-machine.test.ts \
  test/ai/chat/turn-machine.test.ts \
  test/ai/chat/session-machine.test.ts \
  test/ai/chat/supervisor-machine.test.ts \
  test/hooks/use-agent-delegation-events.test.ts \
  test/hooks/use-runtime-events.test.ts \
  test/hooks/use-runtime-recovery.test.ts
```

Expected: FAIL because the application-level event API and `waitingChildren` states do not exist.

- [ ] **Step 4: Add the narrow IPC/preload surface**

Register Agent IPC once from `electron/main/modules/index.mts`. Validate every input in main process. `listActive` returns allowlisted snapshots and Event cursors; it excludes secrets, volatile continuation context, full tool output, and internal artifacts.

`resumePrimary` performs main-process CAS first and returns the created Runtime address. `cancelCheckpoint` writes `cancelRequestedAt`, transitions the no-Child foundation checkpoint to `cancelled`, appends Events, prevents Runtime B, marks the Primary message interrupted, and releases the fence.

- [ ] **Step 5: Add waitingChildren to Actor state machines**

Add a `waitingChildren` state/tag to Primary, Turn, and Session. Keep Session input disabled. Do not map it to `waitingForUser`, because sending a new message would cross an unresolved tool call.

The Supervisor continues routing Runtime events by complete `ChatRuntimeAddress`; it must not assume all `agentId` values are Primary, even though real Child Actors arrive in the next plan.

- [ ] **Step 6: Route suspension, recovery, resume, and cancel**

In `useRuntimeEvents`, map `reason === 'waiting_children'` to:

1. Primary `runtime.suspended`.
2. Turn `turn.waitingChildren`.
3. Session `session.waitingChildren`.
4. Runtime A route unregister.

Do not mark the assistant or Session completed.

In `useAgentDelegationEvents`:

- Subscribe once at application Actor System scope.
- On `ready_to_resume`, allocate Runtime B ID, register its complete Primary address with empty tools, then call `resumePrimary`.
- On synchronous IPC failure, unregister the route and preserve the Checkpoint for a later idempotent retry.
- On startup, call `listActive`, rebuild waiting Actor projections, and retry only persisted `ready_to_resume` snapshots.
- Use `asyncTo` for every async IPC call.

- [ ] **Step 7: Add cooperative cancellation wait policy**

Cancelling a waiting Turn:

1. Sends `cancelCheckpoint` once.
2. Rejects new Runtime B claims.
3. Waits for persisted cancellation event rather than a renderer-local timeout result.
4. Uses the existing bounded Turn-cancel timer only as UI escape; timeout displays interrupted state and leaves main-process recovery authoritative.

The renderer must not declare success merely because it dispatched cancel.

- [ ] **Step 8: Re-run Task 6 tests**

```bash
pnpm exec vitest run \
  test/electron/main/modules/chat/agents/ipc.test.ts \
  test/ai/chat/agent-machine.test.ts \
  test/ai/chat/turn-machine.test.ts \
  test/ai/chat/session-machine.test.ts \
  test/ai/chat/supervisor-machine.test.ts \
  test/hooks/use-agent-delegation-events.test.ts \
  test/hooks/use-runtime-events.test.ts \
  test/hooks/use-runtime-recovery.test.ts
```

Expected: PASS; `waitingChildren` is recoverable, abortable, and never accepts a new user Turn.

- [ ] **Step 9: Commit Task 6**

```bash
git add electron/main/modules/chat/agents/ipc.mts electron/main/modules/index.mts electron/preload/index.mts types/electron-api.d.ts types/chat-agent.d.ts src/ai/chat/machine/agentMachine.ts src/ai/chat/machine/turnMachine.ts src/ai/chat/machine/sessionMachine.ts src/ai/chat/machine/supervisorMachine.ts src/ai/chat/machine/selectors.ts src/ai/chat/actorSystem.ts src/hooks/useChat/useRuntimeEvents.ts src/hooks/useChat/useAgentDelegationEvents.ts src/hooks/useChat/useActorSystem.ts test/electron/main/modules/chat/agents/ipc.test.ts test/ai/chat/agent-machine.test.ts test/ai/chat/turn-machine.test.ts test/ai/chat/session-machine.test.ts test/ai/chat/supervisor-machine.test.ts test/hooks/use-agent-delegation-events.test.ts test/hooks/use-runtime-events.test.ts test/hooks/use-runtime-recovery.test.ts
git commit -m "feat(chat): 投影委派等待与恢复状态"
```

---

### Task 7: Prove the Foundation End to End and Document Its Disabled Boundary

**Files:**

- Create: `test/electron/main/modules/chat/agents/delegation-foundation.test.ts`
- Modify: `test/electron/main/modules/chat/runtime/main-boundary.test.ts`
- Modify: `test/components/BChat/use-runtime-tools.test.ts`
- Modify: `docs/development/chat-multi-session-and-multi-agent-extension.md`
- Modify: `docs/ai-tools/tool-development-guide.md`
- Modify: `CONTEXT.md`
- Modify: `changelog/2026-07-23.md`

**Interfaces:**

- Verifies: one complete A → Checkpoint → synthetic result → B flow.
- Verifies: default users still cannot invoke `delegate_task`.
- Documents: extension seams for the next read-only Child plan without claiming the Child executor exists.

- [ ] **Step 1: Add the end-to-end foundation test**

Create `delegation-foundation.test.ts` with real in-memory SQLite Store and deterministic Runtime/model doubles:

```typescript
it('suspends Runtime A and resumes the same Primary exactly once', async (): Promise<void> => {
  const runtimeA = await harness.startPrimaryWithInternalDelegation();

  expect(runtimeA.completionReason).toBe('waiting_children');
  expect(harness.activeRuntimeIds()).not.toContain(runtimeA.runtimeId);
  expect(harness.canStartNewTurn('session-1')).toBe(false);

  harness.advanceTaskToRunning('task-1', createFrozenReadPlan());
  await harness.recordTaskResult(createVerifiedReadResult('task-1'));
  await Promise.all([harness.deliverReadyEvent(), harness.deliverReadyEvent()]);

  expect(harness.primaryContinuationStarts()).toHaveLength(1);
  expect(harness.primaryContinuationStarts()[0].address).toMatchObject({
    sessionId: runtimeA.sessionId,
    turnId: runtimeA.turnId,
    agentId: 'primary',
    rootRuntimeId: runtimeA.rootRuntimeId,
    continuationOfRuntimeId: runtimeA.runtimeId
  });
  expect(harness.finalAssistantToolResults()).toEqual([expect.objectContaining({ toolCallId: 'call-1', taskId: 'task-1' })]);
});
```

Add crash injection at:

- before delegation transaction.
- after Task insert but before assistant callback.
- after assistant callback but before Outbox insert.
- after committed `waiting_children` but before event delivery.
- after `ready_to_resume` but before CAS.
- after successful CAS but before Runtime B start.

The first three leave no visible deferred part or facts. Event delivery retries are idempotent. Post-CAS startup failure becomes terminal and never starts B twice.

- [ ] **Step 2: Add security and disabled-exposure assertions**

In `use-runtime-tools.test.ts`:

```typescript
expect(getEnabledChatToolNames()).not.toContain('delegate_task');
```

In `main-boundary.test.ts`, assert:

- normal renderer tool requests still use their configured timeout.
- deferred calls never create a renderer-tool request.
- Child transcript APIs do not exist.
- Renderer `resumePrimary` cannot override model or tool snapshots.
- main restart interrupts rather than silently recovering model execution.

- [ ] **Step 3: Run Task 7 tests and verify RED**

```bash
pnpm exec vitest run \
  test/electron/main/modules/chat/agents/delegation-foundation.test.ts \
  test/electron/main/modules/chat/runtime/main-boundary.test.ts \
  test/components/BChat/use-runtime-tools.test.ts
```

Expected: the end-to-end harness exposes any missing integration seam; default-exposure assertions must already pass.

- [ ] **Step 4: Close integration gaps only**

Make only the minimal wiring changes required for the RED cases. Do not add real Child execution, expose the tool, create task-card UI, or implement file write adapters in this task.

- [ ] **Step 5: Update architecture and tool-development docs**

In `docs/development/chat-multi-session-and-multi-agent-extension.md`, document:

- complete Runtime lineage.
- `deferred-coordination` lifecycle.
- transactional message/Task/Checkpoint/Outbox boundary.
- `waiting_children` and `turnContinuationFence`.
- Renderer reload versus main-process restart behavior.
- current disabled foundation boundary.

In `docs/ai-tools/tool-development-guide.md`, require every shared tool to declare `executionClass` and `AgentToolEffectMetadata`. State that only registered `deferred-coordination` tools can end a Runtime through a Checkpoint; returning a pending Promise never grants this behavior.

In `CONTEXT.md`, add the Agent delegation module and factual current state: persistence and continuation foundation exists, real Child execution remains disabled.

- [ ] **Step 6: Update the changelog**

Under `## Added` or `## Changed` in `changelog/2026-07-23.md`, add:

```markdown
- 新增默认关闭的 Child Agent 持久化委派基础，支持 Primary Runtime 跨 Checkpoint 挂起、结果幂等汇合与单次续接。
```

Do not stage unrelated changelog lines.

- [ ] **Step 7: Run targeted foundation verification**

```bash
pnpm exec vitest run \
  test/ai/tools/tool-registry.test.ts \
  test/electron/main/modules/chat/agents/contracts.test.ts \
  test/electron/main/modules/chat/agents/state.test.ts \
  test/electron/main/modules/chat/agents/store.test.ts \
  test/electron/main/modules/chat/agents/result.test.ts \
  test/electron/main/modules/chat/agents/service.test.ts \
  test/electron/main/modules/chat/agents/ipc.test.ts \
  test/electron/main/modules/chat/agents/delegation-foundation.test.ts \
  test/electron/main/modules/chat/runtime/stream/deferred-tools.test.ts \
  test/electron/main/modules/chat/runtime/stream/executor.test.ts \
  test/electron/main/modules/chat/runtime/locks.test.ts \
  test/electron/main/modules/chat/runtime/main-boundary.test.ts \
  test/hooks/use-agent-delegation-events.test.ts \
  test/hooks/use-runtime-events.test.ts \
  test/hooks/use-runtime-recovery.test.ts \
  test/components/BChat/use-runtime-tools.test.ts
pnpm run test:database
```

Expected: PASS with no retries hidden by test configuration.

- [ ] **Step 8: Run repository verification**

```bash
pnpm exec tsc --noEmit
pnpm run electron:build-main
pnpm lint
pnpm lint:style
pnpm test
git diff --check
```

Expected: all commands exit 0. If `pnpm lint` or `pnpm lint:style` modifies files, inspect every edit, rerun the affected targeted tests, then rerun both checks.

- [ ] **Step 9: Review invariants before commit**

Use `rg` and code review to prove:

```bash
rg -n "\bany\b|TODO|TBD|skipMessages|delegate_task" \
  types/chat-agent.d.ts \
  electron/main/modules/chat/agents \
  electron/main/modules/chat/runtime \
  src/ai/chat \
  src/hooks/useChat \
  shared/ai/tools
```

Review every match. The acceptable `delegate_task` matches are schema, registry, validation, stream detection, and tests. There must be no `any`, placeholder marker, `skipMessages` shortcut, active BChat exposure, persisted secrets, mutable snapshot update, or Renderer-supplied model override.

Confirm these invariants manually:

- Task is identity; Attempt is execution; Event is history; Runtime is replaceable.
- Contract and continuation snapshots never update.
- persisted capability is intersected with available capability in future execution; no recovery code expands it.
- Runtime A writing lock is released only after atomic persistence.
- logical fence remains until terminal continuation/cancel handling.
- duplicate result hashes are idempotent; conflicting hashes are protocol errors.
- Checkpoint CAS creates at most one Runtime B.
- main restart never guesses how to resume a Provider call.
- the tool is still `internal`.

- [ ] **Step 10: Commit Task 7**

```bash
git add test/electron/main/modules/chat/agents/delegation-foundation.test.ts test/electron/main/modules/chat/runtime/main-boundary.test.ts test/components/BChat/use-runtime-tools.test.ts docs/development/chat-multi-session-and-multi-agent-extension.md docs/ai-tools/tool-development-guide.md CONTEXT.md
git add -p changelog/2026-07-23.md
git commit -m "test(chat): 验证持久化委派基础闭环"
```

---

## Series Handoff

本计划完成后，下一份实施计划从持久化 `delegation.created` Event 开始，加入：

1. 按需 Coordinator 与稳定 Child Actor 注册。
2. `persisted ∩ available ∩ role/policy` 的单调 Capability Intersection。
3. Execution Plan schema/policy version 与 plan hash 冻结。
4. 只读 `ChildTaskRuntimeExecutor`，不写 `chat_messages`。
5. 最多三个相容 read Task 的 resource-scope 调度、deadline 和 budget hierarchy。
6. 真实 Child 终态结果通过本计划的 `recordTaskResult` 汇入 Primary B。
7. 通过独立 feature flag 把 `delegate_task` 从 `internal` 提升为受控会话暴露。

再下一份计划实现 staged file write、changeset、diff integrity、ConfirmationQueue、三阶段 commit journal、recovery protocol、tombstone 与轻量任务卡片。真实写入能力在该计划完整验证前保持关闭。
