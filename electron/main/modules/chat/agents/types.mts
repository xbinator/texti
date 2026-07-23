/**
 * @file types.mts
 * @description Agent 委派 SQLite Store 的内部记录、输入和窄数据库边界类型。
 */
import type {
  AgentCheckpointStatus,
  AgentDelegationCreatedPayload,
  AgentDelegationContinuationSnapshot,
  AgentExecutionPlanSnapshot,
  AgentRecordState,
  AgentTaskContractSnapshot,
  AgentTaskError,
  AgentTaskErrorPhase,
  AgentTaskPriority,
  AgentTaskQueuePhase,
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
  result?: ChatAgentResult;
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

/** Checkpoint 按 tool-call ID 保存的终态结果信封。 */
export interface AgentTerminalResultEnvelope {
  /** 结构化 Child 结果。 */
  result: ChatAgentResult;
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

/** 持久化 Outbox 记录。 */
export interface AgentOutboxRecord {
  /** Outbox 稳定身份。 */
  outboxId: string;
  /** 业务幂等键。 */
  dedupeKey: string;
  /** 交付事件名。 */
  eventType: 'delegation.created';
  /** 不可变 allowlist payload。 */
  payload: AgentDelegationCreatedPayload;
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
   * 幂等写入单个终态结果并推进 Checkpoint。
   * @param input - Child 结果
   * @returns 更新后的 Checkpoint
   */
  recordTaskResult(input: RecordTaskResultInput): AgentCheckpointRecord;
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
