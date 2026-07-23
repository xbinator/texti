/**
 * @file store.mts
 * @description 持久化 Child Agent 委派事实的同步 SQLite Store。
 */
import type {
  AgentCheckpointStatus,
  AgentDelegationContinuationSnapshot,
  AgentExecutionPlanSnapshot,
  AgentRecordState,
  AgentTaskPriority,
  AgentTaskQueuePhase,
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
  validateContinuationSnapshot,
  validateExecutionPlanSnapshot,
  validateFoundationContract,
  validateFoundationOutbox
} from './contracts.mjs';
import { canTransitionCheckpoint, canTransitionTask, isCheckpointTerminal, isTaskTerminal } from './state.mjs';
import {
  AgentStoreProtocolError,
  type AgentCheckpointRecord,
  type AgentDelegationStore,
  type AgentDelegationRecoverySnapshot,
  type AgentOutboxRecord,
  type AgentStoreDatabase,
  type AgentTaskRecord,
  type AgentTerminalResultEnvelope,
  type CancelCheckpointInput,
  type ClaimCheckpointInput,
  type DeliverAgentOutboxInput,
  type FinalizeCheckpointInput,
  type InterruptAgentCheckpointInput,
  type PrepareDelegationInput,
  type RecordTaskResultInput,
  type TombstoneAgentTaskInput,
  type TransitionAgentTaskInput
} from './types.mjs';

export type { AgentDelegationStore, AgentStoreDatabase, PrepareDelegationInput } from './types.mjs';

/** Attempt 状态为 Task 状态加恢复专用 interrupted。 */
type AgentAttemptStatus = AgentTaskStatus | 'interrupted';

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

/** Store 内部使用的可信 Attempt 投影。 */
interface AgentAttemptRecord {
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
  error?: NonNullable<ReturnType<typeof validateAgentTaskError>>;
  /** 不可变创建时间。 */
  createdAt: string;
}

/** 经 Checkpoint、Task 和终态结果交叉校验的委派聚合。 */
interface ValidatedAgentAggregate {
  /** 聚合根 Checkpoint。 */
  checkpoint: AgentCheckpointRecord;
  /** 与冻结 tool-call 一一对应的 Tasks。 */
  tasks: AgentTaskRecord[];
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
const ATTEMPT_STATUSES = new Set<AgentAttemptStatus>([...TASK_STATUSES, 'interrupted']);

/** Attempt 终态 allowlist。 */
const ATTEMPT_TERMINAL_STATUSES = new Set<AgentAttemptStatus>(['completed', 'failed', 'cancelled', 'deadline_exceeded', 'commit_failed', 'interrupted']);

/** 必须绑定当前 Attempt 身份的 Task 执行态。 */
const TASK_ATTEMPT_REQUIRED_STATUSES = new Set<AgentTaskStatus>(['starting', 'running', 'waiting_confirmation', 'committing']);

/** 必须持有结构化错误的 Attempt 失败终态。 */
const ATTEMPT_ERROR_REQUIRED_STATUSES = new Set<AgentAttemptStatus>(['failed', 'deadline_exceeded', 'commit_failed', 'interrupted']);

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
function hasExactCriteria(result: ChatAgentResult, acceptanceCriteria: readonly string[]): boolean {
  return (
    result.completion.criteria.length === acceptanceCriteria.length &&
    result.completion.criteria.every((criterion, index): boolean => criterion.criterionIndex === index)
  );
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
  let result: ChatAgentResult | undefined;
  if (row.result_json !== null || resultHash !== undefined) {
    if (row.result_json === null || !resultHash) {
      throw new AgentStoreProtocolError('task_result_pair_invalid', 'Task result and hash must coexist');
    }
    const resultValidation = validateChatAgentResult(parseJson(row.result_json, 'task result'));
    if (!resultValidation.ok || hashAgentPayload(resultValidation.result) !== resultHash) {
      throw new AgentStoreProtocolError('task_result_invalid', 'Persisted Task result failed validation');
    }
    if (
      resultValidation.result.taskId !== taskId ||
      resultValidation.result.agentId !== agentId ||
      currentAttemptId === undefined ||
      resultValidation.result.attemptId !== currentAttemptId ||
      !hasExactCriteria(resultValidation.result, validation.contractSnapshot.acceptanceCriteria)
    ) {
      throw new AgentStoreProtocolError('task_result_identity_invalid', 'Persisted Task result identity or criteria do not match its Task row');
    }
    result = resultValidation.result;
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
    const resultValidation = validateChatAgentResult(envelope.result);
    if (!resultValidation.ok || hashAgentPayload(resultValidation.result) !== resultHash) {
      throw new AgentStoreProtocolError('terminal_result_invalid', 'Terminal result failed validation');
    }
    return [requireString(toolCallId, 'terminal result tool call id'), { result: resultValidation.result, resultHash }];
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
   */
  private appendEvent<TType extends ChatAgentEventType>(
    aggregateKind: 'task' | 'checkpoint',
    aggregateId: string,
    type: TType,
    payload: ChatAgentEventPayloadMap[TType],
    occurredAt: string,
    source: ChatAgentEventSource
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

    // 每个持久化终态结果必须与唯一同 tool-call、同 hash 的 Child 审计 Event 构成双射。
    const resultEntries = Object.entries(checkpoint.terminalResults);
    const resultEvents = checkpointEvents.filter((event): boolean => event.type === 'child.result_recorded');
    if (resultEvents.length !== resultEntries.length) {
      throw new AgentStoreProtocolError('delegation_result_events_invalid', 'Terminal results and Child result Events are not an exact set');
    }
    const recordedToolCalls = new Set<string>();
    resultEvents.forEach((event): void => {
      const payload = event.payload as ChatAgentEventPayloadMap['child.result_recorded'];
      const envelope = checkpoint.terminalResults[payload.toolCallId];
      if (recordedToolCalls.has(payload.toolCallId) || !envelope || envelope.resultHash !== payload.resultHash) {
        throw new AgentStoreProtocolError('delegation_result_events_invalid', 'Terminal results and Child result Events are not an exact set');
      }
      recordedToolCalls.add(payload.toolCallId);
    });
    if (resultEntries.some(([toolCallId]): boolean => !recordedToolCalls.has(toolCallId))) {
      throw new AgentStoreProtocolError('delegation_result_events_invalid', 'Terminal results and Child result Events are not an exact set');
    }

    // currentAttemptId 必须解引用为与 Task 和冻结计划严格一致的真实 Attempt。
    tasks.forEach((task): void => {
      if (!task.currentAttemptId) return;
      const attemptRow = this.database.select<AttemptRow>('SELECT * FROM chat_agent_attempts WHERE attempt_id = ?', [task.currentAttemptId])[0];
      if (!attemptRow) {
        throw new AgentStoreProtocolError('delegation_attempt_missing', 'Task current Attempt does not exist');
      }
      const attempt = parseAttempt(attemptRow);
      if (
        attempt.attemptId !== task.currentAttemptId ||
        attempt.taskId !== task.taskId ||
        task.executionPlanSnapshotHash === undefined ||
        attempt.planHash !== task.executionPlanSnapshotHash ||
        (task.result !== undefined && attempt.status !== task.result.executionStatus)
      ) {
        throw new AgentStoreProtocolError('delegation_attempt_invalid', 'Task current Attempt does not match its identity, plan, or result');
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
            envelope.result.attemptId !== task.currentAttemptId
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
          hashAgentPayload(task.result) !== task.resultHash ||
          !envelope ||
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
      if (checkpoint.status !== 'waiting_children') {
        throw new AgentStoreProtocolError('checkpoint_not_waiting', 'Checkpoint is not accepting Child results');
      }

      const targetStatus: AgentTaskStatus = result.executionStatus;
      if (
        !['running', 'cancelling', 'committing'].includes(task.status) ||
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

      const terminalResults = {
        ...checkpoint.terminalResults,
        [task.toolCallId]: { result, resultHash: computedHash }
      };
      const allTerminal = checkpoint.continuationSnapshot.orderedToolCalls.every((toolCall): boolean => terminalResults[toolCall.toolCallId] !== undefined);
      const nextStatus: AgentCheckpointStatus = allTerminal ? 'ready_to_resume' : 'waiting_children';
      const checkpointUpdate = this.database.execute(
        `UPDATE chat_agent_delegation_checkpoints
         SET terminal_results_json = ?, status = ?, version = version + 1, updated_at = ?
         WHERE checkpoint_id = ? AND status = ? AND version = ? AND record_state = ?`,
        [JSON.stringify(terminalResults), nextStatus, input.occurredAt, checkpoint.checkpointId, 'waiting_children', checkpoint.version, 'active']
      );
      if (checkpointUpdate.changes !== 1) {
        throw new AgentStoreProtocolError('checkpoint_result_conflict', 'Checkpoint result projection changed concurrently');
      }
      this.appendEvent(
        'checkpoint',
        checkpoint.checkpointId,
        'child.result_recorded',
        { toolCallId: task.toolCallId, resultHash: computedHash },
        input.occurredAt,
        'child'
      );
      if (allTerminal) {
        this.appendEvent(
          'checkpoint',
          checkpoint.checkpointId,
          'delegation.ready',
          { resultCount: Object.keys(terminalResults).length },
          input.occurredAt,
          'coordinator'
        );
        const readyPayload = {
          checkpointId: checkpoint.checkpointId,
          sessionId: checkpoint.sessionId,
          turnId: checkpoint.turnId,
          resultCount: Object.keys(terminalResults).length
        };
        this.database.execute(
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
            input.occurredAt,
            input.occurredAt
          ]
        );
      }
      const updated = this.getCheckpoint(checkpoint.checkpointId);
      if (!updated) throw new AgentStoreProtocolError('checkpoint_projection_missing', 'Updated Checkpoint is missing');
      return updated;
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
      const task = this.getTask(input.taskId);
      if (!task) throw new AgentStoreProtocolError('task_not_found', 'Task does not exist');
      if (task.recordState !== 'active') throw new AgentStoreProtocolError('task_already_tombstoned', 'Task is already tombstoned');
      if (!isTaskTerminal(task.status)) {
        throw new AgentStoreProtocolError('task_not_terminal', 'Only terminal Tasks can be tombstoned');
      }
      if (task.unfinishedJournalCount !== 0) {
        throw new AgentStoreProtocolError('task_journal_active', 'Task owns an unfinished commit journal');
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
      this.appendEvent('task', task.taskId, 'task.tombstoned', { reason: input.reason }, input.occurredAt, input.source);
      const updated = this.getTask(task.taskId);
      if (!updated) throw new AgentStoreProtocolError('task_projection_missing', 'Tombstoned Task is missing');
      return updated;
    });
  }

  /** @inheritdoc */
  getTask(taskId: string): AgentTaskRecord | null {
    const row = this.database.select<TaskRow>('SELECT * FROM chat_agent_tasks WHERE task_id = ?', [taskId])[0];
    return row ? parseTask(row) : null;
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
        task.result?.attemptId !== envelope.result.attemptId ||
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
