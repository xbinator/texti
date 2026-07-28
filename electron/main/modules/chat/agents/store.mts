/**
 * @file store.mts
 * @description 持久化 Child Agent 委派事实的同步 SQLite Store。
 */
import type {
  AgentCheckpointStatus,
  AgentChangesetRecord,
  AgentCommitIntentSnapshot,
  AgentCommitJournalRecord,
  AgentCommitJournalStatus,
  AgentConfirmationRecord,
  AgentConfirmationStatus,
  AgentDelegationContinuationSnapshot,
  AgentExecutionPlanSnapshot,
  AgentFileOperationSnapshot,
  AgentPreAttemptFailureResult,
  AgentRecordState,
  AgentTaskPriority,
  AgentTaskQueuePhase,
  AgentTaskError,
  AgentTaskResult,
  AgentTaskStatus,
  ChatAgentEvent,
  ChatAgentEventPayloadMap,
  ChatAgentEventSource,
  ChatAgentEventType,
  ChatAgentResult
} from 'types/chat-agent';
import {
  hashAgentPayload,
  normalizeAgentIdentity,
  validateAgentTaskError,
  validateChatAgentEvent,
  validateChatAgentResult,
  validateChangesetSnapshot,
  validateCommitIntentSnapshot,
  validateConfirmationRequestSnapshot,
  validateContinuationSnapshot,
  validateExecutionPlanSnapshot,
  validateFoundationContract,
  validateFoundationOutbox,
  validatePreAttemptFailure
} from './contracts.mjs';
import { canTransitionCheckpoint, canTransitionTask, isCheckpointTerminal, isTaskTerminal } from './state.mjs';
import {
  AgentStoreProtocolError,
  type AgentAttemptProjection,
  type AgentAttemptRecord,
  type AgentAttemptStatus,
  type AgentCheckpointRecord,
  type AgentDelegationStore,
  type AgentDelegationRecoverySnapshot,
  type AgentOutboxRecord,
  type AgentStoreDatabase,
  type AgentTaskListPage,
  type AgentTaskProjectionRecord,
  type AgentTaskRecord,
  type AgentTerminalResultEnvelope,
  type AuthorizeAgentTaskInput,
  type BeginAgentAttemptInput,
  type CancelAgentCommitJournalInput,
  type CancelCheckpointInput,
  type ClaimCheckpointInput,
  type CreateAgentCommitJournalInput,
  type CreateAgentConfirmationInput,
  type DeliverAgentOutboxInput,
  type FinalizeAgentCommitInput,
  type FinalizeCheckpointInput,
  type InterruptAgentCheckpointInput,
  type ListAgentTasksInput,
  type MarkAgentAttemptInput,
  type MarkAgentJournalFailureInput,
  type MarkAgentJournalInput,
  type MarkAgentJournalOperationInput,
  type PrepareAgentChangesetInput,
  type PrepareDelegationInput,
  type QueueAgentCommitInput,
  type RecordPreAttemptFailureInput,
  type RecordTaskResultInput,
  type ResolveAgentConfirmationInput,
  type TombstoneAgentTaskInput,
  type TransitionAgentTaskInput
} from './types.mjs';

export type { AgentDelegationStore, AgentStoreDatabase, PrepareDelegationInput } from './types.mjs';

/** SQLite Task 查询行。 */
interface TaskRow {
  task_id: unknown;
  session_id: unknown;
  turn_id: unknown;
  agent_id: unknown;
  parent_agent_id: unknown;
  root_runtime_id: unknown;
  checkpoint_id: unknown;
  tool_call_id: unknown;
  contract_snapshot_json: unknown;
  contract_snapshot_hash: unknown;
  execution_plan_snapshot_json: unknown;
  execution_plan_snapshot_hash: unknown;
  status: unknown;
  queue_phase: unknown;
  priority: unknown;
  deadline_at: unknown;
  current_attempt_id: unknown;
  cancel_requested_at: unknown;
  result_json: unknown;
  result_hash: unknown;
  error_json: unknown;
  record_state: unknown;
  unfinished_journal_count: unknown;
  created_at: unknown;
  updated_at: unknown;
}

/** SQLite Checkpoint 查询行。 */
interface CheckpointRow {
  checkpoint_id: unknown;
  session_id: unknown;
  turn_id: unknown;
  primary_agent_id: unknown;
  root_runtime_id: unknown;
  source_runtime_id: unknown;
  assistant_message_id: unknown;
  continuation_snapshot_json: unknown;
  continuation_snapshot_hash: unknown;
  status: unknown;
  version: unknown;
  terminal_results_json: unknown;
  resume_runtime_id: unknown;
  error_json: unknown;
  record_state: unknown;
  created_at: unknown;
  updated_at: unknown;
}

/** SQLite Event 查询行。 */
interface EventRow {
  event_id: unknown;
  aggregate_kind: unknown;
  aggregate_id: unknown;
  task_id: unknown;
  checkpoint_id: unknown;
  sequence: unknown;
  attempt_id: unknown;
  runtime_id: unknown;
  event_type: unknown;
  occurred_at: unknown;
  source: unknown;
  schema_version: unknown;
  payload_json: unknown;
}

/** SQLite Outbox 查询行。 */
interface OutboxRow {
  outbox_id: unknown;
  dedupe_key: unknown;
  event_type: unknown;
  payload_json: unknown;
  payload_hash: unknown;
  schema_version: unknown;
  delivery_status: unknown;
  attempt_count: unknown;
  delivered_at: unknown;
  created_at: unknown;
  updated_at: unknown;
}

/** SQLite Attempt 查询行。 */
interface AttemptRow {
  attempt_id: unknown;
  task_id: unknown;
  attempt_number: unknown;
  parent_runtime_id: unknown;
  plan_hash: unknown;
  initial_runtime_id: unknown;
  current_runtime_id: unknown;
  runtime_sequence: unknown;
  status: unknown;
  started_at: unknown;
  finished_at: unknown;
  error_json: unknown;
  created_at: unknown;
}

/** SQLite Changeset 查询行。 */
interface ChangesetRow {
  changeset_id: unknown;
  task_id: unknown;
  attempt_id: unknown;
  agent_id: unknown;
  runtime_id: unknown;
  plan_hash: unknown;
  snapshot_json: unknown;
  snapshot_hash: unknown;
  base_revision: unknown;
  diff_hash: unknown;
  operation_set_hash: unknown;
  status: unknown;
  confirmation_id: unknown;
  record_state: unknown;
  created_at: unknown;
  updated_at: unknown;
}

/** SQLite Confirmation 查询行。 */
interface ConfirmationRow {
  confirmation_id: unknown;
  changeset_id: unknown;
  request_json: unknown;
  request_hash: unknown;
  status: unknown;
  version: unknown;
  decision_json: unknown;
  resolved_at: unknown;
  created_at: unknown;
  updated_at: unknown;
}

/** SQLite Commit Journal 查询行。 */
interface CommitJournalRow {
  journal_id: unknown;
  task_id: unknown;
  attempt_id: unknown;
  changeset_id: unknown;
  confirmation_id: unknown;
  confirmation_version: unknown;
  plan_hash: unknown;
  intent_json: unknown;
  intent_hash: unknown;
  status: unknown;
  operation_progress_json: unknown;
  error_json: unknown;
  created_at: unknown;
  updated_at: unknown;
  finalized_at: unknown;
}

/** journal 内单个已应用操作的恢复进度。 */
interface JournalOperationProgress {
  /** 操作身份。 */
  operationId: string;
  /** 应用后内容 hash。 */
  targetContentHash: string;
}

/**
 * 投影不包含可替换 protected reference 的 commit operation 事实。
 * @param operation - changeset 或 journal 中的文件操作
 * @returns 与用户批准内容绑定的不可变操作事实
 */
function projectCommitOperation(operation: AgentFileOperationSnapshot): Omit<AgentFileOperationSnapshot, 'candidateReference' | 'rollbackReference'> {
  return {
    operationId: operation.operationId,
    kind: operation.kind,
    displayPath: operation.displayPath,
    targetPath: operation.targetPath,
    resourceScope: operation.resourceScope,
    baseRevision: operation.baseRevision,
    baseContentHash: operation.baseContentHash,
    targetContentHash: operation.targetContentHash,
    byteLength: operation.byteLength
  };
}

/**
 * 判断 journal 复制后的 protected references 是否仍精确绑定 changeset 操作事实。
 * @param intentOperations - journal 私有引用操作
 * @param changesetOperations - overlay 引用操作
 * @returns 除 protected references 外是否完全一致
 */
function matchCommitOperations(intentOperations: readonly AgentFileOperationSnapshot[], changesetOperations: readonly AgentFileOperationSnapshot[]): boolean {
  return hashAgentPayload(intentOperations.map(projectCommitOperation)) === hashAgentPayload(changesetOperations.map(projectCommitOperation));
}

/** 经 Checkpoint、Task 和终态结果交叉校验的委派聚合。 */
interface ValidatedAgentAggregate {
  /** 聚合根 Checkpoint。 */
  checkpoint: AgentCheckpointRecord;
  /** 与冻结 tool-call 一一对应的 Tasks。 */
  tasks: AgentTaskRecord[];
}

/** Event 可选 Attempt 与 Runtime 谱系链接。 */
interface AgentEventLinks {
  /** Event 关联的 Attempt。 */
  attemptId?: string;
  /** Event 关联的 Runtime。 */
  runtimeId?: string;
}

/** 单个 Attempt 在 Task 历史中的 Runtime 生命周期 Event。 */
interface AttemptRuntimeEvents {
  /** Runtime 启动准备 Event。 */
  starting?: ChatAgentEvent;
  /** Runtime 启动确认 Event。 */
  started?: ChatAgentEvent;
}

/** Task 状态 allowlist。 */
const TASK_STATUSES = new Set<AgentTaskStatus>([
  'created',
  'planning',
  'authorized',
  'queued',
  'starting',
  'running',
  'waiting_confirmation',
  'committing',
  'cancelling',
  'completed',
  'failed',
  'cancelled',
  'deadline_exceeded',
  'commit_failed'
]);

/** Attempt 持久化状态 allowlist。 */
const ATTEMPT_STATUSES = new Set<AgentAttemptStatus>(['starting', 'running', 'completed', 'failed', 'cancelled', 'deadline_exceeded', 'interrupted']);

/** Attempt 终态 allowlist。 */
const ATTEMPT_TERMINAL_STATUSES = new Set<AgentAttemptStatus>(['completed', 'failed', 'cancelled', 'deadline_exceeded', 'interrupted']);

/** 必须绑定当前 Attempt 身份的 Task 执行态。 */
const TASK_ATTEMPT_REQUIRED_STATUSES = new Set<AgentTaskStatus>(['starting', 'running', 'waiting_confirmation', 'committing']);

/** 必须与 running Attempt 同步的 Task 执行态。 */
const TASK_RUNNING_ATTEMPT_STATUSES = new Set<AgentTaskStatus>(['running', 'waiting_confirmation', 'committing']);

/** 必须持有结构化错误的 Attempt 失败终态。 */
const ATTEMPT_ERROR_REQUIRED_STATUSES = new Set<AgentAttemptStatus>(['failed', 'deadline_exceeded', 'interrupted']);

/** Changeset 可变状态 allowlist。 */
const CHANGESET_STATUSES = new Set<AgentChangesetRecord['status']>([
  'prepared',
  'awaiting_confirmation',
  'approved',
  'rejected',
  'revoked',
  'committing',
  'committed',
  'discarded'
]);

/** Confirmation 可变状态 allowlist。 */
const CONFIRMATION_STATUSES = new Set<AgentConfirmationStatus>(['pending', 'approved', 'rejected', 'revoked']);

/** Commit journal 可变状态 allowlist。 */
const JOURNAL_STATUSES = new Set<AgentCommitJournalStatus>(['created', 'applying', 'applied', 'finalized', 'cancelled', 'manual_recovery']);

/** 由 task.failed Event 表达的 Task 失败终态。 */
const TASK_FAILURE_STATUSES = new Set<AgentTaskStatus>(['failed', 'deadline_exceeded', 'commit_failed']);

/** 除 cooperative cancellation 外必须持有结构化结果的 Task 终态。 */
const TASK_RESULT_REQUIRED_STATUSES = new Set<AgentTaskStatus>(['completed', 'failed', 'deadline_exceeded', 'commit_failed']);

/** Checkpoint 状态 allowlist。 */
const CHECKPOINT_STATUSES = new Set<AgentCheckpointStatus>([
  'preparing',
  'waiting_children',
  'ready_to_resume',
  'resuming',
  'cancelling',
  'completed',
  'failed',
  'cancelled',
  'interrupted'
]);

/**
 * 判断值是否为普通对象。
 * @param value - 未可信值
 * @returns 是否可以按字符串键读取
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 判断对象是否只含明确批准字段。
 * @param value - 待校验对象
 * @param keys - 完整字段 allowlist
 * @returns 是否不存在未知字段
 */
function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key): boolean => keys.includes(key));
}

/**
 * 读取必需的非空字符串。
 * @param value - 未可信值
 * @param field - 错误字段名
 * @returns 已校验字符串
 */
function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new AgentStoreProtocolError('persisted_string_invalid', `Invalid persisted ${field}`);
  }
  return value;
}

/**
 * 读取可选字符串。
 * @param value - 未可信值
 * @param field - 错误字段名
 * @returns 已校验字符串或 undefined
 */
function optionalString(value: unknown, field: string): string | undefined {
  if (value === null || value === undefined) return undefined;
  return requireString(value, field);
}

/**
 * 读取非负整数。
 * @param value - 未可信值
 * @param field - 错误字段名
 * @returns 已校验整数
 */
function requireInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new AgentStoreProtocolError('persisted_integer_invalid', `Invalid persisted ${field}`);
  }
  return value as number;
}

/**
 * 安全解析持久化 JSON。
 * @param value - SQLite JSON 文本
 * @param field - 错误字段名
 * @returns 未可信解析值，交给字段级校验器
 */
function parseJson(value: unknown, field: string): unknown {
  const text = requireString(value, field);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AgentStoreProtocolError('persisted_json_invalid', `Invalid persisted ${field}`);
  }
}

/**
 * 校验不可变 Continuation Snapshot 及其版本化 hash。
 * @param value - 未可信快照
 * @param expectedHash - SQLite 保存的 hash
 * @returns allowlist 快照
 */
function parseContinuation(value: unknown, expectedHash: string): AgentDelegationContinuationSnapshot {
  const validation = validateContinuationSnapshot(value, expectedHash);
  if (!validation.ok) {
    throw new AgentStoreProtocolError(validation.error.details?.reason?.toString() ?? 'continuation_snapshot_invalid', validation.error.message);
  }
  return validation.continuation;
}

/**
 * 校验结果 criterionIndex 精确覆盖不可变验收标准。
 * @param result - 已通过共享 validator 的结果
 * @param acceptanceCriteria - Task 契约中的有序验收标准
 * @returns 是否严格覆盖 0..N-1 且无缺失或额外项
 */
function hasExactCriteria(result: AgentTaskResult, acceptanceCriteria: readonly string[]): boolean {
  return (
    result.completion.criteria.length === acceptanceCriteria.length &&
    result.completion.criteria.every((criterion, index): boolean => criterion.criterionIndex === index)
  );
}

/**
 * 判断结果是否发生在任何 Attempt 创建之前。
 * @param result - 已通过共享 validator 的 Task 结果
 * @returns 是否为 Coordinator 授权前失败
 */
function isPreAttemptFailure(result: AgentTaskResult): result is AgentPreAttemptFailureResult {
  return 'resultKind' in result && result.resultKind === 'pre_attempt_failure';
}

/**
 * 校验持久化 Task 结果的判别式协议。
 * @param value - SQLite 或 Checkpoint 中的未可信结果
 * @returns 规范化真实 Attempt 结果或授权前失败
 */
function parseTaskResult(value: unknown): AgentTaskResult {
  if (isRecord(value) && value.resultKind === 'pre_attempt_failure') {
    const validation = validatePreAttemptFailure(value);
    if (validation.ok) return validation.result;
    throw new AgentStoreProtocolError(validation.error.details?.reason?.toString() ?? 'pre_attempt_result_invalid', validation.error.message);
  }
  const validation = validateChatAgentResult(value);
  if (validation.ok) return validation.result;
  throw new AgentStoreProtocolError(validation.error.details?.reason?.toString() ?? 'task_result_invalid', validation.error.message);
}

/**
 * 校验 Task 行的不可变契约并构造读取投影。
 * @param row - SQLite 查询行
 * @returns 可信 Task 投影
 */
function parseTask(row: TaskRow): AgentTaskRecord {
  const contractValue = parseJson(row.contract_snapshot_json, 'contract snapshot');
  if (
    !isRecord(contractValue) ||
    !hasOnlyKeys(contractValue, ['contractSchemaVersion', 'task', 'acceptanceCriteria', 'mode', 'resources', 'requestedTools', 'required'])
  ) {
    throw new AgentStoreProtocolError('contract_snapshot_invalid', 'Invalid persisted contract snapshot');
  }
  const priority = requireString(row.priority, 'task priority');
  if (priority !== 'low' && priority !== 'normal' && priority !== 'high') {
    throw new AgentStoreProtocolError('task_priority_invalid', 'Invalid persisted task priority');
  }
  const validation = validateFoundationContract({
    task: contractValue.task,
    acceptanceCriteria: contractValue.acceptanceCriteria,
    mode: contractValue.mode,
    resources: contractValue.resources,
    requestedTools: contractValue.requestedTools,
    required: contractValue.required,
    priority,
    ...(row.deadline_at === null ? {} : { deadlineAt: row.deadline_at })
  });
  if (!validation.ok || validation.contractSnapshot.contractSchemaVersion !== contractValue.contractSchemaVersion) {
    throw new AgentStoreProtocolError('contract_snapshot_invalid', 'Invalid persisted contract snapshot');
  }
  const contractHash = requireString(row.contract_snapshot_hash, 'contract snapshot hash');
  if (validation.contractSnapshotHash !== contractHash) {
    throw new AgentStoreProtocolError('contract_snapshot_hash_mismatch', 'Contract snapshot hash mismatch');
  }
  const status = requireString(row.status, 'task status');
  if (!TASK_STATUSES.has(status as AgentTaskStatus)) {
    throw new AgentStoreProtocolError('task_status_invalid', 'Invalid persisted task status');
  }
  const recordState = requireString(row.record_state, 'task record state');
  if (recordState !== 'active' && recordState !== 'tombstoned') {
    throw new AgentStoreProtocolError('task_record_state_invalid', 'Invalid persisted task record state');
  }
  const queuePhase = optionalString(row.queue_phase, 'task queue phase');
  if (queuePhase !== undefined && queuePhase !== 'start' && queuePhase !== 'commit') {
    throw new AgentStoreProtocolError('task_queue_phase_invalid', 'Invalid persisted task queue phase');
  }
  const executionPlanJson = row.execution_plan_snapshot_json;
  const executionPlanHash = optionalString(row.execution_plan_snapshot_hash, 'execution plan hash');
  let executionPlan: AgentExecutionPlanSnapshot | undefined;
  if (executionPlanJson !== null || executionPlanHash !== undefined) {
    if (executionPlanJson === null || !executionPlanHash) {
      throw new AgentStoreProtocolError('execution_plan_pair_invalid', 'Execution plan snapshot and hash must coexist');
    }
    const planValidation = validateExecutionPlanSnapshot(validation.contractSnapshot, parseJson(executionPlanJson, 'execution plan snapshot'));
    if (!planValidation.ok || planValidation.plan.planHash !== executionPlanHash) {
      throw new AgentStoreProtocolError('execution_plan_invalid', 'Persisted execution plan failed validation');
    }
    executionPlan = planValidation.plan;
  }
  const deadlineAt = optionalString(row.deadline_at, 'task deadline');
  const currentAttemptId = optionalString(row.current_attempt_id, 'current attempt id');
  const cancelRequestedAt = optionalString(row.cancel_requested_at, 'cancel requested at');
  const taskId = requireString(row.task_id, 'task id');
  const agentId = requireString(row.agent_id, 'task agent id');
  const resultHash = optionalString(row.result_hash, 'task result hash');
  let result: AgentTaskResult | undefined;
  if (row.result_json !== null || resultHash !== undefined) {
    if (row.result_json === null || !resultHash) {
      throw new AgentStoreProtocolError('task_result_pair_invalid', 'Task result and hash must coexist');
    }
    const parsedResult = parseTaskResult(parseJson(row.result_json, 'task result'));
    if (hashAgentPayload(parsedResult) !== resultHash) {
      throw new AgentStoreProtocolError('task_result_invalid', 'Persisted Task result failed validation');
    }
    if (
      parsedResult.taskId !== taskId ||
      parsedResult.agentId !== agentId ||
      (!isPreAttemptFailure(parsedResult) && (currentAttemptId === undefined || parsedResult.attemptId !== currentAttemptId)) ||
      (isPreAttemptFailure(parsedResult) && currentAttemptId !== undefined) ||
      (!isPreAttemptFailure(parsedResult) &&
        ((validation.contractSnapshot.mode === 'read' && parsedResult.changeset !== undefined) ||
          (validation.contractSnapshot.mode === 'write' && parsedResult.executionStatus === 'completed' && parsedResult.changeset === undefined))) ||
      !hasExactCriteria(parsedResult, validation.contractSnapshot.acceptanceCriteria)
    ) {
      throw new AgentStoreProtocolError('task_result_identity_invalid', 'Persisted Task result identity or criteria do not match its Task row');
    }
    result = parsedResult;
  }
  let error;
  if (row.error_json !== null) {
    error = validateAgentTaskError(parseJson(row.error_json, 'task error'));
    if (!error) throw new AgentStoreProtocolError('task_error_invalid', 'Persisted Task error failed validation');
  }
  const taskStatus = status as AgentTaskStatus;
  if (TASK_ATTEMPT_REQUIRED_STATUSES.has(taskStatus) && currentAttemptId === undefined) {
    throw new AgentStoreProtocolError('task_attempt_projection_invalid', 'Executing Task must bind a current Attempt identity');
  }
  if ((taskStatus === 'queued') !== (queuePhase !== undefined)) {
    throw new AgentStoreProtocolError('task_queue_projection_invalid', 'Queued Task status and queue phase must coexist');
  }
  if ((result !== undefined && taskStatus !== result.executionStatus) || (result === undefined && TASK_RESULT_REQUIRED_STATUSES.has(taskStatus))) {
    throw new AgentStoreProtocolError('task_result_projection_invalid', 'Task status and terminal result do not describe the same projection');
  }
  const resultError = result?.error;
  if (
    (error === undefined) !== (resultError === undefined) ||
    (error !== undefined && resultError !== undefined && hashAgentPayload(error) !== hashAgentPayload(resultError))
  ) {
    throw new AgentStoreProtocolError('task_error_projection_invalid', 'Task error does not exactly match its terminal result error');
  }
  return {
    taskId,
    sessionId: requireString(row.session_id, 'task session id'),
    turnId: requireString(row.turn_id, 'task turn id'),
    agentId,
    parentAgentId: requireString(row.parent_agent_id, 'task parent agent id'),
    rootRuntimeId: requireString(row.root_runtime_id, 'task root runtime id'),
    checkpointId: requireString(row.checkpoint_id, 'task checkpoint id'),
    toolCallId: requireString(row.tool_call_id, 'task tool call id'),
    contractSnapshot: validation.contractSnapshot,
    contractSnapshotHash: contractHash,
    ...(executionPlan ? { executionPlanSnapshot: executionPlan, executionPlanSnapshotHash: executionPlanHash } : {}),
    status: taskStatus,
    ...(queuePhase ? { queuePhase: queuePhase as AgentTaskQueuePhase } : {}),
    priority: priority as AgentTaskPriority,
    ...(deadlineAt ? { deadlineAt } : {}),
    ...(currentAttemptId ? { currentAttemptId } : {}),
    ...(cancelRequestedAt ? { cancelRequestedAt } : {}),
    ...(result ? { result, resultHash } : {}),
    ...(error ? { error } : {}),
    recordState: recordState as AgentRecordState,
    unfinishedJournalCount: requireInteger(row.unfinished_journal_count, 'unfinished journal count'),
    createdAt: requireString(row.created_at, 'task created at'),
    updatedAt: requireString(row.updated_at, 'task updated at')
  };
}

/**
 * 校验 Attempt 行的身份、状态和结构化错误。
 * @param row - SQLite 查询行
 * @returns 可信 Attempt 投影
 */
function parseAttempt(row: AttemptRow): AgentAttemptRecord {
  const status = requireString(row.status, 'attempt status');
  if (!ATTEMPT_STATUSES.has(status as AgentAttemptStatus)) {
    throw new AgentStoreProtocolError('attempt_status_invalid', 'Invalid persisted Attempt status');
  }
  const attemptNumber = requireInteger(row.attempt_number, 'attempt number');
  const runtimeSequence = requireInteger(row.runtime_sequence, 'attempt runtime sequence');
  if (attemptNumber === 0 || runtimeSequence === 0) {
    throw new AgentStoreProtocolError('attempt_sequence_invalid', 'Attempt sequence values must be positive');
  }
  let error;
  if (row.error_json !== null) {
    error = validateAgentTaskError(parseJson(row.error_json, 'attempt error'));
    if (!error) throw new AgentStoreProtocolError('attempt_error_invalid', 'Persisted Attempt error failed validation');
  }
  const startedAt = optionalString(row.started_at, 'attempt started at');
  const finishedAt = optionalString(row.finished_at, 'attempt finished at');
  const attemptStatus = status as AgentAttemptStatus;
  if ((attemptStatus === 'starting' && startedAt !== undefined) || (attemptStatus === 'running' && startedAt === undefined)) {
    throw new AgentStoreProtocolError('attempt_started_projection_invalid', 'Attempt status and started time do not describe the same projection');
  }
  if (ATTEMPT_TERMINAL_STATUSES.has(attemptStatus) !== (finishedAt !== undefined)) {
    throw new AgentStoreProtocolError('attempt_finished_projection_invalid', 'Attempt terminal status and finished time must coexist');
  }
  if (attemptStatus === 'completed' && error !== undefined) {
    throw new AgentStoreProtocolError('attempt_completed_error_invalid', 'Completed Attempt cannot retain an error');
  }
  if (ATTEMPT_ERROR_REQUIRED_STATUSES.has(attemptStatus) && error === undefined) {
    throw new AgentStoreProtocolError('attempt_failure_error_missing', 'Failed Attempt must retain a structured error');
  }
  return {
    attemptId: requireString(row.attempt_id, 'attempt id'),
    taskId: requireString(row.task_id, 'attempt task id'),
    attemptNumber,
    parentRuntimeId: requireString(row.parent_runtime_id, 'attempt parent runtime id'),
    planHash: requireString(row.plan_hash, 'attempt plan hash'),
    initialRuntimeId: requireString(row.initial_runtime_id, 'attempt initial runtime id'),
    currentRuntimeId: requireString(row.current_runtime_id, 'attempt current runtime id'),
    runtimeSequence,
    status: attemptStatus,
    ...(startedAt ? { startedAt } : {}),
    ...(finishedAt ? { finishedAt } : {}),
    ...(error ? { error } : {}),
    createdAt: requireString(row.created_at, 'attempt created at')
  };
}

/**
 * 校验 Changeset 行的不可变 snapshot 与可变投影。
 * @param row - SQLite Changeset 行
 * @returns 可信 Changeset 记录
 */
function parseChangeset(row: ChangesetRow): AgentChangesetRecord {
  const snapshotHash = requireString(row.snapshot_hash, 'changeset snapshot hash');
  const validation = validateChangesetSnapshot(parseJson(row.snapshot_json, 'changeset snapshot'), snapshotHash);
  if (!validation.ok) {
    throw new AgentStoreProtocolError(validation.error.details?.reason?.toString() ?? 'changeset_snapshot_invalid', validation.error.message);
  }
  const { snapshot } = validation;
  const status = requireString(row.status, 'changeset status');
  const recordState = requireString(row.record_state, 'changeset record state');
  const confirmationId = optionalString(row.confirmation_id, 'changeset confirmation id');
  if (!CHANGESET_STATUSES.has(status as AgentChangesetRecord['status']) || (recordState !== 'active' && recordState !== 'tombstoned')) {
    throw new AgentStoreProtocolError('changeset_projection_invalid', 'Changeset status or record state is invalid');
  }
  if (
    snapshot.changesetId !== row.changeset_id ||
    snapshot.taskId !== row.task_id ||
    snapshot.attemptId !== row.attempt_id ||
    snapshot.agentId !== row.agent_id ||
    snapshot.runtimeId !== row.runtime_id ||
    snapshot.planHash !== row.plan_hash ||
    snapshot.baseRevision !== row.base_revision ||
    snapshot.diffHash !== row.diff_hash ||
    snapshot.operationSetHash !== row.operation_set_hash ||
    snapshot.createdAt !== row.created_at
  ) {
    throw new AgentStoreProtocolError('changeset_row_mismatch', 'Changeset columns do not match the immutable snapshot');
  }
  if (status !== 'prepared' && status !== 'discarded' && !confirmationId) {
    throw new AgentStoreProtocolError('changeset_confirmation_missing', 'Changeset state requires a confirmation identity');
  }
  return Object.freeze({
    snapshot,
    snapshotHash,
    status: status as AgentChangesetRecord['status'],
    ...(confirmationId ? { confirmationId } : {}),
    recordState: recordState as AgentChangesetRecord['recordState'],
    updatedAt: requireString(row.updated_at, 'changeset updated at')
  });
}

/**
 * 校验 Confirmation 行的不可变 request 与 CAS 投影。
 * @param row - SQLite Confirmation 行
 * @returns 可信 Confirmation 记录
 */
function parseConfirmation(row: ConfirmationRow): AgentConfirmationRecord {
  const requestHash = requireString(row.request_hash, 'confirmation request hash');
  const validation = validateConfirmationRequestSnapshot(parseJson(row.request_json, 'confirmation request'), requestHash);
  if (!validation.ok) {
    throw new AgentStoreProtocolError(validation.error.details?.reason?.toString() ?? 'confirmation_request_invalid', validation.error.message);
  }
  const request = validation.snapshot;
  const status = requireString(row.status, 'confirmation status');
  const version = requireInteger(row.version, 'confirmation version');
  const resolvedAt = optionalString(row.resolved_at, 'confirmation resolved at');
  if (!CONFIRMATION_STATUSES.has(status as AgentConfirmationStatus) || version === 0) {
    throw new AgentStoreProtocolError('confirmation_projection_invalid', 'Confirmation status or version is invalid');
  }
  let decision: 'approved' | 'rejected' | undefined;
  if (row.decision_json !== null) {
    const parsedDecision = parseJson(row.decision_json, 'confirmation decision');
    if (
      !isRecord(parsedDecision) ||
      !hasOnlyKeys(parsedDecision, ['decision', 'version']) ||
      (parsedDecision.decision !== 'approved' && parsedDecision.decision !== 'rejected') ||
      parsedDecision.version !== version
    ) {
      throw new AgentStoreProtocolError('confirmation_decision_invalid', 'Confirmation decision does not match its CAS projection');
    }
    decision = parsedDecision.decision;
  }
  if (
    request.confirmationId !== row.confirmation_id ||
    request.changesetId !== row.changeset_id ||
    (status === 'pending' && (decision !== undefined || resolvedAt !== undefined)) ||
    ((status === 'approved' || status === 'rejected') && (decision !== status || !resolvedAt)) ||
    (status === 'revoked' && decision !== undefined)
  ) {
    throw new AgentStoreProtocolError('confirmation_row_mismatch', 'Confirmation columns do not match its immutable request or decision');
  }
  return Object.freeze({
    confirmationId: request.confirmationId,
    changesetId: request.changesetId,
    request,
    requestHash,
    status: status as AgentConfirmationStatus,
    version,
    ...(decision ? { decision } : {}),
    createdAt: requireString(row.created_at, 'confirmation created at'),
    updatedAt: requireString(row.updated_at, 'confirmation updated at')
  });
}

/**
 * 校验 journal 操作进度。
 * @param value - 未可信 operation progress JSON
 * @param intent - journal 冻结意图
 * @returns 有序进度
 */
function parseJournalProgress(value: unknown, intent: AgentCommitIntentSnapshot): JournalOperationProgress[] {
  if (!Array.isArray(value)) throw new AgentStoreProtocolError('journal_progress_invalid', 'Journal progress must be an array');
  const expectedOperations = new Map(intent.operations.map((operation): [string, string] => [operation.operationId, operation.targetContentHash]));
  const progress = value.map((entry): JournalOperationProgress => {
    if (
      !isRecord(entry) ||
      !hasOnlyKeys(entry, ['operationId', 'targetContentHash']) ||
      typeof entry.operationId !== 'string' ||
      typeof entry.targetContentHash !== 'string' ||
      expectedOperations.get(entry.operationId) !== entry.targetContentHash
    ) {
      throw new AgentStoreProtocolError('journal_progress_invalid', 'Journal operation progress is outside the immutable intent');
    }
    return {
      operationId: entry.operationId,
      targetContentHash: entry.targetContentHash
    };
  });
  if (new Set(progress.map((entry): string => entry.operationId)).size !== progress.length) {
    throw new AgentStoreProtocolError('journal_progress_duplicate', 'Journal operation progress contains duplicates');
  }
  return progress;
}

/**
 * 校验 Commit Journal 行的不可变 intent 与恢复投影。
 * @param row - SQLite Commit Journal 行
 * @returns 可信 Commit Journal 记录
 */
function parseCommitJournal(row: CommitJournalRow): AgentCommitJournalRecord {
  const intentHash = requireString(row.intent_hash, 'commit intent hash');
  const validation = validateCommitIntentSnapshot(parseJson(row.intent_json, 'commit intent'), intentHash);
  if (!validation.ok) {
    throw new AgentStoreProtocolError(validation.error.details?.reason?.toString() ?? 'commit_intent_invalid', validation.error.message);
  }
  const intent = validation.snapshot;
  const status = requireString(row.status, 'commit journal status');
  const confirmationVersion = requireInteger(row.confirmation_version, 'commit confirmation version');
  if (!JOURNAL_STATUSES.has(status as AgentCommitJournalStatus) || confirmationVersion === 0) {
    throw new AgentStoreProtocolError('commit_journal_projection_invalid', 'Commit journal status or confirmation version is invalid');
  }
  const progress = parseJournalProgress(parseJson(row.operation_progress_json, 'journal operation progress'), intent);
  let error;
  if (row.error_json !== null) {
    error = validateAgentTaskError(parseJson(row.error_json, 'commit journal error'));
    if (!error) throw new AgentStoreProtocolError('commit_journal_error_invalid', 'Commit journal error is invalid');
  }
  const finalizedAt = optionalString(row.finalized_at, 'commit journal finalized at');
  if (
    intent.confirmationId !== row.confirmation_id ||
    intent.confirmationVersion !== confirmationVersion ||
    intent.planHash !== row.plan_hash ||
    (status === 'finalized') !== (finalizedAt !== undefined) ||
    (status === 'manual_recovery') !== (error !== undefined)
  ) {
    throw new AgentStoreProtocolError('commit_journal_row_mismatch', 'Commit journal columns do not match its immutable intent or state');
  }
  return Object.freeze({
    journalId: requireString(row.journal_id, 'commit journal id'),
    taskId: requireString(row.task_id, 'commit journal task id'),
    attemptId: requireString(row.attempt_id, 'commit journal attempt id'),
    changesetId: requireString(row.changeset_id, 'commit journal changeset id'),
    confirmationId: requireString(row.confirmation_id, 'commit journal confirmation id'),
    confirmationVersion,
    planHash: requireString(row.plan_hash, 'commit journal plan hash'),
    intent,
    intentHash,
    status: status as AgentCommitJournalStatus,
    appliedOperationIds: Object.freeze(progress.map((entry): string => entry.operationId)),
    ...(error ? { error } : {}),
    createdAt: requireString(row.created_at, 'commit journal created at'),
    updatedAt: requireString(row.updated_at, 'commit journal updated at'),
    ...(finalizedAt ? { finalizedAt } : {})
  });
}

/**
 * 校验初始空结果映射。
 * @param value - 未可信结果映射
 * @returns 初始空结果映射
 */
function parseTerminalResults(value: unknown): Record<string, AgentTerminalResultEnvelope> {
  if (!isRecord(value)) {
    throw new AgentStoreProtocolError('terminal_results_invalid', 'Persisted terminal results must be an object');
  }
  const entries = Object.entries(value).map(([toolCallId, envelope]): [string, AgentTerminalResultEnvelope] => {
    if (!isRecord(envelope) || !hasOnlyKeys(envelope, ['result', 'resultHash']) || Object.keys(envelope).length !== 2) {
      throw new AgentStoreProtocolError('terminal_result_envelope_invalid', 'Terminal result envelope is invalid');
    }
    const resultHash = requireString(envelope.resultHash, 'terminal result hash');
    const result = parseTaskResult(envelope.result);
    if (hashAgentPayload(result) !== resultHash) {
      throw new AgentStoreProtocolError('terminal_result_invalid', 'Terminal result failed validation');
    }
    return [requireString(toolCallId, 'terminal result tool call id'), { result, resultHash }];
  });
  return Object.freeze(Object.fromEntries(entries));
}

/**
 * 校验 Checkpoint 行并构造读取投影。
 * @param row - SQLite 查询行
 * @returns 可信 Checkpoint 投影
 */
function parseCheckpoint(row: CheckpointRow): AgentCheckpointRecord {
  const status = requireString(row.status, 'checkpoint status');
  if (!CHECKPOINT_STATUSES.has(status as AgentCheckpointStatus)) {
    throw new AgentStoreProtocolError('checkpoint_status_invalid', 'Invalid persisted checkpoint status');
  }
  const recordState = requireString(row.record_state, 'checkpoint record state');
  if (recordState !== 'active' && recordState !== 'tombstoned') {
    throw new AgentStoreProtocolError('checkpoint_record_state_invalid', 'Invalid persisted checkpoint record state');
  }
  const continuationHash = requireString(row.continuation_snapshot_hash, 'continuation snapshot hash');
  const continuationSnapshot = parseContinuation(parseJson(row.continuation_snapshot_json, 'continuation snapshot'), continuationHash);
  const terminalResults = parseTerminalResults(parseJson(row.terminal_results_json, 'terminal results'));
  const orderedToolCalls = new Map(continuationSnapshot.orderedToolCalls.map((toolCall): [string, string] => [toolCall.toolCallId, toolCall.taskId]));
  if (
    Object.entries(terminalResults).some(
      ([toolCallId, envelope]): boolean => !orderedToolCalls.has(toolCallId) || envelope.result.taskId !== orderedToolCalls.get(toolCallId)
    )
  ) {
    throw new AgentStoreProtocolError('terminal_result_link_invalid', 'Terminal result key or Task identity is outside the frozen ordered tool calls');
  }
  let error;
  if (row.error_json !== null) {
    error = validateAgentTaskError(parseJson(row.error_json, 'checkpoint error'));
    if (!error) throw new AgentStoreProtocolError('checkpoint_error_invalid', 'Persisted Checkpoint error failed validation');
  }
  return {
    checkpointId: requireString(row.checkpoint_id, 'checkpoint id'),
    sessionId: requireString(row.session_id, 'checkpoint session id'),
    turnId: requireString(row.turn_id, 'checkpoint turn id'),
    primaryAgentId: requireString(row.primary_agent_id, 'checkpoint primary agent id'),
    rootRuntimeId: requireString(row.root_runtime_id, 'checkpoint root runtime id'),
    sourceRuntimeId: requireString(row.source_runtime_id, 'checkpoint source runtime id'),
    assistantMessageId: requireString(row.assistant_message_id, 'checkpoint assistant message id'),
    continuationSnapshot,
    continuationSnapshotHash: continuationHash,
    status: status as AgentCheckpointStatus,
    version: requireInteger(row.version, 'checkpoint version'),
    terminalResults,
    ...(optionalString(row.resume_runtime_id, 'resume runtime id') ? { resumeRuntimeId: row.resume_runtime_id as string } : {}),
    ...(error ? { error } : {}),
    recordState: recordState as AgentRecordState,
    createdAt: requireString(row.created_at, 'checkpoint created at'),
    updatedAt: requireString(row.updated_at, 'checkpoint updated at')
  };
}

/**
 * 校验当前切片创建的 Checkpoint 事件。
 * @param row - SQLite 查询行
 * @returns 可信 Event
 */
function parseEvent(row: EventRow): ChatAgentEvent {
  const aggregateId = requireString(row.aggregate_id, 'event aggregate id');
  const taskId = optionalString(row.task_id, 'event task id');
  const checkpointId = optionalString(row.checkpoint_id, 'event checkpoint id');
  const attemptId = optionalString(row.attempt_id, 'event attempt id');
  const runtimeId = optionalString(row.runtime_id, 'event runtime id');
  const validation = validateChatAgentEvent({
    eventId: requireString(row.event_id, 'event id'),
    aggregate: { kind: row.aggregate_kind, id: aggregateId },
    ...(taskId ? { taskId } : {}),
    ...(checkpointId ? { checkpointId } : {}),
    sequence: requireInteger(row.sequence, 'event sequence'),
    ...(attemptId ? { attemptId } : {}),
    ...(runtimeId ? { runtimeId } : {}),
    type: row.event_type,
    occurredAt: requireString(row.occurred_at, 'event occurred at'),
    source: row.source,
    schemaVersion: requireInteger(row.schema_version, 'event schema version'),
    payload: parseJson(row.payload_json, 'event payload')
  });
  if (!validation.ok) {
    throw new AgentStoreProtocolError(validation.error.details?.reason?.toString() ?? 'persisted_event_invalid', validation.error.message);
  }
  return validation.event;
}

/**
 * 校验 Outbox 行及 payload hash。
 * @param row - SQLite 查询行
 * @returns 可信 Outbox 投影
 */
function parseOutbox(row: OutboxRow): AgentOutboxRecord {
  const payload = parseJson(row.payload_json, 'outbox payload');
  const payloadHash = requireString(row.payload_hash, 'outbox payload hash');
  const validation = validateFoundationOutbox({
    eventType: row.event_type,
    payload,
    payloadHash,
    schemaVersion: row.schema_version
  });
  if (!validation.ok) {
    throw new AgentStoreProtocolError(validation.error.details?.reason?.toString() ?? 'persisted_outbox_invalid', validation.error.message);
  }
  const deliveryStatus = requireString(row.delivery_status, 'outbox delivery status');
  if (deliveryStatus !== 'pending' && deliveryStatus !== 'delivered') {
    throw new AgentStoreProtocolError('outbox_status_invalid', 'Invalid persisted outbox status');
  }
  const base = {
    outboxId: requireString(row.outbox_id, 'outbox id'),
    dedupeKey: requireString(row.dedupe_key, 'outbox dedupe key'),
    payloadHash: validation.outbox.payloadHash,
    schemaVersion: validation.outbox.schemaVersion,
    deliveryStatus: deliveryStatus as 'pending' | 'delivered',
    attemptCount: requireInteger(row.attempt_count, 'outbox attempt count'),
    ...(optionalString(row.delivered_at, 'outbox delivered at') ? { deliveredAt: row.delivered_at as string } : {}),
    createdAt: requireString(row.created_at, 'outbox created at'),
    updatedAt: requireString(row.updated_at, 'outbox updated at')
  };
  return validation.outbox.eventType === 'delegation.ready'
    ? { ...base, eventType: 'delegation.ready', payload: validation.outbox.payload }
    : { ...base, eventType: 'delegation.created', payload: validation.outbox.payload };
}

/**
 * 校验持久化身份或不透明引用的稳定文本边界。
 * @param value - 待持久化标识
 * @param field - 展示用字段名
 */
function validateStableId(value: string, field: string): void {
  if (value.length > 256 || normalizeAgentIdentity(value) !== value) {
    throw new AgentStoreProtocolError('prepare_identity_invalid', `${field} must be a non-empty, unpadded identifier of at most 256 characters`);
  }
}

/**
 * 在落库前重验不可变快照、hash 和跨记录身份。
 * @param input - 可能来自服务边界的委派输入
 */
function validatePrepareInput(input: PrepareDelegationInput): void {
  const { checkpoint } = input;
  [
    [checkpoint.checkpointId, 'checkpointId'],
    [checkpoint.sessionId, 'checkpoint.sessionId'],
    [checkpoint.turnId, 'checkpoint.turnId'],
    [checkpoint.primaryAgentId, 'primaryAgentId'],
    [checkpoint.rootRuntimeId, 'checkpoint.rootRuntimeId'],
    [checkpoint.sourceRuntimeId, 'sourceRuntimeId'],
    [checkpoint.assistantMessageId, 'assistantMessageId'],
    [checkpoint.continuationSnapshot.continuationContextReference, 'continuationContextReference'],
    [checkpoint.continuationSnapshot.sourceMessageRevision, 'sourceMessageRevision'],
    [checkpoint.continuationSnapshot.modelSnapshot.providerId, 'continuation.providerId'],
    [checkpoint.continuationSnapshot.modelSnapshot.modelId, 'continuation.modelId'],
    [input.outbox.outboxId, 'outboxId'],
    [input.outbox.dedupeKey, 'outbox.dedupeKey'],
    [input.outbox.payload.checkpointId, 'outbox.checkpointId'],
    [input.outbox.payload.sessionId, 'outbox.sessionId'],
    [input.outbox.payload.turnId, 'outbox.turnId']
  ].forEach(([value, field]): void => validateStableId(value, field));
  input.tasks.forEach((task): void => {
    [
      [task.taskId, 'taskId'],
      [task.sessionId, 'task.sessionId'],
      [task.turnId, 'task.turnId'],
      [task.agentId, 'agentId'],
      [task.parentAgentId, 'parentAgentId'],
      [task.rootRuntimeId, 'task.rootRuntimeId'],
      [task.checkpointId, 'task.checkpointId'],
      [task.toolCallId, 'toolCallId']
    ].forEach(([value, field]): void => validateStableId(value, field));
    task.contractSnapshot.resources.forEach((resource): void => {
      validateStableId(resource.reference, 'resource.reference');
      if (resource.revision !== undefined) validateStableId(resource.revision, 'resource.revision');
    });
  });
  checkpoint.continuationSnapshot.orderedToolCalls.forEach((toolCall): void => {
    validateStableId(toolCall.taskId, 'continuation.taskId');
    validateStableId(toolCall.toolCallId, 'continuation.toolCallId');
  });
  const uniqueTaskIds = new Set(input.tasks.map((task): string => task.taskId));
  const uniqueAgentIds = new Set(input.tasks.map((task): string => task.agentId));
  const uniqueToolCallIds = new Set(input.tasks.map((task): string => task.toolCallId));
  if (
    uniqueTaskIds.size !== input.tasks.length ||
    uniqueAgentIds.size !== input.tasks.length ||
    uniqueToolCallIds.size !== input.tasks.length ||
    input.tasks.some((task): boolean => task.parentAgentId !== checkpoint.primaryAgentId) ||
    input.outbox.dedupeKey !== `delegation.created:${checkpoint.checkpointId}`
  ) {
    throw new AgentStoreProtocolError('prepare_identity_mismatch', 'Delegation identities, parent links, uniqueness, or Outbox dedupe key are invalid');
  }
  const normalizedContinuation = parseContinuation(checkpoint.continuationSnapshot, checkpoint.continuationSnapshotHash);
  if (!Number.isFinite(Date.parse(input.occurredAt)) || input.tasks.length === 0 || normalizedContinuation.orderedToolCalls.length !== input.tasks.length) {
    throw new AgentStoreProtocolError('prepare_envelope_invalid', 'Invalid delegation prepare envelope');
  }
  input.tasks.forEach((task, index): void => {
    const validation = validateFoundationContract({
      task: task.contractSnapshot.task,
      acceptanceCriteria: task.contractSnapshot.acceptanceCriteria,
      mode: task.contractSnapshot.mode,
      resources: task.contractSnapshot.resources,
      requestedTools: task.contractSnapshot.requestedTools,
      required: task.contractSnapshot.required,
      priority: task.priority,
      ...(task.deadlineAt ? { deadlineAt: task.deadlineAt } : {})
    });
    const orderedCall = normalizedContinuation.orderedToolCalls[index];
    if (
      !validation.ok ||
      validation.contractSnapshot.contractSchemaVersion !== task.contractSnapshot.contractSchemaVersion ||
      validation.contractSnapshotHash !== task.contractSnapshotHash ||
      task.checkpointId !== checkpoint.checkpointId ||
      task.sessionId !== checkpoint.sessionId ||
      task.turnId !== checkpoint.turnId ||
      task.rootRuntimeId !== checkpoint.rootRuntimeId ||
      orderedCall.taskId !== task.taskId ||
      orderedCall.toolCallId !== task.toolCallId
    ) {
      throw new AgentStoreProtocolError('prepare_task_invalid', 'Invalid immutable delegation task');
    }
  });
  const outboxValidation = validateFoundationOutbox({
    eventType: input.outbox.eventType,
    payload: input.outbox.payload,
    payloadHash: input.outbox.payloadHash,
    schemaVersion: input.outbox.schemaVersion
  });
  if (
    !outboxValidation.ok ||
    outboxValidation.outbox.payload.checkpointId !== checkpoint.checkpointId ||
    outboxValidation.outbox.payload.sessionId !== checkpoint.sessionId ||
    outboxValidation.outbox.payload.turnId !== checkpoint.turnId
  ) {
    throw new AgentStoreProtocolError('prepare_outbox_invalid', 'Invalid immutable delegation outbox');
  }
}

/** 原子委派 Store 的 SQLite 实现。 */
class SqliteAgentDelegationStore implements AgentDelegationStore {
  /** 同步 SQLite 事务边界。 */
  private readonly database: AgentStoreDatabase;

  /**
   * 创建 Store。
   * @param database - 同步 SQLite 边界
   */
  constructor(database: AgentStoreDatabase) {
    this.database = database;
  }

  /**
   * 在同一事务按协议顺序写入初始事实。
   * @param input - 原子委派输入
   * @param persistAssistant - 同事务 assistant 尾部写入
   */
  prepareDelegation(input: PrepareDelegationInput, persistAssistant: () => undefined): void {
    validatePrepareInput(input);
    this.database.transaction((): void => {
      input.tasks.forEach((task): void => {
        this.database.execute(
          `INSERT INTO chat_agent_tasks (
            task_id, session_id, turn_id, agent_id, parent_agent_id, root_runtime_id,
            checkpoint_id, tool_call_id, contract_snapshot_json, contract_snapshot_hash,
            status, priority, deadline_at, record_state, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            task.taskId,
            task.sessionId,
            task.turnId,
            task.agentId,
            task.parentAgentId,
            task.rootRuntimeId,
            task.checkpointId,
            task.toolCallId,
            JSON.stringify(task.contractSnapshot),
            task.contractSnapshotHash,
            'created',
            task.priority,
            task.deadlineAt ?? null,
            'active',
            input.occurredAt,
            input.occurredAt
          ]
        );
      });
      this.database.execute(
        `INSERT INTO chat_agent_delegation_checkpoints (
          checkpoint_id, session_id, turn_id, primary_agent_id, root_runtime_id, source_runtime_id,
          assistant_message_id, continuation_snapshot_json, continuation_snapshot_hash,
          status, version, terminal_results_json, record_state, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.checkpoint.checkpointId,
          input.checkpoint.sessionId,
          input.checkpoint.turnId,
          input.checkpoint.primaryAgentId,
          input.checkpoint.rootRuntimeId,
          input.checkpoint.sourceRuntimeId,
          input.checkpoint.assistantMessageId,
          JSON.stringify(input.checkpoint.continuationSnapshot),
          input.checkpoint.continuationSnapshotHash,
          'preparing',
          0,
          '{}',
          'active',
          input.occurredAt,
          input.occurredAt
        ]
      );
      input.tasks.forEach((task): void => {
        this.appendEvent(
          'task',
          task.taskId,
          'task.created',
          { checkpointId: task.checkpointId, toolCallId: task.toolCallId },
          input.occurredAt,
          'coordinator'
        );
      });
      this.appendEvent(
        'checkpoint',
        input.checkpoint.checkpointId,
        'delegation.checkpoint_created',
        {
          taskIds: input.tasks.map((task): string => task.taskId),
          sourceRuntimeId: input.checkpoint.sourceRuntimeId
        },
        input.occurredAt,
        'coordinator'
      );
      const persistenceResult: unknown = persistAssistant();
      if (persistenceResult !== undefined) {
        throw new AgentStoreProtocolError('assistant_persistence_async', 'Assistant persistence must finish synchronously in the current transaction');
      }
      const transition = this.database.execute(
        `UPDATE chat_agent_delegation_checkpoints
         SET status = ?, version = ?, updated_at = ?
         WHERE checkpoint_id = ? AND status = ? AND version = ?`,
        ['waiting_children', 1, input.occurredAt, input.checkpoint.checkpointId, 'preparing', 0]
      );
      if (transition.changes !== 1) {
        throw new AgentStoreProtocolError('prepare_transition_conflict', 'Checkpoint prepare transition failed');
      }
      this.appendEvent(
        'checkpoint',
        input.checkpoint.checkpointId,
        'primary.suspended',
        {
          sourceRuntimeId: input.checkpoint.sourceRuntimeId
        },
        input.occurredAt,
        'primary'
      );
      this.database.execute(
        `INSERT INTO chat_agent_outbox (
          outbox_id, dedupe_key, event_type, payload_json, payload_hash, schema_version,
          delivery_status, attempt_count, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.outbox.outboxId,
          input.outbox.dedupeKey,
          input.outbox.eventType,
          JSON.stringify(input.outbox.payload),
          input.outbox.payloadHash,
          input.outbox.schemaVersion,
          'pending',
          0,
          input.occurredAt,
          input.occurredAt
        ]
      );
    });
  }

  /**
   * 追加经共享 validator 校验的聚合 Event。
   * @param aggregateKind - Event 聚合类型
   * @param aggregateId - Event 聚合 ID
   * @param type - Event 判别类型
   * @param payload - 与类型匹配的 allowlist payload
   * @param occurredAt - Event 时间
   * @param source - 可信来源
   * @param links - 可选 Attempt 与 Runtime 谱系
   */
  private appendEvent<TType extends ChatAgentEventType>(
    aggregateKind: 'task' | 'checkpoint',
    aggregateId: string,
    type: TType,
    payload: ChatAgentEventPayloadMap[TType],
    occurredAt: string,
    source: ChatAgentEventSource,
    links: AgentEventLinks = {}
  ): ChatAgentEvent {
    const maxRow = this.database.select<{ max_sequence: unknown }>(
      `SELECT MAX(sequence) AS max_sequence
       FROM chat_agent_events
       WHERE aggregate_kind = ? AND aggregate_id = ?`,
      [aggregateKind, aggregateId]
    )[0];
    const sequence = maxRow?.max_sequence === null || maxRow === undefined ? 1 : requireInteger(maxRow.max_sequence, 'event cursor') + 1;
    const validation = validateChatAgentEvent({
      eventId: `${aggregateKind}:${aggregateId}:${sequence}:${type}`,
      aggregate: { kind: aggregateKind, id: aggregateId },
      ...(aggregateKind === 'task' ? { taskId: aggregateId } : { checkpointId: aggregateId }),
      sequence,
      ...links,
      type,
      occurredAt,
      source,
      schemaVersion: 1,
      payload
    });
    if (!validation.ok) {
      throw new AgentStoreProtocolError(validation.error.details?.reason?.toString() ?? 'event_append_invalid', validation.error.message);
    }
    const { event } = validation;
    this.database.execute(
      `INSERT INTO chat_agent_events (
        event_id, aggregate_kind, aggregate_id, task_id, checkpoint_id, sequence,
        attempt_id, runtime_id, event_type, occurred_at, source, schema_version, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event.eventId,
        event.aggregate.kind,
        event.aggregate.id,
        event.taskId ?? null,
        event.checkpointId ?? null,
        event.sequence,
        event.attemptId ?? null,
        event.runtimeId ?? null,
        event.type,
        event.occurredAt,
        event.source,
        event.schemaVersion,
        JSON.stringify(event.payload)
      ]
    );
    return event;
  }

  /**
   * 按身份读取 Changeset。
   * @param changesetId - changeset ID
   * @returns Changeset，不存在时为 null
   */
  getChangeset(changesetId: string): AgentChangesetRecord | null {
    const row = this.database.select<ChangesetRow>('SELECT * FROM chat_agent_changesets WHERE changeset_id = ?', [changesetId])[0];
    return row ? parseChangeset(row) : null;
  }

  /**
   * 按 Attempt 读取唯一 Changeset。
   * @param attemptId - Attempt ID
   * @returns Changeset，不存在时为 null
   */
  private getAttemptChangeset(attemptId: string): AgentChangesetRecord | null {
    const row = this.database.select<ChangesetRow>('SELECT * FROM chat_agent_changesets WHERE attempt_id = ?', [attemptId])[0];
    return row ? parseChangeset(row) : null;
  }

  /**
   * 按身份读取 Confirmation。
   * @param confirmationId - confirmation ID
   * @returns Confirmation，不存在时为 null
   */
  /** @inheritdoc */
  getConfirmation(confirmationId: string): AgentConfirmationRecord | null {
    const row = this.database.select<ConfirmationRow>('SELECT * FROM chat_agent_confirmations WHERE confirmation_id = ?', [confirmationId])[0];
    return row ? parseConfirmation(row) : null;
  }

  /**
   * 按身份读取 Commit Journal。
   * @param journalId - journal ID
   * @returns Commit Journal，不存在时为 null
   */
  getCommitJournal(journalId: string): AgentCommitJournalRecord | null {
    const row = this.database.select<CommitJournalRow>('SELECT * FROM chat_agent_commit_journals WHERE journal_id = ?', [journalId])[0];
    return row ? parseCommitJournal(row) : null;
  }

  /**
   * 交叉校验 Attempt 投影与 Runtime 生命周期 Event。
   * @param task - Event 聚合所属 Task
   * @param events - Task 的完整有序历史
   */
  private validateRuntimeHistory(task: AgentTaskRecord, events: readonly ChatAgentEvent[]): void {
    const attempts = this.listTaskAttempts(task.taskId);
    const attemptById = new Map(attempts.map((attempt): [string, AgentAttemptRecord] => [attempt.attemptId, attempt]));
    const eventsByAttempt = new Map<string, AttemptRuntimeEvents>();

    events.forEach((event, index): void => {
      if (event.type !== 'runtime.starting' && event.type !== 'runtime.started') return;
      const attempt = event.attemptId ? attemptById.get(event.attemptId) : undefined;
      const payload = event.payload as ChatAgentEventPayloadMap['runtime.starting' | 'runtime.started'];
      const previous = events[index - 1];
      const previousPayload = previous?.type === 'task.status_changed' ? (previous.payload as ChatAgentEventPayloadMap['task.status_changed']) : undefined;
      const isStarting = event.type === 'runtime.starting';
      const expectedSource: ChatAgentEventSource = isStarting ? 'coordinator' : 'runtime';
      const expectedFrom: AgentTaskStatus = isStarting ? 'queued' : 'starting';
      const expectedTo: AgentTaskStatus = isStarting ? 'starting' : 'running';
      if (
        !attempt ||
        !event.runtimeId ||
        event.runtimeId !== payload.runtimeId ||
        event.runtimeId !== attempt.initialRuntimeId ||
        event.source !== expectedSource ||
        previous?.type !== 'task.status_changed' ||
        previous.attemptId !== attempt.attemptId ||
        previous.runtimeId !== event.runtimeId ||
        previousPayload?.from !== expectedFrom ||
        previousPayload.to !== expectedTo
      ) {
        throw new AgentStoreProtocolError('task_runtime_history_invalid', 'Runtime lifecycle Event does not match its Attempt or Task transition');
      }
      const runtimeEvents = eventsByAttempt.get(attempt.attemptId) ?? {};
      if ((isStarting && runtimeEvents.starting) || (!isStarting && runtimeEvents.started)) {
        throw new AgentStoreProtocolError('task_runtime_history_invalid', 'Runtime lifecycle Event is duplicated for one Attempt');
      }
      if (isStarting) runtimeEvents.starting = event;
      else runtimeEvents.started = event;
      eventsByAttempt.set(attempt.attemptId, runtimeEvents);
    });

    attempts.forEach((attempt): void => {
      const runtimeEvents = eventsByAttempt.get(attempt.attemptId);
      if (
        !runtimeEvents?.starting ||
        runtimeEvents.starting.occurredAt !== attempt.createdAt ||
        (attempt.startedAt === undefined) !== (runtimeEvents.started === undefined) ||
        (attempt.startedAt !== undefined && runtimeEvents.started?.occurredAt !== attempt.startedAt)
      ) {
        throw new AgentStoreProtocolError('task_runtime_history_invalid', 'Attempt projection and Runtime lifecycle history are not an exact pair');
      }
    });
  }

  /**
   * 校验聚合 Event 的连续序列和 Task 状态投影。
   * @param aggregateKind - Event 聚合类型
   * @param aggregateId - Event 聚合 ID
   * @param events - 已通过单 Event schema 校验的历史
   */
  private validateEventHistory(aggregateKind: 'task' | 'checkpoint', aggregateId: string, events: readonly ChatAgentEvent[]): void {
    if (aggregateKind === 'checkpoint') {
      const checkpoint = this.getCheckpoint(aggregateId);
      if (!checkpoint && events.length === 0) return;
      if (!checkpoint || events.length < 2) {
        throw new AgentStoreProtocolError('event_aggregate_incomplete', 'Checkpoint Event history is missing its aggregate or first Event');
      }
      events.forEach((event, index): void => {
        if (event.sequence !== index + 1) {
          throw new AgentStoreProtocolError('event_sequence_invalid', 'Checkpoint Event sequence is not continuous from one');
        }
      });
      const firstEvent = events[0];
      const firstPayload = firstEvent.payload as ChatAgentEventPayloadMap['delegation.checkpoint_created'];
      const expectedTaskIds = checkpoint.continuationSnapshot.orderedToolCalls.map((toolCall): string => toolCall.taskId);
      if (
        firstEvent.type !== 'delegation.checkpoint_created' ||
        firstEvent.source !== 'coordinator' ||
        firstPayload.sourceRuntimeId !== checkpoint.sourceRuntimeId ||
        firstPayload.taskIds.length !== expectedTaskIds.length ||
        !firstPayload.taskIds.every((taskId, index): boolean => taskId === expectedTaskIds[index])
      ) {
        throw new AgentStoreProtocolError('checkpoint_event_origin_invalid', 'Checkpoint Event history does not start with its frozen delegation identity');
      }
      const suspendedEvent = events[1];
      const suspendedPayload = suspendedEvent.payload as ChatAgentEventPayloadMap['primary.suspended'];
      if (
        suspendedEvent.type !== 'primary.suspended' ||
        suspendedEvent.source !== 'primary' ||
        suspendedPayload.sourceRuntimeId !== checkpoint.sourceRuntimeId
      ) {
        throw new AgentStoreProtocolError('checkpoint_event_suspension_invalid', 'Checkpoint second Event is not its matching Primary suspension');
      }

      // 从 preparing 起重放所有会改变 Checkpoint 投影的 Event，非状态 Event 允许穿插。
      let projectedStatus: AgentCheckpointStatus = 'waiting_children';
      events.slice(2).forEach((event): void => {
        let targetStatus: AgentCheckpointStatus | undefined;
        if (event.type === 'delegation.checkpoint_created' || event.type === 'primary.suspended') {
          throw new AgentStoreProtocolError('checkpoint_event_origin_duplicate', 'Checkpoint origin Events cannot repeat');
        }
        if (event.type === 'delegation.ready') {
          const payload = event.payload as ChatAgentEventPayloadMap['delegation.ready'];
          if (payload.resultCount !== Object.keys(checkpoint.terminalResults).length) {
            throw new AgentStoreProtocolError('checkpoint_event_ready_invalid', 'Checkpoint ready Event result count does not match its projection');
          }
          targetStatus = 'ready_to_resume';
        } else if (event.type === 'primary.resume_started') {
          const payload = event.payload as ChatAgentEventPayloadMap['primary.resume_started'];
          if (payload.runtimeId !== checkpoint.resumeRuntimeId) {
            throw new AgentStoreProtocolError('checkpoint_event_resume_invalid', 'Checkpoint resume Event Runtime does not match its projection');
          }
          targetStatus = 'resuming';
        } else if (event.type === 'delegation.cancel_requested') {
          targetStatus = 'cancelling';
        } else if (event.type === 'delegation.interrupted') {
          targetStatus = 'interrupted';
        } else if (event.type === 'delegation.completed') {
          const payload = event.payload as ChatAgentEventPayloadMap['delegation.completed'];
          targetStatus = payload.outcome;
        }
        if (targetStatus !== undefined) {
          if (!canTransitionCheckpoint(projectedStatus, targetStatus)) {
            throw new AgentStoreProtocolError('checkpoint_event_transition_invalid', 'Checkpoint Event history contains an illegal status transition');
          }
          projectedStatus = targetStatus;
        }
      });
      if (projectedStatus !== checkpoint.status) {
        throw new AgentStoreProtocolError('checkpoint_event_projection_invalid', 'Checkpoint Event projection does not match the persisted Checkpoint status');
      }
      return;
    }

    const task = this.getTask(aggregateId);
    if (!task && events.length === 0) return;
    if (!task || events.length === 0) {
      throw new AgentStoreProtocolError('event_aggregate_incomplete', 'Task Event history is missing its aggregate or first Event');
    }

    // Task 历史必须由身份绑定的 task.created 开始。
    const firstEvent = events[0];
    const createdPayload = firstEvent.payload as ChatAgentEventPayloadMap['task.created'];
    if (
      firstEvent.sequence !== 1 ||
      firstEvent.type !== 'task.created' ||
      createdPayload.checkpointId !== task.checkpointId ||
      createdPayload.toolCallId !== task.toolCallId
    ) {
      throw new AgentStoreProtocolError('task_event_origin_invalid', 'Task Event history does not start with its matching creation Event');
    }

    let projectedStatus: AgentTaskStatus = 'created';
    let planAuthorizedCount = 0;
    events.forEach((event, index): void => {
      if (event.sequence !== index + 1) {
        throw new AgentStoreProtocolError('event_sequence_invalid', 'Task Event sequence is not continuous from one');
      }
      if (index > 0 && event.type === 'task.created') {
        throw new AgentStoreProtocolError('task_event_duplicate_create', 'Task Event history contains a duplicate creation Event');
      }
      if (event.type === 'task.status_changed') {
        const payload = event.payload as ChatAgentEventPayloadMap['task.status_changed'];
        if (payload.from !== projectedStatus) {
          throw new AgentStoreProtocolError('task_event_status_link_invalid', 'Task status Event does not link from the projected state');
        }
        projectedStatus = payload.to;
        return;
      }
      if (event.type === 'plan.authorized') {
        const payload = event.payload as ChatAgentEventPayloadMap['plan.authorized'];
        if (
          projectedStatus !== 'authorized' ||
          !task.executionPlanSnapshot ||
          payload.planHash !== task.executionPlanSnapshotHash ||
          payload.planSchemaVersion !== task.executionPlanSnapshot.planSchemaVersion ||
          payload.policyVersion !== task.executionPlanSnapshot.policyVersion
        ) {
          throw new AgentStoreProtocolError('task_event_plan_invalid', 'Plan authorization Event does not match the immutable Task plan');
        }
        planAuthorizedCount += 1;
        return;
      }
      if (event.type === 'task.queued') {
        const payload = event.payload as ChatAgentEventPayloadMap['task.queued'];
        const previous = events[index - 1];
        const previousPayload = previous?.type === 'task.status_changed' ? (previous.payload as ChatAgentEventPayloadMap['task.status_changed']) : undefined;
        if (
          projectedStatus !== 'queued' ||
          previous?.type !== 'task.status_changed' ||
          previousPayload?.to !== 'queued' ||
          previousPayload.queuePhase !== payload.queuePhase
        ) {
          throw new AgentStoreProtocolError('task_event_queue_invalid', 'Task queued Event does not follow its matching status transition');
        }
        return;
      }
      if (event.type === 'task.completed') {
        const payload = event.payload as ChatAgentEventPayloadMap['task.completed'];
        if (isTaskTerminal(projectedStatus) || payload.resultHash !== task.resultHash || task.result?.executionStatus !== 'completed') {
          throw new AgentStoreProtocolError('task_event_completion_invalid', 'Task completion Event does not match its persisted result');
        }
        projectedStatus = 'completed';
        return;
      }
      if (event.type === 'task.cancelled') {
        const payload = event.payload as ChatAgentEventPayloadMap['task.cancelled'];
        if (
          isTaskTerminal(projectedStatus) ||
          (payload.resultHash !== undefined && (payload.resultHash !== task.resultHash || task.result?.executionStatus !== 'cancelled'))
        ) {
          throw new AgentStoreProtocolError('task_event_cancellation_invalid', 'Task cancellation Event does not match its persisted result');
        }
        projectedStatus = 'cancelled';
        return;
      }
      if (event.type === 'task.failed') {
        const payload = event.payload as ChatAgentEventPayloadMap['task.failed'];
        const resultStatus = task.result?.executionStatus;
        if (
          isTaskTerminal(projectedStatus) ||
          payload.resultHash === undefined ||
          payload.resultHash !== task.resultHash ||
          resultStatus === undefined ||
          !TASK_FAILURE_STATUSES.has(resultStatus)
        ) {
          throw new AgentStoreProtocolError('task_event_failure_invalid', 'Task failure Event does not match its persisted result');
        }
        projectedStatus = resultStatus;
      }
    });
    if (projectedStatus !== task.status) {
      throw new AgentStoreProtocolError('task_event_projection_invalid', 'Task Event projection does not match the persisted Task status');
    }
    if (planAuthorizedCount !== (task.executionPlanSnapshot ? 1 : 0)) {
      throw new AgentStoreProtocolError('task_event_plan_invalid', 'Task plan and authorization Event are not an exact pair');
    }
    this.validateRuntimeHistory(task, events);
  }

  /**
   * 加载并交叉校验 Checkpoint、Tasks 与完整终态结果。
   * @param checkpointId - 聚合根 Checkpoint ID
   * @returns 经校验的聚合；Checkpoint 不存在时返回 null
   */
  private loadValidatedAggregate(checkpointId: string): ValidatedAgentAggregate | null {
    const checkpoint = this.getCheckpoint(checkpointId);
    if (!checkpoint) return null;
    const tasks = this.database
      .select<TaskRow>(
        `SELECT * FROM chat_agent_tasks
         WHERE checkpoint_id = ?
         ORDER BY created_at ASC, task_id ASC`,
        [checkpoint.checkpointId]
      )
      .map(parseTask);
    const { orderedToolCalls } = checkpoint.continuationSnapshot;
    const taskById = new Map(tasks.map((task): [string, AgentTaskRecord] => [task.taskId, task]));

    // 每个冻结 tool-call 必须精确映射一个同聚合、未删除的 Task，且不能存在额外 Task。
    if (
      tasks.length !== orderedToolCalls.length ||
      taskById.size !== tasks.length ||
      orderedToolCalls.some((toolCall): boolean => {
        const task = taskById.get(toolCall.taskId);
        return (
          !task ||
          task.toolCallId !== toolCall.toolCallId ||
          task.checkpointId !== checkpoint.checkpointId ||
          task.sessionId !== checkpoint.sessionId ||
          task.turnId !== checkpoint.turnId ||
          task.parentAgentId !== checkpoint.primaryAgentId ||
          task.rootRuntimeId !== checkpoint.rootRuntimeId ||
          task.contractSnapshot.required !== toolCall.required ||
          task.recordState !== 'active'
        );
      })
    ) {
      throw new AgentStoreProtocolError('delegation_aggregate_mapping_invalid', 'Checkpoint continuation and persisted Tasks are not an exact aggregate');
    }

    // 聚合恢复必须重验每个 Task 和 Checkpoint 的完整事件历史。
    tasks.forEach((task): void => {
      this.listEvents('task', task.taskId);
    });
    const checkpointEvents = this.listEvents('checkpoint', checkpoint.checkpointId);

    // 每个持久化终态结果必须与唯一同 tool-call、同 hash 的结果审计 Event 构成双射。
    const resultEntries = Object.entries(checkpoint.terminalResults);
    const resultEvents = checkpointEvents.filter((event): boolean => event.type === 'child.result_recorded');
    if (resultEvents.length !== resultEntries.length) {
      throw new AgentStoreProtocolError('delegation_result_events_invalid', 'Terminal results and result Events are not an exact set');
    }
    const recordedToolCalls = new Set<string>();
    resultEvents.forEach((event): void => {
      const payload = event.payload as ChatAgentEventPayloadMap['child.result_recorded'];
      const envelope = checkpoint.terminalResults[payload.toolCallId];
      if (recordedToolCalls.has(payload.toolCallId) || !envelope || envelope.resultHash !== payload.resultHash) {
        throw new AgentStoreProtocolError('delegation_result_events_invalid', 'Terminal results and result Events are not an exact set');
      }
      recordedToolCalls.add(payload.toolCallId);
    });
    if (resultEntries.some(([toolCallId]): boolean => !recordedToolCalls.has(toolCallId))) {
      throw new AgentStoreProtocolError('delegation_result_events_invalid', 'Terminal results and result Events are not an exact set');
    }

    // currentAttemptId 必须解引用为与 Task 和冻结计划严格一致的真实 Attempt。
    tasks.forEach((task): void => {
      if (!task.currentAttemptId) return;
      const attemptRow = this.database.select<AttemptRow>('SELECT * FROM chat_agent_attempts WHERE attempt_id = ?', [task.currentAttemptId])[0];
      if (!attemptRow) {
        throw new AgentStoreProtocolError('delegation_attempt_missing', 'Task current Attempt does not exist');
      }
      const attempt = parseAttempt(attemptRow);
      const attemptStateMatches =
        (task.status === 'starting' && attempt.status === 'starting') ||
        (TASK_RUNNING_ATTEMPT_STATUSES.has(task.status) && attempt.status === 'running') ||
        (task.status === 'cancelling' && (attempt.status === 'starting' || attempt.status === 'running')) ||
        (isTaskTerminal(task.status) && ATTEMPT_TERMINAL_STATUSES.has(attempt.status));
      if (
        attempt.attemptId !== task.currentAttemptId ||
        attempt.taskId !== task.taskId ||
        task.executionPlanSnapshotHash === undefined ||
        attempt.planHash !== task.executionPlanSnapshotHash ||
        !attemptStateMatches ||
        (task.result !== undefined && attempt.status !== task.result.executionStatus)
      ) {
        throw new AgentStoreProtocolError('delegation_attempt_state_invalid', 'Task current Attempt does not match its identity, plan, state, or result');
      }
    });

    // 可恢复状态必须已经持有全部 tool-call 的一致终态结果。
    if (checkpoint.status === 'ready_to_resume' || checkpoint.status === 'resuming') {
      if (
        resultEntries.length !== orderedToolCalls.length ||
        orderedToolCalls.some((toolCall): boolean => {
          const task = taskById.get(toolCall.taskId);
          const envelope = checkpoint.terminalResults[toolCall.toolCallId];
          return (
            !task ||
            !envelope ||
            !task.result ||
            !task.resultHash ||
            !isTaskTerminal(task.status) ||
            task.status !== task.result.executionStatus ||
            envelope.resultHash !== task.resultHash ||
            envelope.result.taskId !== task.taskId ||
            envelope.result.agentId !== task.agentId ||
            (isPreAttemptFailure(envelope.result)
              ? task.currentAttemptId !== undefined || !isPreAttemptFailure(task.result)
              : isPreAttemptFailure(task.result) || envelope.result.attemptId !== task.currentAttemptId)
          );
        })
      ) {
        throw new AgentStoreProtocolError(
          'delegation_aggregate_results_incomplete',
          'Resumable Checkpoint does not contain one valid result per frozen tool-call'
        );
      }
    }

    const frozenCheckpoint = Object.freeze(checkpoint);
    const frozenTasks = tasks.map((task): AgentTaskRecord => Object.freeze(task));
    Object.freeze(frozenTasks);
    return Object.freeze({ checkpoint: frozenCheckpoint, tasks: frozenTasks });
  }

  /** @inheritdoc */
  transitionTask(input: TransitionAgentTaskInput): AgentTaskRecord {
    return this.database.transaction((): AgentTaskRecord => {
      const task = this.getTask(input.taskId);
      if (!task) throw new AgentStoreProtocolError('task_not_found', 'Task does not exist');
      if (task.recordState !== 'active') throw new AgentStoreProtocolError('task_tombstoned', 'Task is tombstoned');
      if (
        task.contractSnapshot.mode === 'read' &&
        ((task.status === 'created' && input.toStatus === 'planning') || (task.status === 'planning' && input.toStatus === 'authorized'))
      ) {
        throw new AgentStoreProtocolError('read_authorization_requires_atomic_protocol', 'Read Task authorization must use authorizeTask');
      }
      if (isTaskTerminal(input.toStatus)) {
        throw new AgentStoreProtocolError('task_terminalization_requires_protocol', 'Terminal Task states require result, cancellation, or recovery protocol');
      }

      const includesPlan = input.executionPlanSnapshot !== undefined || input.executionPlanSnapshotHash !== undefined;
      let authorizedPlan: AgentExecutionPlanSnapshot | undefined;
      if (input.toStatus === 'authorized') {
        if (
          task.executionPlanSnapshot ||
          !input.executionPlanSnapshot ||
          !input.executionPlanSnapshotHash ||
          input.executionPlanSnapshot.planHash !== input.executionPlanSnapshotHash
        ) {
          throw new AgentStoreProtocolError('execution_plan_write_invalid', 'Authorization requires one new matching plan');
        }
        const planValidation = validateExecutionPlanSnapshot(task.contractSnapshot, input.executionPlanSnapshot);
        if (!planValidation.ok || planValidation.plan.planHash !== input.executionPlanSnapshotHash) {
          throw new AgentStoreProtocolError('execution_plan_invalid', 'Execution plan failed contract-bound validation');
        }
        authorizedPlan = planValidation.plan;
      } else if (includesPlan) {
        throw new AgentStoreProtocolError('execution_plan_immutable', 'Execution plan can only be written at authorization');
      }

      let contextQueuePhase: AgentTaskQueuePhase | undefined;
      let nextQueuePhase: AgentTaskQueuePhase | undefined;
      if (task.status === 'queued' && input.toStatus === 'queued') {
        contextQueuePhase = task.queuePhase;
        nextQueuePhase = input.queuePhase;
      } else if (input.toStatus === 'queued') {
        contextQueuePhase = input.queuePhase;
      } else if (task.status === 'queued') {
        contextQueuePhase = task.queuePhase;
      }
      if (
        !canTransitionTask(task.status, input.toStatus, {
          mode: task.contractSnapshot.mode,
          queuePhase: contextQueuePhase,
          nextQueuePhase,
          executionPlanSnapshot: authorizedPlan,
          contractSnapshot: task.contractSnapshot
        })
      ) {
        throw new AgentStoreProtocolError('task_transition_invalid', 'Task state transition is not legal');
      }

      const targetQueuePhase = input.toStatus === 'queued' ? input.queuePhase ?? null : null;
      const update = authorizedPlan
        ? this.database.execute(
            `UPDATE chat_agent_tasks
             SET status = ?, queue_phase = ?, execution_plan_snapshot_json = ?,
                 execution_plan_snapshot_hash = ?, updated_at = ?
             WHERE task_id = ? AND status = ? AND record_state = ?
               AND execution_plan_snapshot_json IS NULL AND execution_plan_snapshot_hash IS NULL`,
            [input.toStatus, targetQueuePhase, JSON.stringify(authorizedPlan), authorizedPlan.planHash, input.occurredAt, task.taskId, task.status, 'active']
          )
        : this.database.execute(
            `UPDATE chat_agent_tasks
             SET status = ?, queue_phase = ?, updated_at = ?
             WHERE task_id = ? AND status = ? AND record_state = ?`,
            [input.toStatus, targetQueuePhase, input.occurredAt, task.taskId, task.status, 'active']
          );
      if (update.changes !== 1) throw new AgentStoreProtocolError('task_transition_conflict', 'Task projection changed concurrently');
      this.appendEvent(
        'task',
        task.taskId,
        'task.status_changed',
        {
          from: task.status,
          to: input.toStatus,
          ...(targetQueuePhase ? { queuePhase: targetQueuePhase } : {})
        },
        input.occurredAt,
        input.source
      );
      if (authorizedPlan) {
        this.appendEvent(
          'task',
          task.taskId,
          'plan.authorized',
          {
            planHash: authorizedPlan.planHash,
            planSchemaVersion: authorizedPlan.planSchemaVersion,
            policyVersion: authorizedPlan.policyVersion
          },
          input.occurredAt,
          input.source
        );
      }
      if (input.toStatus === 'queued' && input.queuePhase) {
        this.appendEvent('task', task.taskId, 'task.queued', { queuePhase: input.queuePhase }, input.occurredAt, input.source);
      }
      const updated = this.getTask(task.taskId);
      if (!updated) throw new AgentStoreProtocolError('task_projection_missing', 'Updated Task is missing');
      return updated;
    });
  }

  /** @inheritdoc */
  authorizeTask(input: AuthorizeAgentTaskInput): AgentTaskRecord {
    return this.database.transaction((): AgentTaskRecord => {
      const task = this.getTask(input.taskId);
      if (!task) throw new AgentStoreProtocolError('task_not_found', 'Task does not exist');
      if (task.recordState !== 'active') throw new AgentStoreProtocolError('task_tombstoned', 'Task is tombstoned');
      if (input.executionPlanSnapshot.planHash !== input.executionPlanSnapshotHash || !Number.isFinite(Date.parse(input.occurredAt))) {
        throw new AgentStoreProtocolError('authorization_input_invalid', 'Authorization envelope or plan hash is invalid');
      }
      const planValidation = validateExecutionPlanSnapshot(task.contractSnapshot, input.executionPlanSnapshot);
      if (!planValidation.ok || planValidation.plan.planHash !== input.executionPlanSnapshotHash) {
        throw new AgentStoreProtocolError('execution_plan_invalid', 'Execution plan failed contract-bound validation');
      }

      // 相同授权可安全重放，但必须重验完整 Event 历史，不能补写半套事实。
      if (
        task.status === 'queued' &&
        task.queuePhase === 'start' &&
        task.executionPlanSnapshotHash === input.executionPlanSnapshotHash &&
        task.executionPlanSnapshot?.planHash === input.executionPlanSnapshotHash
      ) {
        const events = this.listEvents('task', task.taskId);
        const planEvents = events.filter((event): boolean => event.type === 'plan.authorized');
        const queueEvents = events.filter((event): boolean => event.type === 'task.queued');
        const planEvent = planEvents[0];
        const queueEvent = queueEvents[0];
        const planPayload = planEvent?.payload as ChatAgentEventPayloadMap['plan.authorized'] | undefined;
        const queuePayload = queueEvent?.payload as ChatAgentEventPayloadMap['task.queued'] | undefined;
        if (
          planEvents.length !== 1 ||
          queueEvents.length !== 1 ||
          planPayload?.planHash !== input.executionPlanSnapshotHash ||
          queuePayload?.queuePhase !== 'start'
        ) {
          throw new AgentStoreProtocolError('authorization_history_invalid', 'Authorized Task history is incomplete or inconsistent');
        }
        return task;
      }
      if (task.status !== 'created' || task.executionPlanSnapshot || task.executionPlanSnapshotHash) {
        throw new AgentStoreProtocolError('authorization_state_invalid', 'Task is not eligible for first authorization');
      }
      const checkpoint = this.getCheckpoint(task.checkpointId);
      const orderedCall = checkpoint?.continuationSnapshot.orderedToolCalls.find((entry): boolean => entry.taskId === task.taskId);
      const frozenModel = checkpoint?.continuationSnapshot.modelSnapshot;
      if (
        !checkpoint ||
        checkpoint.status !== 'waiting_children' ||
        checkpoint.recordState !== 'active' ||
        checkpoint.sessionId !== task.sessionId ||
        checkpoint.turnId !== task.turnId ||
        checkpoint.primaryAgentId !== task.parentAgentId ||
        checkpoint.rootRuntimeId !== task.rootRuntimeId ||
        orderedCall?.toolCallId !== task.toolCallId ||
        !frozenModel ||
        frozenModel.providerId !== planValidation.plan.modelSnapshot.providerId ||
        frozenModel.modelId !== planValidation.plan.modelSnapshot.modelId
      ) {
        throw new AgentStoreProtocolError('authorization_aggregate_invalid', 'Authorization plan does not match its active Checkpoint');
      }
      if (
        !canTransitionTask('created', 'planning', { mode: task.contractSnapshot.mode }) ||
        !canTransitionTask('planning', 'authorized', {
          mode: task.contractSnapshot.mode,
          executionPlanSnapshot: planValidation.plan,
          contractSnapshot: task.contractSnapshot
        }) ||
        !canTransitionTask('authorized', 'queued', { mode: task.contractSnapshot.mode, queuePhase: 'start' })
      ) {
        throw new AgentStoreProtocolError('authorization_protocol_invalid', 'Authorization transitions are not legal');
      }

      const planningUpdate = this.database.execute(
        `UPDATE chat_agent_tasks
         SET status = ?, queue_phase = NULL, updated_at = ?
         WHERE task_id = ? AND status = ? AND record_state = ?
           AND execution_plan_snapshot_json IS NULL AND execution_plan_snapshot_hash IS NULL`,
        ['planning', input.occurredAt, task.taskId, 'created', 'active']
      );
      if (planningUpdate.changes !== 1) {
        throw new AgentStoreProtocolError('authorization_conflict', 'Task changed before planning could be recorded');
      }
      this.appendEvent('task', task.taskId, 'task.status_changed', { from: 'created', to: 'planning' }, input.occurredAt, input.source);

      const authorizationUpdate = this.database.execute(
        `UPDATE chat_agent_tasks
         SET status = ?, execution_plan_snapshot_json = ?,
             execution_plan_snapshot_hash = ?, updated_at = ?
         WHERE task_id = ? AND status = ? AND record_state = ?
           AND execution_plan_snapshot_json IS NULL AND execution_plan_snapshot_hash IS NULL`,
        ['authorized', JSON.stringify(planValidation.plan), planValidation.plan.planHash, input.occurredAt, task.taskId, 'planning', 'active']
      );
      if (authorizationUpdate.changes !== 1) {
        throw new AgentStoreProtocolError('authorization_conflict', 'Task changed before authorization could be recorded');
      }
      this.appendEvent('task', task.taskId, 'task.status_changed', { from: 'planning', to: 'authorized' }, input.occurredAt, input.source);
      this.appendEvent(
        'task',
        task.taskId,
        'plan.authorized',
        {
          planHash: planValidation.plan.planHash,
          planSchemaVersion: planValidation.plan.planSchemaVersion,
          policyVersion: planValidation.plan.policyVersion
        },
        input.occurredAt,
        input.source
      );

      const queueUpdate = this.database.execute(
        `UPDATE chat_agent_tasks
         SET status = ?, queue_phase = ?, updated_at = ?
         WHERE task_id = ? AND status = ? AND record_state = ?`,
        ['queued', 'start', input.occurredAt, task.taskId, 'authorized', 'active']
      );
      if (queueUpdate.changes !== 1) {
        throw new AgentStoreProtocolError('authorization_conflict', 'Task changed before start queue could be recorded');
      }
      this.appendEvent('task', task.taskId, 'task.status_changed', { from: 'authorized', to: 'queued', queuePhase: 'start' }, input.occurredAt, input.source);
      this.appendEvent('task', task.taskId, 'task.queued', { queuePhase: 'start' }, input.occurredAt, input.source);

      const authorized = this.getTask(task.taskId);
      if (!authorized) throw new AgentStoreProtocolError('task_projection_missing', 'Authorized Task is missing');
      return authorized;
    });
  }

  /** @inheritdoc */
  beginAttempt(input: BeginAgentAttemptInput): AgentAttemptProjection {
    return this.database.transaction((): AgentAttemptProjection => {
      const task = this.getTask(input.taskId);
      if (!task) throw new AgentStoreProtocolError('task_not_found', 'Task does not exist');
      if (task.recordState !== 'active') throw new AgentStoreProtocolError('task_tombstoned', 'Task is tombstoned');

      const existingAttempt = this.getAttempt(input.attemptId);
      if (
        task.status === 'starting' &&
        task.currentAttemptId === input.attemptId &&
        existingAttempt?.taskId === task.taskId &&
        existingAttempt.parentRuntimeId === input.parentRuntimeId &&
        existingAttempt.initialRuntimeId === input.runtimeId &&
        existingAttempt.currentRuntimeId === input.runtimeId &&
        existingAttempt.status === 'starting' &&
        existingAttempt.planHash === task.executionPlanSnapshotHash
      ) {
        this.listEvents('task', task.taskId);
        return Object.freeze({ task, attempt: existingAttempt });
      }
      if (task.status !== 'queued' || task.queuePhase !== 'start' || task.currentAttemptId !== undefined) {
        throw new AgentStoreProtocolError('attempt_start_state_invalid', 'Task is not eligible to begin an Attempt', 'starting');
      }
      if (!task.executionPlanSnapshotHash || !task.executionPlanSnapshot) {
        throw new AgentStoreProtocolError('attempt_plan_missing', 'Task has no frozen Execution Plan', 'starting');
      }
      const checkpoint = this.getCheckpoint(task.checkpointId);
      if (!checkpoint || checkpoint.recordState !== 'active') {
        throw new AgentStoreProtocolError('attempt_checkpoint_missing', 'Attempt checkpoint is unavailable', 'starting');
      }
      if (checkpoint.sourceRuntimeId !== input.parentRuntimeId) {
        throw new AgentStoreProtocolError('attempt_parent_runtime_mismatch', 'Attempt parent Runtime does not match its checkpoint', 'starting');
      }
      if (existingAttempt) {
        throw new AgentStoreProtocolError('attempt_identity_conflict', 'Attempt identity is already bound', 'starting');
      }

      const maxAttemptRow = this.database.select<{ max_attempt_number: unknown }>(
        'SELECT MAX(attempt_number) AS max_attempt_number FROM chat_agent_attempts WHERE task_id = ?',
        [task.taskId]
      )[0];
      const attemptNumber =
        maxAttemptRow === undefined || maxAttemptRow.max_attempt_number === null
          ? 1
          : requireInteger(maxAttemptRow.max_attempt_number, 'attempt number cursor') + 1;
      this.database.execute(
        `INSERT INTO chat_agent_attempts (
          attempt_id, task_id, attempt_number, parent_runtime_id, plan_hash,
          initial_runtime_id, current_runtime_id, runtime_sequence, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.attemptId,
          task.taskId,
          attemptNumber,
          input.parentRuntimeId,
          task.executionPlanSnapshotHash,
          input.runtimeId,
          input.runtimeId,
          1,
          'starting',
          input.occurredAt
        ]
      );
      const taskUpdate = this.database.execute(
        `UPDATE chat_agent_tasks
         SET status = ?, queue_phase = NULL, current_attempt_id = ?, updated_at = ?
         WHERE task_id = ? AND status = ? AND queue_phase = ? AND current_attempt_id IS NULL
           AND execution_plan_snapshot_hash = ? AND record_state = ?`,
        ['starting', input.attemptId, input.occurredAt, task.taskId, 'queued', 'start', task.executionPlanSnapshotHash, 'active']
      );
      if (taskUpdate.changes !== 1) {
        throw new AgentStoreProtocolError('attempt_start_conflict', 'Task changed while beginning its Attempt', 'starting');
      }
      const links = { attemptId: input.attemptId, runtimeId: input.runtimeId };
      this.appendEvent('task', task.taskId, 'task.status_changed', { from: 'queued', to: 'starting' }, input.occurredAt, 'coordinator', links);
      this.appendEvent('task', task.taskId, 'runtime.starting', { runtimeId: input.runtimeId }, input.occurredAt, 'coordinator', links);

      const updatedTask = this.getTask(task.taskId);
      const attempt = this.getAttempt(input.attemptId);
      if (!updatedTask || !attempt) {
        throw new AgentStoreProtocolError('attempt_projection_missing', 'Started Attempt projection is missing', 'starting');
      }
      return Object.freeze({ task: updatedTask, attempt });
    });
  }

  /** @inheritdoc */
  markAttemptRunning(input: MarkAgentAttemptInput): AgentAttemptProjection {
    return this.database.transaction((): AgentAttemptProjection => {
      const task = this.getTask(input.taskId);
      const attempt = this.getAttempt(input.attemptId);
      if (!task || !attempt) {
        throw new AgentStoreProtocolError('attempt_target_missing', 'Task or Attempt does not exist', 'starting');
      }
      if (task.recordState !== 'active') throw new AgentStoreProtocolError('task_tombstoned', 'Task is tombstoned');
      if (
        task.status === 'running' &&
        task.currentAttemptId === attempt.attemptId &&
        attempt.taskId === task.taskId &&
        attempt.currentRuntimeId === input.runtimeId &&
        attempt.status === 'running' &&
        attempt.planHash === task.executionPlanSnapshotHash
      ) {
        this.listEvents('task', task.taskId);
        return Object.freeze({ task, attempt });
      }
      if (attempt.taskId !== task.taskId) {
        throw new AgentStoreProtocolError('attempt_task_mismatch', 'Attempt does not belong to Task', 'starting');
      }
      if (task.currentAttemptId !== attempt.attemptId) {
        throw new AgentStoreProtocolError('attempt_current_mismatch', 'Task current Attempt identity does not match', 'starting');
      }
      if (attempt.currentRuntimeId !== input.runtimeId || attempt.initialRuntimeId !== input.runtimeId) {
        throw new AgentStoreProtocolError('attempt_runtime_mismatch', 'Attempt Runtime identity does not match', 'starting');
      }
      if (
        task.status !== 'starting' ||
        attempt.status !== 'starting' ||
        !task.executionPlanSnapshotHash ||
        attempt.planHash !== task.executionPlanSnapshotHash
      ) {
        throw new AgentStoreProtocolError('attempt_running_state_invalid', 'Attempt is not eligible to enter running', 'starting');
      }

      const attemptUpdate = this.database.execute(
        `UPDATE chat_agent_attempts
         SET status = ?, started_at = ?
         WHERE attempt_id = ? AND task_id = ? AND current_runtime_id = ? AND status = ? AND started_at IS NULL`,
        ['running', input.occurredAt, attempt.attemptId, task.taskId, input.runtimeId, 'starting']
      );
      if (attemptUpdate.changes !== 1) {
        throw new AgentStoreProtocolError('attempt_running_conflict', 'Attempt changed while acknowledging Runtime start', 'starting');
      }
      const taskUpdate = this.database.execute(
        `UPDATE chat_agent_tasks
         SET status = ?, updated_at = ?
         WHERE task_id = ? AND current_attempt_id = ? AND status = ? AND record_state = ?`,
        ['running', input.occurredAt, task.taskId, attempt.attemptId, 'starting', 'active']
      );
      if (taskUpdate.changes !== 1) {
        throw new AgentStoreProtocolError('attempt_task_running_conflict', 'Task changed while acknowledging Runtime start', 'starting');
      }
      const links = { attemptId: attempt.attemptId, runtimeId: input.runtimeId };
      this.appendEvent('task', task.taskId, 'task.status_changed', { from: 'starting', to: 'running' }, input.occurredAt, 'runtime', links);
      this.appendEvent('task', task.taskId, 'runtime.started', { runtimeId: input.runtimeId }, input.occurredAt, 'runtime', links);

      const updatedTask = this.getTask(task.taskId);
      const updatedAttempt = this.getAttempt(attempt.attemptId);
      if (!updatedTask || !updatedAttempt) {
        throw new AgentStoreProtocolError('attempt_projection_missing', 'Running Attempt projection is missing', 'starting');
      }
      return Object.freeze({ task: updatedTask, attempt: updatedAttempt });
    });
  }

  /** @inheritdoc */
  prepareChangeset(input: PrepareAgentChangesetInput): AgentChangesetRecord {
    const validation = validateChangesetSnapshot(input.snapshot, input.snapshotHash);
    if (!validation.ok || !Number.isFinite(Date.parse(input.occurredAt))) {
      throw new AgentStoreProtocolError(
        validation.ok ? 'changeset_input_invalid' : validation.error.details?.reason?.toString() ?? 'changeset_snapshot_invalid',
        validation.ok ? 'Changeset timestamp is invalid' : validation.error.message,
        'commit_validation'
      );
    }
    const { snapshot } = validation;
    return this.database.transaction((): AgentChangesetRecord => {
      const existingByAttempt = this.getAttemptChangeset(snapshot.attemptId);
      const existingById = this.getChangeset(snapshot.changesetId);
      const existing = existingByAttempt ?? existingById;
      if (existing) {
        if (
          existing.snapshot.changesetId === snapshot.changesetId &&
          existing.snapshot.attemptId === snapshot.attemptId &&
          existing.snapshotHash === input.snapshotHash
        ) {
          return existing;
        }
        throw new AgentStoreProtocolError('changeset_replay_conflict', 'Attempt already owns a different immutable changeset', 'commit_validation');
      }

      const task = this.getTask(snapshot.taskId);
      const attempt = this.getAttempt(snapshot.attemptId);
      if (
        !task ||
        !attempt ||
        task.recordState !== 'active' ||
        task.contractSnapshot.mode !== 'write' ||
        task.status !== 'running' ||
        task.currentAttemptId !== snapshot.attemptId ||
        !task.executionPlanSnapshot ||
        !task.executionPlanSnapshotHash
      ) {
        throw new AgentStoreProtocolError('changeset_task_invalid', 'Changeset requires the current running write Task', 'commit_validation');
      }
      if (
        attempt.taskId !== task.taskId ||
        attempt.status !== 'running' ||
        attempt.planHash !== task.executionPlanSnapshotHash ||
        snapshot.planHash !== task.executionPlanSnapshotHash ||
        snapshot.agentId !== task.agentId
      ) {
        throw new AgentStoreProtocolError('changeset_attempt_mismatch', 'Changeset does not match the current Attempt or frozen plan', 'commit_validation');
      }
      if (attempt.currentRuntimeId !== snapshot.runtimeId) {
        throw new AgentStoreProtocolError('changeset_runtime_mismatch', 'Changeset Runtime does not own the current Attempt', 'commit_validation');
      }
      if (
        task.executionPlanSnapshot.commitPolicy.mode !== 'staged' ||
        snapshot.resourceScopes.some((scope): boolean => !task.executionPlanSnapshot?.resourceScopes.includes(scope))
      ) {
        throw new AgentStoreProtocolError('changeset_scope_invalid', 'Changeset exceeds the frozen staged-write resource scopes', 'resource_validation');
      }

      const insert = this.database.execute(
        `INSERT INTO chat_agent_changesets (
          changeset_id, task_id, attempt_id, agent_id, runtime_id, plan_hash,
          snapshot_json, snapshot_hash, base_revision, diff_hash, operation_set_hash,
          status, record_state, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          snapshot.changesetId,
          snapshot.taskId,
          snapshot.attemptId,
          snapshot.agentId,
          snapshot.runtimeId,
          snapshot.planHash,
          JSON.stringify(snapshot),
          input.snapshotHash,
          snapshot.baseRevision,
          snapshot.diffHash,
          snapshot.operationSetHash,
          'prepared',
          'active',
          snapshot.createdAt,
          input.occurredAt
        ]
      );
      if (insert.changes !== 1) {
        throw new AgentStoreProtocolError('changeset_write_failed', 'Changeset fact was not persisted', 'commit_validation');
      }
      this.appendEvent(
        'task',
        task.taskId,
        'changeset.prepared',
        { changesetId: snapshot.changesetId, snapshotHash: input.snapshotHash, diffHash: snapshot.diffHash },
        input.occurredAt,
        'child',
        { attemptId: attempt.attemptId, runtimeId: attempt.currentRuntimeId }
      );
      const prepared = this.getChangeset(snapshot.changesetId);
      if (!prepared) throw new AgentStoreProtocolError('changeset_projection_missing', 'Prepared Changeset projection is missing');
      return prepared;
    });
  }

  /** @inheritdoc */
  createConfirmation(input: CreateAgentConfirmationInput): AgentConfirmationRecord {
    const validation = validateConfirmationRequestSnapshot(input.request, input.requestHash);
    if (!validation.ok || !Number.isFinite(Date.parse(input.occurredAt))) {
      throw new AgentStoreProtocolError(
        validation.ok ? 'confirmation_input_invalid' : validation.error.details?.reason?.toString() ?? 'confirmation_request_invalid',
        validation.ok ? 'Confirmation timestamp is invalid' : validation.error.message,
        'confirmation'
      );
    }
    const request = validation.snapshot;
    return this.database.transaction((): AgentConfirmationRecord => {
      const existingRow = this.database.select<ConfirmationRow>('SELECT * FROM chat_agent_confirmations WHERE changeset_id = ?', [request.changesetId])[0];
      if (existingRow) {
        const existing = parseConfirmation(existingRow);
        if (existing.confirmationId === request.confirmationId && existing.requestHash === input.requestHash) return existing;
        throw new AgentStoreProtocolError('confirmation_replay_conflict', 'Changeset already owns a different confirmation request', 'confirmation');
      }
      if (this.getConfirmation(request.confirmationId)) {
        throw new AgentStoreProtocolError('confirmation_replay_conflict', 'Confirmation identity is already bound', 'confirmation');
      }

      const changeset = this.getChangeset(request.changesetId);
      const task = changeset ? this.getTask(changeset.snapshot.taskId) : null;
      const attempt = changeset ? this.getAttempt(changeset.snapshot.attemptId) : null;
      if (
        !changeset ||
        !task ||
        !attempt ||
        changeset.status !== 'prepared' ||
        changeset.recordState !== 'active' ||
        task.status !== 'running' ||
        task.contractSnapshot.mode !== 'write' ||
        task.currentAttemptId !== attempt.attemptId ||
        attempt.status !== 'running'
      ) {
        throw new AgentStoreProtocolError(
          'confirmation_state_invalid',
          'Confirmation requires a prepared changeset from the running write Attempt',
          'confirmation'
        );
      }
      const { snapshot } = changeset;
      if (
        request.sessionId !== task.sessionId ||
        request.turnId !== task.turnId ||
        request.taskId !== task.taskId ||
        request.attemptId !== attempt.attemptId ||
        request.agentId !== task.agentId ||
        request.runtimeId !== attempt.currentRuntimeId ||
        request.toolCallId !== task.toolCallId ||
        request.planHash !== snapshot.planHash ||
        request.baseRevision !== snapshot.baseRevision ||
        request.diffHash !== snapshot.diffHash ||
        request.operationSetHash !== snapshot.operationSetHash ||
        hashAgentPayload(request.resourceScopes) !== hashAgentPayload(snapshot.resourceScopes) ||
        request.unifiedDiffReference !== snapshot.diffReference
      ) {
        throw new AgentStoreProtocolError(
          'confirmation_integrity_invalid',
          'Confirmation request does not exactly bind the persisted changeset',
          'confirmation'
        );
      }
      if (!canTransitionTask('running', 'waiting_confirmation', { mode: 'write' })) {
        throw new AgentStoreProtocolError('confirmation_transition_invalid', 'Write Task cannot enter confirmation', 'confirmation');
      }

      const insert = this.database.execute(
        `INSERT INTO chat_agent_confirmations (
          confirmation_id, changeset_id, request_json, request_hash, status,
          version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [request.confirmationId, request.changesetId, JSON.stringify(request), input.requestHash, 'pending', 1, request.createdAt, input.occurredAt]
      );
      const changesetUpdate = this.database.execute(
        `UPDATE chat_agent_changesets
         SET status = ?, confirmation_id = ?, updated_at = ?
         WHERE changeset_id = ? AND status = ? AND confirmation_id IS NULL AND record_state = ?`,
        ['awaiting_confirmation', request.confirmationId, input.occurredAt, request.changesetId, 'prepared', 'active']
      );
      const taskUpdate = this.database.execute(
        `UPDATE chat_agent_tasks
         SET status = ?, updated_at = ?
         WHERE task_id = ? AND status = ? AND current_attempt_id = ? AND record_state = ?`,
        ['waiting_confirmation', input.occurredAt, task.taskId, 'running', attempt.attemptId, 'active']
      );
      if (insert.changes !== 1 || changesetUpdate.changes !== 1 || taskUpdate.changes !== 1) {
        throw new AgentStoreProtocolError('confirmation_write_conflict', 'Confirmation projections changed concurrently', 'confirmation');
      }
      const links = { attemptId: attempt.attemptId, runtimeId: attempt.currentRuntimeId };
      this.appendEvent('task', task.taskId, 'task.status_changed', { from: 'running', to: 'waiting_confirmation' }, input.occurredAt, 'coordinator', links);
      this.appendEvent(
        'task',
        task.taskId,
        'confirmation.requested',
        { requestId: request.confirmationId, requestHash: input.requestHash, diffHash: request.diffHash, version: 1 },
        input.occurredAt,
        'coordinator',
        links
      );
      const confirmation = this.getConfirmation(request.confirmationId);
      if (!confirmation) throw new AgentStoreProtocolError('confirmation_projection_missing', 'Confirmation projection is missing');
      return confirmation;
    });
  }

  /** @inheritdoc */
  resolveConfirmation(input: ResolveAgentConfirmationInput): AgentConfirmationRecord {
    return this.database.transaction((): AgentConfirmationRecord => {
      if (
        (input.decision !== 'approved' && input.decision !== 'rejected') ||
        !Number.isInteger(input.expectedVersion) ||
        input.expectedVersion <= 0 ||
        !Number.isFinite(Date.parse(input.occurredAt))
      ) {
        throw new AgentStoreProtocolError('confirmation_resolution_invalid', 'Confirmation decision envelope is invalid', 'confirmation');
      }
      const confirmation = this.getConfirmation(input.confirmationId);
      if (!confirmation) throw new AgentStoreProtocolError('confirmation_not_found', 'Confirmation does not exist', 'confirmation');
      if (confirmation.status === input.decision && confirmation.decision === input.decision && confirmation.version === input.expectedVersion + 1) {
        return confirmation;
      }
      if (confirmation.status !== 'pending' || confirmation.version !== input.expectedVersion) {
        throw new AgentStoreProtocolError('confirmation_version_conflict', 'Confirmation CAS version conflicts with persisted state', 'confirmation');
      }
      const changeset = this.getChangeset(confirmation.changesetId);
      const task = changeset ? this.getTask(changeset.snapshot.taskId) : null;
      const attempt = changeset ? this.getAttempt(changeset.snapshot.attemptId) : null;
      if (
        !changeset ||
        !task ||
        !attempt ||
        changeset.status !== 'awaiting_confirmation' ||
        changeset.confirmationId !== confirmation.confirmationId ||
        task.status !== 'waiting_confirmation' ||
        task.currentAttemptId !== attempt.attemptId ||
        attempt.status !== 'running'
      ) {
        throw new AgentStoreProtocolError('confirmation_resolution_state_invalid', 'Confirmation aggregate is no longer eligible for decision', 'confirmation');
      }
      const nextVersion = confirmation.version + 1;
      const confirmationUpdate = this.database.execute(
        `UPDATE chat_agent_confirmations
         SET status = ?, version = ?, decision_json = ?, resolved_at = ?, updated_at = ?
         WHERE confirmation_id = ? AND status = ? AND version = ?`,
        [
          input.decision,
          nextVersion,
          JSON.stringify({ decision: input.decision, version: nextVersion }),
          input.occurredAt,
          input.occurredAt,
          confirmation.confirmationId,
          'pending',
          input.expectedVersion
        ]
      );
      const changesetUpdate = this.database.execute(
        `UPDATE chat_agent_changesets
         SET status = ?, updated_at = ?
         WHERE changeset_id = ? AND status = ? AND confirmation_id = ?`,
        [input.decision, input.occurredAt, changeset.snapshot.changesetId, 'awaiting_confirmation', confirmation.confirmationId]
      );
      if (confirmationUpdate.changes !== 1 || changesetUpdate.changes !== 1) {
        throw new AgentStoreProtocolError('confirmation_version_conflict', 'Confirmation decision lost its CAS', 'confirmation');
      }
      this.appendEvent(
        'task',
        task.taskId,
        'confirmation.resolved',
        { requestId: confirmation.confirmationId, decision: input.decision, diffHash: changeset.snapshot.diffHash, version: nextVersion },
        input.occurredAt,
        'user',
        { attemptId: attempt.attemptId, runtimeId: attempt.currentRuntimeId }
      );
      const resolved = this.getConfirmation(confirmation.confirmationId);
      if (!resolved) throw new AgentStoreProtocolError('confirmation_projection_missing', 'Resolved confirmation is missing');
      return resolved;
    });
  }

  /** @inheritdoc */
  revokeConfirmation(confirmationId: string, reason: string, occurredAt: string): AgentConfirmationRecord {
    return this.database.transaction((): AgentConfirmationRecord => {
      if (!reason.trim() || !Number.isFinite(Date.parse(occurredAt))) {
        throw new AgentStoreProtocolError('confirmation_revoke_invalid', 'Confirmation revocation envelope is invalid', 'confirmation');
      }
      const confirmation = this.getConfirmation(confirmationId);
      if (!confirmation) throw new AgentStoreProtocolError('confirmation_not_found', 'Confirmation does not exist', 'confirmation');
      if (confirmation.status === 'revoked') return confirmation;
      if (confirmation.status !== 'pending' && confirmation.status !== 'approved') {
        throw new AgentStoreProtocolError('confirmation_revoke_conflict', 'Only a pending or uncommitted approved confirmation can be revoked', 'confirmation');
      }
      const changeset = this.getChangeset(confirmation.changesetId);
      const task = changeset ? this.getTask(changeset.snapshot.taskId) : null;
      const pendingState = confirmation.status === 'pending' && changeset?.status === 'awaiting_confirmation' && task?.status === 'waiting_confirmation';
      const approvedState =
        confirmation.status === 'approved' &&
        changeset?.status === 'approved' &&
        task?.status === 'queued' &&
        task.queuePhase === 'commit' &&
        task.unfinishedJournalCount === 0;
      if (!changeset || !task || (!pendingState && !approvedState)) {
        throw new AgentStoreProtocolError('confirmation_revoke_state_invalid', 'Confirmation aggregate is not revocable', 'confirmation');
      }
      const nextVersion = confirmation.version + 1;
      const confirmationUpdate = this.database.execute(
        `UPDATE chat_agent_confirmations
         SET status = ?, version = ?, decision_json = NULL, resolved_at = ?, updated_at = ?
         WHERE confirmation_id = ? AND status = ? AND version = ?`,
        ['revoked', nextVersion, occurredAt, occurredAt, confirmation.confirmationId, confirmation.status, confirmation.version]
      );
      const changesetUpdate = this.database.execute(
        `UPDATE chat_agent_changesets
         SET status = ?, updated_at = ?
         WHERE changeset_id = ? AND status = ? AND confirmation_id = ?`,
        ['revoked', occurredAt, changeset.snapshot.changesetId, changeset.status, confirmation.confirmationId]
      );
      if (confirmationUpdate.changes !== 1 || changesetUpdate.changes !== 1) {
        throw new AgentStoreProtocolError('confirmation_revoke_conflict', 'Confirmation revocation lost its CAS', 'confirmation');
      }
      this.appendEvent(
        'task',
        task.taskId,
        'confirmation.invalidated',
        { requestId: confirmation.confirmationId, reason: reason.trim(), version: nextVersion },
        occurredAt,
        'coordinator',
        { attemptId: changeset.snapshot.attemptId, runtimeId: changeset.snapshot.runtimeId }
      );
      const revoked = this.getConfirmation(confirmation.confirmationId);
      if (!revoked) throw new AgentStoreProtocolError('confirmation_projection_missing', 'Revoked confirmation is missing');
      return revoked;
    });
  }

  /** @inheritdoc */
  queueCommit(input: QueueAgentCommitInput): AgentTaskRecord {
    return this.database.transaction((): AgentTaskRecord => {
      if (!Number.isInteger(input.confirmationVersion) || input.confirmationVersion <= 0 || !Number.isFinite(Date.parse(input.occurredAt))) {
        throw new AgentStoreProtocolError('commit_queue_input_invalid', 'Commit queue envelope is invalid', 'commit_validation');
      }
      const task = this.getTask(input.taskId);
      const confirmation = this.getConfirmation(input.confirmationId);
      const changeset = confirmation ? this.getChangeset(confirmation.changesetId) : null;
      if (
        task?.status === 'queued' &&
        task.queuePhase === 'commit' &&
        confirmation?.status === 'approved' &&
        confirmation.version === input.confirmationVersion &&
        changeset?.snapshot.taskId === task.taskId
      ) {
        return task;
      }
      if (
        !task ||
        !confirmation ||
        !changeset ||
        task.recordState !== 'active' ||
        task.contractSnapshot.mode !== 'write' ||
        task.status !== 'waiting_confirmation' ||
        task.currentAttemptId !== changeset.snapshot.attemptId ||
        confirmation.status !== 'approved' ||
        confirmation.version !== input.confirmationVersion ||
        changeset.status !== 'approved' ||
        changeset.confirmationId !== confirmation.confirmationId ||
        changeset.snapshot.taskId !== task.taskId ||
        !canTransitionTask('waiting_confirmation', 'queued', { mode: 'write', queuePhase: 'commit' })
      ) {
        throw new AgentStoreProtocolError('commit_queue_state_invalid', 'Approved confirmation does not authorize this Task commit', 'commit_validation');
      }
      const update = this.database.execute(
        `UPDATE chat_agent_tasks
         SET status = ?, queue_phase = ?, updated_at = ?
         WHERE task_id = ? AND status = ? AND current_attempt_id = ? AND record_state = ?`,
        ['queued', 'commit', input.occurredAt, task.taskId, 'waiting_confirmation', changeset.snapshot.attemptId, 'active']
      );
      if (update.changes !== 1) throw new AgentStoreProtocolError('commit_queue_conflict', 'Commit queue projection changed concurrently', 'commit_validation');
      const links = { attemptId: changeset.snapshot.attemptId, runtimeId: changeset.snapshot.runtimeId };
      this.appendEvent(
        'task',
        task.taskId,
        'task.status_changed',
        { from: 'waiting_confirmation', to: 'queued', queuePhase: 'commit' },
        input.occurredAt,
        'coordinator',
        links
      );
      this.appendEvent('task', task.taskId, 'task.queued', { queuePhase: 'commit' }, input.occurredAt, 'coordinator', links);
      const queued = this.getTask(task.taskId);
      if (!queued) throw new AgentStoreProtocolError('task_projection_missing', 'Commit-queued Task is missing');
      return queued;
    });
  }

  /** @inheritdoc */
  createCommitJournal(input: CreateAgentCommitJournalInput): AgentCommitJournalRecord {
    const validation = validateCommitIntentSnapshot(input.intent, input.intentHash);
    if (!validation.ok || !Number.isInteger(input.confirmationVersion) || input.confirmationVersion <= 0 || !Number.isFinite(Date.parse(input.occurredAt))) {
      throw new AgentStoreProtocolError(
        validation.ok ? 'commit_journal_input_invalid' : validation.error.details?.reason?.toString() ?? 'commit_intent_invalid',
        validation.ok ? 'Commit journal envelope is invalid' : validation.error.message,
        'commit_validation'
      );
    }
    const intent = validation.snapshot;
    return this.database.transaction((): AgentCommitJournalRecord => {
      const existingById = this.getCommitJournal(input.journalId);
      const existingRow = this.database.select<CommitJournalRow>('SELECT * FROM chat_agent_commit_journals WHERE changeset_id = ?', [input.changesetId])[0];
      const existing = existingById ?? (existingRow ? parseCommitJournal(existingRow) : null);
      if (existing) {
        if (
          existing.journalId === input.journalId &&
          existing.changesetId === input.changesetId &&
          existing.confirmationId === input.confirmationId &&
          existing.confirmationVersion === input.confirmationVersion &&
          existing.intentHash === input.intentHash
        ) {
          return existing;
        }
        throw new AgentStoreProtocolError('commit_journal_replay_conflict', 'Changeset already owns a different commit journal', 'commit_validation');
      }

      const changeset = this.getChangeset(input.changesetId);
      const confirmation = this.getConfirmation(input.confirmationId);
      const task = changeset ? this.getTask(changeset.snapshot.taskId) : null;
      const attempt = changeset ? this.getAttempt(changeset.snapshot.attemptId) : null;
      if (
        !changeset ||
        !confirmation ||
        !task ||
        !attempt ||
        task.recordState !== 'active' ||
        task.contractSnapshot.mode !== 'write' ||
        task.status !== 'queued' ||
        task.queuePhase !== 'commit' ||
        task.unfinishedJournalCount !== 0 ||
        task.currentAttemptId !== attempt.attemptId ||
        attempt.status !== 'running' ||
        changeset.status !== 'approved' ||
        changeset.confirmationId !== confirmation.confirmationId ||
        confirmation.status !== 'approved' ||
        confirmation.version !== input.confirmationVersion
      ) {
        throw new AgentStoreProtocolError('commit_journal_state_invalid', 'Commit journal requires one approved queued write aggregate', 'commit_validation');
      }
      if (
        input.confirmationVersion !== intent.confirmationVersion ||
        input.confirmationId !== intent.confirmationId ||
        intent.confirmationId !== confirmation.confirmationId ||
        intent.changesetSnapshotHash !== changeset.snapshotHash ||
        intent.planHash !== changeset.snapshot.planHash ||
        intent.planHash !== task.executionPlanSnapshotHash ||
        intent.resultDraft.taskId !== task.taskId ||
        intent.resultDraft.agentId !== task.agentId ||
        intent.resultDraft.attemptId !== attempt.attemptId ||
        !matchCommitOperations(intent.operations, changeset.snapshot.operations) ||
        intent.resultDraft.criteria.length !== task.contractSnapshot.acceptanceCriteria.length ||
        !intent.resultDraft.criteria.every((criterion, index): boolean => criterion.criterionIndex === index) ||
        !canTransitionTask('queued', 'committing', { mode: 'write', queuePhase: 'commit' })
      ) {
        throw new AgentStoreProtocolError(
          'commit_intent_binding_invalid',
          'Commit intent does not exactly bind the approved immutable facts',
          'commit_validation'
        );
      }

      const insert = this.database.execute(
        `INSERT INTO chat_agent_commit_journals (
          journal_id, task_id, attempt_id, changeset_id, confirmation_id,
          confirmation_version, plan_hash, intent_json, intent_hash, status,
          operation_progress_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.journalId,
          task.taskId,
          attempt.attemptId,
          changeset.snapshot.changesetId,
          confirmation.confirmationId,
          confirmation.version,
          intent.planHash,
          JSON.stringify(intent),
          input.intentHash,
          'created',
          '[]',
          intent.createdAt,
          input.occurredAt
        ]
      );
      const changesetUpdate = this.database.execute(
        `UPDATE chat_agent_changesets
         SET status = ?, updated_at = ?
         WHERE changeset_id = ? AND status = ? AND confirmation_id = ?`,
        ['committing', input.occurredAt, changeset.snapshot.changesetId, 'approved', confirmation.confirmationId]
      );
      const taskUpdate = this.database.execute(
        `UPDATE chat_agent_tasks
         SET status = ?, queue_phase = NULL,
             unfinished_journal_count = unfinished_journal_count + 1, updated_at = ?
         WHERE task_id = ? AND status = ? AND queue_phase = ?
           AND unfinished_journal_count = 0 AND current_attempt_id = ? AND record_state = ?`,
        ['committing', input.occurredAt, task.taskId, 'queued', 'commit', attempt.attemptId, 'active']
      );
      if (insert.changes !== 1 || changesetUpdate.changes !== 1 || taskUpdate.changes !== 1) {
        throw new AgentStoreProtocolError('commit_journal_write_conflict', 'Commit journal projections changed concurrently', 'commit_validation');
      }
      const links = { attemptId: attempt.attemptId, runtimeId: attempt.currentRuntimeId };
      this.appendEvent('task', task.taskId, 'task.status_changed', { from: 'queued', to: 'committing' }, input.occurredAt, 'coordinator', links);
      this.appendEvent(
        'task',
        task.taskId,
        'commit.journal_created',
        {
          journalId: input.journalId,
          changesetId: changeset.snapshot.changesetId,
          intentHash: input.intentHash,
          confirmationVersion: confirmation.version
        },
        input.occurredAt,
        'coordinator',
        links
      );
      const journal = this.getCommitJournal(input.journalId);
      if (!journal) throw new AgentStoreProtocolError('commit_journal_projection_missing', 'Created commit journal is missing');
      return journal;
    });
  }

  /** @inheritdoc */
  markJournalApplying(input: MarkAgentJournalInput): AgentCommitJournalRecord {
    return this.database.transaction((): AgentCommitJournalRecord => {
      if (!Number.isFinite(Date.parse(input.occurredAt))) {
        throw new AgentStoreProtocolError('commit_journal_input_invalid', 'Commit journal timestamp is invalid', 'commit');
      }
      const journal = this.getCommitJournal(input.journalId);
      if (!journal) throw new AgentStoreProtocolError('commit_journal_not_found', 'Commit journal does not exist', 'commit');
      if (journal.status === 'applying') return journal;
      if (journal.status !== 'created') {
        throw new AgentStoreProtocolError('commit_journal_state_invalid', 'Commit journal cannot enter applying', 'commit');
      }
      const update = this.database.execute(
        `UPDATE chat_agent_commit_journals
         SET status = ?, updated_at = ?
         WHERE journal_id = ? AND status = ?`,
        ['applying', input.occurredAt, journal.journalId, 'created']
      );
      if (update.changes !== 1) throw new AgentStoreProtocolError('commit_journal_update_conflict', 'Commit journal changed concurrently', 'commit');
      const applying = this.getCommitJournal(journal.journalId);
      if (!applying) throw new AgentStoreProtocolError('commit_journal_projection_missing', 'Applying journal is missing');
      return applying;
    });
  }

  /** @inheritdoc */
  markJournalOperation(input: MarkAgentJournalOperationInput): AgentCommitJournalRecord {
    return this.database.transaction((): AgentCommitJournalRecord => {
      if (!Number.isFinite(Date.parse(input.occurredAt))) {
        throw new AgentStoreProtocolError('commit_operation_input_invalid', 'Commit operation timestamp is invalid', 'commit');
      }
      const journal = this.getCommitJournal(input.journalId);
      if (!journal) throw new AgentStoreProtocolError('commit_journal_not_found', 'Commit journal does not exist', 'commit');
      const operation = journal.intent.operations.find((entry): boolean => entry.operationId === input.operationId);
      if (!operation || operation.targetContentHash !== input.targetContentHash) {
        throw new AgentStoreProtocolError(
          'commit_operation_integrity_invalid',
          'Applied operation is outside the immutable commit intent',
          'commit_validation'
        );
      }
      if (journal.appliedOperationIds.includes(input.operationId)) return journal;
      if (journal.status !== 'applying') {
        throw new AgentStoreProtocolError('commit_operation_state_invalid', 'Commit journal is not applying external mutations', 'commit');
      }
      const nextProgress: JournalOperationProgress[] = [
        ...journal.appliedOperationIds.map((operationId): JournalOperationProgress => {
          const applied = journal.intent.operations.find((entry): boolean => entry.operationId === operationId);
          if (!applied) throw new AgentStoreProtocolError('journal_progress_invalid', 'Persisted journal progress is outside its intent');
          return { operationId, targetContentHash: applied.targetContentHash };
        }),
        { operationId: operation.operationId, targetContentHash: operation.targetContentHash }
      ];
      const update = this.database.execute(
        `UPDATE chat_agent_commit_journals
         SET operation_progress_json = ?, updated_at = ?
         WHERE journal_id = ? AND status = ? AND operation_progress_json = ?`,
        [JSON.stringify(nextProgress), input.occurredAt, journal.journalId, 'applying', JSON.stringify(nextProgress.slice(0, -1))]
      );
      if (update.changes !== 1) throw new AgentStoreProtocolError('commit_operation_conflict', 'Commit operation progress changed concurrently', 'commit');
      const attempt = this.getAttempt(journal.attemptId);
      this.appendEvent(
        'task',
        journal.taskId,
        'commit.mutation_applied',
        { journalId: journal.journalId, operationId: operation.operationId, targetHash: operation.targetContentHash },
        input.occurredAt,
        'coordinator',
        { attemptId: journal.attemptId, ...(attempt ? { runtimeId: attempt.currentRuntimeId } : {}) }
      );
      const updated = this.getCommitJournal(journal.journalId);
      if (!updated) throw new AgentStoreProtocolError('commit_journal_projection_missing', 'Updated commit journal is missing');
      return updated;
    });
  }

  /** @inheritdoc */
  markJournalApplied(input: MarkAgentJournalInput): AgentCommitJournalRecord {
    return this.database.transaction((): AgentCommitJournalRecord => {
      if (!Number.isFinite(Date.parse(input.occurredAt))) {
        throw new AgentStoreProtocolError('commit_journal_input_invalid', 'Commit journal timestamp is invalid', 'commit');
      }
      const journal = this.getCommitJournal(input.journalId);
      if (!journal) throw new AgentStoreProtocolError('commit_journal_not_found', 'Commit journal does not exist', 'commit');
      if (journal.status === 'applied') return journal;
      if (journal.status !== 'applying' || journal.appliedOperationIds.length !== journal.intent.operations.length) {
        throw new AgentStoreProtocolError(
          'commit_journal_incomplete',
          'All immutable operations must be recorded before journal apply completes',
          'commit_validation'
        );
      }
      const update = this.database.execute(
        `UPDATE chat_agent_commit_journals
         SET status = ?, updated_at = ?
         WHERE journal_id = ? AND status = ?`,
        ['applied', input.occurredAt, journal.journalId, 'applying']
      );
      if (update.changes !== 1) throw new AgentStoreProtocolError('commit_journal_update_conflict', 'Commit journal changed concurrently', 'commit');
      const applied = this.getCommitJournal(journal.journalId);
      if (!applied) throw new AgentStoreProtocolError('commit_journal_projection_missing', 'Applied commit journal is missing');
      return applied;
    });
  }

  /** @inheritdoc */
  cancelCommitJournal(input: CancelAgentCommitJournalInput): AgentCheckpointRecord {
    return this.database.transaction((): AgentCheckpointRecord => {
      if (!Number.isFinite(Date.parse(input.occurredAt))) {
        throw new AgentStoreProtocolError('commit_journal_input_invalid', 'Commit journal timestamp is invalid', 'recovery');
      }
      const journal = this.getCommitJournal(input.journalId);
      if (!journal) throw new AgentStoreProtocolError('commit_journal_not_found', 'Commit journal does not exist', 'recovery');
      const task = this.getTask(journal.taskId);
      const attempt = this.getAttempt(journal.attemptId);
      const changeset = this.getChangeset(journal.changesetId);
      const checkpoint = task ? this.getCheckpoint(task.checkpointId) : null;
      if (!task || !attempt || !changeset || !checkpoint) {
        throw new AgentStoreProtocolError('commit_cancel_target_missing', 'Commit cancellation aggregate is incomplete', 'recovery');
      }
      if (journal.status === 'cancelled' && task.status === 'cancelled' && task.resultHash) return checkpoint;
      if (
        journal.status !== 'created' ||
        journal.appliedOperationIds.length !== 0 ||
        task.status !== 'committing' ||
        task.unfinishedJournalCount !== 1 ||
        task.currentAttemptId !== attempt.attemptId ||
        attempt.status !== 'running' ||
        changeset.status !== 'committing' ||
        !canTransitionTask('committing', 'cancelled', { mode: 'write' })
      ) {
        throw new AgentStoreProtocolError('commit_cancel_state_invalid', 'Only an unapplied created journal can be cancelled', 'recovery');
      }
      const criteria = [...journal.intent.resultDraft.criteria];
      const verifiedCount = criteria.filter(
        (criterion): boolean => criterion.claim.status === 'satisfied' && criterion.verification.status === 'verified'
      ).length;
      let completionLevel: ChatAgentResult['completion']['level'] = 'partial';
      if (verifiedCount === 0) completionLevel = 'none';
      if (verifiedCount === criteria.length) completionLevel = 'full';
      const error: AgentTaskError = {
        code: 'cancelled',
        phase: 'recovery',
        category: 'runtime',
        retryable: false,
        details: { reason: 'journal_unapplied_after_restart' }
      };
      const resultCandidate: ChatAgentResult = {
        taskId: task.taskId,
        agentId: task.agentId,
        attemptId: attempt.attemptId,
        executionStatus: 'cancelled',
        completion: { level: completionLevel, criteria },
        summary: journal.intent.resultDraft.summary,
        ...(journal.intent.resultDraft.output === undefined ? {} : { output: journal.intent.resultDraft.output }),
        warnings: [...journal.intent.resultDraft.warnings],
        artifacts: [],
        changeset: {
          changesetId: changeset.snapshot.changesetId,
          baseRevision: changeset.snapshot.baseRevision,
          diffHash: changeset.snapshot.diffHash,
          operationSetHash: changeset.snapshot.operationSetHash,
          planHash: changeset.snapshot.planHash
        },
        usage: journal.intent.resultDraft.usage,
        error
      };
      const resultValidation = validateChatAgentResult(resultCandidate);
      if (!resultValidation.ok) {
        throw new AgentStoreProtocolError(
          resultValidation.error.details?.reason?.toString() ?? 'commit_cancel_result_invalid',
          resultValidation.error.message,
          'recovery'
        );
      }
      const { result } = resultValidation;
      const resultHash = hashAgentPayload(result);
      const attemptUpdate = this.database.execute(
        `UPDATE chat_agent_attempts
         SET status = ?, finished_at = ?, error_json = ?
         WHERE attempt_id = ? AND task_id = ? AND status = ?`,
        ['cancelled', input.occurredAt, JSON.stringify(error), attempt.attemptId, task.taskId, 'running']
      );
      const taskUpdate = this.database.execute(
        `UPDATE chat_agent_tasks
         SET status = ?, result_json = ?, result_hash = ?, error_json = ?,
             unfinished_journal_count = unfinished_journal_count - 1, updated_at = ?
         WHERE task_id = ? AND status = ? AND current_attempt_id = ?
           AND result_hash IS NULL AND unfinished_journal_count = 1 AND record_state = ?`,
        ['cancelled', JSON.stringify(result), resultHash, JSON.stringify(error), input.occurredAt, task.taskId, 'committing', attempt.attemptId, 'active']
      );
      const changesetUpdate = this.database.execute(
        `UPDATE chat_agent_changesets
         SET status = ?, updated_at = ?
         WHERE changeset_id = ? AND status = ?`,
        ['discarded', input.occurredAt, changeset.snapshot.changesetId, 'committing']
      );
      const journalUpdate = this.database.execute(
        `UPDATE chat_agent_commit_journals
         SET status = ?, finalized_at = ?, updated_at = ?
         WHERE journal_id = ? AND status = ? AND operation_progress_json = ?`,
        ['cancelled', input.occurredAt, input.occurredAt, journal.journalId, 'created', '[]']
      );
      if (attemptUpdate.changes !== 1 || taskUpdate.changes !== 1 || changesetUpdate.changes !== 1 || journalUpdate.changes !== 1) {
        throw new AgentStoreProtocolError('commit_cancel_conflict', 'Commit cancellation projections changed concurrently', 'recovery');
      }
      const links = { attemptId: attempt.attemptId, runtimeId: attempt.currentRuntimeId };
      this.appendEvent('task', task.taskId, 'task.cancelled', { resultHash }, input.occurredAt, 'coordinator', links);
      return this.joinTerminalResult(task, checkpoint, result, resultHash, input.occurredAt, 'coordinator');
    });
  }

  /** @inheritdoc */
  finalizeCommit(input: FinalizeAgentCommitInput): AgentCheckpointRecord {
    return this.database.transaction((): AgentCheckpointRecord => {
      if (!/^[a-f0-9]{64}$/.test(input.finalHash) || !Number.isFinite(Date.parse(input.occurredAt))) {
        throw new AgentStoreProtocolError('commit_finalize_input_invalid', 'Commit finalization envelope is invalid', 'commit_validation');
      }
      const journal = this.getCommitJournal(input.journalId);
      if (!journal) throw new AgentStoreProtocolError('commit_journal_not_found', 'Commit journal does not exist', 'commit_validation');
      const task = this.getTask(journal.taskId);
      const attempt = this.getAttempt(journal.attemptId);
      const changeset = this.getChangeset(journal.changesetId);
      const confirmation = this.getConfirmation(journal.confirmationId);
      const checkpoint = task ? this.getCheckpoint(task.checkpointId) : null;
      if (!task || !attempt || !changeset || !confirmation || !checkpoint) {
        throw new AgentStoreProtocolError('commit_finalize_target_missing', 'Commit aggregate is incomplete', 'commit_validation');
      }
      if (journal.status === 'finalized') {
        if (task.resultHash === input.resultHash && hashAgentPayload(task.result) === input.resultHash) return checkpoint;
        throw new AgentStoreProtocolError('commit_finalize_replay_conflict', 'Finalized journal conflicts with the supplied result', 'commit_validation');
      }
      const resultValidation = validateChatAgentResult(input.result);
      if (!resultValidation.ok) {
        throw new AgentStoreProtocolError(
          resultValidation.error.details?.reason?.toString() ?? 'commit_result_invalid',
          resultValidation.error.message,
          'commit_validation'
        );
      }
      const { result } = resultValidation;
      const expectedChangeset = {
        changesetId: changeset.snapshot.changesetId,
        baseRevision: changeset.snapshot.baseRevision,
        diffHash: changeset.snapshot.diffHash,
        operationSetHash: changeset.snapshot.operationSetHash,
        planHash: changeset.snapshot.planHash
      };
      const draftProjection = {
        summary: result.summary,
        ...(result.output === undefined ? {} : { output: result.output }),
        criteria: result.completion.criteria,
        warnings: result.warnings,
        usage: result.usage
      };
      const frozenDraftProjection = {
        summary: journal.intent.resultDraft.summary,
        ...(journal.intent.resultDraft.output === undefined ? {} : { output: journal.intent.resultDraft.output }),
        criteria: journal.intent.resultDraft.criteria,
        warnings: [
          ...journal.intent.resultDraft.warnings,
          ...(task.cancelRequestedAt
            ? [
                {
                  code: 'cancel_arrived_too_late',
                  message: 'Cancellation arrived after durable commit application had started; the approved changeset was finalized.'
                }
              ]
            : [])
        ],
        usage: journal.intent.resultDraft.usage
      };
      if (
        journal.status !== 'applied' ||
        task.status !== 'committing' ||
        task.unfinishedJournalCount !== 1 ||
        task.currentAttemptId !== attempt.attemptId ||
        attempt.status !== 'running' ||
        changeset.status !== 'committing' ||
        confirmation.status !== 'approved' ||
        confirmation.version !== journal.confirmationVersion ||
        result.executionStatus !== 'completed' ||
        result.error !== undefined ||
        result.taskId !== task.taskId ||
        result.agentId !== task.agentId ||
        result.attemptId !== attempt.attemptId ||
        hashAgentPayload(result) !== input.resultHash ||
        !hasExactCriteria(result, task.contractSnapshot.acceptanceCriteria) ||
        hashAgentPayload(result.changeset) !== hashAgentPayload(expectedChangeset) ||
        hashAgentPayload(draftProjection) !== hashAgentPayload(frozenDraftProjection) ||
        result.artifacts.length !== 0 ||
        !canTransitionTask('committing', 'completed', { mode: 'write' })
      ) {
        throw new AgentStoreProtocolError(
          'commit_finalize_integrity_invalid',
          'Final result does not exactly bind the applied commit facts',
          'commit_validation'
        );
      }

      const attemptUpdate = this.database.execute(
        `UPDATE chat_agent_attempts
         SET status = ?, finished_at = ?
         WHERE attempt_id = ? AND task_id = ? AND status = ?`,
        ['completed', input.occurredAt, attempt.attemptId, task.taskId, 'running']
      );
      const taskUpdate = this.database.execute(
        `UPDATE chat_agent_tasks
         SET status = ?, result_json = ?, result_hash = ?,
             unfinished_journal_count = unfinished_journal_count - 1, updated_at = ?
         WHERE task_id = ? AND status = ? AND current_attempt_id = ?
           AND result_hash IS NULL AND unfinished_journal_count = 1 AND record_state = ?`,
        ['completed', JSON.stringify(result), input.resultHash, input.occurredAt, task.taskId, 'committing', attempt.attemptId, 'active']
      );
      const changesetUpdate = this.database.execute(
        `UPDATE chat_agent_changesets
         SET status = ?, updated_at = ?
         WHERE changeset_id = ? AND status = ?`,
        ['committed', input.occurredAt, changeset.snapshot.changesetId, 'committing']
      );
      const journalUpdate = this.database.execute(
        `UPDATE chat_agent_commit_journals
         SET status = ?, finalized_at = ?, updated_at = ?
         WHERE journal_id = ? AND status = ?`,
        ['finalized', input.occurredAt, input.occurredAt, journal.journalId, 'applied']
      );
      if (attemptUpdate.changes !== 1 || taskUpdate.changes !== 1 || changesetUpdate.changes !== 1 || journalUpdate.changes !== 1) {
        throw new AgentStoreProtocolError('commit_finalize_conflict', 'Commit finalization projections changed concurrently', 'commit');
      }
      const links = { attemptId: attempt.attemptId, runtimeId: attempt.currentRuntimeId };
      this.appendEvent(
        'task',
        task.taskId,
        'commit.finalized',
        { journalId: journal.journalId, finalHash: input.finalHash },
        input.occurredAt,
        'coordinator',
        links
      );
      this.appendEvent('task', task.taskId, 'task.completed', { resultHash: input.resultHash }, input.occurredAt, 'coordinator', links);
      return this.joinTerminalResult(task, checkpoint, result, input.resultHash, input.occurredAt, 'coordinator');
    });
  }

  /** @inheritdoc */
  markManualRecovery(input: MarkAgentJournalFailureInput): AgentCheckpointRecord {
    return this.database.transaction((): AgentCheckpointRecord => {
      const error = validateAgentTaskError(input.error);
      if (
        !error ||
        error.code !== 'manual_recovery_required' ||
        (error.phase !== 'commit_validation' && error.phase !== 'commit' && error.phase !== 'recovery') ||
        (error.category !== 'runtime' && error.category !== 'integrity') ||
        !Number.isFinite(Date.parse(input.occurredAt))
      ) {
        throw new AgentStoreProtocolError('manual_recovery_error_invalid', 'Manual recovery requires a manual_recovery_required error', 'recovery');
      }
      const journal = this.getCommitJournal(input.journalId);
      if (!journal) throw new AgentStoreProtocolError('commit_journal_not_found', 'Commit journal does not exist', 'recovery');
      const task = this.getTask(journal.taskId);
      const attempt = this.getAttempt(journal.attemptId);
      const changeset = this.getChangeset(journal.changesetId);
      const checkpoint = task ? this.getCheckpoint(task.checkpointId) : null;
      if (!task || !attempt || !changeset || !checkpoint) {
        throw new AgentStoreProtocolError('manual_recovery_target_missing', 'Commit recovery aggregate is incomplete', 'recovery');
      }
      if (journal.status === 'manual_recovery' && task.status === 'commit_failed' && task.resultHash) return checkpoint;
      if (
        journal.status === 'finalized' ||
        journal.status === 'cancelled' ||
        task.status !== 'committing' ||
        attempt.status !== 'running' ||
        changeset.status !== 'committing'
      ) {
        throw new AgentStoreProtocolError('manual_recovery_state_invalid', 'Commit aggregate cannot enter manual recovery', 'recovery');
      }
      const criteria = [...journal.intent.resultDraft.criteria];
      const satisfiedCount = criteria.filter((criterion): boolean => criterion.claim.status === 'satisfied').length;
      const verifiedCount = criteria.filter((criterion): boolean => criterion.verification.status === 'verified').length;
      let completionLevel: 'full' | 'partial' | 'none' = 'none';
      if (satisfiedCount > 0) completionLevel = 'partial';
      if (satisfiedCount === criteria.length && verifiedCount === criteria.length) completionLevel = 'full';
      const resultCandidate = {
        taskId: task.taskId,
        agentId: task.agentId,
        attemptId: attempt.attemptId,
        executionStatus: 'commit_failed' as const,
        completion: { level: completionLevel, criteria },
        summary: journal.intent.resultDraft.summary,
        ...(journal.intent.resultDraft.output === undefined ? {} : { output: journal.intent.resultDraft.output }),
        warnings: [...journal.intent.resultDraft.warnings],
        artifacts: [],
        changeset: {
          changesetId: changeset.snapshot.changesetId,
          baseRevision: changeset.snapshot.baseRevision,
          diffHash: changeset.snapshot.diffHash,
          operationSetHash: changeset.snapshot.operationSetHash,
          planHash: changeset.snapshot.planHash
        },
        usage: journal.intent.resultDraft.usage,
        error
      };
      const resultValidation = validateChatAgentResult(resultCandidate);
      if (!resultValidation.ok) {
        throw new AgentStoreProtocolError(
          resultValidation.error.details?.reason?.toString() ?? 'manual_recovery_result_invalid',
          resultValidation.error.message,
          'recovery'
        );
      }
      const { result } = resultValidation;
      const resultHash = hashAgentPayload(result);
      const attemptUpdate = this.database.execute(
        `UPDATE chat_agent_attempts
         SET status = ?, finished_at = ?, error_json = ?
         WHERE attempt_id = ? AND task_id = ? AND status = ?`,
        ['failed', input.occurredAt, JSON.stringify(error), attempt.attemptId, task.taskId, 'running']
      );
      const taskUpdate = this.database.execute(
        `UPDATE chat_agent_tasks
         SET status = ?, result_json = ?, result_hash = ?, error_json = ?, updated_at = ?
         WHERE task_id = ? AND status = ? AND result_hash IS NULL
           AND unfinished_journal_count = 1 AND record_state = ?`,
        ['commit_failed', JSON.stringify(result), resultHash, JSON.stringify(error), input.occurredAt, task.taskId, 'committing', 'active']
      );
      const journalUpdate = this.database.execute(
        `UPDATE chat_agent_commit_journals
         SET status = ?, error_json = ?, updated_at = ?
         WHERE journal_id = ? AND status NOT IN (?, ?)`,
        ['manual_recovery', JSON.stringify(error), input.occurredAt, journal.journalId, 'finalized', 'cancelled']
      );
      if (attemptUpdate.changes !== 1 || taskUpdate.changes !== 1 || journalUpdate.changes !== 1) {
        throw new AgentStoreProtocolError('manual_recovery_conflict', 'Manual recovery projections changed concurrently', 'recovery');
      }
      const links = { attemptId: attempt.attemptId, runtimeId: attempt.currentRuntimeId };
      this.appendEvent('task', task.taskId, 'task.failed', { error, resultHash }, input.occurredAt, 'coordinator', links);
      return this.joinTerminalResult(task, checkpoint, result, resultHash, input.occurredAt, 'coordinator');
    });
  }

  /** @inheritdoc */
  listPendingConfirmations(): AgentConfirmationRecord[] {
    return this.database
      .select<ConfirmationRow>(
        `SELECT * FROM chat_agent_confirmations
         WHERE status = ?
         ORDER BY created_at ASC, confirmation_id ASC`,
        ['pending']
      )
      .map(parseConfirmation);
  }

  /** @inheritdoc */
  listUnfinishedJournals(): AgentCommitJournalRecord[] {
    return this.database
      .select<CommitJournalRow>(
        `SELECT * FROM chat_agent_commit_journals
         WHERE status NOT IN (?, ?)
         ORDER BY created_at ASC, journal_id ASC`,
        ['finalized', 'cancelled']
      )
      .map(parseCommitJournal);
  }

  /**
   * 创建一个不含 Attempt、产物和模型成本的规范化授权前失败。
   * @param task - 尚未创建 Attempt 的 Task
   * @param error - 已通过 allowlist 的不可重试授权错误
   * @returns 可持久化并注入 Primary 的稳定结果
   */
  private createPreAttemptResult(task: AgentTaskRecord, error: AgentTaskError): Readonly<AgentPreAttemptFailureResult> {
    const candidate: AgentPreAttemptFailureResult = {
      resultKind: 'pre_attempt_failure',
      taskId: task.taskId,
      agentId: task.agentId,
      executionStatus: 'failed',
      completion: {
        level: 'none',
        criteria: task.contractSnapshot.acceptanceCriteria.map((_criterion, criterionIndex) => ({
          criterionIndex,
          claim: {
            status: 'unknown',
            summary: 'Authorization failed before this criterion could be evaluated.',
            evidence: []
          },
          verification: {
            status: 'unverified',
            verifier: 'policy',
            evidence: []
          }
        }))
      },
      summary: 'Task authorization failed before execution.',
      warnings: [],
      artifacts: [],
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        modelCalls: 0,
        toolRounds: 0,
        queueDurationMs: 0,
        executionDurationMs: 0,
        externalRequests: 0,
        monetaryCost: {
          currency: 'unknown',
          pricingVersion: 'unknown',
          estimated: 'unknown',
          actual: 'unknown'
        }
      },
      error
    };
    const validation = validatePreAttemptFailure(candidate);
    if (!validation.ok) {
      throw new AgentStoreProtocolError(
        validation.error.details?.reason?.toString() ?? 'pre_attempt_result_invalid',
        validation.error.message,
        'plan_validation'
      );
    }
    return validation.result;
  }

  /**
   * 把一个已写入 Task 的终态结果汇合到 Checkpoint。
   * 正常等待在结果齐备时创建 ready Outbox；取消中的 Checkpoint 只汇合结果并终止，不触发 Primary 续接。
   * 调用方必须处于同一 Store 事务中。
   * @param task - 结果所属 Task
   * @param checkpoint - 仍在等待 Child 或取消回执的 Checkpoint
   * @param result - 已规范化 Task 结果
   * @param resultHash - canonical 结果 hash
   * @param occurredAt - 汇合时间
   * @param source - 真实结果产生方
   * @returns 汇合后的 Checkpoint
   */
  private joinTerminalResult(
    task: AgentTaskRecord,
    checkpoint: AgentCheckpointRecord,
    result: AgentTaskResult,
    resultHash: string,
    occurredAt: string,
    source: Extract<ChatAgentEventSource, 'child' | 'coordinator'>
  ): AgentCheckpointRecord {
    const acceptsResults = checkpoint.status === 'waiting_children' || checkpoint.status === 'cancelling';
    if (!acceptsResults || checkpoint.terminalResults[task.toolCallId]) {
      throw new AgentStoreProtocolError('checkpoint_not_waiting', 'Checkpoint is not accepting a new Task result');
    }
    const terminalResults = {
      ...checkpoint.terminalResults,
      [task.toolCallId]: { result, resultHash }
    };
    const allTerminal = checkpoint.continuationSnapshot.orderedToolCalls.every((toolCall): boolean => terminalResults[toolCall.toolCallId] !== undefined);
    let nextStatus: AgentCheckpointStatus = checkpoint.status;
    if (checkpoint.status === 'cancelling' && allTerminal) nextStatus = 'cancelled';
    if (checkpoint.status === 'waiting_children' && allTerminal) nextStatus = 'ready_to_resume';
    if (nextStatus !== checkpoint.status && !canTransitionCheckpoint(checkpoint.status, nextStatus)) {
      throw new AgentStoreProtocolError('checkpoint_result_transition_invalid', 'Checkpoint cannot finish after joining this Task result');
    }
    const checkpointUpdate = this.database.execute(
      `UPDATE chat_agent_delegation_checkpoints
       SET terminal_results_json = ?, status = ?, version = version + 1, updated_at = ?
       WHERE checkpoint_id = ? AND status = ? AND version = ? AND record_state = ?`,
      [JSON.stringify(terminalResults), nextStatus, occurredAt, checkpoint.checkpointId, checkpoint.status, checkpoint.version, 'active']
    );
    if (checkpointUpdate.changes !== 1) {
      throw new AgentStoreProtocolError('checkpoint_result_conflict', 'Checkpoint result projection changed concurrently');
    }
    this.appendEvent('checkpoint', checkpoint.checkpointId, 'child.result_recorded', { toolCallId: task.toolCallId, resultHash }, occurredAt, source);
    if (allTerminal && checkpoint.status === 'waiting_children') {
      this.appendEvent(
        'checkpoint',
        checkpoint.checkpointId,
        'delegation.ready',
        { resultCount: Object.keys(terminalResults).length },
        occurredAt,
        'coordinator'
      );
      const readyPayload = {
        checkpointId: checkpoint.checkpointId,
        sessionId: checkpoint.sessionId,
        turnId: checkpoint.turnId,
        resultCount: Object.keys(terminalResults).length
      };
      const outboxInsert = this.database.execute(
        `INSERT INTO chat_agent_outbox (
          outbox_id, dedupe_key, event_type, payload_json, payload_hash, schema_version,
          delivery_status, attempt_count, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `delegation-ready-${checkpoint.checkpointId}`,
          `delegation.ready:${checkpoint.checkpointId}`,
          'delegation.ready',
          JSON.stringify(readyPayload),
          hashAgentPayload(readyPayload),
          1,
          'pending',
          0,
          occurredAt,
          occurredAt
        ]
      );
      if (outboxInsert.changes !== 1) {
        throw new AgentStoreProtocolError('ready_outbox_write_failed', 'Ready Outbox was not created with the terminal result');
      }
    } else if (allTerminal) {
      this.appendEvent('checkpoint', checkpoint.checkpointId, 'delegation.completed', { outcome: 'cancelled' }, occurredAt, 'coordinator');
    }
    const updated = this.getCheckpoint(checkpoint.checkpointId);
    if (!updated) throw new AgentStoreProtocolError('checkpoint_projection_missing', 'Updated Checkpoint is missing');
    return updated;
  }

  /** @inheritdoc */
  recordTaskResult(input: RecordTaskResultInput): AgentCheckpointRecord {
    let replayConflict: AgentStoreProtocolError | undefined;
    const recordedCheckpoint = this.database.transaction((): AgentCheckpointRecord => {
      const task = this.getTask(input.taskId);
      const checkpoint = this.getCheckpoint(input.checkpointId);
      if (!task || !checkpoint) throw new AgentStoreProtocolError('result_target_missing', 'Task or Checkpoint does not exist');
      if (
        task.checkpointId !== input.checkpointId ||
        task.toolCallId !== input.toolCallId ||
        task.recordState !== 'active' ||
        checkpoint.recordState !== 'active'
      ) {
        throw new AgentStoreProtocolError('result_target_mismatch', 'Result target identity does not match persisted facts');
      }

      const resultValidation = validateChatAgentResult(input.result);
      if (!resultValidation.ok) {
        throw new AgentStoreProtocolError(
          resultValidation.error.details?.reason?.toString() ?? 'result_validation_failed',
          resultValidation.error.message,
          'result_validation'
        );
      }
      const { result } = resultValidation;
      const computedHash = hashAgentPayload(result);
      if (
        computedHash !== input.resultHash ||
        result.taskId !== task.taskId ||
        result.agentId !== task.agentId ||
        task.currentAttemptId === undefined ||
        result.attemptId !== task.currentAttemptId ||
        !hasExactCriteria(result, task.contractSnapshot.acceptanceCriteria)
      ) {
        throw new AgentStoreProtocolError('result_identity_invalid', 'Result identity or hash does not match Task');
      }
      if (task.resultHash) {
        const envelope = checkpoint.terminalResults[task.toolCallId];
        if (
          !task.result ||
          isPreAttemptFailure(task.result) ||
          hashAgentPayload(task.result) !== task.resultHash ||
          !envelope ||
          isPreAttemptFailure(envelope.result) ||
          envelope.resultHash !== task.resultHash ||
          hashAgentPayload(envelope.result) !== task.resultHash ||
          envelope.result.taskId !== task.taskId ||
          envelope.result.agentId !== task.agentId ||
          envelope.result.attemptId !== task.currentAttemptId
        ) {
          throw new AgentStoreProtocolError('result_replay_conflict', 'Task result replay conflicts with persisted Task or Checkpoint result');
        }
        if (task.resultHash !== computedHash) {
          // 冲突审计必须在事务提交后再抛错，否则 append-only Event 会随 throw 回滚。
          this.appendEvent(
            'task',
            task.taskId,
            'protocol.error',
            {
              reason: 'result_replay_conflict',
              expectedHash: task.resultHash,
              actualHash: computedHash
            },
            input.occurredAt,
            'coordinator'
          );
          replayConflict = new AgentStoreProtocolError(
            'result_replay_conflict',
            'Task result replay conflicts with the already persisted canonical result',
            'result_validation'
          );
        }
        return checkpoint;
      }
      if (!task.executionPlanSnapshotHash) {
        throw new AgentStoreProtocolError('result_plan_missing', 'Task has no frozen Execution Plan');
      }
      const attemptRow = this.database.select<AttemptRow>('SELECT * FROM chat_agent_attempts WHERE attempt_id = ?', [task.currentAttemptId])[0];
      if (!attemptRow) throw new AgentStoreProtocolError('result_attempt_missing', 'Current Attempt does not exist');
      const attempt = parseAttempt(attemptRow);
      if (
        attempt.attemptId !== result.attemptId ||
        attempt.taskId !== task.taskId ||
        attempt.planHash !== task.executionPlanSnapshotHash ||
        ATTEMPT_TERMINAL_STATUSES.has(attempt.status)
      ) {
        throw new AgentStoreProtocolError('result_attempt_invalid', 'Current Attempt identity, plan, or status is invalid');
      }
      if (checkpoint.status !== 'waiting_children' && checkpoint.status !== 'cancelling') {
        throw new AgentStoreProtocolError('checkpoint_not_waiting', 'Checkpoint is not accepting Task results');
      }

      const targetStatus: AgentTaskStatus = result.executionStatus;
      const isStartFailureResult = targetStatus === 'failed' && result.error?.code === 'runtime_start_failed' && result.error.phase === 'starting';
      const isStartFailure = task.status === 'starting' && attempt.status === 'starting' && isStartFailureResult;
      const waitingConfirmationFailure =
        task.status === 'waiting_confirmation' &&
        attempt.status === 'running' &&
        targetStatus === 'failed' &&
        result.error?.code === 'confirmation_denied' &&
        result.error.phase === 'confirmation';
      const queuedCommitFailure =
        task.status === 'queued' &&
        task.queuePhase === 'commit' &&
        attempt.status === 'running' &&
        (targetStatus === 'failed' || targetStatus === 'deadline_exceeded' || targetStatus === 'cancelled' || targetStatus === 'commit_failed');
      const attemptSourceMatches =
        isStartFailure ||
        ((task.status === 'running' || task.status === 'committing') && attempt.status === 'running') ||
        waitingConfirmationFailure ||
        queuedCommitFailure ||
        (task.status === 'cancelling' && (attempt.status === 'starting' || attempt.status === 'running'));
      if (isStartFailureResult && !isStartFailure) {
        throw new AgentStoreProtocolError('result_attempt_state_invalid', 'Runtime start failure requires a starting Task and Attempt', 'starting');
      }
      if (!attemptSourceMatches || targetStatus === 'commit_failed') {
        throw new AgentStoreProtocolError('result_attempt_state_invalid', 'Task result does not match the current Attempt state');
      }
      if (
        (!isStartFailure && !['running', 'waiting_confirmation', 'queued', 'cancelling', 'committing'].includes(task.status)) ||
        !canTransitionTask(task.status, targetStatus, { mode: task.contractSnapshot.mode })
      ) {
        throw new AgentStoreProtocolError('result_source_state_invalid', 'Task cannot terminalize from its current state');
      }
      const attemptUpdate = this.database.execute(
        `UPDATE chat_agent_attempts
         SET status = ?, finished_at = ?, error_json = ?
         WHERE attempt_id = ? AND task_id = ? AND plan_hash = ? AND status = ?`,
        [
          targetStatus,
          input.occurredAt,
          result.error ? JSON.stringify(result.error) : null,
          result.attemptId,
          task.taskId,
          task.executionPlanSnapshotHash,
          attempt.status
        ]
      );
      if (attemptUpdate.changes !== 1) {
        throw new AgentStoreProtocolError('result_attempt_conflict', 'Current Attempt changed concurrently');
      }
      if (task.contractSnapshot.mode === 'write' && targetStatus !== 'completed') {
        const changeset = this.getAttemptChangeset(attempt.attemptId);
        if (changeset && changeset.status !== 'committing' && changeset.status !== 'committed' && changeset.status !== 'discarded') {
          const changesetUpdate = this.database.execute(
            `UPDATE chat_agent_changesets
             SET status = ?, updated_at = ?
             WHERE changeset_id = ? AND status = ? AND record_state = ?`,
            ['discarded', input.occurredAt, changeset.snapshot.changesetId, changeset.status, 'active']
          );
          if (changesetUpdate.changes !== 1) {
            throw new AgentStoreProtocolError('result_changeset_discard_conflict', 'Terminal write result could not discard its changeset');
          }
        }
      }
      const taskUpdate = this.database.execute(
        `UPDATE chat_agent_tasks
         SET status = ?, queue_phase = NULL, result_json = ?, result_hash = ?, error_json = ?, updated_at = ?
         WHERE task_id = ? AND status = ? AND result_hash IS NULL AND record_state = ?`,
        [
          targetStatus,
          JSON.stringify(result),
          computedHash,
          result.error ? JSON.stringify(result.error) : null,
          input.occurredAt,
          task.taskId,
          task.status,
          'active'
        ]
      );
      if (taskUpdate.changes !== 1) {
        throw new AgentStoreProtocolError('result_write_conflict', 'Task result changed concurrently');
      }
      let taskEventType: 'task.completed' | 'task.failed' | 'task.cancelled' = 'task.failed';
      if (targetStatus === 'completed') taskEventType = 'task.completed';
      if (targetStatus === 'cancelled') taskEventType = 'task.cancelled';
      if (taskEventType === 'task.completed') {
        this.appendEvent('task', task.taskId, taskEventType, { resultHash: computedHash }, input.occurredAt, 'child');
      } else if (taskEventType === 'task.cancelled') {
        this.appendEvent('task', task.taskId, taskEventType, { resultHash: computedHash }, input.occurredAt, 'child');
      } else {
        this.appendEvent(
          'task',
          task.taskId,
          taskEventType,
          { ...(result.error ? { error: result.error } : {}), resultHash: computedHash },
          input.occurredAt,
          'child'
        );
      }

      return this.joinTerminalResult(task, checkpoint, result, computedHash, input.occurredAt, 'child');
    });
    if (replayConflict) throw replayConflict;
    return recordedCheckpoint;
  }

  /** @inheritdoc */
  recordPreAttemptFailure(input: RecordPreAttemptFailureInput): AgentCheckpointRecord {
    let replayConflict: AgentStoreProtocolError | undefined;
    const recordedCheckpoint = this.database.transaction((): AgentCheckpointRecord => {
      const task = this.getTask(input.taskId);
      const checkpoint = this.getCheckpoint(input.checkpointId);
      const error = validateAgentTaskError(input.error);
      if (!task || !checkpoint) {
        throw new AgentStoreProtocolError('pre_attempt_target_missing', 'Task or Checkpoint does not exist', 'plan_validation');
      }
      if (
        task.checkpointId !== input.checkpointId ||
        task.toolCallId !== input.toolCallId ||
        task.recordState !== 'active' ||
        checkpoint.recordState !== 'active'
      ) {
        throw new AgentStoreProtocolError('pre_attempt_target_mismatch', 'Pre-Attempt result target does not match persisted facts', 'plan_validation');
      }
      if (
        !error ||
        error.retryable ||
        (error.phase !== 'plan_validation' && error.phase !== 'resource_validation') ||
        !Number.isFinite(Date.parse(input.occurredAt))
      ) {
        throw new AgentStoreProtocolError(
          'pre_attempt_error_invalid',
          'Pre-Attempt failure requires a non-retryable plan or resource error',
          'plan_validation'
        );
      }
      const result = this.createPreAttemptResult(task, error);
      const computedHash = hashAgentPayload(result);
      if (task.resultHash) {
        const envelope = checkpoint.terminalResults[task.toolCallId];
        if (
          !task.result ||
          !isPreAttemptFailure(task.result) ||
          !envelope ||
          !isPreAttemptFailure(envelope.result) ||
          task.resultHash !== envelope.resultHash ||
          hashAgentPayload(task.result) !== task.resultHash ||
          hashAgentPayload(envelope.result) !== task.resultHash
        ) {
          throw new AgentStoreProtocolError('pre_attempt_replay_conflict', 'Pre-Attempt replay conflicts with persisted Task or Checkpoint result');
        }
        if (task.resultHash !== computedHash) {
          this.appendEvent(
            'task',
            task.taskId,
            'protocol.error',
            {
              reason: 'pre_attempt_replay_conflict',
              expectedHash: task.resultHash,
              actualHash: computedHash
            },
            input.occurredAt,
            'coordinator'
          );
          replayConflict = new AgentStoreProtocolError(
            'pre_attempt_replay_conflict',
            'Pre-Attempt replay conflicts with the already persisted canonical result',
            'result_validation'
          );
        }
        return checkpoint;
      }
      if (
        checkpoint.status !== 'waiting_children' ||
        task.currentAttemptId !== undefined ||
        !canTransitionTask(task.status, 'failed', {
          mode: task.contractSnapshot.mode,
          queuePhase: task.queuePhase
        })
      ) {
        throw new AgentStoreProtocolError('pre_attempt_state_invalid', 'Task is not eligible for pre-Attempt terminalization', 'plan_validation');
      }
      const taskUpdate = this.database.execute(
        `UPDATE chat_agent_tasks
         SET status = ?, queue_phase = NULL, result_json = ?, result_hash = ?, error_json = ?, updated_at = ?
         WHERE task_id = ? AND status = ? AND current_attempt_id IS NULL
           AND result_hash IS NULL AND record_state = ?`,
        ['failed', JSON.stringify(result), computedHash, JSON.stringify(error), input.occurredAt, task.taskId, task.status, 'active']
      );
      if (taskUpdate.changes !== 1) {
        throw new AgentStoreProtocolError('pre_attempt_write_conflict', 'Task changed before its pre-Attempt failure was recorded', 'plan_validation');
      }
      this.appendEvent('task', task.taskId, 'task.failed', { error, resultHash: computedHash }, input.occurredAt, 'coordinator');
      return this.joinTerminalResult(task, checkpoint, result, computedHash, input.occurredAt, 'coordinator');
    });
    if (replayConflict) throw replayConflict;
    return recordedCheckpoint;
  }

  /** @inheritdoc */
  claimResume(input: ClaimCheckpointInput): AgentCheckpointRecord | null {
    return this.database.transaction((): AgentCheckpointRecord | null => {
      const aggregate = this.loadValidatedAggregate(input.checkpointId);
      const checkpoint = aggregate?.checkpoint;
      if (
        !checkpoint ||
        checkpoint.recordState !== 'active' ||
        checkpoint.status !== 'ready_to_resume' ||
        checkpoint.version !== input.expectedVersion ||
        checkpoint.resumeRuntimeId !== undefined ||
        !canTransitionCheckpoint(checkpoint.status, 'resuming')
      ) {
        return null;
      }
      const update = this.database.execute(
        `UPDATE chat_agent_delegation_checkpoints
         SET status = ?, version = version + 1, resume_runtime_id = ?, updated_at = ?
         WHERE checkpoint_id = ? AND status = ? AND version = ?
           AND resume_runtime_id IS NULL AND record_state = ?`,
        ['resuming', input.resumeRuntimeId, input.occurredAt, checkpoint.checkpointId, 'ready_to_resume', input.expectedVersion, 'active']
      );
      if (update.changes !== 1) return null;
      this.appendEvent('checkpoint', checkpoint.checkpointId, 'primary.resume_started', { runtimeId: input.resumeRuntimeId }, input.occurredAt, 'primary');
      const updated = this.loadValidatedAggregate(checkpoint.checkpointId);
      if (!updated) throw new AgentStoreProtocolError('checkpoint_projection_missing', 'Claimed Checkpoint is missing');
      return updated.checkpoint;
    });
  }

  /** @inheritdoc */
  finalizeResume(input: FinalizeCheckpointInput): AgentCheckpointRecord {
    return this.database.transaction((): AgentCheckpointRecord => {
      const aggregate = this.loadValidatedAggregate(input.checkpointId);
      const checkpoint = aggregate?.checkpoint;
      if (!checkpoint || checkpoint.recordState !== 'active') {
        throw new AgentStoreProtocolError('resume_finalize_inactive', 'Checkpoint is not inside the active finalization scope');
      }
      const error = input.error === undefined ? undefined : validateAgentTaskError(input.error);
      if (input.error !== undefined && !error) {
        throw new AgentStoreProtocolError('resume_error_invalid', 'Checkpoint finalization error is invalid');
      }
      if ((input.outcome === 'failed') !== (error !== undefined)) {
        throw new AgentStoreProtocolError('resume_outcome_invalid', 'Failed finalization requires one structured error');
      }

      // 同一 Runtime 的完全相同终态请求是幂等重放，不追加重复完成 Event。
      if (checkpoint.status === input.outcome) {
        const errorMatches =
          input.outcome === 'completed' ||
          (checkpoint.error !== undefined && error !== undefined && hashAgentPayload(checkpoint.error) === hashAgentPayload(error));
        if (checkpoint.resumeRuntimeId === input.resumeRuntimeId && errorMatches) return checkpoint;
        throw new AgentStoreProtocolError('resume_finalize_conflict', 'Finalized Checkpoint conflicts with the requested Runtime or outcome');
      }
      if (isCheckpointTerminal(checkpoint.status)) {
        throw new AgentStoreProtocolError('resume_finalize_conflict', 'Finalized Checkpoint conflicts with the requested Runtime or outcome');
      }
      if (
        checkpoint.status !== 'resuming' ||
        checkpoint.version !== input.expectedVersion ||
        checkpoint.resumeRuntimeId !== input.resumeRuntimeId ||
        !canTransitionCheckpoint(checkpoint.status, input.outcome)
      ) {
        throw new AgentStoreProtocolError('resume_finalize_invalid', 'Checkpoint cannot be finalized by this Runtime');
      }
      const update = this.database.execute(
        `UPDATE chat_agent_delegation_checkpoints
         SET status = ?, version = version + 1, error_json = ?, updated_at = ?
         WHERE checkpoint_id = ? AND status = ? AND version = ? AND resume_runtime_id = ?
           AND record_state = ?`,
        [
          input.outcome,
          error ? JSON.stringify(error) : null,
          input.occurredAt,
          checkpoint.checkpointId,
          'resuming',
          input.expectedVersion,
          input.resumeRuntimeId,
          'active'
        ]
      );
      if (update.changes !== 1) {
        throw new AgentStoreProtocolError('resume_finalize_conflict', 'Checkpoint finalization lost its CAS');
      }
      this.appendEvent('checkpoint', checkpoint.checkpointId, 'delegation.completed', { outcome: input.outcome }, input.occurredAt, 'primary');
      const updated = this.getCheckpoint(checkpoint.checkpointId);
      if (!updated) throw new AgentStoreProtocolError('checkpoint_projection_missing', 'Finalized Checkpoint is missing');
      return updated;
    });
  }

  /** @inheritdoc */
  cancelCheckpoint(input: CancelCheckpointInput): AgentCheckpointRecord {
    return this.database.transaction((): AgentCheckpointRecord => {
      if (!input.reason.trim() || !Number.isFinite(Date.parse(input.occurredAt))) {
        throw new AgentStoreProtocolError('checkpoint_cancel_input_invalid', 'Cancellation input is invalid');
      }
      let checkpoint = this.getCheckpoint(input.checkpointId);
      if (!checkpoint) throw new AgentStoreProtocolError('checkpoint_not_found', 'Checkpoint does not exist');
      if (checkpoint.status === 'cancelled') return checkpoint;

      if (checkpoint.status === 'waiting_children' || checkpoint.status === 'ready_to_resume') {
        if (!canTransitionCheckpoint(checkpoint.status, 'cancelling')) {
          throw new AgentStoreProtocolError('checkpoint_cancel_transition_invalid', 'Checkpoint cannot start cancellation');
        }
        const requestUpdate = this.database.execute(
          `UPDATE chat_agent_delegation_checkpoints
           SET status = ?, version = version + 1, updated_at = ?
           WHERE checkpoint_id = ? AND status = ? AND version = ? AND record_state = ?`,
          ['cancelling', input.occurredAt, checkpoint.checkpointId, checkpoint.status, checkpoint.version, 'active']
        );
        if (requestUpdate.changes !== 1) {
          throw new AgentStoreProtocolError('checkpoint_cancel_conflict', 'Checkpoint cancellation changed concurrently');
        }
        this.appendEvent('checkpoint', checkpoint.checkpointId, 'delegation.cancel_requested', { reason: input.reason.trim() }, input.occurredAt, 'user');
        const requested = this.getCheckpoint(checkpoint.checkpointId);
        if (!requested) throw new AgentStoreProtocolError('checkpoint_projection_missing', 'Cancelling Checkpoint is missing');
        checkpoint = requested;
      } else if (checkpoint.status !== 'cancelling') {
        throw new AgentStoreProtocolError('checkpoint_cancel_state_invalid', 'Checkpoint cannot accept cancellation');
      }

      const activeTaskRows = this.database.select<TaskRow>(
        `SELECT * FROM chat_agent_tasks
         WHERE checkpoint_id = ? AND record_state = ?
         ORDER BY created_at ASC, task_id ASC`,
        [checkpoint.checkpointId, 'active']
      );
      activeTaskRows.map(parseTask).forEach((task): void => {
        if (isTaskTerminal(task.status) || task.status === 'cancelling') return;
        if (task.status === 'committing') {
          const commitCancelUpdate = this.database.execute(
            `UPDATE chat_agent_tasks
             SET cancel_requested_at = COALESCE(cancel_requested_at, ?), updated_at = ?
             WHERE task_id = ? AND status = ? AND record_state = ?`,
            [input.occurredAt, input.occurredAt, task.taskId, 'committing', 'active']
          );
          if (commitCancelUpdate.changes !== 1) {
            throw new AgentStoreProtocolError('task_cancel_conflict', 'Committing Task cancellation changed concurrently');
          }
          return;
        }
        if (!canTransitionTask(task.status, 'cancelling', { mode: task.contractSnapshot.mode })) return;
        const taskUpdate = this.database.execute(
          `UPDATE chat_agent_tasks
           SET status = ?, queue_phase = NULL, cancel_requested_at = ?, updated_at = ?
           WHERE task_id = ? AND status = ? AND record_state = ?`,
          ['cancelling', input.occurredAt, input.occurredAt, task.taskId, task.status, 'active']
        );
        if (taskUpdate.changes !== 1) {
          throw new AgentStoreProtocolError('task_cancel_conflict', 'Task cancellation changed concurrently');
        }
        this.appendEvent('task', task.taskId, 'task.status_changed', { from: task.status, to: 'cancelling' }, input.occurredAt, 'user');
      });

      const safety = this.database.select<{ live_attempts: unknown; journal_count: unknown }>(
        `SELECT
           COUNT(a.attempt_id) AS live_attempts,
           COALESCE(SUM(t.unfinished_journal_count), 0) AS journal_count
         FROM chat_agent_tasks t
         LEFT JOIN chat_agent_attempts a
           ON a.task_id = t.task_id
          AND a.status NOT IN (?, ?, ?, ?, ?, ?)
         WHERE t.checkpoint_id = ? AND t.record_state = ?`,
        ['completed', 'failed', 'cancelled', 'deadline_exceeded', 'commit_failed', 'interrupted', checkpoint.checkpointId, 'active']
      )[0];
      if (
        requireInteger(safety?.live_attempts, 'checkpoint live attempt count') !== 0 ||
        requireInteger(safety?.journal_count, 'checkpoint journal count') !== 0
      ) {
        return checkpoint;
      }
      const cancellationTasks = this.database
        .select<TaskRow>(
          `SELECT * FROM chat_agent_tasks
           WHERE checkpoint_id = ? AND record_state = ?
           ORDER BY created_at ASC, task_id ASC`,
          [checkpoint.checkpointId, 'active']
        )
        .map(parseTask);
      if (cancellationTasks.some((task): boolean => !isTaskTerminal(task.status) && task.status !== 'cancelling')) {
        return checkpoint;
      }
      cancellationTasks.forEach((task): void => {
        if (task.status !== 'cancelling') return;
        const taskUpdate = this.database.execute(
          `UPDATE chat_agent_tasks
           SET status = ?, queue_phase = NULL, updated_at = ?
           WHERE task_id = ? AND status = ? AND record_state = ?`,
          ['cancelled', input.occurredAt, task.taskId, 'cancelling', 'active']
        );
        if (taskUpdate.changes !== 1) {
          throw new AgentStoreProtocolError('task_cancel_finalize_conflict', 'Task cancellation finalization changed concurrently');
        }
        this.appendEvent('task', task.taskId, 'task.cancelled', {}, input.occurredAt, 'coordinator');
      });
      if (!canTransitionCheckpoint(checkpoint.status, 'cancelled')) {
        throw new AgentStoreProtocolError('checkpoint_cancel_finalize_invalid', 'Checkpoint cannot finish cancellation');
      }
      const finalUpdate = this.database.execute(
        `UPDATE chat_agent_delegation_checkpoints
         SET status = ?, version = version + 1, updated_at = ?
         WHERE checkpoint_id = ? AND status = ? AND version = ? AND record_state = ?`,
        ['cancelled', input.occurredAt, checkpoint.checkpointId, 'cancelling', checkpoint.version, 'active']
      );
      if (finalUpdate.changes !== 1) {
        throw new AgentStoreProtocolError('checkpoint_cancel_finalize_conflict', 'Checkpoint cancellation finalization lost its CAS');
      }
      this.appendEvent('checkpoint', checkpoint.checkpointId, 'delegation.completed', { outcome: 'cancelled' }, input.occurredAt, 'coordinator');
      const cancelled = this.getCheckpoint(checkpoint.checkpointId);
      if (!cancelled) throw new AgentStoreProtocolError('checkpoint_projection_missing', 'Cancelled Checkpoint is missing');
      return cancelled;
    });
  }

  /** @inheritdoc */
  tombstoneTask(input: TombstoneAgentTaskInput): AgentTaskRecord {
    return this.database.transaction((): AgentTaskRecord => {
      if (!input.reason.trim() || !Number.isFinite(Date.parse(input.occurredAt))) {
        throw new AgentStoreProtocolError('task_tombstone_input_invalid', 'Task tombstone envelope is invalid');
      }
      const task = this.getTask(input.taskId);
      if (!task) throw new AgentStoreProtocolError('task_not_found', 'Task does not exist');
      if (task.recordState !== 'active') throw new AgentStoreProtocolError('task_already_tombstoned', 'Task is already tombstoned');
      const pendingConfirmation = this.database.select<{ pending_count: unknown }>(
        `SELECT COUNT(*) AS pending_count
         FROM chat_agent_confirmations c
         INNER JOIN chat_agent_changesets s ON s.changeset_id = c.changeset_id
         WHERE s.task_id = ? AND c.status = ?`,
        [task.taskId, 'pending']
      )[0];
      if (requireInteger(pendingConfirmation?.pending_count, 'pending confirmation count') !== 0) {
        throw new AgentStoreProtocolError('task_confirmation_pending', 'Task owns a pending confirmation');
      }
      if (task.unfinishedJournalCount !== 0) {
        throw new AgentStoreProtocolError('task_journal_active', 'Task owns an unfinished commit journal');
      }
      if (!isTaskTerminal(task.status)) {
        throw new AgentStoreProtocolError('task_not_terminal', 'Only terminal Tasks can be tombstoned');
      }
      const liveAttempt = this.database.select<{ live_count: unknown }>(
        `SELECT COUNT(*) AS live_count
         FROM chat_agent_attempts
         WHERE task_id = ?
           AND status NOT IN (?, ?, ?, ?, ?, ?)`,
        [task.taskId, 'completed', 'failed', 'cancelled', 'deadline_exceeded', 'commit_failed', 'interrupted']
      )[0];
      if (requireInteger(liveAttempt?.live_count, 'live attempt count') !== 0) {
        throw new AgentStoreProtocolError('task_attempt_active', 'Task has a live Attempt');
      }
      const checkpoint = this.getCheckpoint(task.checkpointId);
      if (!checkpoint || !isCheckpointTerminal(checkpoint.status)) {
        throw new AgentStoreProtocolError('task_checkpoint_active', 'Task is referenced by a nonterminal Checkpoint');
      }
      const update = this.database.execute(
        `UPDATE chat_agent_tasks
         SET record_state = ?, updated_at = ?
         WHERE task_id = ? AND record_state = ? AND status = ? AND unfinished_journal_count = 0`,
        ['tombstoned', input.occurredAt, task.taskId, 'active', task.status]
      );
      if (update.changes !== 1) {
        throw new AgentStoreProtocolError('task_tombstone_conflict', 'Task tombstone preconditions changed');
      }
      this.appendEvent('task', task.taskId, 'task.tombstoned', { reason: input.reason.trim() }, input.occurredAt, input.source);
      const updated = this.getTask(task.taskId);
      if (!updated) throw new AgentStoreProtocolError('task_projection_missing', 'Tombstoned Task is missing');
      return updated;
    });
  }

  /** @inheritdoc */
  listTasksBySession(input: ListAgentTasksInput): AgentTaskListPage {
    if (
      normalizeAgentIdentity(input.sessionId) !== input.sessionId ||
      !Number.isInteger(input.terminalLimit) ||
      input.terminalLimit < 0 ||
      (input.terminalBefore !== undefined &&
        (normalizeAgentIdentity(input.terminalBefore.taskId) !== input.terminalBefore.taskId || !Number.isFinite(Date.parse(input.terminalBefore.updatedAt))))
    ) {
      throw new AgentStoreProtocolError('task_list_input_invalid', 'Task list query input is invalid');
    }

    return this.database.transaction((): AgentTaskListPage => {
      const terminalStatuses: readonly AgentTaskStatus[] = ['completed', 'failed', 'cancelled', 'deadline_exceeded', 'commit_failed'];
      const activeRows = input.includeActive
        ? this.database.select<TaskRow>(
            `SELECT * FROM chat_agent_tasks
             WHERE session_id = ?
               AND record_state = ?
               AND status NOT IN (?, ?, ?, ?, ?)
             ORDER BY updated_at DESC, task_id DESC`,
            [input.sessionId, 'active', ...terminalStatuses]
          )
        : [];
      const terminalParams: unknown[] = [input.sessionId, 'active', ...terminalStatuses];
      const cursorClause = input.terminalBefore
        ? `AND (
             updated_at < ?
             OR (updated_at = ? AND task_id < ?)
           )`
        : '';
      if (input.terminalBefore) {
        terminalParams.push(input.terminalBefore.updatedAt, input.terminalBefore.updatedAt, input.terminalBefore.taskId);
      }
      terminalParams.push(input.terminalLimit + 1);
      const terminalRows = this.database.select<TaskRow>(
        `SELECT * FROM chat_agent_tasks
         WHERE session_id = ?
           AND record_state = ?
           AND status IN (?, ?, ?, ?, ?)
           ${cursorClause}
         ORDER BY updated_at DESC, task_id DESC
         LIMIT ?`,
        terminalParams
      );
      const hasMoreTerminal = terminalRows.length > input.terminalLimit;
      /**
       * 在当前列表事务内把排序行加载为完整投影。
       * @param row - 已按页面顺序选中的 Task 行
       * @returns 与排序事实处于同一快照的 Task 投影
       */
      const loadRow = (row: TaskRow): AgentTaskProjectionRecord => {
        const projection = this.loadTaskProjection(requireString(row.task_id, 'list task id'));
        if (!projection) {
          throw new AgentStoreProtocolError('task_list_projection_missing', 'Listed Task projection is missing');
        }
        return projection;
      };

      return Object.freeze({
        active: Object.freeze(activeRows.map(loadRow)),
        terminal: Object.freeze(terminalRows.slice(0, input.terminalLimit).map(loadRow)),
        hasMoreTerminal
      });
    });
  }

  /** @inheritdoc */
  getTaskProjection(taskId: string): AgentTaskProjectionRecord | null {
    if (normalizeAgentIdentity(taskId) !== taskId) {
      throw new AgentStoreProtocolError('projection_task_id_invalid', 'Task projection identity is invalid');
    }

    return this.database.transaction((): AgentTaskProjectionRecord | null => this.loadTaskProjection(taskId));
  }

  /**
   * 在调用方已经建立的读取事务中加载完整 Task 投影事实。
   * @param taskId - Task ID
   * @returns 完整投影记录，不存在时为 null
   */
  private loadTaskProjection(taskId: string): AgentTaskProjectionRecord | null {
    const task = this.getTask(taskId);
    if (!task) return null;
    const checkpoint = this.getCheckpoint(task.checkpointId);
    const toolCall = checkpoint?.continuationSnapshot.orderedToolCalls.find((entry): boolean => entry.taskId === task.taskId);
    if (
      !checkpoint ||
      checkpoint.sessionId !== task.sessionId ||
      checkpoint.turnId !== task.turnId ||
      checkpoint.rootRuntimeId !== task.rootRuntimeId ||
      checkpoint.primaryAgentId !== task.parentAgentId ||
      toolCall?.toolCallId !== task.toolCallId
    ) {
      throw new AgentStoreProtocolError('projection_checkpoint_mismatch', 'Task projection Checkpoint identity is inconsistent');
    }

    let currentAttempt: AgentAttemptRecord | undefined;
    if (task.currentAttemptId) {
      const attempt = this.getAttempt(task.currentAttemptId);
      if (!attempt || attempt.taskId !== task.taskId || attempt.planHash !== task.executionPlanSnapshotHash) {
        throw new AgentStoreProtocolError('projection_attempt_mismatch', 'Task projection Attempt identity is inconsistent');
      }
      currentAttempt = attempt;
    }

    const eventRows = this.database.select<EventRow>(
      `SELECT * FROM chat_agent_events
       WHERE aggregate_kind = ? AND aggregate_id = ?
       ORDER BY sequence DESC
       LIMIT 50`,
      ['task', task.taskId]
    );
    if (eventRows.length === 0) {
      throw new AgentStoreProtocolError('projection_event_missing', 'Task projection Event history is missing');
    }
    const taskSequence = requireInteger(eventRows[0].sequence, 'projection task sequence');
    const events = eventRows.map(parseEvent).reverse();
    if (events.at(-1)?.sequence !== taskSequence || events.some((event, index): boolean => index > 0 && event.sequence !== events[index - 1].sequence + 1)) {
      throw new AgentStoreProtocolError('projection_event_sequence_invalid', 'Task projection Event window is not continuous');
    }

    const changeset = currentAttempt ? this.getAttemptChangeset(currentAttempt.attemptId) : null;
    if (
      changeset &&
      (changeset.snapshot.taskId !== task.taskId ||
        changeset.snapshot.attemptId !== currentAttempt?.attemptId ||
        changeset.snapshot.agentId !== task.agentId ||
        changeset.snapshot.runtimeId !== currentAttempt.currentRuntimeId ||
        changeset.snapshot.planHash !== currentAttempt.planHash)
    ) {
      throw new AgentStoreProtocolError('projection_changeset_mismatch', 'Task projection changeset identity is inconsistent');
    }

    const confirmation = changeset?.confirmationId ? this.getConfirmation(changeset.confirmationId) : null;
    if (
      changeset?.confirmationId &&
      (!confirmation ||
        confirmation.changesetId !== changeset.snapshot.changesetId ||
        confirmation.request.taskId !== task.taskId ||
        confirmation.request.attemptId !== currentAttempt?.attemptId ||
        confirmation.request.agentId !== task.agentId ||
        confirmation.request.runtimeId !== currentAttempt?.currentRuntimeId ||
        confirmation.request.toolCallId !== task.toolCallId ||
        confirmation.request.sessionId !== task.sessionId ||
        confirmation.request.turnId !== task.turnId ||
        confirmation.request.planHash !== changeset.snapshot.planHash ||
        confirmation.request.baseRevision !== changeset.snapshot.baseRevision ||
        confirmation.request.diffHash !== changeset.snapshot.diffHash ||
        confirmation.request.operationSetHash !== changeset.snapshot.operationSetHash)
    ) {
      throw new AgentStoreProtocolError('projection_confirmation_mismatch', 'Task projection confirmation identity is inconsistent');
    }

    const journalRow = changeset
      ? this.database.select<CommitJournalRow>('SELECT * FROM chat_agent_commit_journals WHERE changeset_id = ?', [changeset.snapshot.changesetId])[0]
      : undefined;
    const journal = journalRow ? parseCommitJournal(journalRow) : null;
    if (
      journal &&
      (!confirmation ||
        journal.taskId !== task.taskId ||
        journal.attemptId !== currentAttempt?.attemptId ||
        journal.changesetId !== changeset?.snapshot.changesetId ||
        journal.confirmationId !== confirmation.confirmationId ||
        journal.planHash !== currentAttempt?.planHash)
    ) {
      throw new AgentStoreProtocolError('projection_journal_mismatch', 'Task projection commit journal identity is inconsistent');
    }

    return Object.freeze({
      task,
      checkpoint,
      ...(currentAttempt ? { currentAttempt } : {}),
      taskSequence,
      events: Object.freeze(events),
      ...(changeset ? { changeset } : {}),
      ...(confirmation ? { confirmation } : {}),
      ...(journal ? { journal } : {})
    });
  }

  /** @inheritdoc */
  getTask(taskId: string): AgentTaskRecord | null {
    const row = this.database.select<TaskRow>('SELECT * FROM chat_agent_tasks WHERE task_id = ?', [taskId])[0];
    return row ? parseTask(row) : null;
  }

  /** @inheritdoc */
  getAttempt(attemptId: string): AgentAttemptRecord | null {
    const row = this.database.select<AttemptRow>('SELECT * FROM chat_agent_attempts WHERE attempt_id = ?', [attemptId])[0];
    return row ? Object.freeze(parseAttempt(row)) : null;
  }

  /** @inheritdoc */
  listTaskAttempts(taskId: string): AgentAttemptRecord[] {
    return this.database
      .select<AttemptRow>(
        `SELECT * FROM chat_agent_attempts
         WHERE task_id = ?
         ORDER BY attempt_number ASC`,
        [taskId]
      )
      .map((row): AgentAttemptRecord => Object.freeze(parseAttempt(row)));
  }

  /** @inheritdoc */
  getCheckpoint(checkpointId: string): AgentCheckpointRecord | null {
    const row = this.database.select<CheckpointRow>('SELECT * FROM chat_agent_delegation_checkpoints WHERE checkpoint_id = ?', [checkpointId])[0];
    if (!row) return null;
    const checkpoint = parseCheckpoint(row);
    Object.entries(checkpoint.terminalResults).forEach(([toolCallId, envelope]): void => {
      const toolCall = checkpoint.continuationSnapshot.orderedToolCalls.find((entry): boolean => entry.toolCallId === toolCallId);
      const task = toolCall ? this.getTask(toolCall.taskId) : null;
      if (
        !toolCall ||
        !task ||
        task.resultHash !== envelope.resultHash ||
        !task.result ||
        (isPreAttemptFailure(envelope.result)
          ? !isPreAttemptFailure(task.result)
          : isPreAttemptFailure(task.result) || task.result.attemptId !== envelope.result.attemptId) ||
        !hasExactCriteria(envelope.result, task.contractSnapshot.acceptanceCriteria)
      ) {
        throw new AgentStoreProtocolError('checkpoint_terminal_result_invalid', 'Checkpoint terminal result does not match its persisted Task projection');
      }
    });
    return checkpoint;
  }

  /** @inheritdoc */
  listEvents(aggregateKind: 'task' | 'checkpoint', aggregateId: string): ChatAgentEvent[] {
    const events = this.database
      .select<EventRow>(
        `SELECT * FROM chat_agent_events
         WHERE aggregate_kind = ? AND aggregate_id = ?
         ORDER BY sequence ASC`,
        [aggregateKind, aggregateId]
      )
      .map(parseEvent);
    this.validateEventHistory(aggregateKind, aggregateId, events);
    return events;
  }

  /** @inheritdoc */
  getOutbox(dedupeKey: string): AgentOutboxRecord | null {
    const row = this.database.select<OutboxRow>('SELECT * FROM chat_agent_outbox WHERE dedupe_key = ?', [dedupeKey])[0];
    return row ? parseOutbox(row) : null;
  }

  /** @inheritdoc */
  listPendingOutbox(): AgentOutboxRecord[] {
    return this.database
      .select<OutboxRow>(
        `SELECT * FROM chat_agent_outbox
         WHERE delivery_status = ?
         ORDER BY created_at ASC, outbox_id ASC`,
        ['pending']
      )
      .map(parseOutbox);
  }

  /** @inheritdoc */
  markOutboxDelivered(input: DeliverAgentOutboxInput): AgentOutboxRecord {
    return this.database.transaction((): AgentOutboxRecord => {
      if (!Number.isFinite(Date.parse(input.deliveredAt))) {
        throw new AgentStoreProtocolError('outbox_delivery_time_invalid', 'Outbox delivery time is invalid');
      }
      const row = this.database.select<OutboxRow>('SELECT * FROM chat_agent_outbox WHERE outbox_id = ?', [input.outboxId])[0];
      if (!row) throw new AgentStoreProtocolError('outbox_not_found', 'Outbox record does not exist');
      const current = parseOutbox(row);
      if (current.deliveryStatus === 'delivered') return current;
      const update = this.database.execute(
        `UPDATE chat_agent_outbox
         SET delivery_status = ?, attempt_count = attempt_count + 1, delivered_at = ?, updated_at = ?
         WHERE outbox_id = ? AND delivery_status = ?`,
        ['delivered', input.deliveredAt, input.deliveredAt, current.outboxId, 'pending']
      );
      if (update.changes !== 1) {
        throw new AgentStoreProtocolError('outbox_delivery_conflict', 'Outbox delivery state changed concurrently');
      }
      const updatedRow = this.database.select<OutboxRow>('SELECT * FROM chat_agent_outbox WHERE outbox_id = ?', [input.outboxId])[0];
      if (!updatedRow) throw new AgentStoreProtocolError('outbox_projection_missing', 'Delivered Outbox is missing');
      return parseOutbox(updatedRow);
    });
  }

  /** @inheritdoc */
  interruptCheckpoint(input: InterruptAgentCheckpointInput): AgentCheckpointRecord {
    const validatedReason = validateAgentTaskError(input.error);
    if (!validatedReason || validatedReason.phase !== 'recovery') {
      throw new AgentStoreProtocolError('interrupt_reason_invalid', 'Checkpoint interruption requires a recovery error');
    }
    if (!Number.isFinite(Date.parse(input.occurredAt))) {
      throw new AgentStoreProtocolError('interrupt_time_invalid', 'Checkpoint interruption time is invalid');
    }
    return this.database.transaction((): AgentCheckpointRecord => {
      const aggregate = this.loadValidatedAggregate(input.checkpointId);
      if (!aggregate) {
        throw new AgentStoreProtocolError('checkpoint_not_found', 'Checkpoint does not exist');
      }
      const { checkpoint, tasks: aggregateTasks } = aggregate;
      if (checkpoint.status === 'interrupted') return checkpoint;
      if (checkpoint.status === 'preparing' || !canTransitionCheckpoint(checkpoint.status, 'interrupted')) {
        throw new AgentStoreProtocolError('interrupt_checkpoint_state_invalid', 'Checkpoint cannot transition to interrupted');
      }
      if (aggregateTasks.some((task): boolean => task.status === 'committing' || task.unfinishedJournalCount > 0)) {
        throw new AgentStoreProtocolError('interrupt_checkpoint_journal_blocked', 'Checkpoint interruption requires commit journal recovery');
      }

      this.database.execute(
        `UPDATE chat_agent_attempts
         SET status = ?, finished_at = ?, error_json = ?
         WHERE task_id IN (
           SELECT task_id FROM chat_agent_tasks WHERE checkpoint_id = ? AND record_state = ?
         ) AND status NOT IN (?, ?, ?, ?, ?, ?)`,
        [
          'interrupted',
          input.occurredAt,
          JSON.stringify(validatedReason),
          checkpoint.checkpointId,
          'active',
          'completed',
          'failed',
          'cancelled',
          'deadline_exceeded',
          'commit_failed',
          'interrupted'
        ]
      );
      aggregateTasks.forEach((task): void => {
        if (isTaskTerminal(task.status)) return;
        let sourceStatus = task.status;
        if (sourceStatus !== 'cancelling') {
          if (!canTransitionTask(sourceStatus, 'cancelling', { mode: task.contractSnapshot.mode })) {
            throw new AgentStoreProtocolError('interrupt_task_state_invalid', 'Checkpoint Task cannot cooperate with cancellation');
          }
          const requestUpdate = this.database.execute(
            `UPDATE chat_agent_tasks
             SET status = ?, queue_phase = NULL, cancel_requested_at = ?, updated_at = ?
             WHERE task_id = ? AND status = ? AND record_state = ?`,
            ['cancelling', input.occurredAt, input.occurredAt, task.taskId, sourceStatus, 'active']
          );
          if (requestUpdate.changes !== 1) {
            throw new AgentStoreProtocolError('interrupt_task_conflict', 'Checkpoint Task cancellation changed concurrently');
          }
          this.appendEvent('task', task.taskId, 'task.status_changed', { from: sourceStatus, to: 'cancelling' }, input.occurredAt, 'system');
          sourceStatus = 'cancelling';
        }
        const finalUpdate = this.database.execute(
          `UPDATE chat_agent_tasks
           SET status = ?, queue_phase = NULL, updated_at = ?
           WHERE task_id = ? AND status = ? AND record_state = ?`,
          ['cancelled', input.occurredAt, task.taskId, sourceStatus, 'active']
        );
        if (finalUpdate.changes !== 1) {
          throw new AgentStoreProtocolError('interrupt_task_finalize_conflict', 'Checkpoint Task cancellation finalization changed concurrently');
        }
        this.appendEvent('task', task.taskId, 'task.cancelled', {}, input.occurredAt, 'system');
      });
      const update = this.database.execute(
        `UPDATE chat_agent_delegation_checkpoints
         SET status = ?, version = version + 1, error_json = ?, updated_at = ?
         WHERE checkpoint_id = ? AND status = ? AND version = ? AND record_state = ?`,
        ['interrupted', JSON.stringify(validatedReason), input.occurredAt, checkpoint.checkpointId, checkpoint.status, checkpoint.version, 'active']
      );
      if (update.changes !== 1) {
        throw new AgentStoreProtocolError('interrupt_checkpoint_conflict', 'Checkpoint interruption changed concurrently');
      }
      this.appendEvent('checkpoint', checkpoint.checkpointId, 'delegation.interrupted', { error: validatedReason }, input.occurredAt, 'system');
      const interrupted = this.getCheckpoint(checkpoint.checkpointId);
      if (!interrupted) {
        throw new AgentStoreProtocolError('checkpoint_projection_missing', 'Interrupted Checkpoint is missing');
      }
      return interrupted;
    });
  }

  /** @inheritdoc */
  interruptActive(reason: Parameters<AgentDelegationStore['interruptActive']>[0]): number {
    const validatedReason = validateAgentTaskError(reason);
    if (!validatedReason || validatedReason.phase !== 'recovery') {
      throw new AgentStoreProtocolError('interrupt_reason_invalid', 'Recovery interruption requires a recovery error');
    }
    return this.database.transaction((): number => {
      const rows = this.database.select<CheckpointRow>(
        `SELECT * FROM chat_agent_delegation_checkpoints
         WHERE record_state = ?
           AND status NOT IN (?, ?, ?, ?)
        ORDER BY created_at ASC, checkpoint_id ASC`,
        ['active', 'completed', 'failed', 'cancelled', 'interrupted']
      );
      let interruptedCount = 0;
      rows.forEach((row): void => {
        const checkpointId = requireString(row.checkpoint_id, 'interrupt checkpoint id');
        const aggregate = this.loadValidatedAggregate(checkpointId);
        if (!aggregate) {
          throw new AgentStoreProtocolError('checkpoint_projection_missing', 'Recovery Checkpoint is missing');
        }
        const { checkpoint, tasks: aggregateTasks } = aggregate;
        if (checkpoint.status === 'preparing' || !canTransitionCheckpoint(checkpoint.status, 'interrupted')) {
          throw new AgentStoreProtocolError('interrupt_checkpoint_state_invalid', 'Recovery encountered a Checkpoint that cannot transition to interrupted');
        }
        const occurredAt = new Date().toISOString();

        // Commit recovery 尚未实现时，任一 committing/journal Task 都阻断整个聚合且不得先产生副作用。
        if (aggregateTasks.some((task): boolean => task.status === 'committing' || task.unfinishedJournalCount > 0)) {
          return;
        }
        this.database.execute(
          `UPDATE chat_agent_attempts
           SET status = ?, finished_at = ?, error_json = ?
           WHERE task_id IN (
             SELECT task_id FROM chat_agent_tasks WHERE checkpoint_id = ? AND record_state = ?
           ) AND status NOT IN (?, ?, ?, ?, ?, ?)`,
          [
            'interrupted',
            occurredAt,
            JSON.stringify(validatedReason),
            checkpoint.checkpointId,
            'active',
            'completed',
            'failed',
            'cancelled',
            'deadline_exceeded',
            'commit_failed',
            'interrupted'
          ]
        );
        aggregateTasks.forEach((task): void => {
          if (isTaskTerminal(task.status)) return;
          let sourceStatus = task.status;
          if (sourceStatus !== 'cancelling') {
            if (!canTransitionTask(sourceStatus, 'cancelling', { mode: task.contractSnapshot.mode })) {
              throw new AgentStoreProtocolError('interrupt_task_state_invalid', 'Recovery encountered a Task that cannot cooperate with cancellation');
            }
            const requestUpdate = this.database.execute(
              `UPDATE chat_agent_tasks
               SET status = ?, queue_phase = NULL, cancel_requested_at = ?, updated_at = ?
               WHERE task_id = ? AND status = ? AND record_state = ?`,
              ['cancelling', occurredAt, occurredAt, task.taskId, sourceStatus, 'active']
            );
            if (requestUpdate.changes !== 1) {
              throw new AgentStoreProtocolError('interrupt_task_conflict', 'Recovery Task cancellation changed concurrently');
            }
            this.appendEvent('task', task.taskId, 'task.status_changed', { from: sourceStatus, to: 'cancelling' }, occurredAt, 'system');
            sourceStatus = 'cancelling';
          }
          const finalUpdate = this.database.execute(
            `UPDATE chat_agent_tasks
             SET status = ?, queue_phase = NULL, updated_at = ?
             WHERE task_id = ? AND status = ? AND record_state = ?`,
            ['cancelled', occurredAt, task.taskId, sourceStatus, 'active']
          );
          if (finalUpdate.changes !== 1) {
            throw new AgentStoreProtocolError('interrupt_task_finalize_conflict', 'Recovery Task cancellation finalization changed concurrently');
          }
          this.appendEvent('task', task.taskId, 'task.cancelled', {}, occurredAt, 'system');
        });
        const update = this.database.execute(
          `UPDATE chat_agent_delegation_checkpoints
           SET status = ?, version = version + 1, error_json = ?, updated_at = ?
           WHERE checkpoint_id = ? AND status = ? AND version = ? AND record_state = ?`,
          ['interrupted', JSON.stringify(validatedReason), occurredAt, checkpoint.checkpointId, checkpoint.status, checkpoint.version, 'active']
        );
        if (update.changes !== 1) return;
        this.appendEvent('checkpoint', checkpoint.checkpointId, 'delegation.interrupted', { error: validatedReason }, occurredAt, 'system');
        interruptedCount += 1;
      });
      return interruptedCount;
    });
  }

  /** @inheritdoc */
  listActive(): AgentDelegationRecoverySnapshot[] {
    const checkpointRows = this.database.select<CheckpointRow>(
      `SELECT * FROM chat_agent_delegation_checkpoints
       WHERE record_state = ?
         AND status NOT IN (?, ?, ?, ?)
       ORDER BY created_at ASC, checkpoint_id ASC`,
      ['active', 'completed', 'failed', 'cancelled', 'interrupted']
    );
    return checkpointRows.map((row): AgentDelegationRecoverySnapshot => {
      const checkpointId = requireString(row.checkpoint_id, 'active checkpoint id');
      const aggregate = this.loadValidatedAggregate(checkpointId);
      if (!aggregate) throw new AgentStoreProtocolError('checkpoint_projection_missing', 'Active Checkpoint is missing');
      const events = this.listEvents('checkpoint', checkpointId);
      return Object.freeze({
        checkpoint: aggregate.checkpoint,
        tasks: aggregate.tasks,
        eventSequence: events.at(-1)?.sequence ?? 0
      });
    });
  }
}

/**
 * 创建委派事实 Store。
 * @param database - 与聊天消息共享事务域的 SQLite 边界
 * @returns 同步委派 Store
 */
export function createAgentDelegationStore(database: AgentStoreDatabase): AgentDelegationStore {
  return new SqliteAgentDelegationStore(database);
}
