# Child Agent Controlled Write Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让单层 write Child 只在 Task 私有 overlay 中生成文件 changeset，经持久化确认、资源重新校验和三阶段 commit journal 后原子写入工作区，并在崩溃、取消或 revision 漂移时安全收敛。

**Architecture:** 延续现有 Task/Attempt/Event/Runtime 分层，新增 Child 专用 `stage_file_write` 与 `stage_file_edit`，它们只修改私有 overlay，不复用会立即写盘的 `write_file`/`edit_file`。Coordinator 在模型执行阶段持有 `write-intent`，changeset 持久化后释放全部 lease；用户确认由 Main-owned Confirmation Store 持久化，批准后重新获取 `exclusive-commit`，验证 `baseRevision + diffHash + operationSetHash + planHash`，再依次完成 journal created、external mutation applied、commit finalized。轻量任务卡片不属于本计划，待受控写入协议闭环后单独实施。

**Tech Stack:** TypeScript strict mode、Electron main/preload IPC、Vue 3、Pinia、better-sqlite3、Node.js `fs/promises`、`atomically`、AI SDK stream adapter、Vitest。

## Global Constraints

- 始终继承 Primary Runtime A 冻结的 `modelSnapshot`；write Child 不能接受 Renderer 模型覆盖。
- 委派深度固定为一层；write Child 永远移除 `delegate_task`、模型切换、会话管理、shell、设置、MCP mutation、WebView mutation 和外部 HTTP mutation。
- `effectiveCapability = persistedCapability ∩ availableCapability ∩ role/policyCapability`，恢复只能单调收缩。
- read Task 继续只接受 `pure_read`；write Task 只接受 `pure_read` 与 Main 注册的 `staged_file_write`。
- `write_file` 与 `edit_file` 仍是 `immediate_side_effect`，不得进入 Child Execution Plan；Child 只能使用内部 `stage_file_write` 与 `stage_file_edit`。
- `stage_file_write` 与 `stage_file_edit` 仅支持已存在真实父目录下的工作区本地文本文件；拒绝 `unsaved://`、工作区外路径、符号链接逃逸、目录目标和二进制内容。
- 单个 changeset 最多 32 个文件操作、单文件候选最多 4 MiB、候选总量最多 16 MiB、完整可确认 diff 最多 256 KiB；超过限制以 `budget_exceeded/result_validation` 失败，不截断后继续确认。
- write Task 必须有非空、规范化的 file/directory resource scope；Provider 每次工具调用前仍需重复校验 registry、effect、plan、权限、scope 和取消信号。
- Task overlay 不是工作区；没有 finalized commit journal 时，changeset 不能形成成功结果。
- write Child 在生成 changeset 时持有 `write-intent`，进入 `waiting_confirmation` 前释放全部 lease。
- 用户批准后必须重新获取 `exclusive-commit`，并重新验证 `baseRevision`、基础内容 hash、`diffHash`、`operationSetHash`、`planHash` 和 permission scope。
- Confirmation resolve 使用 `confirmationId + expectedVersion` CAS；重复点击、迟到响应和 Renderer 重载不能重复提交。
- commit journal 顺序固定为 `created → applying → applied → finalized`；未知外部状态只能进入 `manual_recovery`，不能猜测成功。
- `committing` 阶段的取消是 cooperative request；到达不可逆提交点后先收敛 journal，再决定 `completed`、`commit_failed` 或 `cancelled`。
- Main 重启不自动重新执行 write Child；无 journal 的 overlay 丢弃，有 journal 的 Task 先恢复 journal。
- write Attempt 继续消耗原 Turn/Task budget reservation；confirmation 等待和本地 commit 不创建新额度，Primary 不能通过拆分 write Child 绕过 Turn 或 Session budget。
- `chat_agent_tasks.unfinished_journal_count > 0` 时禁止 tombstone 和物理清理。
- 第一阶段维持 Main-owned `controlledWriteChildEnabled: false`，直到 Task 8 的恢复、安全与全量验证全部通过。
- 所有新增函数、接口和复杂分支都按仓库规范添加 JSDoc，不使用 `any`。
- 所有异步错误归一化使用 `src/utils/asyncTo.ts` 或主进程现有的结构化 `Promise.allSettled` 边界。

## File Structure

### Shared contract and registry

- `shared/ai/tools/AgentStagedFileTool/index.ts`: 定义只供 Child 计划使用的两个 staged 文件工具及可信 effect metadata。
- `shared/ai/tools/index.ts`: 注册并导出 staged 工具，但保持 `exposure: 'internal'`。
- `types/chat-agent.d.ts`: 定义 changeset、confirmation、journal、write outcome 和 Renderer allowlist 投影。
- `electron/main/modules/chat/agents/contracts.mts`: 规范化并哈希新增持久化快照和 Event payload。
- `electron/main/modules/chat/agents/plan-compiler.mts`: 按 Task mode 编译 read 或 staged-write 计划。

### Main-owned write protocol

- `electron/main/modules/chat/agents/write-overlay.mts`: 管理 Attempt 私有 overlay、文本操作和 changeset 完整性。
- `electron/main/modules/chat/agents/write-tools.mts`: 为 Child Runtime 暴露 staged 工具 Schema、guard 和 overlay executor。
- `electron/main/modules/chat/agents/confirmation-store.mts`: 持久化确认请求、CAS resolve、撤销和等待者。
- `electron/main/modules/chat/agents/file-commit.mts`: 验证 commit boundary、原子替换文件和 journal 恢复。
- `electron/main/modules/chat/agents/scheduler.mts`: 从 read-only lease 扩展为 resource-scoped read/write-intent/exclusive-commit 门禁。
- `electron/main/modules/chat/agents/store.mts`: 提供 changeset、journal 和 Task 状态机的唯一事务写入口。
- `electron/main/modules/chat/agents/coordinator.mts`: 编排 overlay、确认、commit、取消和终态汇合。
- `electron/main/modules/chat/agents/executor.mts`: 让 Child model loop 返回 read 终态或 write preparation outcome。

### Renderer projection

- `electron/main/modules/chat/agents/ipc.mts`: 暴露确认快照查询与 CAS resolve，不接受 Renderer 提交 hash、计划或资源覆盖。
- `electron/preload/index.mts`: 添加精确 typed API。
- `src/stores/chat/confirmationQueue.ts`: 合并 Runtime 临时确认与 Agent 持久化确认的应用级队列投影。
- `src/hooks/useChat/useAgentConfirmationEvents.ts`: 先订阅、再拉快照并按 version/sequence 单调恢复。
- `src/components/BChat/components/ConfirmationSheet.vue`: 展示来源、scope、diff 与完整性字段。
- `src/components/BChat/index.vue`: 从应用级队列选择当前确认，不在组件卸载时撤销 Main pending request。

---

### Task 1: Register Staged File Capabilities And Compile Write Plans

**Files:**
- Create: `shared/ai/tools/AgentStagedFileTool/index.ts`
- Modify: `shared/ai/tools/index.ts`
- Modify: `shared/ai/tools/DelegateTaskTool/index.ts`
- Modify: `types/chat-agent.d.ts`
- Modify: `electron/main/modules/chat/agents/contracts.mts`
- Modify: `electron/main/modules/chat/agents/plan-compiler.mts`
- Modify: `electron/main/modules/chat/agents/service.mts`
- Test: `test/ai/tools/tool-registry.test.ts`
- Test: `test/electron/main/modules/chat/agents/contracts.test.ts`
- Test: `test/electron/main/modules/chat/agents/plan-compiler.test.ts`
- Test: `test/electron/main/modules/chat/agents/service.test.ts`

**Interfaces:**
- Consumes: `ToolRegistryEntry`、`AgentTaskContractSnapshot.mode`、现有 capability intersection 与 monotonic restore。
- Produces: `STAGE_FILE_WRITE_TOOL_NAME`、`STAGE_FILE_EDIT_TOOL_NAME`、mode-aware `compileAgentPlan()`、`authorizeTask()`；read 计划仍为 `commitPolicy.mode = 'none'`，write 计划固定为 `{ mode: 'staged', adapter: 'atomic-file-v1' }`。

- [x] **Step 1: Write failing registry and plan tests**

增加以下核心断言：

```ts
expect(getToolRegistryEntry('stage_file_write')).toMatchObject({
  runtime: 'main',
  exposure: 'internal',
  executionClass: 'direct',
  effect: {
    effect: 'staged_file_write',
    resourceScopeResolver: 'file-path',
    commitAdapter: 'atomic-file-v1',
    reversible: true
  }
});

const result = compileAgentPlan({
  ...input,
  task: createTask({
    mode: 'write',
    requestedTools: ['read_file', 'stage_file_edit']
  })
});

expect(result).toMatchObject({
  ok: true,
  plan: {
    capabilitySet: ['read_file', 'stage_file_edit'],
    commitPolicy: { mode: 'staged', adapter: 'atomic-file-v1' }
  }
});
```

同时断言：

- read Task 请求 staged 工具时返回 `capability_denied/plan_validation`。
- write Task 请求 `write_file`、`edit_file`、shell 或 `immediate_side_effect` 时失败。
- write Task 没有任何 staged 工具时失败，不允许以 write mode 伪装 read Task。
- write Task 可以同时保留显式请求的 `pure_read` 工具。
- restore 后 staged capability 只能保持或移除，不能新增。
- `validateExecutionPlanSnapshot()` 拒绝 adapter 缺失、未知 adapter、effect 与 commit policy 不匹配。

- [x] **Step 2: Run focused tests and verify RED**

Run:

```bash
pnpm exec vitest run test/ai/tools/tool-registry.test.ts test/electron/main/modules/chat/agents/contracts.test.ts test/electron/main/modules/chat/agents/plan-compiler.test.ts test/electron/main/modules/chat/agents/service.test.ts
```

Expected: FAIL，因为 staged registry 条目、write plan 分支和 `authorizeTask()` 尚不存在。

- [x] **Step 3: Add internal staged tool definitions**

创建以下精确 registry 条目；名称必须与 Child tool executor 保持一致：

```ts
export const STAGE_FILE_WRITE_TOOL_NAME = 'stage_file_write';
export const STAGE_FILE_EDIT_TOOL_NAME = 'stage_file_edit';

export const stageFileWriteToolRegistryEntry = {
  runtime: 'main',
  group: 'file',
  exposure: 'internal',
  executionClass: 'direct',
  effect: {
    effect: 'staged_file_write',
    resourceScopeResolver: 'file-path',
    commitAdapter: 'atomic-file-v1',
    reversible: true
  },
  definition: {
    name: STAGE_FILE_WRITE_TOOL_NAME,
    description: '在当前 Child Task 私有 overlay 中创建或完整替换文本文件；不会直接修改工作区。',
    source: 'builtin',
    riskLevel: 'write',
    requiresActiveDocument: false,
    permissionCategory: 'system',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '冻结 resource scope 内的工作区相对或绝对文件路径。' },
        content: { type: 'string', description: '候选完整文本内容。' }
      },
      required: ['path', 'content'],
      additionalProperties: false
    }
  }
} satisfies ToolRegistryEntry;
```

`stage_file_edit` 参数固定为 `path/oldString/newString/replaceAll`，描述必须明确修改的是 overlay。两个条目只进入 registry，不进入 `chat-default` exposure。

- [x] **Step 4: Make plan validation mode-aware**

用 mode 决定 effect 和 commit policy：

```ts
const WRITE_ADAPTER = 'atomic-file-v1';
const allowedEffects =
  input.task.contractSnapshot.mode === 'write'
    ? new Set(['pure_read', 'staged_file_write'])
    : new Set(['pure_read']);

const capabilitySet = requestedTools.filter((toolName): boolean => {
  const entry = dependencies.getToolEntry(toolName);
  return Boolean(
    entry &&
      entry.runtime === 'main' &&
      entry.executionClass === 'direct' &&
      allowedEffects.has(entry.effect.effect) &&
      (entry.effect.effect !== 'staged_file_write' || entry.effect.commitAdapter === WRITE_ADAPTER)
  );
});

const hasStagedWrite = capabilitySet.some(
  (toolName): boolean => dependencies.getToolEntry(toolName)?.effect.effect === 'staged_file_write'
);
if (input.task.contractSnapshot.mode === 'write' && !hasStagedWrite) {
  return createPlanFailure('write_plan_staged_capability_missing');
}
```

生成计划时按实际 registry metadata 固化 `toolEffectSet`；write plan 固定 `commitPolicy: { mode: 'staged', adapter: WRITE_ADAPTER }`。校验器必须要求 mode、effect、adapter 三者完全一致。

- [x] **Step 5: Generalize service authorization without widening Renderer authority**

把内部方法改为：

```ts
authorizeTask(taskId: string): AgentTaskRecord
```

该方法仍从 Store、continuation context、Main feature、权限与预算 provider 读取输入；Renderer 不能传 mode、adapter、tool list 或模型覆盖。保留 `authorizeReadTask()` 作为一个版本内的兼容委托，并在 Coordinator 切换后删除。

- [x] **Step 6: Run focused tests and verify GREEN**

Run:

```bash
pnpm exec vitest run test/ai/tools/tool-registry.test.ts test/electron/main/modules/chat/agents/contracts.test.ts test/electron/main/modules/chat/agents/plan-compiler.test.ts test/electron/main/modules/chat/agents/service.test.ts
```

Expected: PASS，且现有 read plan 快照 hash 与恢复测试继续通过。

- [x] **Step 7: Commit Task 1**

```bash
git add shared/ai/tools/AgentStagedFileTool/index.ts shared/ai/tools/index.ts shared/ai/tools/DelegateTaskTool/index.ts types/chat-agent.d.ts electron/main/modules/chat/agents/contracts.mts electron/main/modules/chat/agents/plan-compiler.mts electron/main/modules/chat/agents/service.mts test/ai/tools/tool-registry.test.ts test/electron/main/modules/chat/agents/contracts.test.ts test/electron/main/modules/chat/agents/plan-compiler.test.ts test/electron/main/modules/chat/agents/service.test.ts changelog/2026-07-27.md
git commit -m "feat(chat): 冻结 Child 受控写入计划"
```

---

### Task 2: Persist Immutable Changesets, Confirmations And Commit Journals

**Files:**
- Modify: `types/chat-agent.d.ts`
- Modify: `electron/main/modules/database/service.mts`
- Modify: `electron/main/modules/chat/agents/types.mts`
- Modify: `electron/main/modules/chat/agents/contracts.mts`
- Modify: `electron/main/modules/chat/agents/store.mts`
- Test: `test/electron/main/modules/database/agent-task-migration.test.ts`
- Test: `test/electron/main/modules/chat/agents/contracts.test.ts`
- Test: `test/electron/main/modules/chat/agents/result.test.ts`
- Test: `test/electron/main/modules/chat/agents/store.test.ts`
- Test: `test/electron/main/modules/chat/runtime/main-boundary.test.ts`

**Interfaces:**
- Consumes: 现有 append-only Event、Task CAS 状态机、immutable snapshot trigger 和 `unfinished_journal_count`。
- Produces: `AgentChangesetSnapshot`、`AgentConfirmationRecord`、`AgentCommitJournalRecord` 与 Store 的原子 prepare/resolve/journal transition API。

- [x] **Step 1: Write failing migration and immutability tests**

测试数据库升级后存在以下表和约束：

```ts
expect(tableNames).toEqual(
  expect.arrayContaining([
    'chat_agent_changesets',
    'chat_agent_confirmations',
    'chat_agent_commit_journals'
  ])
);

expect(() =>
  database.prepare('UPDATE chat_agent_changesets SET snapshot_hash = ? WHERE changeset_id = ?').run(
    'f'.repeat(64),
    'changeset-1'
  )
).toThrow(/agent_changeset_immutable/);

expect(() =>
  database.prepare('DELETE FROM chat_agent_commit_journals WHERE journal_id = ?').run('journal-1')
).toThrow(/agent_fact_delete_forbidden/);
```

Store tests覆盖：

- `prepareChangeset()` 只接受 `running` write Task 与当前 Attempt/Runtime/plan。
- 同一 Attempt 只能有一个 active changeset；完全相同重放幂等，不同 hash 冲突。
- `createConfirmation()` 与 changeset 同事务完成 `running → waiting_confirmation`。
- `resolveConfirmation()` 使用 version CAS，重复相同决定幂等，不同决定冲突。
- `queueCommit()` 只在 confirmation 已 approved 时完成 `waiting_confirmation → queued(commit)`，此时尚未创建 journal。
- `createCommitJournal()` 只在调用方已持有 `exclusive-commit` 且完成 commit validation 后，同事务完成 `queued(commit) → committing`、journal created 和 `unfinished_journal_count + 1`。
- `finalizeCommit()` 同事务写入 result、journal finalized、`unfinished_journal_count - 1` 和 Task completed。
- tombstone 在未决 confirmation 或 unfinished journal 存在时拒绝。

- [x] **Step 2: Run database and Store tests and verify RED**

Run:

```bash
pnpm exec cross-env ELECTRON_RUN_AS_NODE=1 HOST=127.0.0.1 electron node_modules/vitest/vitest.mjs run test/electron/main/modules/database/agent-task-migration.test.ts test/electron/main/modules/chat/agents/store.test.ts
pnpm exec vitest run test/electron/main/modules/chat/agents/contracts.test.ts
```

Expected: FAIL，因为三个事实表、共享类型和 Store API 尚不存在。

- [x] **Step 3: Define immutable snapshot types**

加入以下核心类型：

```ts
export interface AgentFileOperationSnapshot {
  readonly operationId: string;
  readonly kind: 'create' | 'replace';
  readonly displayPath: string;
  readonly targetPath: string;
  readonly resourceScope: string;
  readonly baseRevision: string;
  readonly baseContentHash: string;
  readonly targetContentHash: string;
  readonly candidateReference: string;
  readonly rollbackReference: string;
  readonly byteLength: number;
}

export interface AgentChangesetSnapshot {
  readonly changesetSchemaVersion: number;
  readonly changesetId: string;
  readonly taskId: string;
  readonly attemptId: string;
  readonly agentId: string;
  readonly runtimeId: string;
  readonly planHash: string;
  readonly baseRevision: string;
  readonly diffReference: string;
  readonly diffHash: string;
  readonly operationSetHash: string;
  readonly resourceScopes: readonly string[];
  readonly operations: readonly AgentFileOperationSnapshot[];
  readonly createdAt: string;
}

export interface AgentWriteResultDraft {
  readonly taskId: string;
  readonly agentId: string;
  readonly attemptId: string;
  readonly summary: string;
  readonly output?: unknown;
  readonly criteria: readonly AgentCriteriaResult[];
  readonly warnings: readonly AgentTaskWarning[];
  readonly usage: AgentUsageAccounting;
}

export interface AgentConfirmationRequestSnapshot {
  readonly confirmationSchemaVersion: number;
  readonly confirmationId: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly taskId: string;
  readonly attemptId: string;
  readonly agentId: string;
  readonly runtimeId: string;
  readonly toolCallId: string;
  readonly changesetId: string;
  readonly planHash: string;
  readonly baseRevision: string;
  readonly diffHash: string;
  readonly operationSetHash: string;
  readonly resourceScopes: readonly string[];
  readonly displayPaths: readonly string[];
  readonly unifiedDiffReference: string;
  readonly riskLevel: 'write' | 'dangerous';
  readonly createdAt: string;
}

export interface AgentCommitIntentSnapshot {
  readonly journalSchemaVersion: number;
  readonly changesetSnapshotHash: string;
  readonly confirmationId: string;
  readonly confirmationVersion: number;
  readonly planHash: string;
  readonly resultDraft: AgentWriteResultDraft;
  readonly operations: readonly AgentFileOperationSnapshot[];
  readonly createdAt: string;
}

export type AgentConfirmationStatus = 'pending' | 'approved' | 'rejected' | 'revoked';
export type AgentConfirmationDecision = {
  readonly decision: 'approved' | 'rejected';
  readonly version: number;
};
export type AgentCommitJournalStatus =
  | 'created'
  | 'applying'
  | 'applied'
  | 'finalized'
  | 'cancelled'
  | 'manual_recovery';

export interface AgentChangesetRecord {
  readonly snapshot: AgentChangesetSnapshot;
  readonly snapshotHash: string;
  readonly status: 'prepared' | 'awaiting_confirmation' | 'approved' | 'rejected' | 'revoked' | 'committing' | 'committed' | 'discarded';
  readonly confirmationId?: string;
  readonly recordState: AgentRecordState;
  readonly updatedAt: string;
}

export interface AgentConfirmationRecord {
  readonly confirmationId: string;
  readonly changesetId: string;
  readonly request: AgentConfirmationRequestSnapshot;
  readonly requestHash: string;
  readonly status: AgentConfirmationStatus;
  readonly version: number;
  readonly decision?: AgentConfirmationDecision['decision'];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AgentCommitJournalRecord {
  readonly journalId: string;
  readonly taskId: string;
  readonly attemptId: string;
  readonly changesetId: string;
  readonly confirmationId: string;
  readonly confirmationVersion: number;
  readonly planHash: string;
  readonly intent: AgentCommitIntentSnapshot;
  readonly intentHash: string;
  readonly status: AgentCommitJournalStatus;
  readonly appliedOperationIds: readonly string[];
  readonly error?: AgentTaskError;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly finalizedAt?: string;
}
```

Confirmation immutable request 必须绑定 `sessionId/turnId/taskId/attemptId/agentId/runtimeId/toolCallId/changesetId/planHash/baseRevision/diffHash/operationSetHash/resourceScopes/riskLevel/requestHash`。Journal immutable intent 必须绑定 confirmation version 和完整 changeset snapshot hash。

- [x] **Step 4: Create fact tables and immutable triggers**

表结构固定为以下字段：

```sql
CREATE TABLE IF NOT EXISTS chat_agent_changesets (
  changeset_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  runtime_id TEXT NOT NULL,
  plan_hash TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL,
  base_revision TEXT NOT NULL,
  diff_hash TEXT NOT NULL,
  operation_set_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  confirmation_id TEXT,
  record_state TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (status IN ('prepared', 'awaiting_confirmation', 'approved', 'rejected', 'revoked', 'committing', 'committed', 'discarded')),
  CHECK (record_state IN ('active', 'tombstoned'))
);

CREATE TABLE IF NOT EXISTS chat_agent_confirmations (
  confirmation_id TEXT PRIMARY KEY,
  changeset_id TEXT NOT NULL UNIQUE,
  request_json TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  decision_json TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (status IN ('pending', 'approved', 'rejected', 'revoked')),
  CHECK (version > 0)
);

CREATE TABLE IF NOT EXISTS chat_agent_commit_journals (
  journal_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  changeset_id TEXT NOT NULL UNIQUE,
  confirmation_id TEXT NOT NULL,
  confirmation_version INTEGER NOT NULL,
  plan_hash TEXT NOT NULL,
  intent_json TEXT NOT NULL,
  intent_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  operation_progress_json TEXT NOT NULL DEFAULT '[]',
  error_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finalized_at TEXT,
  CHECK (status IN ('created', 'applying', 'applied', 'finalized', 'cancelled', 'manual_recovery'))
);
```

为 identity/snapshot/intention/createdAt 添加 immutable trigger，为三个表添加 no-delete trigger；只允许 confirmation 的 status/version/decision、journal 的 status/progress/error/finalizedAt 和 changeset 的 mutable projection 变化。

- [x] **Step 5: Add narrow transactional Store APIs**

Store 对外只暴露以下写入口：

```ts
export interface PrepareAgentChangesetInput {
  readonly snapshot: AgentChangesetSnapshot;
  readonly snapshotHash: string;
  readonly occurredAt: string;
}

export interface CreateAgentConfirmationInput {
  readonly request: AgentConfirmationRequestSnapshot;
  readonly requestHash: string;
  readonly occurredAt: string;
}

export interface ResolveAgentConfirmationInput {
  readonly confirmationId: string;
  readonly expectedVersion: number;
  readonly decision: 'approved' | 'rejected';
  readonly occurredAt: string;
}

export interface QueueAgentCommitInput {
  readonly taskId: string;
  readonly confirmationId: string;
  readonly confirmationVersion: number;
  readonly occurredAt: string;
}

export interface CreateAgentCommitJournalInput {
  readonly journalId: string;
  readonly changesetId: string;
  readonly confirmationId: string;
  readonly confirmationVersion: number;
  readonly intent: AgentCommitIntentSnapshot;
  readonly intentHash: string;
  readonly occurredAt: string;
}

export interface MarkAgentJournalInput {
  readonly journalId: string;
  readonly occurredAt: string;
}

export interface MarkAgentJournalOperationInput extends MarkAgentJournalInput {
  readonly operationId: string;
  readonly targetContentHash: string;
}

export interface FinalizeAgentCommitInput extends MarkAgentJournalInput {
  readonly result: ChatAgentResult;
  readonly resultHash: string;
  readonly finalHash: string;
}

export interface MarkAgentJournalFailureInput extends MarkAgentJournalInput {
  readonly error: AgentTaskError;
}

prepareChangeset(input: PrepareAgentChangesetInput): AgentChangesetRecord
createConfirmation(input: CreateAgentConfirmationInput): AgentConfirmationRecord
resolveConfirmation(input: ResolveAgentConfirmationInput): AgentConfirmationRecord
revokeConfirmation(confirmationId: string, reason: string, occurredAt: string): AgentConfirmationRecord
queueCommit(input: QueueAgentCommitInput): AgentTaskRecord
createCommitJournal(input: CreateAgentCommitJournalInput): AgentCommitJournalRecord
markJournalApplying(input: MarkAgentJournalInput): AgentCommitJournalRecord
markJournalOperation(input: MarkAgentJournalOperationInput): AgentCommitJournalRecord
markJournalApplied(input: MarkAgentJournalInput): AgentCommitJournalRecord
finalizeCommit(input: FinalizeAgentCommitInput): AgentCheckpointRecord
markManualRecovery(input: MarkAgentJournalFailureInput): AgentCheckpointRecord
listPendingConfirmations(): AgentConfirmationRecord[]
listUnfinishedJournals(): AgentCommitJournalRecord[]
```

每个方法都重新读取 Task、Attempt、changeset 和 plan hash，使用 CAS 更新投影，并在同一事务追加包含 `attemptId/runtimeId` 的 Event。Event payload 只保存 ID、hash、version、decision 和稳定错误码，不保存候选全文。

- [x] **Step 6: Run migration, contract and Store tests**

Run:

```bash
pnpm exec vitest run test/electron/main/modules/chat/agents/contracts.test.ts
pnpm exec cross-env ELECTRON_RUN_AS_NODE=1 HOST=127.0.0.1 electron node_modules/vitest/vitest.mjs run test/electron/main/modules/database/agent-task-migration.test.ts test/electron/main/modules/chat/agents/store.test.ts
```

Expected: PASS，且旧数据库可增量创建新表，已有 Task/Attempt/Event 事实不被重写。

- [x] **Step 7: Commit Task 2**

```bash
git add types/chat-agent.d.ts electron/main/modules/database/service.mts electron/main/modules/chat/agents/types.mts electron/main/modules/chat/agents/contracts.mts electron/main/modules/chat/agents/store.mts test/electron/main/modules/database/agent-task-migration.test.ts test/electron/main/modules/chat/agents/contracts.test.ts test/electron/main/modules/chat/agents/result.test.ts test/electron/main/modules/chat/agents/store.test.ts changelog/2026-07-27.md
git commit -m "feat(chat): 持久化 Child 写入事实"
```

---

### Task 3: Build A Task-Private Overlay And Diff Integrity

**Files:**
- Create: `electron/main/modules/chat/agents/write-overlay.mts`
- Create: `electron/main/modules/chat/agents/write-tools.mts`
- Create: `test/electron/main/modules/chat/agents/write-overlay.test.ts`
- Create: `test/electron/main/modules/chat/agents/write-tools.test.ts`
- Modify: `electron/main/modules/chat/agents/contracts.mts`
- Modify: `electron/main/modules/chat/agents/read-tools.mts`

**Interfaces:**
- Consumes: write Execution Plan、真实 workspace root、Attempt/Runtime identity、staged tool registry。
- Produces: `createAgentWriteOverlay()`、`createChildWriteTools()` 与 canonical `AgentChangesetSnapshot`；任何 staged 调用都不修改真实目标。

- [x] **Step 1: Write failing overlay isolation tests**

核心测试：

```ts
const overlay = await createAgentWriteOverlay({
  task,
  attempt,
  runtimeId: 'runtime-write-1',
  plan,
  workspaceRoot,
  overlayRoot,
  now: () => '2026-07-27T00:00:00.000Z',
  createId: (kind): string => `${kind}-1`
});

await overlay.writeFile({ path: 'notes.md', content: 'new content' });

expect(await fs.readFile(path.join(workspaceRoot, 'notes.md'), 'utf8')).toBe('old content');
const changeset = await overlay.prepare();
expect(changeset).toMatchObject({
  taskId: task.taskId,
  attemptId: attempt.attemptId,
  planHash: plan.planHash,
  operations: [{
    kind: 'replace',
    baseContentHash: hashText('old content'),
    targetContentHash: hashText('new content')
  }]
});
expect(changeset.diffHash).toMatch(/^[a-f0-9]{64}$/);
expect(changeset.operationSetHash).toMatch(/^[a-f0-9]{64}$/);
```

同时验证：

- 同一文件连续 edit 从 overlay 当前内容继续，不重复读取工作区。
- create 与 replace 生成不同 operation kind。
- no-op 不生成 operation；全部 no-op 时 `prepare()` 返回 `null`。
- `oldString` 零匹配、多匹配且未启用 replaceAll 时稳定失败。
- `unsaved://`、目录、二进制 NUL、工作区外路径和符号链接逃逸被拒绝。
- 文件在 prepare 前变化时返回 `stale_context/commit_validation`。
- 第 33 个 operation、超过 4 MiB 的单文件、超过 16 MiB 的候选总量和超过 256 KiB 的 diff 都在持久化或确认前失败。
- `dispose()` 只删除该 Attempt 的精确 overlay 目录。

- [x] **Step 2: Run overlay tests and verify RED**

Run:

```bash
pnpm exec vitest run test/electron/main/modules/chat/agents/write-overlay.test.ts test/electron/main/modules/chat/agents/write-tools.test.ts
```

Expected: FAIL，因为 overlay 和 staged tool executor 尚不存在。

- [x] **Step 3: Implement canonical hashes and protected references**

使用现有 `hashAgentPayload()`，完整性计算固定为：

```ts
const operationSetHash = hashAgentPayload({
  schemaVersion: 1,
  operations: operations.map((operation) => ({
    operationId: operation.operationId,
    kind: operation.kind,
    targetPath: operation.targetPath,
    resourceScope: operation.resourceScope,
    baseRevision: operation.baseRevision,
    baseContentHash: operation.baseContentHash,
    targetContentHash: operation.targetContentHash,
    byteLength: operation.byteLength
  }))
});

const baseRevision = hashAgentPayload({
  schemaVersion: 1,
  bases: operations.map((operation) => ({
    targetPath: operation.targetPath,
    baseRevision: operation.baseRevision,
    baseContentHash: operation.baseContentHash
  }))
});

const diffHash = hashAgentPayload({
  schemaVersion: 1,
  baseRevision,
  operationSetHash,
  diffContentHash: hashText(unifiedDiff)
});
```

在 `contracts.mts` 导出并复用固定上限：

```ts
export const AGENT_MAX_CHANGESET_OPERATIONS = 32;
export const AGENT_MAX_STAGED_FILE_BYTES = 4 * 1024 * 1024;
export const AGENT_MAX_CHANGESET_BYTES = 16 * 1024 * 1024;
export const AGENT_MAX_DIFF_BYTES = 256 * 1024;
```

候选内容、回滚内容和完整 diff 写入 `overlayRoot/<taskId>/<attemptId>/` 下权限为 `0o700` 的私有目录；snapshot 只保存受保护引用与 hash。displayPath 使用 workspace 相对路径，Event 和普通日志不记录全文。

每个基础 revision 固定按以下事实计算，避免“内容改回原值”绕过确认：

```ts
const baseRevision = hashAgentPayload({
  schemaVersion: 1,
  targetPath,
  exists,
  parentRealPath,
  size,
  mtimeMs,
  contentHash
});
```

create operation 使用 `exists: false`、真实父目录和空内容 hash；replace operation 使用目标 realpath、`fs.stat()` 的 size/mtimeMs 和完整内容 hash。

- [x] **Step 4: Implement overlay operations**

公开边界固定为：

```ts
export interface AgentWriteOverlay {
  writeFile(input: { path: string; content: string }): Promise<AgentOverlayOperationResult>;
  editFile(input: {
    path: string;
    oldString: string;
    newString: string;
    replaceAll: boolean;
  }): Promise<AgentOverlayOperationResult>;
  prepare(): Promise<AgentChangesetSnapshot | null>;
  dispose(): Promise<void>;
}

export interface AgentOverlayOperationResult {
  readonly operationId: string;
  readonly displayPath: string;
  readonly changed: boolean;
  readonly targetContentHash: string;
}

export interface CreateAgentWriteOverlayInput {
  readonly task: AgentTaskRecord;
  readonly attempt: AgentAttemptRecord;
  readonly runtimeId: string;
  readonly plan: AgentExecutionPlanSnapshot;
  readonly workspaceRoot: string;
  readonly overlayRoot: string;
  readonly now: () => string;
  readonly createId: (kind: 'changeset' | 'operation') => string;
}

export async function createAgentWriteOverlay(
  input: CreateAgentWriteOverlayInput
): Promise<AgentWriteOverlay>
```

首次访问文件时解析 realpath 或最近存在父目录的 realpath，验证 scope 后冻结 `{ exists, contentHash, revision }`。后续操作只读写 overlay 候选。`prepare()` 再读取真实目标并比较基础 revision，按 targetPath 排序生成不可变 operation 集合。

- [x] **Step 5: Add guarded Child staged tools**

`createChildWriteTools()` 同时暴露计划内 pure-read 工具与 staged 工具：

```ts
export interface ChildWriteTools {
  readonly tools: AITransportTool[];
  readonly guardToolCall: RuntimeToolGuard;
  readonly executeMainTool: ChatRuntimeMainToolExecutor;
  prepare(): Promise<AgentChangesetSnapshot | null>;
  dispose(): Promise<void>;
}
```

每次调用重新验证 registry 仍是 `main/direct/staged_file_write/atomic-file-v1`，plan 仍含工具和 `commitPolicy.mode === 'staged'`，目标仍在冻结 scope，signal 未取消。executor 只能调用 overlay 方法，不能导入 Runtime `FileTool` 的立即写盘分支。

- [x] **Step 6: Run overlay and tool tests**

Run:

```bash
pnpm exec vitest run test/electron/main/modules/chat/agents/write-overlay.test.ts test/electron/main/modules/chat/agents/write-tools.test.ts
```

Expected: PASS，并由测试明确证明真实工作区内容在 changeset prepared 后仍未改变。

- [x] **Step 7: Commit Task 3**

```bash
git add electron/main/modules/chat/agents/write-overlay.mts electron/main/modules/chat/agents/write-tools.mts electron/main/modules/chat/agents/contracts.mts electron/main/modules/chat/agents/read-tools.mts test/electron/main/modules/chat/agents/write-overlay.test.ts test/electron/main/modules/chat/agents/write-tools.test.ts docs/superpowers/plans/2026-07-27-child-agent-controlled-write.md changelog/2026-07-27.md
git commit -m "feat(chat): 生成 Child 文件 changeset"
```

---

### Task 4: Upgrade Scheduling To Resource-Scoped Read And Write Leases

**Files:**
- Modify: `electron/main/modules/chat/agents/resource-scopes.mts`
- Modify: `electron/main/modules/chat/agents/scheduler.mts`
- Modify: `electron/main/modules/chat/agents/coordinator.mts`
- Modify: `electron/main/modules/chat/agents/service.mts`
- Test: `test/electron/main/modules/chat/agents/resource-scopes.test.ts`
- Test: `test/electron/main/modules/chat/agents/scheduler.test.ts`
- Test: `test/electron/main/modules/chat/agents/coordinator.test.ts`
- Test: `test/electron/main/modules/chat/agents/read-runtime.test.ts`

**Interfaces:**
- Consumes: canonical `file:`/`directory:/**` scopes、Task priority/deadline。
- Produces: `AgentResourceScheduler.enqueue()` 返回 `shared-read`、`write-intent` 或 `exclusive-commit` lease；等待确认时 Coordinator 不持有 lease。

- [x] **Step 1: Write failing compatibility and fairness tests**

测试矩阵：

```ts
expect(scopesOverlap('file:/repo/a.md', 'file:/repo/a.md')).toBe(true);
expect(scopesOverlap('directory:/repo/**', 'file:/repo/a.md')).toBe(true);
expect(scopesOverlap('directory:/repo/a/**', 'file:/repo/b.md')).toBe(false);

const readA = await scheduler.enqueue(request('read-a', 'shared-read', ['file:/repo/a.md']));
const readB = await scheduler.enqueue(request('read-b', 'shared-read', ['file:/repo/a.md']));
expect(scheduler.activeCount()).toBe(2);

const writer = scheduler.enqueue(request('write-a', 'write-intent', ['file:/repo/a.md']));
expect(scheduler.queuedCount()).toBe(1);

readA.release();
readB.release();
await expect(writer).resolves.toMatchObject({ kind: 'write-intent' });
```

再验证：

- 不冲突 write-intent 可以并行。
- exclusive-commit 与同 scope 的 read/write-intent/exclusive-commit 都冲突。
- writer 排队后，同优先级或更低优先级的新冲突 reader 不能越过 writer。
- 高优先级不抢占已活动 lease。
- deadline 和 cancel 对三类 lease 都有效。
- 同一 Task 同一 phase 重放返回同一个 Promise，不同 claim 重放失败。
- Coordinator read model 请求迁移为 `start/shared-read`；write model 的 acquire/release 生命周期测试仍在 Task 7 与 confirmation 状态机一起完成，避免提前启动 write Task。

- [x] **Step 2: Run scheduler tests and verify RED**

Run:

```bash
pnpm exec vitest run test/electron/main/modules/chat/agents/resource-scopes.test.ts test/electron/main/modules/chat/agents/scheduler.test.ts test/electron/main/modules/chat/agents/coordinator.test.ts
pnpm exec cross-env ELECTRON_RUN_AS_NODE=1 HOST=127.0.0.1 electron node_modules/vitest/vitest.mjs run test/electron/main/modules/chat/agents/read-runtime.test.ts
```

Expected: FAIL，因为当前 scheduler 只接受 read mode，scope overlap 尚未参与许可兼容判断。

- [x] **Step 3: Export canonical scope overlap**

`resource-scopes.mts` 增加：

```ts
export function scopesOverlap(left: string, right: string): boolean {
  const leftScope = parseCanonicalScope(left);
  const rightScope = parseCanonicalScope(right);
  if (leftScope.kind === 'file' && rightScope.kind === 'file') {
    return leftScope.path === rightScope.path;
  }
  if (leftScope.kind === 'directory' && rightScope.kind === 'directory') {
    return isPathWithin(leftScope.path, rightScope.path) || isPathWithin(rightScope.path, leftScope.path);
  }
  const directory = leftScope.kind === 'directory' ? leftScope : rightScope;
  const file = leftScope.kind === 'file' ? leftScope : rightScope;
  return isPathWithin(file.path, directory.path);
}
```

非法 canonical scope 直接抛 `AgentStoreProtocolError` 等价的稳定 protocol error，不能降级为“不冲突”。

- [x] **Step 4: Generalize scheduler request and lease**

```ts
export type AgentResourceLeaseKind = 'shared-read' | 'write-intent' | 'exclusive-commit';

export interface AgentScheduleRequest {
  readonly taskId: string;
  readonly phase: 'start' | 'commit';
  readonly kind: AgentResourceLeaseKind;
  readonly priority: AgentTaskPriority;
  readonly deadlineAt: string;
  readonly createdAt: string;
  readonly resourceScopes: readonly string[];
}

export interface AgentResourceLease {
  readonly taskId: string;
  readonly phase: 'start' | 'commit';
  readonly kind: AgentResourceLeaseKind;
  readonly signal: AbortSignal;
  release(): void;
}

export interface AgentResourceScheduler {
  enqueue(request: AgentScheduleRequest): Promise<AgentResourceLease>;
  cancel(taskId: string, reason: string): boolean;
  activeCount(): number;
  queuedCount(): number;
}
```

兼容规则固定为：scope 不重叠时允许；scope 重叠时只有 `shared-read + shared-read` 允许。保留最多三个活动 Child execution slot；`exclusive-commit` 复用同一 slot，不额外扩大并行度。`service.mts`、Coordinator 与 read runtime 测试统一切换到 `createAgentResourceScheduler()`，Task 4 完成后删除旧 `AgentReadScheduler/AgentReadLease/createAgentReadScheduler` 名称。

- [x] **Step 5: Implement writer fairness and phase-aware replay**

队列排序仍按 priority、createdAt、taskId；dispatch 时若候选 reader 前存在同优先级或更高优先级的冲突 writer，则跳过该 reader。内部幂等键改为 `${taskId}:${phase}`，保证 start lease 释放后可以为同一 Task 申请 commit lease。

- [x] **Step 6: Run scheduler and coordinator tests**

Run:

```bash
pnpm exec vitest run test/electron/main/modules/chat/agents/resource-scopes.test.ts test/electron/main/modules/chat/agents/scheduler.test.ts test/electron/main/modules/chat/agents/coordinator.test.ts
pnpm exec cross-env ELECTRON_RUN_AS_NODE=1 HOST=127.0.0.1 electron node_modules/vitest/vitest.mjs run test/electron/main/modules/chat/agents/read-runtime.test.ts
```

Expected: PASS，且 read-only 三并行测试保持通过。

- [x] **Step 7: Commit Task 4**

```bash
git add electron/main/modules/chat/agents/resource-scopes.mts electron/main/modules/chat/agents/scheduler.mts electron/main/modules/chat/agents/coordinator.mts electron/main/modules/chat/agents/service.mts test/electron/main/modules/chat/agents/resource-scopes.test.ts test/electron/main/modules/chat/agents/scheduler.test.ts test/electron/main/modules/chat/agents/coordinator.test.ts test/electron/main/modules/chat/agents/read-runtime.test.ts docs/superpowers/plans/2026-07-27-child-agent-controlled-write.md changelog/2026-07-27.md
git commit -m "feat(chat): 增加 Child 写入资源门禁"
```

---

### Task 5: Add Main-Owned Persistent Confirmation Queue

**Files:**
- Create: `electron/main/modules/chat/agents/confirmation-store.mts`
- Create: `src/stores/chat/confirmationQueue.ts`
- Create: `src/hooks/useChat/useAgentConfirmationEvents.ts`
- Modify: `types/chat-agent.d.ts`
- Modify: `types/electron-api.d.ts`
- Modify: `electron/main/modules/chat/agents/service.mts`
- Modify: `electron/main/modules/chat/agents/ipc.mts`
- Modify: `electron/main/modules/chat/agents/store.mts`
- Modify: `electron/preload/index.mts`
- Modify: `src/shared/platform/electron-api.ts`
- Modify: `src/hooks/useChat/useAgentDelegationEvents.ts`
- Modify: `src/components/BChat/utils/confirmationController.ts`
- Modify: `src/components/BChat/components/ConfirmationSheet.vue`
- Modify: `src/components/BChat/index.vue`
- Create: `test/electron/main/modules/chat/agents/confirmation-store.test.ts`
- Test: `test/electron/main/modules/chat/agents/ipc.test.ts`
- Test: `test/electron/main/modules/chat/agents/service.test.ts`
- Test: `test/electron/main/modules/chat/agents/store.test.ts`
- Create: `test/stores/chat/confirmation-queue.test.ts`
- Create: `test/hooks/use-agent-confirmation-events.test.ts`
- Test: `test/hooks/use-agent-delegation-events.test.ts`
- Test: `test/components/BChat/confirmation-controller.test.ts`
- Create: `test/components/BChat/confirmation-sheet.component.test.ts`

**Interfaces:**
- Consumes: Task 2 confirmation Store API、application event publisher、现有 ConfirmationSheet。
- Produces: 持久化 `ChatAgentConfirmationSnapshot[]`、`chat:agent:list-confirmations`、`chat:agent:resolve-confirmation` 与应用级风险优先/FIFO 选择投影。

- [x] **Step 1: Write failing Main queue and CAS tests**

```ts
const waiting = queue.request(createConfirmationInput());
expect(store.listPendingConfirmations()).toHaveLength(1);
expect(queue.snapshot()).toMatchObject([{ status: 'pending', version: 1 }]);

const approved = queue.resolve({
  confirmationId: 'confirmation-1',
  expectedVersion: 1,
  decision: 'approved'
});
expect(approved).toMatchObject({ status: 'approved', version: 2 });
await expect(waiting).resolves.toMatchObject({ decision: 'approved', version: 2 });

expect(() =>
  queue.resolve({
    confirmationId: 'confirmation-1',
    expectedVersion: 1,
    decision: 'approved'
  })
).toThrowError(expect.objectContaining({ reason: 'confirmation_version_conflict' }));
```

同时验证 reject、revoke、Task cancel、Renderer 无订阅者、Renderer 重载和迟到响应。相同 version/decision 的网络重放必须返回已持久化结果，但不能二次唤醒 commit。

- [x] **Step 2: Write failing Renderer ordering tests**

Renderer Store 同时保存 `source: 'runtime' | 'agent'` 的 allowlist 投影，以风险优先、请求时间 FIFO、confirmationId 稳定排序：

```ts
export type ChatConfirmationQueueItem =
  | {
      readonly source: 'runtime';
      readonly confirmationId: string;
      readonly ownerId: string;
      readonly request: AIToolConfirmationRequest;
      readonly createdAt: string;
    }
  | {
      readonly source: 'agent';
      readonly confirmationId: string;
      readonly snapshot: ChatAgentConfirmationSnapshot;
      readonly createdAt: string;
    };

store.applySnapshot([
  confirmation('read-1', 'read', '2026-07-27T00:00:00.000Z'),
  confirmation('write-2', 'write', '2026-07-27T00:00:02.000Z'),
  confirmation('danger-1', 'dangerous', '2026-07-27T00:00:03.000Z'),
  confirmation('write-1', 'write', '2026-07-27T00:00:01.000Z')
]);

expect(store.current?.confirmationId).toBe('danger-1');
store.select('write-2');
expect(store.current?.confirmationId).toBe('write-2');
expect(store.pending.map((item) => item.confirmationId)).toHaveLength(4);
```

选择指定项只能改变 current projection，不能覆盖或删除其他 pending request。旧 version event 必须忽略。Runtime 项的 Promise resolver 保存在控制器私有 Map，不进入 Pinia state；Agent 项只由 Main snapshot/event 创建，不持有 Renderer resolver。

- [x] **Step 3: Implement Main-owned waiters over persisted facts**

```ts
export interface AgentConfirmationQueue {
  request(input: CreateAgentConfirmationInput): Promise<AgentConfirmationDecision>;
  resolve(input: ChatAgentResolveConfirmationInput): ChatAgentConfirmationSnapshot;
  revokeTask(taskId: string, reason: string): ChatAgentConfirmationSnapshot[];
  listPending(): ChatAgentConfirmationSnapshot[];
  recover(): void;
}
```

`request()` 必须先持久化再创建 waiter；发布 Renderer event 失败不影响 pending 事实。queue 的决议和撤销返回值也保持 Renderer allowlist，防止调用链误透传私有 overlay 引用。`recover()` 只恢复 pending snapshot，不承诺在 Main 重启后恢复原 Promise；启动恢复协议会撤销无 journal write Task。

- [x] **Step 4: Add exact IPC and preload APIs**

Renderer allowlist 投影固定为：

```ts
export interface ChatAgentConfirmationSnapshot {
  readonly confirmationId: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly taskId: string;
  readonly attemptId: string;
  readonly agentId: string;
  readonly runtimeId: string;
  readonly toolCallId: string;
  readonly changesetId: string;
  readonly status: AgentConfirmationStatus;
  readonly version: number;
  readonly riskLevel: 'write' | 'dangerous';
  readonly displayPaths: readonly string[];
  readonly resourceScopes: readonly string[];
  readonly unifiedDiff: string;
  readonly baseRevision: string;
  readonly diffHash: string;
  readonly operationSetHash: string;
  readonly planHash: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ChatAgentConfirmationApplicationEvent {
  readonly schemaVersion: 1;
  readonly type: 'confirmation.updated';
  readonly confirmation: ChatAgentConfirmationSnapshot;
}

export interface ChatAgentCheckpointApplicationEvent {
  readonly schemaVersion: 1;
  readonly type: 'checkpoint.updated';
  readonly checkpoint: ChatAgentCheckpointSnapshot;
  readonly checkpointSequence: number;
}

export type ChatAgentApplicationEvent =
  | ChatAgentCheckpointApplicationEvent
  | ChatAgentConfirmationApplicationEvent;
```

把 `ChatAgentApplicationEvent` 改为 checkpoint event 与 confirmation event 的判别联合；`useAgentDelegationEvents()` 只处理 `checkpoint.updated`，避免把新事件误当 Checkpoint。

IPC 输入固定为：

```ts
export interface ChatAgentResolveConfirmationInput {
  readonly confirmationId: string;
  readonly expectedVersion: number;
  readonly decision: 'approved' | 'rejected';
}
```

Renderer 不能提交 `diffHash`、`baseRevision`、scope、taskId、planHash 或 remember scope；Main 从持久化 request 取这些事实。新增 API：

```ts
chatAgentListConfirmations(): Promise<ChatAgentHandlerResult<ChatAgentConfirmationSnapshot[]>>
chatAgentResolveConfirmation(
  input: ChatAgentResolveConfirmationInput
): Promise<ChatAgentHandlerResult<ChatAgentConfirmationSnapshot>>
```

- [x] **Step 5: Project the application-level queue into BChat**

`useAgentConfirmationEvents()` 先订阅 `confirmation.updated`，再调用 list snapshot，并按 `version + updatedAt` 收敛。`createChatConfirmationController()` 改为应用级队列的 Runtime adapter：每个 controller 拥有稳定 ownerId，`dispose()` 只能 reject 自己的 Runtime 项，绝不能删除 Agent 项。ConfirmationSheet 从统一 current projection 渲染，对 Agent request 展示：

- Child Task/Agent 来源。
- 真实 workspace 相对目标与 resource scope。
- 风险级别和 changeset 文件数。
- 文本 unified diff。
- `baseRevision`、`diffHash`、`operationSetHash`、`planHash` 的可复制短指纹。

Agent request 禁止“本会话允许/始终允许”；只提供本次批准或拒绝。BChat 卸载只取消事件订阅，不 resolve Main pending request。

- [x] **Step 6: Run Main, Renderer and component tests**

Run:

```bash
pnpm exec vitest run test/electron/main/modules/chat/agents/confirmation-store.test.ts test/electron/main/modules/chat/agents/ipc.test.ts test/electron/main/modules/chat/agents/service.test.ts test/stores/chat/confirmation-queue.test.ts test/hooks/use-agent-confirmation-events.test.ts test/hooks/use-agent-delegation-events.test.ts test/components/BChat/confirmation-controller.test.ts test/components/BChat/confirmation-sheet.component.test.ts
```

Expected: PASS，且多个 Child pending confirmation 在 Renderer 重载后全部恢复。

- [x] **Step 7: Commit Task 5**

```bash
git add electron/main/modules/chat/agents/confirmation-store.mts src/stores/chat/confirmationQueue.ts src/hooks/useChat/useAgentConfirmationEvents.ts types/chat-agent.d.ts types/electron-api.d.ts electron/main/modules/chat/agents/service.mts electron/main/modules/chat/agents/ipc.mts electron/main/modules/chat/agents/store.mts electron/preload/index.mts src/shared/platform/electron-api.ts src/hooks/useChat/useAgentDelegationEvents.ts src/components/BChat/utils/confirmationController.ts src/components/BChat/components/ConfirmationSheet.vue src/components/BChat/index.vue test/electron/main/modules/chat/agents/confirmation-store.test.ts test/electron/main/modules/chat/agents/ipc.test.ts test/electron/main/modules/chat/agents/service.test.ts test/electron/main/modules/chat/agents/store.test.ts test/electron/main/modules/chat/runtime/main-boundary.test.ts test/stores/chat/confirmation-queue.test.ts test/hooks/use-agent-confirmation-events.test.ts test/hooks/use-agent-delegation-events.test.ts test/components/BChat/confirmation-controller.test.ts test/components/BChat/confirmation-sheet.component.test.ts changelog/2026-07-27.md
git commit -m "feat(chat): 持久化 Child 确认队列"
```

---

### Task 6: Apply File Changes Through A Recoverable Commit Journal

**Files:**
- Create: `electron/main/modules/chat/agents/file-commit.mts`
- Create: `test/electron/main/modules/chat/agents/file-commit.test.ts`
- Modify: `electron/main/modules/chat/agents/store.mts`
- Modify: `test/electron/main/modules/chat/agents/store.test.ts`
- Modify: `test/electron/main/modules/chat/runtime/atomic-write.test.ts`

**Interfaces:**
- Consumes: approved confirmation、exclusive-commit lease、immutable changeset、`atomically`。
- Produces: `AgentFileCommitter.commit()` 与 `recover()`；每次真实 mutation 前必须已有 durable journal。

- [x] **Step 1: Write failing commit validation tests**

```ts
await expect(
  committer.commit({
    task,
    attempt,
    changeset,
    confirmation,
    lease: exclusiveCommitLease
  })
).resolves.toMatchObject({
  journal: { status: 'finalized' },
  targetHashes: [changeset.operations[0].targetContentHash]
});

expect(await fs.readFile(targetPath, 'utf8')).toBe('new content');
expect(callOrder).toEqual([
  'validate',
  'journal-created',
  'journal-applying',
  'operation-applied',
  'journal-applied',
  'targets-verified',
  'journal-finalized'
]);
```

再覆盖每个 fail-closed 校验：

- lease 不是当前 Task 的 `exclusive-commit`。
- confirmation 未 approved 或 version/hash 不匹配。
- plan、changeset、operation set、diff 或 base revision 不匹配。
- target realpath/scope 在确认后改变。
- 当前内容既不匹配 base hash 也不匹配 target hash。
- journal 未创建时 `writeFileAtomically` 从未调用。

- [x] **Step 2: Write crash-injection recovery tests**

为每个注入点创建独立测试：

```ts
const points: AgentCommitCrashPoint[] = [
  'after_journal_created',
  'after_first_operation',
  'after_all_operations',
  'after_target_validation'
];
```

期望：

- `after_journal_created` 且目标仍是 base：安全标记 cancelled。
- 部分操作已是 target、其余仍是 base：按 intent roll-forward。
- 全部目标是 target：直接 mark applied 并 finalize。
- 任一目标同时不匹配 base/target：`manual_recovery_required`，Task `commit_failed`。
- 重复 `recover()` 幂等，不重复写已匹配 target 的文件。

- [x] **Step 3: Run commit tests and verify RED**

Run:

```bash
pnpm exec vitest run test/electron/main/modules/chat/agents/file-commit.test.ts test/electron/main/modules/chat/runtime/atomic-write.test.ts
pnpm exec cross-env ELECTRON_RUN_AS_NODE=1 HOST=127.0.0.1 electron node_modules/vitest/vitest.mjs run test/electron/main/modules/chat/agents/store.test.ts
```

Expected: FAIL，因为 journal adapter 与 crash recovery 尚不存在。

- [x] **Step 4: Implement pre-commit validation**

`commit()` 开头按以下顺序验证：

```ts
validateLease(input.lease, input.task, input.changeset.resourceScopes);
validatePlan(input.task.executionPlanSnapshot, input.changeset.planHash, 'atomic-file-v1');
validateConfirmation(input.confirmation, input.changeset);
validateCurrentPermissions(input.task.executionPlanSnapshot.permissionSnapshot);
await validateOperationTargets(input.changeset.operations, input.task.executionPlanSnapshot.resourceScopes);
await validateBaseContents(input.changeset.operations);
validateProtectedReferences(input.changeset.operations);
```

只有全部成功后才能调用 `store.createCommitJournal()`。Journal intent 把候选内容和回滚内容复制到 journalRoot 的 task/journal 私有目录，计算 intent hash 后持久化；不能依赖易失 overlay 才能恢复。

- [x] **Step 5: Implement serial atomic application and finalization**

公开边界：

```ts
export interface AgentFileCommitInput {
  readonly task: AgentTaskRecord;
  readonly attempt: AgentAttemptRecord;
  readonly changeset: AgentChangesetRecord;
  readonly confirmation: AgentConfirmationRecord;
  readonly resultDraft: AgentWriteResultDraft;
  readonly lease: AgentResourceLease;
}

export interface AgentFileCommitResult {
  readonly journal: AgentCommitJournalRecord;
  readonly checkpoint: AgentCheckpointRecord;
  readonly result: ChatAgentResult;
  readonly targetHashes: readonly string[];
}

export interface AgentJournalRecoveryResult {
  readonly journalId: string;
  readonly status: 'finalized' | 'cancelled' | 'manual_recovery';
  readonly taskId: string;
}

export interface AgentFileCommitter {
  commit(input: AgentFileCommitInput): Promise<AgentFileCommitResult>;
  recover(): Promise<AgentJournalRecoveryResult[]>;
}
```

对 operation 按 targetPath 稳定排序，逐项执行：

```ts
await writeFileAtomically(operation.targetPath, candidateContent, {
  encoding: 'utf8'
});
await verifyContentHash(operation.targetPath, operation.targetContentHash);
store.markJournalOperation({
  journalId,
  operationId: operation.operationId,
  targetContentHash: operation.targetContentHash,
  occurredAt: now()
});
```

所有 operation applied 后再次验证全体 target hash，先 mark applied，再根据 journal 中冻结的 `resultDraft` 生成 commit evidence 和 canonical `ChatAgentResult`。最后通过 `store.finalizeCommit()` 在一个 SQLite 事务中写入 journal finalized、Task result、Task completed、Checkpoint rendezvous 和必要 Outbox。任何异常都保留 journal 与 protected content，不在未知状态删除恢复材料。

- [x] **Step 6: Run commit, Store and atomic write tests**

Run:

```bash
pnpm exec vitest run test/electron/main/modules/chat/agents/file-commit.test.ts test/electron/main/modules/chat/runtime/atomic-write.test.ts
pnpm exec cross-env ELECTRON_RUN_AS_NODE=1 HOST=127.0.0.1 electron node_modules/vitest/vitest.mjs run test/electron/main/modules/chat/agents/store.test.ts
```

Expected: PASS，所有 crash point 都收敛为 finalized、cancelled 或 manual_recovery，不留下 Task completed + unfinished journal 的矛盾状态。

- [x] **Step 7: Commit Task 6**

```bash
git add electron/main/modules/chat/agents/file-commit.mts electron/main/modules/chat/agents/store.mts test/electron/main/modules/chat/agents/file-commit.test.ts test/electron/main/modules/chat/agents/store.test.ts test/electron/main/modules/chat/runtime/atomic-write.test.ts changelog/2026-07-27.md
git commit -m "feat(chat): 增加 Child 文件提交日志"
```

---

### Task 7: Orchestrate Write Preparation, Confirmation And Commit

**Files:**
- Modify: `types/chat-agent.d.ts`
- Modify: `electron/main/modules/chat/agents/executor.mts`
- Modify: `electron/main/modules/chat/agents/result.mts`
- Modify: `electron/main/modules/chat/agents/coordinator.mts`
- Modify: `electron/main/modules/chat/agents/service.mts`
- Modify: `electron/main/modules/chat/runtime/service.mts`
- Modify: `electron/main/index.mts`
- Test: `test/electron/main/modules/chat/agents/executor.test.ts`
- Test: `test/electron/main/modules/chat/agents/result.test.ts`
- Test: `test/electron/main/modules/chat/agents/coordinator.test.ts`
- Test: `test/electron/main/modules/chat/agents/service.test.ts`

**Interfaces:**
- Consumes: write tools、resource scheduler、persistent confirmation queue、file committer 和现有 checkpoint rendezvous。
- Produces: write Child 从 `queued(start)` 到 `completed/commit_failed/cancelled` 的完整状态机；Primary Runtime B 仍只在 finalized 结果后续接一次。

- [ ] **Step 1: Write failing executor outcome tests**

Executor 返回判别联合：

```ts
export type ChildExecutionOutcome =
  | { readonly kind: 'terminal'; readonly result: ChatAgentResult }
  | {
      readonly kind: 'changeset_prepared';
      readonly changeset: AgentChangesetSnapshot;
      readonly draft: AgentWriteResultDraft;
    };
```

测试 write Child 调用 staged tools 后：

- Provider stream 已结束。
- Runtime 从 registry 解绑。
- 普通 `chat_messages` 没有 Child transcript。
- executor 返回 changeset preparation，不伪造 completed result。
- no-op write 返回 completed/no changeset 终态。
- write result draft 的 criteria 在 commit 前只能是 unverified。

- [ ] **Step 2: Write failing Coordinator lifecycle tests**

断言精确顺序：

```ts
expect(callOrder).toEqual([
  'write-intent-acquired',
  'attempt-started',
  'runtime-started',
  'changeset-prepared',
  'write-intent-released',
  'confirmation-created',
  'confirmation-approved',
  'commit-queued',
  'exclusive-commit-acquired',
  'commit-validated',
  'journal-created',
  'journal-finalized',
  'result-recorded',
  'exclusive-commit-released'
]);
```

再验证：

- rejected/revoked confirmation 丢弃 overlay，Task cancelled，不申请 commit lease。
- waiting confirmation 时 `activeCount()` 不包含该 Task。
- Task/Turn cancel 先持久化取消意图，再 revoke confirmation。
- committing 收到 cancel 只设置 cancelRequested，不能 hard abort 原子替换。
- commit finalized 后迟到 cancel 形成 warning `cancel_arrived_too_late`，结果仍 completed。
- stale base 在 journal 创建前使 confirmation 失效并以 `stale_context/commit_validation` 失败；不复用旧 approval。
- required write Task 失败仍按现有 checkpoint required 策略汇合。
- write Attempt 沿用 Task 已有 budget reservation，等待确认和 commit 不创建第二笔 reservation；实际 model usage 只结算一次。

- [ ] **Step 3: Run executor and coordinator tests and verify RED**

Run:

```bash
pnpm exec vitest run test/electron/main/modules/chat/agents/executor.test.ts test/electron/main/modules/chat/agents/result.test.ts test/electron/main/modules/chat/agents/coordinator.test.ts test/electron/main/modules/chat/agents/service.test.ts
```

Expected: FAIL，因为 executor 只返回 read `ChatAgentResult`，Coordinator 尚无 write 生命周期。

- [ ] **Step 4: Generalize executor without sharing immediate write paths**

write 分支创建 `ChildWriteTools`，read 分支继续使用 `ChildReadTools`。模型循环结束后：

```ts
if (task.contractSnapshot.mode === 'write') {
  const changeset = await writeTools.prepare();
  if (!changeset) {
    return {
      kind: 'terminal',
      result: createNoChangeResult(task, attempt, usage)
    };
  }
  return {
    kind: 'changeset_prepared',
    changeset,
    draft: createWriteDraft(task, attempt, usage)
  };
}

return {
  kind: 'terminal',
  result: createReadResult(task, attempt, modelOutput, usage)
};
```

`finally` 只做 Runtime/temporary stream 清理；write overlay 的持有权随 changeset 转移给 Coordinator，不能在 confirmation 前删除候选引用。

- [ ] **Step 5: Implement the write state machine in Coordinator**

write start 使用 `write-intent`。收到 preparation 后必须：

1. `store.prepareChangeset()`。
2. release write-intent。
3. `confirmationQueue.request()`，Task 进入 `waiting_confirmation`。
4. approved 后 `queueCommit()` 使 Task 进入 `queued(commit)`，此时仍没有 journal。
5. 申请 `exclusive-commit`。
6. `fileCommitter.commit()` 先完成 commit validation，再以 `createCommitJournal()` 原子进入 `committing`。
7. journal created 后才允许执行外部 mutation。
8. 由 Store 同事务 finalize journal、Task result 和 checkpoint rendezvous。

Coordinator dependency 从 `authorizeReadTask(taskId)` 切换为 mode-aware `authorizeTask(taskId)`；切换完成后删除 Task 1 的兼容方法，避免 read/write 授权路径长期分叉。

任何分支都通过结构化错误和合法状态迁移收敛；Coordinator 不直接写 SQLite。commit result 的 changeset 必须精确复制：

```ts
changeset: {
  changesetId: snapshot.changesetId,
  baseRevision: snapshot.baseRevision,
  diffHash: snapshot.diffHash,
  operationSetHash: snapshot.operationSetHash,
  planHash: snapshot.planHash
}
```

artifact owner 固定为当前 task/agent/attempt，visibility 首版为 `primary`；只有后续任务卡片策略可提升为 `user`。

- [ ] **Step 6: Add a separate Main-owned write feature gate**

扩展 feature 配置：

```ts
export interface PrimaryDelegationFeatureConfig {
  readonly enabled: boolean;
  readonly pureReadChildEnabled: boolean;
  readonly controlledWriteChildEnabled: boolean;
  readonly maxParallelReadChildren: 3;
}
```

默认和生产环境解析均保持 `controlledWriteChildEnabled: false`。flag 为 false 时，write Contract 在 authorization 前稳定失败；Renderer 不能开启该 flag。测试环境必须显式注入 true 才能跑 write coordinator。

- [ ] **Step 7: Run focused orchestration tests**

Run:

```bash
pnpm exec vitest run test/electron/main/modules/chat/agents/executor.test.ts test/electron/main/modules/chat/agents/result.test.ts test/electron/main/modules/chat/agents/coordinator.test.ts test/electron/main/modules/chat/agents/service.test.ts
```

Expected: PASS，且 read Child 行为、一次 Primary rendezvous 和预算结算保持不变。

- [ ] **Step 8: Commit Task 7**

```bash
git add types/chat-agent.d.ts electron/main/modules/chat/agents/executor.mts electron/main/modules/chat/agents/result.mts electron/main/modules/chat/agents/coordinator.mts electron/main/modules/chat/agents/service.mts electron/main/modules/chat/runtime/service.mts electron/main/index.mts test/electron/main/modules/chat/agents/executor.test.ts test/electron/main/modules/chat/agents/result.test.ts test/electron/main/modules/chat/agents/coordinator.test.ts test/electron/main/modules/chat/agents/service.test.ts changelog/2026-07-27.md
git commit -m "feat(chat): 接通 Child 受控写入闭环"
```

---

### Task 8: Recover Journals And Prove The Controlled-Write Boundary

**Files:**
- Modify: `electron/main/modules/chat/agents/service.mts`
- Modify: `electron/main/modules/chat/agents/coordinator.mts`
- Modify: `electron/main/index.mts`
- Create: `test/electron/main/modules/chat/agents/write-runtime.test.ts`
- Modify: `test/electron/main/modules/chat/agents/startup-recovery.test.ts`
- Modify: `test/electron/main/modules/chat/agents/read-runtime.test.ts`
- Modify: `test/electron/main/modules/chat/agents/delegation-foundation.test.ts`
- Modify: `package.json`
- Modify: `changelog/2026-07-27.md`
- Modify: `docs/superpowers/plans/2026-07-27-child-agent-controlled-write.md`

**Interfaces:**
- Consumes: 所有前置 Task 的持久化事实、feature gate、recovery API 和 Primary checkpoint rendezvous。
- Produces: Main 启动恢复顺序、受控写入端到端证明和默认关闭的可发布实现。

- [ ] **Step 1: Write failing startup recovery tests**

启动恢复顺序必须是：

```ts
expect(recoveryOrder).toEqual([
  'load-unfinished-journals',
  'recover-file-journals',
  'revoke-orphan-confirmations',
  'discard-unjournaled-overlays',
  'interrupt-unrecoverable-write-attempts',
  'recover-read-delegations',
  'publish-snapshots'
]);
```

覆盖：

- unjournaled prepared changeset 丢弃并以 `runtime_interrupted` 收敛，不重新调用模型。
- pending confirmation 在 Main 重启后 revoked，不自动批准或提交。
- created/applying/applied journal 按 Task 6 协议恢复。
- manual recovery Task 保留 journal、protected content 和 `unfinished_journal_count`。
- finalized journal 不重复写目标文件。
- recovery 完成前 Coordinator 不接受新 write Task。

- [ ] **Step 2: Write controlled-write end-to-end tests**

`write-runtime.test.ts` 使用真实 SQLite、临时 workspace 和 fake Provider 验证：

```ts
expect(await fs.readFile(targetPath, 'utf8')).toBe('before');
await waitForConfirmation('confirmation-write-1');
expect(await fs.readFile(targetPath, 'utf8')).toBe('before');

await resolveConfirmation({
  confirmationId: 'confirmation-write-1',
  expectedVersion: 1,
  decision: 'approved'
});
await waitForTask('completed');

expect(await fs.readFile(targetPath, 'utf8')).toBe('after');
expect(database.prepare('SELECT COUNT(*) AS count FROM chat_messages WHERE agent_id != ?').get('primary')).toEqual({ count: 0 });
expect(checkpoint.status).toBe('ready_to_resume');
```

再覆盖：

- 两个不冲突 write Child 可准备 changeset，但 confirmation 独立存在。
- 两个冲突 write Child 的 write-intent 和 commit 串行。
- Renderer 重载恢复两个 confirmation，批准其中一个不丢失另一个。
- approval 后、commit lease 前改变基础文件，写入被拒绝且旧 diff 不提交。
- Turn cancel 撤销 pending confirmation 并有界等待 journal。
- write Child 无 `delegate_task`、immediate write、shell、settings、MCP、WebView 和 network capability。
- feature flag false 时 write Task 在 Attempt 前失败且工作区不变。

- [ ] **Step 3: Run recovery and end-to-end tests and verify RED**

Run:

```bash
pnpm exec cross-env ELECTRON_RUN_AS_NODE=1 HOST=127.0.0.1 electron node_modules/vitest/vitest.mjs run test/electron/main/modules/chat/agents/startup-recovery.test.ts test/electron/main/modules/chat/agents/write-runtime.test.ts
```

Expected: FAIL，直到启动恢复顺序和完整 write wiring 接通。

- [ ] **Step 4: Implement deterministic startup recovery**

Main 初始化时先创建 Store、ConfirmationQueue 和 FileCommitter，再执行：

```ts
await fileCommitter.recover();
confirmationQueue.recover();
await delegationService.recoverInterruptedWrites();
await delegationCoordinator.recover();
```

`recoverInterruptedWrites()` 只处理无 journal write Task 和 orphan confirmation；不能修改 finalized journal 或自动创建新 Attempt。恢复期间 `controlledWriteReady` 为 false，Coordinator 收到 write payload 时保持持久化 queued，不启动 Runtime。

- [ ] **Step 5: Add the database test target**

把 `test/electron/main/modules/chat/agents/write-runtime.test.ts` 与 startup recovery 加入 `test:database`，确保本地 `pnpm test` 不会跳过需要 Electron Node/better-sqlite3 的写入协议测试。

- [ ] **Step 6: Run complete verification**

Run:

```bash
pnpm exec vitest run test/ai/tools/tool-registry.test.ts test/electron/main/modules/chat/agents/contracts.test.ts test/electron/main/modules/chat/agents/plan-compiler.test.ts test/electron/main/modules/chat/agents/resource-scopes.test.ts test/electron/main/modules/chat/agents/scheduler.test.ts test/electron/main/modules/chat/agents/write-overlay.test.ts test/electron/main/modules/chat/agents/write-tools.test.ts test/electron/main/modules/chat/agents/confirmation-store.test.ts test/electron/main/modules/chat/agents/file-commit.test.ts test/electron/main/modules/chat/agents/executor.test.ts test/electron/main/modules/chat/agents/result.test.ts test/electron/main/modules/chat/agents/coordinator.test.ts test/electron/main/modules/chat/agents/service.test.ts test/electron/main/modules/chat/agents/ipc.test.ts test/stores/chat/confirmation-queue.test.ts test/hooks/use-agent-confirmation-events.test.ts test/hooks/use-agent-delegation-events.test.ts test/components/BChat/confirmation-controller.test.ts test/components/BChat/confirmation-sheet.component.test.ts
pnpm test:database
pnpm exec tsc --noEmit
pnpm electron:build-main
pnpm exec eslint src shared electron --ext .vue,.ts,.tsx,.js,.jsx,.mts
pnpm exec stylelint 'src/**/*.{vue,less,css}'
git diff --check
```

Expected: 全部退出码为 0。若全量 ESLint 暴露与本功能无关的既有问题，必须在 Task 8 记录精确文件和错误，但本计划新增/修改文件仍需单独通过 ESLint。

- [ ] **Step 7: Update plan status and changelog**

把本计划完成的 checkbox 更新为 `[x]`。`changelog/2026-07-27.md` 至少记录：

```markdown
## Added
- Child Agent 文件型受控写入：Task 私有 overlay、diff integrity、持久化确认队列和可恢复 commit journal。

## Changed
- Child Agent 调度门禁扩展为 resource-scoped shared-read、write-intent 与 exclusive-commit，等待确认时不持有 lease。
```

不得声称设置、shell、MCP、WebView 或外部 HTTP mutation 已支持。

- [ ] **Step 8: Commit Task 8**

```bash
git add electron/main/modules/chat/agents/service.mts electron/main/modules/chat/agents/coordinator.mts electron/main/index.mts test/electron/main/modules/chat/agents/write-runtime.test.ts test/electron/main/modules/chat/agents/startup-recovery.test.ts test/electron/main/modules/chat/agents/read-runtime.test.ts test/electron/main/modules/chat/agents/delegation-foundation.test.ts package.json changelog/2026-07-27.md docs/superpowers/plans/2026-07-27-child-agent-controlled-write.md
git commit -m "test(chat): 验证 Child 受控写入恢复边界"
```

---

## Series Handoff

本计划完成后，继续拆分独立 UI/operations 计划，不在受控写入提交中顺带实现：

1. 应用级 Agent Task Store 与轻量任务卡片。
2. 卡片按 Event sequence 恢复、忽略重复/旧事件。
3. artifact ownership/visibility 的 user-visible 提升流程。
4. 卡片中的单 Task cancel、confirmation 定位和 committing 提示。
5. redacted Event timeline、cost accounting 展示和 tombstone 投影。
6. 灰度配置与 `controlledWriteChildEnabled` 的安全启用流程。
