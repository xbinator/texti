/**
 * @file types.mts
 * @description Agent 委派 SQLite Store 的内部记录、输入和窄数据库边界类型。
 */
import type {
  AgentCheckpointStatus,
  AgentChangesetRecord,
  AgentChangesetSnapshot,
  AgentCommitIntentSnapshot,
  AgentCommitJournalRecord,
  AgentConfirmationRecord,
  AgentConfirmationRequestSnapshot,
  AgentDelegationCreatedPayload,
  AgentDelegationContinuationSnapshot,
  AgentDelegationReadyPayload,
  AgentExecutionPlanSnapshot,
  AgentRecordState,
  AgentTaskContractSnapshot,
  AgentTaskError,
  AgentTaskErrorPhase,
  AgentTaskPriority,
  AgentTaskQueuePhase,
  AgentTaskResult,
  AgentTaskStatus,
  ChatAgentEvent,
  ChatAgentEventSource,
  ChatAgentResult
} from 'types/chat-agent';

/** 同步 SQLite 能力边界，保证 assistant 消息和委派事实共享事务。 */
export interface AgentStoreDatabase {
  /**
   * 执行单条写 SQL。
   * @param sql - 参数化 SQL
   * @param params - 位置参数
   * @returns SQLite 写入统计
   */
  execute(sql: string, params?: readonly unknown[]): { changes: number; lastInsertRowid: number | bigint };
  /**
   * 执行查询 SQL。
   * @param sql - 参数化 SQL
   * @param params - 位置参数
   * @returns 行记录
   */
  select<T>(sql: string, params?: readonly unknown[]): T[];
  /**
   * 在共享 SQLite 连接中同步执行事务。
   * @param operation - 事务体
   * @returns 事务体返回值
   */
  transaction<T>(operation: () => T): T;
}

/** Store 层稳定协议错误。 */
export class AgentStoreProtocolError extends Error {
  /** 机器可判断的 Store 错误码。 */
  readonly code = 'protocol_error';

  /** 不依赖展示消息的稳定原因。 */
  readonly reason: string;

  /** Store 持久化读取和协议恢复阶段。 */
  readonly phase: AgentTaskErrorPhase;

  /** Store 协议错误的稳定类别。 */
  readonly category = 'protocol';

  /** 不可在未知状态上自动重试。 */
  readonly retryable = false;

  /** 经 allowlist 裁剪的机器细节。 */
  readonly details: NonNullable<AgentTaskError['details']>;

  /**
   * 创建协议错误。
   * @param reason - 稳定机器原因
   * @param message - 不参与控制流的可选展示说明
   * @param phase - 发生错误的协议阶段
   */
  constructor(reason: string, message = reason, phase: AgentTaskErrorPhase = 'recovery') {
    super(message);
    this.name = 'AgentStoreProtocolError';
    this.reason = reason;
    this.phase = phase;
    this.details = { reason };
  }
}

/** 持久化 Task 当前投影。 */
export interface AgentTaskRecord {
  /** Task 稳定身份。 */
  taskId: string;
  /** 所属会话。 */
  sessionId: string;
  /** 所属 Turn。 */
  turnId: string;
  /** 稳定 Child Actor。 */
  agentId: string;
  /** Primary Actor。 */
  parentAgentId: string;
  /** Turn 根 Runtime。 */
  rootRuntimeId: string;
  /** 唯一所属 Checkpoint。 */
  checkpointId: string;
  /** 原始 Provider tool-call ID。 */
  toolCallId: string;
  /** 不可变契约快照。 */
  contractSnapshot: AgentTaskContractSnapshot;
  /** 不可变契约 hash。 */
  contractSnapshotHash: string;
  /** 首次授权后冻结的执行计划。 */
  executionPlanSnapshot?: AgentExecutionPlanSnapshot;
  /** 执行计划 hash。 */
  executionPlanSnapshotHash?: string;
  /** 可变执行状态。 */
  status: AgentTaskStatus;
  /** queued 状态的当前阶段。 */
  queuePhase?: AgentTaskQueuePhase;
  /** 调度优先级。 */
  priority: AgentTaskPriority;
  /** 可选绝对截止时间。 */
  deadlineAt?: string;
  /** 当前 Attempt。 */
  currentAttemptId?: string;
  /** cooperative cancellation 请求时间。 */
  cancelRequestedAt?: string;
  /** 结构化终态结果。 */
  result?: AgentTaskResult;
  /** 终态结果完整性 hash。 */
  resultHash?: string;
  /** 当前结构化错误。 */
  error?: AgentTaskError;
  /** 逻辑记录状态。 */
  recordState: AgentRecordState;
  /** 未完成 commit journal 数量。 */
  unfinishedJournalCount: number;
  /** 不可变创建时间。 */
  createdAt: string;
  /** 投影更新时间。 */
  updatedAt: string;
}

/** Attempt 自身的执行生命周期状态。 */
export type AgentAttemptStatus = 'starting' | 'running' | 'completed' | 'failed' | 'cancelled' | 'deadline_exceeded' | 'interrupted';

/** 持久化 Attempt 当前投影。 */
export interface AgentAttemptRecord {
  /** Attempt 稳定身份。 */
  attemptId: string;
  /** Attempt 所属 Task。 */
  taskId: string;
  /** Task 内单调递增序号。 */
  attemptNumber: number;
  /** 创建 Attempt 的父 Runtime。 */
  parentRuntimeId: string;
  /** Attempt 绑定的冻结计划 hash。 */
  planHash: string;
  /** 首个 Child Runtime。 */
  initialRuntimeId: string;
  /** 当前可替换 Child Runtime。 */
  currentRuntimeId: string;
  /** Runtime 替换序号。 */
  runtimeSequence: number;
  /** Attempt 当前状态。 */
  status: AgentAttemptStatus;
  /** 可选启动时间。 */
  startedAt?: string;
  /** 可选终止时间。 */
  finishedAt?: string;
  /** 可选结构化错误。 */
  error?: AgentTaskError;
  /** 不可变创建时间。 */
  createdAt: string;
}

/** Task 与当前 Attempt 的同事务投影。 */
export interface AgentAttemptProjection {
  /** Attempt 迁移后的 Task。 */
  task: AgentTaskRecord;
  /** Attempt 迁移后的执行记录。 */
  attempt: AgentAttemptRecord;
}

/** Checkpoint 按 tool-call ID 保存的终态结果信封。 */
export interface AgentTerminalResultEnvelope {
  /** 真实 Attempt 结果或显式不含 Attempt 的授权前失败。 */
  result: AgentTaskResult;
  /** 结果完整性 hash。 */
  resultHash: string;
}

/** 持久化 Delegation Checkpoint 当前投影。 */
export interface AgentCheckpointRecord {
  /** Checkpoint 稳定身份。 */
  checkpointId: string;
  /** 所属会话。 */
  sessionId: string;
  /** 所属 Turn。 */
  turnId: string;
  /** Primary Actor。 */
  primaryAgentId: string;
  /** Turn 根 Runtime。 */
  rootRuntimeId: string;
  /** 挂起的 Runtime A。 */
  sourceRuntimeId: string;
  /** 含原始 tool-call 的 assistant 消息。 */
  assistantMessageId: string;
  /** 不可变续接快照。 */
  continuationSnapshot: AgentDelegationContinuationSnapshot;
  /** 续接快照完整性 hash。 */
  continuationSnapshotHash: string;
  /** 可变 Checkpoint 状态。 */
  status: AgentCheckpointStatus;
  /** CAS 版本。 */
  version: number;
  /** 按原 tool-call ID 汇合的结果。 */
  terminalResults: Record<string, AgentTerminalResultEnvelope>;
  /** CAS claim 后唯一 Runtime B。 */
  resumeRuntimeId?: string;
  /** 中断或失败错误。 */
  error?: AgentTaskError;
  /** 逻辑记录状态。 */
  recordState: AgentRecordState;
  /** 不可变创建时间。 */
  createdAt: string;
  /** 投影更新时间。 */
  updatedAt: string;
}

/** 持久化 Outbox 记录的共享可变交付字段。 */
interface AgentOutboxRecordBase {
  /** Outbox 稳定身份。 */
  outboxId: string;
  /** 业务幂等键。 */
  dedupeKey: string;
  /** payload 完整性 hash。 */
  payloadHash: string;
  /** payload Schema 版本。 */
  schemaVersion: number;
  /** 可变交付状态。 */
  deliveryStatus: 'pending' | 'delivered';
  /** 交付尝试次数。 */
  attemptCount: number;
  /** 成功交付时间。 */
  deliveredAt?: string;
  /** 不可变创建时间。 */
  createdAt: string;
  /** 投影更新时间。 */
  updatedAt: string;
}

/** Runtime A 挂起后交付的 delegation.created Outbox。 */
export interface AgentDelegationCreatedOutboxRecord extends AgentOutboxRecordBase {
  /** 交付事件名。 */
  eventType: 'delegation.created';
  /** 不可变创建 payload。 */
  payload: AgentDelegationCreatedPayload;
}

/** 全部 Child 结果汇合后交付的 delegation.ready Outbox。 */
export interface AgentDelegationReadyOutboxRecord extends AgentOutboxRecordBase {
  /** 交付事件名。 */
  eventType: 'delegation.ready';
  /** 不可变就绪 payload。 */
  payload: AgentDelegationReadyPayload;
}

/** 由 eventType 判别 payload 的持久化 Outbox 记录。 */
export type AgentOutboxRecord = AgentDelegationCreatedOutboxRecord | AgentDelegationReadyOutboxRecord;

/** 原子 prepare 中的单个 Task 事实。 */
export interface PrepareAgentTaskInput {
  /** Task 稳定身份。 */
  taskId: string;
  /** 所属会话。 */
  sessionId: string;
  /** 所属 Turn。 */
  turnId: string;
  /** 稳定 Child Actor。 */
  agentId: string;
  /** Primary Actor。 */
  parentAgentId: string;
  /** Turn 根 Runtime。 */
  rootRuntimeId: string;
  /** 唯一所属 Checkpoint。 */
  checkpointId: string;
  /** 原始 Provider tool-call ID。 */
  toolCallId: string;
  /** 已规范化不可变契约。 */
  contractSnapshot: AgentTaskContractSnapshot;
  /** 契约完整性 hash。 */
  contractSnapshotHash: string;
  /** 初始调度优先级。 */
  priority: AgentTaskPriority;
  /** 可选绝对截止时间。 */
  deadlineAt?: string;
}

/** 原子 prepare 中的 Checkpoint 事实。 */
export interface PrepareAgentCheckpointInput {
  /** Checkpoint 稳定身份。 */
  checkpointId: string;
  /** 所属会话。 */
  sessionId: string;
  /** 所属 Turn。 */
  turnId: string;
  /** Primary Actor。 */
  primaryAgentId: string;
  /** Turn 根 Runtime。 */
  rootRuntimeId: string;
  /** 挂起 Runtime A。 */
  sourceRuntimeId: string;
  /** 原 assistant 消息。 */
  assistantMessageId: string;
  /** 不可变续接快照。 */
  continuationSnapshot: AgentDelegationContinuationSnapshot;
  /** 续接快照完整性 hash。 */
  continuationSnapshotHash: string;
}

/** 原子 prepare 中的不可变 Outbox 事实。 */
export interface PrepareAgentOutboxInput {
  /** Outbox 稳定身份。 */
  outboxId: string;
  /** 业务幂等键。 */
  dedupeKey: string;
  /** 交付事件名。 */
  eventType: 'delegation.created';
  /** allowlist payload。 */
  payload: AgentDelegationCreatedPayload;
  /** payload 完整性 hash。 */
  payloadHash: string;
  /** payload Schema 版本。 */
  schemaVersion: number;
}

/** 一次原子委派写入的完整输入。 */
export interface PrepareDelegationInput {
  /** 按原 tool-call 顺序排列的 Tasks。 */
  tasks: PrepareAgentTaskInput[];
  /** 汇合这些 Tasks 的 Checkpoint。 */
  checkpoint: PrepareAgentCheckpointInput;
  /** Renderer 投影使用的 Outbox。 */
  outbox: PrepareAgentOutboxInput;
  /** 所有初始事实的 ISO-8601 时间。 */
  occurredAt: string;
}

/** 单次 Task 状态迁移输入。 */
export interface TransitionAgentTaskInput {
  /** 目标 Task。 */
  taskId: string;
  /** 目标执行状态。 */
  toStatus: AgentTaskStatus;
  /** 进入 queued 时的目标阶段。 */
  queuePhase?: AgentTaskQueuePhase;
  /** planning → authorized 的完整计划。 */
  executionPlanSnapshot?: AgentExecutionPlanSnapshot;
  /** 计划完整性 hash。 */
  executionPlanSnapshotHash?: string;
  /** Event 时间。 */
  occurredAt: string;
  /** 可信迁移来源。 */
  source: ChatAgentEventSource;
}

/** 原子编译后授权一个 Task 的输入。 */
export interface AuthorizeAgentTaskInput {
  /** created 状态的目标 Task。 */
  taskId: string;
  /** 经 Coordinator 编译并校验的不可变计划。 */
  executionPlanSnapshot: AgentExecutionPlanSnapshot;
  /** 计划完整性 hash。 */
  executionPlanSnapshotHash: string;
  /** 三段迁移共享的 Event 时间。 */
  occurredAt: string;
  /** 可信授权来源。 */
  source: Extract<ChatAgentEventSource, 'coordinator' | 'system'>;
}

/** 原子创建一个 Child Attempt 的输入。 */
export interface BeginAgentAttemptInput {
  /** 已冻结计划并处于 queued(start) 的 Task。 */
  taskId: string;
  /** 新 Attempt 稳定身份。 */
  attemptId: string;
  /** 创建 Attempt 的 Primary Runtime。 */
  parentRuntimeId: string;
  /** 首个 Child Runtime 身份。 */
  runtimeId: string;
  /** Attempt 创建时间。 */
  occurredAt: string;
}

/** 确认 Child Runtime 已启动的输入。 */
export interface MarkAgentAttemptInput {
  /** Attempt 所属 Task。 */
  taskId: string;
  /** 已创建的 Attempt。 */
  attemptId: string;
  /** 已由 Actor registry 绑定的 Runtime。 */
  runtimeId: string;
  /** Runtime 启动时间。 */
  occurredAt: string;
}

/** 写入单个 Child 终态结果的输入。 */
export interface RecordTaskResultInput {
  /** 结果所属 Task。 */
  taskId: string;
  /** 汇合结果的 Checkpoint。 */
  checkpointId: string;
  /** 原始 Provider tool-call ID。 */
  toolCallId: string;
  /** 结构化终态结果。 */
  result: ChatAgentResult;
  /** 结果完整性 hash。 */
  resultHash: string;
  /** 结果发生时间。 */
  occurredAt: string;
}

/** 原子写入授权前失败结果的输入。 */
export interface RecordPreAttemptFailureInput {
  /** 失败所属 Task。 */
  taskId: string;
  /** 汇合结果的 Checkpoint。 */
  checkpointId: string;
  /** 原始 Provider tool-call ID。 */
  toolCallId: string;
  /** 不可重试的计划或资源错误。 */
  error: AgentTaskError;
  /** 失败发生时间。 */
  occurredAt: string;
}

/** Checkpoint 单次 resume claim 输入。 */
export interface ClaimCheckpointInput {
  /** 目标 Checkpoint。 */
  checkpointId: string;
  /** 调用方读取到的 CAS 版本。 */
  expectedVersion: number;
  /** 计划创建的唯一 Runtime B。 */
  resumeRuntimeId: string;
  /** claim 时间。 */
  occurredAt: string;
}

/** Checkpoint Runtime B 结束输入。 */
export interface FinalizeCheckpointInput {
  /** 目标 Checkpoint。 */
  checkpointId: string;
  /** Runtime B 启动后读取到的 CAS 版本。 */
  expectedVersion: number;
  /** 实际完成的 Runtime B。 */
  resumeRuntimeId: string;
  /** Runtime B 终态。 */
  outcome: 'completed' | 'failed';
  /** 完成时间。 */
  occurredAt: string;
  /** 失败时的结构化错误。 */
  error?: AgentTaskError;
}

/** Checkpoint cooperative cancellation 输入。 */
export interface CancelCheckpointInput {
  /** 目标 Checkpoint。 */
  checkpointId: string;
  /** 用户可读取消原因。 */
  reason: string;
  /** 请求时间。 */
  occurredAt: string;
}

/** Task 逻辑删除输入。 */
export interface TombstoneAgentTaskInput {
  /** 目标 Task。 */
  taskId: string;
  /** 审计删除原因。 */
  reason: string;
  /** 删除时间。 */
  occurredAt: string;
  /** 删除请求来源。 */
  source: Extract<ChatAgentEventSource, 'user' | 'system'>;
}

/** Outbox 成功交付输入。 */
export interface DeliverAgentOutboxInput {
  /** 目标 Outbox。 */
  outboxId: string;
  /** 成功交付时间。 */
  deliveredAt: string;
}

/** 定向中断单个已提交 Checkpoint 的补偿输入。 */
export interface InterruptAgentCheckpointInput {
  /** 唯一目标 Checkpoint。 */
  checkpointId: string;
  /** 已通过 allowlist 的恢复错误。 */
  error: AgentTaskError;
  /** 补偿发生时间。 */
  occurredAt: string;
}

/** 原子持久化一个 write Attempt changeset 的输入。 */
export interface PrepareAgentChangesetInput {
  /** 完整不可变 changeset。 */
  readonly snapshot: AgentChangesetSnapshot;
  /** changeset snapshot hash。 */
  readonly snapshotHash: string;
  /** 写入时间。 */
  readonly occurredAt: string;
}

/** 原子创建持久化确认请求的输入。 */
export interface CreateAgentConfirmationInput {
  /** 完整不可变确认请求。 */
  readonly request: AgentConfirmationRequestSnapshot;
  /** request snapshot hash。 */
  readonly requestHash: string;
  /** 写入时间。 */
  readonly occurredAt: string;
}

/** confirmation CAS 决议输入。 */
export interface ResolveAgentConfirmationInput {
  /** 目标 confirmation。 */
  readonly confirmationId: string;
  /** 调用方观察到的版本。 */
  readonly expectedVersion: number;
  /** 用户决定。 */
  readonly decision: 'approved' | 'rejected';
  /** 决议时间。 */
  readonly occurredAt: string;
}

/** 把已批准 Task 放入 commit 队列的输入。 */
export interface QueueAgentCommitInput {
  /** 目标 Task。 */
  readonly taskId: string;
  /** 已批准 confirmation。 */
  readonly confirmationId: string;
  /** 已批准 confirmation 版本。 */
  readonly confirmationVersion: number;
  /** 排队时间。 */
  readonly occurredAt: string;
}

/** 原子创建 commit journal 的输入。 */
export interface CreateAgentCommitJournalInput {
  /** journal 稳定身份。 */
  readonly journalId: string;
  /** 唯一 changeset。 */
  readonly changesetId: string;
  /** 已批准 confirmation。 */
  readonly confirmationId: string;
  /** 已批准 confirmation 版本。 */
  readonly confirmationVersion: number;
  /** 完整不可变 commit intent。 */
  readonly intent: AgentCommitIntentSnapshot;
  /** commit intent hash。 */
  readonly intentHash: string;
  /** journal 创建时间。 */
  readonly occurredAt: string;
}

/** commit journal 状态更新的共享输入。 */
export interface MarkAgentJournalInput {
  /** 目标 journal。 */
  readonly journalId: string;
  /** 状态更新时间。 */
  readonly occurredAt: string;
}

/** 单个外部操作完成输入。 */
export interface MarkAgentJournalOperationInput extends MarkAgentJournalInput {
  /** 已应用操作身份。 */
  readonly operationId: string;
  /** 应用后的目标内容 hash。 */
  readonly targetContentHash: string;
}

/** commit journal 成功终态输入。 */
export interface FinalizeAgentCommitInput extends MarkAgentJournalInput {
  /** 最终结构化 Task 结果。 */
  readonly result: ChatAgentResult;
  /** 最终结果 hash。 */
  readonly resultHash: string;
  /** 全部外部修改的最终完整性 hash。 */
  readonly finalHash: string;
}

/** commit journal 人工恢复终态输入。 */
export interface MarkAgentJournalFailureInput extends MarkAgentJournalInput {
  /** 结构化恢复错误。 */
  readonly error: AgentTaskError;
}

/** Renderer 重载恢复所需的持久化投影。 */
export interface AgentDelegationRecoverySnapshot {
  /** 非终态 Checkpoint。 */
  checkpoint: AgentCheckpointRecord;
  /** Checkpoint 下未 tombstone 的 Tasks。 */
  tasks: AgentTaskRecord[];
  /** Checkpoint 当前 Event cursor。 */
  eventSequence: number;
}

/** Agent Store 对外同步能力。 */
export interface AgentDelegationStore {
  /**
   * 原子写入 assistant 消息、Tasks、Checkpoint、Events 和 Outbox。
   * @param input - 不可变委派事实
   * @param persistAssistant - 使用同一 SQLite 连接写入消息尾部的同步回调
   */
  prepareDelegation(input: PrepareDelegationInput, persistAssistant: () => undefined): void;
  /**
   * 校验并投影一次 Task 状态迁移。
   * @param input - 状态迁移输入
   * @returns 更新后的 Task
   */
  transitionTask(input: TransitionAgentTaskInput): AgentTaskRecord;
  /**
   * 在一个事务内写入 planning、authorized 和 queued(start) 事实。
   * @param input - 已编译且未落库的只读计划
   * @returns 已进入 queued(start) 的 Task
   */
  authorizeTask(input: AuthorizeAgentTaskInput): AgentTaskRecord;
  /**
   * 原子创建 Attempt、绑定 Task 并进入 starting。
   * @param input - 冻结 Task 与预注册 Runtime 身份
   * @returns 同事务更新后的 Task 与 Attempt
   */
  beginAttempt(input: BeginAgentAttemptInput): AgentAttemptProjection;
  /**
   * 原子确认 Attempt Runtime 已启动并进入 running。
   * @param input - Task、Attempt 与 Runtime 身份
   * @returns 同事务更新后的 Task 与 Attempt
   */
  markAttemptRunning(input: MarkAgentAttemptInput): AgentAttemptProjection;
  /**
   * 原子持久化 running write Attempt 的不可变 changeset。
   * @param input - changeset snapshot 与 hash
   * @returns 持久化 changeset 投影
   */
  prepareChangeset(input: PrepareAgentChangesetInput): AgentChangesetRecord;
  /**
   * 创建确认请求并原子进入 waiting_confirmation。
   * @param input - confirmation request 与 hash
   * @returns pending confirmation
   */
  createConfirmation(input: CreateAgentConfirmationInput): AgentConfirmationRecord;
  /**
   * 使用 version CAS 决议 confirmation。
   * @param input - 预期版本与决定
   * @returns 决议后的 confirmation
   */
  resolveConfirmation(input: ResolveAgentConfirmationInput): AgentConfirmationRecord;
  /**
   * 撤销仍 pending 的 confirmation。
   * @param confirmationId - 目标确认
   * @param reason - 稳定撤销原因
   * @param occurredAt - 撤销时间
   * @returns revoked confirmation
   */
  revokeConfirmation(confirmationId: string, reason: string, occurredAt: string): AgentConfirmationRecord;
  /**
   * 把已批准 Task 放入 commit 队列。
   * @param input - confirmation CAS 事实
   * @returns queued(commit) Task
   */
  queueCommit(input: QueueAgentCommitInput): AgentTaskRecord;
  /**
   * 冻结 commit intent 并进入 committing。
   * 调用前置条件是 Coordinator 已持有 scheduler 签发的 exclusive-commit lease；
   * Store 只接受 Main 内部调用，并重新验证全部持久化事实，不把 Renderer 输入当作授权。
   * @param input - journal 身份和完整意图
   * @returns created journal
   */
  createCommitJournal(input: CreateAgentCommitJournalInput): AgentCommitJournalRecord;
  /**
   * 标记 journal 开始外部应用。
   * @param input - journal 身份与时间
   * @returns applying journal
   */
  markJournalApplying(input: MarkAgentJournalInput): AgentCommitJournalRecord;
  /**
   * 幂等记录单个已应用操作。
   * @param input - 操作身份和目标 hash
   * @returns 更新进度后的 journal
   */
  markJournalOperation(input: MarkAgentJournalOperationInput): AgentCommitJournalRecord;
  /**
   * 标记全部操作已应用。
   * @param input - journal 身份与时间
   * @returns applied journal
   */
  markJournalApplied(input: MarkAgentJournalInput): AgentCommitJournalRecord;
  /**
   * 原子完成 journal、Task、Attempt 和 Checkpoint 汇合。
   * @param input - 最终结果和完整性 hash
   * @returns 汇合后的 Checkpoint
   */
  finalizeCommit(input: FinalizeAgentCommitInput): AgentCheckpointRecord;
  /**
   * 把未知外部状态收敛到 manual_recovery。
   * @param input - journal 与结构化错误
   * @returns 当前 Checkpoint
   */
  markManualRecovery(input: MarkAgentJournalFailureInput): AgentCheckpointRecord;
  /** @returns 全部 pending confirmation。 */
  listPendingConfirmations(): AgentConfirmationRecord[];
  /** @returns 全部未 finalized/cancelled journal。 */
  listUnfinishedJournals(): AgentCommitJournalRecord[];
  /**
   * 幂等写入单个终态结果并推进 Checkpoint。
   * @param input - Child 结果
   * @returns 更新后的 Checkpoint
   */
  recordTaskResult(input: RecordTaskResultInput): AgentCheckpointRecord;
  /**
   * 不创建 Attempt，原子写入一个授权前终态失败并推进 Checkpoint。
   * @param input - Task、tool-call 与结构化授权错误
   * @returns 更新后的 Checkpoint
   */
  recordPreAttemptFailure(input: RecordPreAttemptFailureInput): AgentCheckpointRecord;
  /**
   * 使用 CAS claim 唯一 Runtime B。
   * @param input - 预期版本和 Runtime ID
   * @returns claim 成功后的 Checkpoint，CAS 失败返回 null
   */
  claimResume(input: ClaimCheckpointInput): AgentCheckpointRecord | null;
  /**
   * 结束已 claim 的 Primary Runtime B。
   * @param input - 续接终态
   * @returns 终态 Checkpoint
   */
  finalizeResume(input: FinalizeCheckpointInput): AgentCheckpointRecord;
  /**
   * 先持久化 cooperative cancellation，再在安全时收敛终态。
   * @param input - 取消请求
   * @returns 当前 Checkpoint
   */
  cancelCheckpoint(input: CancelCheckpointInput): AgentCheckpointRecord;
  /**
   * 在所有引用稳定后逻辑删除终态 Task。
   * @param input - tombstone 请求
   * @returns 保留不可变事实的 Task
   */
  tombstoneTask(input: TombstoneAgentTaskInput): AgentTaskRecord;
  /**
   * 读取单个 Task。
   * @param taskId - Task ID
   * @returns Task，不存在时为 null
   */
  getTask(taskId: string): AgentTaskRecord | null;
  /**
   * 读取单个 Attempt。
   * @param attemptId - Attempt ID
   * @returns Attempt，不存在时为 null
   */
  getAttempt(attemptId: string): AgentAttemptRecord | null;
  /**
   * 按序读取 Task 的全部 Attempt 历史。
   * @param taskId - Task ID
   * @returns attemptNumber 升序 Attempts
   */
  listTaskAttempts(taskId: string): AgentAttemptRecord[];
  /**
   * 读取单个 Checkpoint。
   * @param checkpointId - Checkpoint ID
   * @returns Checkpoint，不存在时为 null
   */
  getCheckpoint(checkpointId: string): AgentCheckpointRecord | null;
  /**
   * 读取聚合的有序 Event 历史。
   * @param aggregateKind - 聚合种类
   * @param aggregateId - 聚合 ID
   * @returns sequence 升序 Events
   */
  listEvents(aggregateKind: 'task' | 'checkpoint', aggregateId: string): ChatAgentEvent[];
  /**
   * 按稳定去重键读取 Outbox，包括已交付记录。
   * @param dedupeKey - Outbox 去重键
   * @returns Outbox，不存在时为 null
   */
  getOutbox(dedupeKey: string): AgentOutboxRecord | null;
  /** @returns 所有待交付 Outbox 记录。 */
  listPendingOutbox(): AgentOutboxRecord[];
  /**
   * 标记一次 Outbox 成功交付。
   * @param input - 交付结果
   * @returns 更新后的 Outbox
   */
  markOutboxDelivered(input: DeliverAgentOutboxInput): AgentOutboxRecord;
  /**
   * 定向中断一个无法取得 continuation fence 的已提交 Checkpoint。
   * @param input - Checkpoint、恢复错误与时间
   * @returns 中断后的 Checkpoint
   */
  interruptCheckpoint(input: InterruptAgentCheckpointInput): AgentCheckpointRecord;
  /**
   * 把主进程重启时的非终态 Checkpoint 收敛为 interrupted。
   * @param reason - 恢复错误
   * @returns 被中断的 Checkpoint 数
   */
  interruptActive(reason: AgentTaskError): number;
  /** @returns Renderer 重载需要的所有非终态恢复快照。 */
  listActive(): AgentDelegationRecoverySnapshot[];
}
