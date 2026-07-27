/**
 * @file contracts.mts
 * @description 校验、规范化并哈希基础阶段的不可变 Agent 委派契约。
 */
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import type {
  AgentArtifactReference,
  AgentBudgetSnapshot,
  AgentChangesetSnapshot,
  AgentCommitPolicy,
  AgentCommitIntentSnapshot,
  AgentConfirmationRequestSnapshot,
  AgentCriteriaResult,
  AgentDelegationContinuationSnapshot,
  AgentDelegationCreatedPayload,
  AgentDelegationReadyPayload,
  AgentEvidenceReference,
  AgentExecutionPlanSnapshot,
  AgentFileOperationSnapshot,
  AgentModelSnapshot,
  AgentOrderedToolCallSnapshot,
  AgentPlanToolEffect,
  AgentPreAttemptFailureResult,
  AgentResourceReference,
  AgentTaskContractSnapshot,
  AgentTaskError,
  AgentTaskErrorCode,
  AgentTaskErrorDetailKey,
  AgentTaskPriority,
  AgentTaskWarning,
  AgentUsageAccounting,
  AgentWriteResultDraft,
  ChatAgentCheckpointEventType,
  ChatAgentEvent,
  ChatAgentEventPayloadMap,
  ChatAgentEventSource,
  ChatAgentEventType,
  ChatAgentResult,
  DelegateTaskInput
} from 'types/chat-agent';
import { AGENT_FILE_COMMIT_ADAPTER } from '../../../../../shared/ai/tools/AgentStagedFileTool/index.js';

export { AGENT_FILE_COMMIT_ADAPTER };

/** 当前 Task Contract Snapshot Schema 版本。 */
export const AGENT_CONTRACT_SCHEMA_VERSION = 1;

/** 当前支持的 Execution Plan Schema 版本。 */
export const AGENT_PLAN_SCHEMA_VERSION = 1;

/** 当前支持的 Delegation Checkpoint Schema 版本。 */
export const AGENT_CHECKPOINT_SCHEMA_VERSION = 1;

/** 当前支持的 Event Schema 版本。 */
export const AGENT_EVENT_SCHEMA_VERSION = 1;

/** 当前基础阶段的安全策略版本。 */
export const AGENT_FOUNDATION_POLICY_VERSION = 'foundation-v1';

/** 当前只读 Child Execution Plan 的安全策略版本。 */
export const AGENT_READ_PLAN_POLICY_VERSION = 'read-runtime-v1';

/** 当前受控写入 Child Execution Plan 的安全策略版本。 */
export const AGENT_WRITE_PLAN_POLICY_VERSION = 'controlled-write-v1';

/** 当前 changeset snapshot Schema 版本。 */
export const AGENT_CHANGESET_SCHEMA_VERSION = 1;

/** 当前 confirmation request Schema 版本。 */
export const AGENT_CONFIRMATION_SCHEMA_VERSION = 1;

/** 当前 commit intent Schema 版本。 */
export const AGENT_COMMIT_JOURNAL_SCHEMA_VERSION = 1;

/** 单个契约允许的最大验收标准数量。 */
export const AGENT_MAX_ACCEPTANCE_CRITERIA = 16;

/** 单个契约允许的最大资源引用数量。 */
export const AGENT_MAX_RESOURCES = 32;

/** 单个契约允许的最大请求工具数量。 */
export const AGENT_MAX_REQUESTED_TOOLS = 16;

/** 单个规范化 Agent payload 的最大 UTF-8 字节数。 */
export const AGENT_CANONICAL_PAYLOAD_MAX_BYTES = 256 * 1024;

/** 基础契约成功校验结果。 */
export interface FoundationContractSuccess {
  /** 校验是否成功。 */
  ok: true;
  /** 完整规范化调用输入。 */
  contract: Readonly<DelegateTaskInput>;
  /** 不含可变调度字段的不可变契约快照。 */
  contractSnapshot: Readonly<AgentTaskContractSnapshot>;
  /** 版本化契约快照 SHA-256。 */
  contractSnapshotHash: string;
}

/** 基础契约失败校验结果。 */
export interface FoundationContractFailure {
  /** 校验是否成功。 */
  ok: false;
  /** 稳定、可机器判断的校验错误。 */
  error: AgentTaskError;
}

/** 基础契约校验结果。 */
export type FoundationContractValidation = FoundationContractSuccess | FoundationContractFailure;

/** Agent 结果成功校验结果。 */
export interface ChatAgentResultSuccess {
  /** 校验是否成功。 */
  ok: true;
  /** 深冻结且只含 allowlist 字段的结果。 */
  result: Readonly<ChatAgentResult>;
}

/** Agent 结果失败校验结果。 */
export interface ChatAgentResultFailure {
  /** 校验是否成功。 */
  ok: false;
  /** 稳定结果协议错误。 */
  error: AgentTaskError;
}

/** Agent 结果 allowlist 校验结果。 */
export type ChatAgentResultValidation = ChatAgentResultSuccess | ChatAgentResultFailure;

/** 授权前失败结果成功校验。 */
export interface PreAttemptFailureSuccess {
  /** 校验是否成功。 */
  ok: true;
  /** 深冻结且不含 Attempt 身份的失败结果。 */
  result: Readonly<AgentPreAttemptFailureResult>;
}

/** 授权前失败结果校验返回值。 */
export type PreAttemptFailureValidation = PreAttemptFailureSuccess | ChatAgentResultFailure;

/** Execution Plan 成功校验结果。 */
export interface ExecutionPlanValidationSuccess {
  /** 校验是否成功。 */
  ok: true;
  /** 深冻结、contract-bound 的执行计划。 */
  plan: Readonly<AgentExecutionPlanSnapshot>;
}

/** Execution Plan 失败校验结果。 */
export interface ExecutionPlanValidationFailure {
  /** 校验是否成功。 */
  ok: false;
  /** 稳定计划校验错误。 */
  error: AgentTaskError;
}

/** Execution Plan runtime 校验结果。 */
export type ExecutionPlanValidation = ExecutionPlanValidationSuccess | ExecutionPlanValidationFailure;

/** write snapshot 成功校验结果。 */
export interface WriteSnapshotValidationSuccess<TSnapshot> {
  /** 校验是否成功。 */
  ok: true;
  /** 深冻结且 hash-bound 的 snapshot。 */
  snapshot: Readonly<TSnapshot>;
}

/** write snapshot 失败校验结果。 */
export interface WriteSnapshotValidationFailure {
  /** 校验是否成功。 */
  ok: false;
  /** 稳定 snapshot 校验错误。 */
  error: AgentTaskError;
}

/** write snapshot runtime 校验结果。 */
export type WriteSnapshotValidation<TSnapshot> = WriteSnapshotValidationSuccess<TSnapshot> | WriteSnapshotValidationFailure;

/** Continuation Snapshot 成功校验结果。 */
export interface ContinuationValidationSuccess {
  /** 校验是否成功。 */
  ok: true;
  /** 深冻结、版本化的续接快照。 */
  continuation: Readonly<AgentDelegationContinuationSnapshot>;
}

/** Continuation Snapshot 失败校验结果。 */
export interface ContinuationValidationFailure {
  /** 校验是否成功。 */
  ok: false;
  /** 稳定恢复校验错误。 */
  error: AgentTaskError;
}

/** Continuation Snapshot runtime 校验结果。 */
export type ContinuationValidation = ContinuationValidationSuccess | ContinuationValidationFailure;

/** Event 成功校验结果。 */
export interface ChatAgentEventValidationSuccess {
  /** 校验是否成功。 */
  ok: true;
  /** 深冻结且聚合身份一致的 Event。 */
  event: Readonly<ChatAgentEvent>;
}

/** Event 失败校验结果。 */
export interface ChatAgentEventValidationFailure {
  /** 校验是否成功。 */
  ok: false;
  /** 稳定 Event 协议错误。 */
  error: AgentTaskError;
}

/** Event runtime 校验结果。 */
export type ChatAgentEventValidation = ChatAgentEventValidationSuccess | ChatAgentEventValidationFailure;

/** 基础 Outbox 信封的共享字段。 */
interface FoundationOutboxEnvelopeBase {
  /** payload 完整性 hash。 */
  payloadHash: string;
  /** Outbox payload Schema 版本。 */
  schemaVersion: number;
}

/** Runtime A 挂起后的 delegation.created Outbox 信封。 */
export interface FoundationCreatedOutboxEnvelope extends FoundationOutboxEnvelopeBase {
  /** 创建事件判别。 */
  eventType: 'delegation.created';
  /** allowlist 创建 payload。 */
  payload: AgentDelegationCreatedPayload;
}

/** Child 结果全部汇合后的 delegation.ready Outbox 信封。 */
export interface FoundationReadyOutboxEnvelope extends FoundationOutboxEnvelopeBase {
  /** 就绪事件判别。 */
  eventType: 'delegation.ready';
  /** allowlist 就绪 payload。 */
  payload: AgentDelegationReadyPayload;
}

/** 由 eventType 判别 payload 的基础 Outbox 信封。 */
export type FoundationOutboxEnvelope = FoundationCreatedOutboxEnvelope | FoundationReadyOutboxEnvelope;

/** Outbox 成功校验结果。 */
export interface FoundationOutboxValidationSuccess {
  /** 校验是否成功。 */
  ok: true;
  /** 深冻结的 Outbox 信封。 */
  outbox: Readonly<FoundationOutboxEnvelope>;
}

/** Outbox 失败校验结果。 */
export interface FoundationOutboxValidationFailure {
  /** 校验是否成功。 */
  ok: false;
  /** 稳定 Outbox 协议错误。 */
  error: AgentTaskError;
}

/** 基础 Outbox runtime 校验结果。 */
export type FoundationOutboxValidation = FoundationOutboxValidationSuccess | FoundationOutboxValidationFailure;

/** 执行计划中除自描述 hash 之外的不可变字段。 */
export type AgentExecutionPlanBody = Omit<AgentExecutionPlanSnapshot, 'planHash'>;

/** 允许的契约优先级。 */
const AGENT_PRIORITIES = new Set<AgentTaskPriority>(['low', 'normal', 'high']);

/** 允许的资源域。 */
const RESOURCE_KINDS = new Set<AgentResourceReference['kind']>(['file', 'directory', 'document', 'webview', 'resource']);

/** error.details 允许持久化的稳定键。 */
const ERROR_DETAIL_KEYS = new Set<AgentTaskErrorDetailKey>([
  'reason',
  'resourceReference',
  'resourceScope',
  'toolName',
  'expectedHash',
  'actualHash',
  'expectedVersion',
  'actualVersion',
  'status',
  'limit',
  'observed',
  'deadlineAt',
  'taskId',
  'checkpointId',
  'attemptId',
  'runtimeId',
  'operationId'
]);

/**
 * AgentTaskError code 允许的协议阶段与分类。
 */
interface AgentErrorRule {
  /** 该 code 可出现的阶段。 */
  readonly phases: readonly AgentTaskError['phase'][];
  /** 该 code 可使用的分类。 */
  readonly categories: readonly AgentTaskError['category'][];
}

/** 全部已声明错误阶段，仅 protocol_error 可跨任意阶段。 */
const ALL_ERROR_PHASES: readonly AgentTaskError['phase'][] = [
  'contract_validation',
  'plan_validation',
  'resource_validation',
  'queue',
  'starting',
  'runtime',
  'result_validation',
  'confirmation',
  'commit_validation',
  'commit',
  'recovery'
];

/** 全局 AgentTaskError code→phase/category 收缩矩阵。 */
const AGENT_ERROR_RULES: Readonly<Record<AgentTaskErrorCode, AgentErrorRule>> = {
  invalid_contract: {
    phases: ['contract_validation'],
    categories: ['protocol']
  },
  capability_denied: {
    phases: ['contract_validation', 'plan_validation', 'resource_validation', 'confirmation'],
    categories: ['policy']
  },
  resource_scope_invalid: {
    phases: ['resource_validation', 'commit_validation'],
    categories: ['resource', 'integrity']
  },
  plan_version_unsupported: {
    phases: ['plan_validation', 'recovery'],
    categories: ['protocol', 'policy']
  },
  deadline_exceeded: {
    phases: ['queue', 'starting', 'runtime', 'confirmation', 'commit'],
    categories: ['policy', 'runtime']
  },
  budget_exceeded: {
    phases: ['queue', 'starting', 'runtime', 'commit'],
    categories: ['policy']
  },
  runtime_start_failed: {
    phases: ['starting'],
    categories: ['runtime']
  },
  runtime_failed: {
    phases: ['runtime'],
    categories: ['runtime']
  },
  runtime_interrupted: {
    phases: ['runtime', 'recovery'],
    categories: ['runtime']
  },
  result_evidence_invalid: {
    phases: ['result_validation'],
    categories: ['integrity', 'protocol']
  },
  confirmation_denied: {
    phases: ['confirmation'],
    categories: ['user', 'policy']
  },
  stale_context: {
    phases: ['commit_validation', 'commit', 'recovery'],
    categories: ['integrity', 'resource']
  },
  commit_failed: {
    phases: ['commit_validation', 'commit', 'recovery'],
    categories: ['resource', 'runtime', 'integrity']
  },
  manual_recovery_required: {
    phases: ['commit_validation', 'commit', 'recovery'],
    categories: ['integrity', 'runtime']
  },
  cancelled: {
    phases: ['runtime', 'commit', 'recovery'],
    categories: ['user', 'runtime']
  },
  protocol_error: {
    phases: ALL_ERROR_PHASES,
    categories: ['protocol']
  }
};

/**
 * 判断未知值是否为普通记录。
 * @param value - 待判断值
 * @returns 是否为无数组语义的普通对象
 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * 创建基础契约校验错误。
 * @param reason - 机器可聚合的非法字段原因
 * @param message - 展示说明
 * @param code - 稳定错误码
 * @returns 失败校验结果
 */
function contractFailure(reason: string, message: string, code: AgentTaskErrorCode = 'invalid_contract'): FoundationContractFailure {
  return {
    ok: false,
    error: {
      code,
      phase: 'contract_validation',
      category: code === 'capability_denied' ? 'policy' : 'protocol',
      retryable: false,
      message,
      details: { reason }
    }
  };
}

/**
 * 创建结果信封校验错误。
 * @param reason - 机器可聚合的非法字段原因
 * @param message - 展示说明
 * @returns 失败校验结果
 */
function resultFailure(reason: string, message: string): ChatAgentResultFailure {
  return {
    ok: false,
    error: {
      code: 'protocol_error',
      phase: 'result_validation',
      category: 'protocol',
      retryable: false,
      message,
      details: { reason }
    }
  };
}

/**
 * 创建共享快照或历史信封校验错误。
 * @param phase - 失败协议阶段
 * @param reason - 稳定机器原因
 * @param message - 展示说明
 * @returns 结构化 Agent 错误
 */
function validationError(phase: AgentTaskError['phase'], reason: string, message: string): AgentTaskError {
  return {
    code: phase === 'plan_validation' ? 'plan_version_unsupported' : 'protocol_error',
    phase,
    category: phase === 'plan_validation' ? 'policy' : 'protocol',
    retryable: false,
    message,
    details: { reason }
  };
}

/**
 * 校验记录只包含 allowlist 字段。
 * @param record - 待校验记录
 * @param allowedKeys - 允许字段集合
 * @returns 是否没有未知字段
 */
function hasOnlyKeys(record: Record<string, unknown>, allowedKeys: ReadonlySet<string>): boolean {
  return Object.keys(record).every((key): boolean => allowedKeys.has(key));
}

/**
 * 校验记录完整且仅包含指定字段。
 * @param record - 待校验记录
 * @param keys - 完整字段集合
 * @returns 是否与字段集合精确一致
 */
function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(record).length === keys.length && hasOnlyKeys(record, new Set(keys));
}

/**
 * 校验并规范化非空短文本。
 * @param value - 未可信输入
 * @returns 规范化字符串，失败时返回 null
 */
function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 4000) return null;
  return normalized;
}

/**
 * 确定性裁剪字符串中形似凭据的值，仅供展示、Event reason 和错误说明层使用。
 * @param value - 已完成基础长度校验的文本
 * @returns 不保留原凭据值的展示文本
 */
function redactSecretValues(value: string): string {
  const redactMatch = (_match: string, prefix: string): string => `${prefix}[REDACTED]`;

  return value
    .replace(/(^|[\s,;?&])(?:[A-Z][A-Z0-9]*_)+(?:KEY|TOKEN|SECRET|PASSWORD)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s,;&]+)/g, redactMatch)
    .replace(/(^|[\s,;])(?:Set-Cookie|Cookie)\s*:\s*[^\r\n]+/gi, redactMatch)
    .replace(/(^|[\s,;])(?:Proxy-)?Authorization\s*:\s*(?:Bearer|Basic)\s+(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, redactMatch)
    .replace(/(^|[\s,;?&{[(:_-])(?:"|')?(?:api[_-]?key|access[_-]?token|refresh[_-]?token)(?:"|')?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;&}\]]+)/gi, redactMatch)
    .replace(/(^|[\s,;?&{[(:_-])(?:"|')?(?:client[_-]?secret|password|cookie)(?:"|')?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;&}\]]+)/gi, redactMatch)
    .replace(/\b(?:sk|rk)-[A-Za-z0-9_-]{16,}\b/g, '[REDACTED]');
}

/**
 * Identity/reference/contract 层策略：发现 secret-shaped value 直接拒绝，绝不静默改变授权任务或稳定身份。
 * @param value - 未可信身份、引用、契约或机器字段
 * @returns 无凭据形态的规范化字符串，失败时返回 null
 */
export function normalizeAgentIdentity(value: unknown): string | null {
  const normalized = normalizeText(value);
  if (!normalized || redactSecretValues(normalized) !== normalized) return null;
  return normalized;
}

/**
 * Display/event-error 层策略：在 hash 或持久化前确定性替换 secret-shaped value。
 * @param value - 未可信展示、Event reason 或错误说明
 * @returns 已裁剪的规范化字符串，失败时返回 null
 */
function normalizeDisplayText(value: unknown): string | null {
  const normalized = normalizeText(value);
  return normalized ? redactSecretValues(normalized) : null;
}

/**
 * 校验 ISO-8601 绝对时间。
 * @param value - 未可信截止时间
 * @returns 规范化 ISO 字符串，缺省时返回 undefined，非法时返回 null
 */
function normalizeDeadline(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const absolutePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
  if (!absolutePattern.test(trimmed) || Number.isNaN(Date.parse(trimmed))) return null;
  return new Date(trimmed).toISOString();
}

/**
 * 校验普通 ISO-8601 时间。
 * @param value - 未可信时间值
 * @returns 规范化 ISO 时间，非法时返回 null
 */
function normalizeTimestamp(value: unknown): string | null {
  const normalized = normalizeDeadline(value);
  return normalized ?? null;
}

/**
 * 校验并规范化资源引用。
 * @param value - 未可信资源记录
 * @returns 规范化资源，失败时返回 null
 */
function normalizeResource(value: unknown): AgentResourceReference | null {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, new Set(['kind', 'reference', 'revision']))) return null;
  if (typeof value.kind !== 'string' || !RESOURCE_KINDS.has(value.kind as AgentResourceReference['kind'])) return null;
  const reference = normalizeAgentIdentity(value.reference);
  if (!reference) return null;
  const revision = value.revision === undefined ? undefined : normalizeAgentIdentity(value.revision);
  if (value.revision !== undefined && !revision) return null;

  return {
    kind: value.kind as AgentResourceReference['kind'],
    reference,
    ...(revision ? { revision } : {})
  };
}

/**
 * 递归冻结已规范化对象，避免调用方修改持久化前快照。
 * @param value - 需要冻结的值
 * @returns 同一不可变值
 */
function deepFreeze<T>(value: T): Readonly<T> {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  Object.values(value as Record<string, unknown>).forEach((nested): void => {
    deepFreeze(nested);
  });
  return Object.freeze(value);
}

/**
 * 把结构化克隆安全值规范化为稳定 JSON 值。
 * @param value - 未可信 payload
 * @param ancestors - 当前递归祖先，用于拒绝循环引用
 * @returns 键排序后的 JSON 安全值
 */
function canonicalize(value: unknown, ancestors: ReadonlySet<object> = new Set()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    throw new Error('Agent payload must be structured-clone-safe JSON');
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new Error('Agent payload must be structured-clone-safe JSON without cycles');
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(value);
    return value.map((entry): unknown => canonicalize(entry, nextAncestors));
  }
  if (!isPlainRecord(value)) throw new Error('Agent payload must be structured-clone-safe JSON records');
  if (ancestors.has(value)) throw new Error('Agent payload must be structured-clone-safe JSON without cycles');

  const nextAncestors = new Set(ancestors);
  nextAncestors.add(value);
  return Object.keys(value)
    .sort()
    .reduce<Record<string, unknown>>((result, key): Record<string, unknown> => {
      result[key] = canonicalize(value[key], nextAncestors);
      return result;
    }, {});
}

/**
 * 检测结构化输出中不得跨边界持久化的敏感键和值。
 * @param value - 已要求 JSON-safe 的结构化值
 * @returns 是否包含凭据形态
 */
function hasSensitiveOutput(value: unknown): boolean {
  if (typeof value === 'string') return redactSecretValues(value) !== value;
  if (Array.isArray(value)) return value.some(hasSensitiveOutput);
  if (!isPlainRecord(value)) return false;
  const sensitiveKey = /^(?:authorization|proxyAuthorization|apiKey|accessToken|refreshToken|clientSecret|password|cookie|environment)$/i;
  return Object.entries(value).some(([key, nested]): boolean => sensitiveKey.test(key) || hasSensitiveOutput(nested));
}

/**
 * 校验证据引用 allowlist。
 * @param value - 未可信证据
 * @returns 规范化证据，非法时返回 null
 */
function normalizeEvidence(value: unknown): AgentEvidenceReference | null {
  const kinds = new Set<AgentEvidenceReference['kind']>(['tool_event', 'artifact', 'resource_snapshot', 'commit_journal', 'task_result']);
  if (!isPlainRecord(value) || !hasOnlyKeys(value, new Set(['kind', 'referenceId', 'contentHash']))) return null;
  if (typeof value.kind !== 'string' || !kinds.has(value.kind as AgentEvidenceReference['kind'])) return null;
  const referenceId = normalizeAgentIdentity(value.referenceId);
  const contentHash = value.contentHash === undefined ? undefined : normalizeAgentIdentity(value.contentHash);
  if (!referenceId || (value.contentHash !== undefined && !contentHash)) return null;
  return {
    kind: value.kind as AgentEvidenceReference['kind'],
    referenceId,
    ...(contentHash ? { contentHash } : {})
  };
}

/**
 * 校验一条验收结论的 claim 与 verification 双层结构。
 * @param value - 未可信验收结论
 * @returns 规范化结论，非法时返回 null
 */
function normalizeCriteria(value: unknown): AgentCriteriaResult | null {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, new Set(['criterionIndex', 'claim', 'verification']))) return null;
  if (!Number.isInteger(value.criterionIndex) || (value.criterionIndex as number) < 0) return null;
  if (!isPlainRecord(value.claim) || !hasOnlyKeys(value.claim, new Set(['status', 'summary', 'evidence']))) return null;
  if (!isPlainRecord(value.verification) || !hasOnlyKeys(value.verification, new Set(['status', 'verifier', 'evidence']))) {
    return null;
  }
  const claimStatuses = new Set(['satisfied', 'unsatisfied', 'unknown']);
  const verificationStatuses = new Set(['verified', 'unverified', 'contradicted']);
  const verifiers = new Set(['tool', 'coordinator', 'primary', 'policy']);
  if (typeof value.claim.status !== 'string' || !claimStatuses.has(value.claim.status)) return null;
  if (typeof value.verification.status !== 'string' || !verificationStatuses.has(value.verification.status)) return null;
  if (typeof value.verification.verifier !== 'string' || !verifiers.has(value.verification.verifier)) return null;
  const summary = normalizeDisplayText(value.claim.summary);
  if (!summary || !Array.isArray(value.claim.evidence) || !Array.isArray(value.verification.evidence)) return null;
  const claimEvidence = value.claim.evidence.map(normalizeEvidence);
  const verificationEvidence = value.verification.evidence.map(normalizeEvidence);
  if (claimEvidence.some((evidence): boolean => evidence === null) || verificationEvidence.some((evidence): boolean => evidence === null)) {
    return null;
  }

  return {
    criterionIndex: value.criterionIndex as number,
    claim: {
      status: value.claim.status as AgentCriteriaResult['claim']['status'],
      summary,
      evidence: claimEvidence as AgentEvidenceReference[]
    },
    verification: {
      status: value.verification.status as AgentCriteriaResult['verification']['status'],
      verifier: value.verification.verifier as AgentCriteriaResult['verification']['verifier'],
      evidence: verificationEvidence as AgentEvidenceReference[]
    }
  };
}

/**
 * 校验结构化错误，不允许嵌套 details 或未知机器字段。
 * @param value - 未可信错误
 * @returns 规范化错误，非法时返回 null
 */
function normalizeTaskError(value: unknown): AgentTaskError | null {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, new Set(['code', 'phase', 'category', 'retryable', 'details', 'message']))) {
    return null;
  }
  if (typeof value.code !== 'string' || !Object.prototype.hasOwnProperty.call(AGENT_ERROR_RULES, value.code)) return null;
  if (typeof value.phase !== 'string' || typeof value.category !== 'string') return null;
  const code = value.code as AgentTaskErrorCode;
  const phase = value.phase as AgentTaskError['phase'];
  const category = value.category as AgentTaskError['category'];
  const rule = AGENT_ERROR_RULES[code];
  if (!rule.phases.includes(phase) || !rule.categories.includes(category)) return null;
  if (typeof value.retryable !== 'boolean') return null;
  const message = value.message === undefined ? undefined : normalizeDisplayText(value.message);
  if (value.message !== undefined && !message) return null;
  let details: AgentTaskError['details'];
  if (value.details !== undefined) {
    if (!isPlainRecord(value.details)) return null;
    const detailEntries = Object.entries(value.details);
    if (
      detailEntries.some(([key, detail]): boolean => {
        return (
          !ERROR_DETAIL_KEYS.has(key as AgentTaskErrorDetailKey) ||
          (detail !== null && typeof detail !== 'string' && (typeof detail !== 'number' || !Number.isFinite(detail)) && typeof detail !== 'boolean')
        );
      })
    ) {
      return null;
    }
    if (detailEntries.some((entry): boolean => typeof entry[1] === 'string' && normalizeDisplayText(entry[1]) === null)) return null;
    const normalizedEntries = detailEntries.map(([key, detail]): [string, string | number | boolean | null] => {
      if (typeof detail !== 'string') return [key, detail as number | boolean | null];
      return [key, normalizeDisplayText(detail) as string];
    });
    details = Object.fromEntries(normalizedEntries) as NonNullable<AgentTaskError['details']>;
  }

  return {
    code,
    phase,
    category,
    retryable: value.retryable,
    ...(details ? { details } : {}),
    ...(message ? { message } : {})
  };
}

/**
 * 校验持久化或 IPC 边界上的结构化 Agent 错误。
 * @param input - 未可信错误值
 * @returns 仅含批准机器字段的错误，非法时返回 null
 */
export function validateAgentTaskError(input: unknown): AgentTaskError | null {
  return normalizeTaskError(input);
}

/**
 * 校验 Result executionStatus 与结构化错误的专用 code、phase、category 矩阵。
 * @param status - Result 机器终态
 * @param error - 已通过字段 allowlist 的结构化错误
 * @returns 错误是否属于该终态允许的组合
 */
function matchesResultError(status: ChatAgentResult['executionStatus'], error: AgentTaskError): boolean {
  switch (status) {
    case 'completed':
      return false;
    case 'failed':
      return error.code !== 'cancelled' && error.code !== 'deadline_exceeded' && error.code !== 'commit_failed';
    case 'cancelled':
      return (
        error.code === 'cancelled' &&
        (error.phase === 'runtime' || error.phase === 'commit' || error.phase === 'recovery') &&
        (error.category === 'user' || error.category === 'runtime')
      );
    case 'deadline_exceeded':
      return (
        error.code === 'deadline_exceeded' &&
        (error.phase === 'queue' || error.phase === 'starting' || error.phase === 'runtime' || error.phase === 'confirmation' || error.phase === 'commit') &&
        (error.category === 'policy' || error.category === 'runtime')
      );
    case 'commit_failed':
      return (
        (error.code === 'commit_failed' || error.code === 'manual_recovery_required') &&
        (error.phase === 'commit_validation' || error.phase === 'commit' || error.phase === 'recovery') &&
        (error.category === 'resource' || error.category === 'runtime' || error.category === 'integrity')
      );
    default:
      return false;
  }
}

/**
 * 校验非终止性 warning。
 * @param value - 未可信 warning
 * @returns 规范化 warning，非法时返回 null
 */
function normalizeWarning(value: unknown): AgentTaskWarning | null {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, new Set(['code', 'message']))) return null;
  const code = normalizeAgentIdentity(value.code);
  const message = normalizeDisplayText(value.message);
  return code && message ? { code, message } : null;
}

/**
 * 校验 SHA-256 十六进制 hash。
 * @param value - 未可信 hash
 * @returns 是否为规范化 SHA-256
 */
function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

/**
 * 校验结果信封中的 changeset 完整性引用。
 * @param value - 未可信 changeset 结果
 * @returns allowlist 引用或 null
 */
function normalizeChangesetResult(value: unknown): ChatAgentResult['changeset'] | null {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, new Set(['changesetId', 'baseRevision', 'diffHash', 'operationSetHash', 'planHash']))) {
    return null;
  }
  const changesetId = normalizeAgentIdentity(value.changesetId);
  if (!changesetId || !isSha256(value.baseRevision) || !isSha256(value.diffHash) || !isSha256(value.operationSetHash) || !isSha256(value.planHash)) {
    return null;
  }
  return {
    changesetId,
    baseRevision: value.baseRevision,
    diffHash: value.diffHash,
    operationSetHash: value.operationSetHash,
    planHash: value.planHash
  };
}

/**
 * 校验带来源 ownership 的 artifact。
 * @param value - 未可信 artifact
 * @returns 规范化 artifact，非法时返回 null
 */
function normalizeArtifact(value: unknown): AgentArtifactReference | null {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, new Set(['artifactId', 'kind', 'reference', 'contentHash', 'owner', 'visibility', 'createdAt']))) {
    return null;
  }
  if (!isPlainRecord(value.owner) || !hasOnlyKeys(value.owner, new Set(['taskId', 'agentId', 'attemptId']))) return null;
  const artifactId = normalizeAgentIdentity(value.artifactId);
  const kind = normalizeAgentIdentity(value.kind);
  const reference = normalizeAgentIdentity(value.reference);
  const contentHash = value.contentHash === undefined ? undefined : normalizeAgentIdentity(value.contentHash);
  const taskId = normalizeAgentIdentity(value.owner.taskId);
  const agentId = normalizeAgentIdentity(value.owner.agentId);
  const attemptId = normalizeAgentIdentity(value.owner.attemptId);
  const createdAt = normalizeTimestamp(value.createdAt);
  if (!artifactId || !kind || !reference || !taskId || !agentId || !attemptId || !createdAt || (value.contentHash !== undefined && !contentHash)) {
    return null;
  }
  if (value.visibility !== 'internal' && value.visibility !== 'primary' && value.visibility !== 'user') return null;
  return {
    artifactId,
    kind,
    reference,
    ...(contentHash ? { contentHash } : {}),
    owner: { taskId, agentId, attemptId },
    visibility: value.visibility,
    createdAt
  };
}

/**
 * 校验 token、轮次、耗时、外部请求和可未知货币成本。
 * @param value - 未可信 usage
 * @returns 规范化 usage，非法时返回 null
 */
function normalizeUsage(value: unknown): AgentUsageAccounting | null {
  const usageKeys = new Set([
    'inputTokens',
    'outputTokens',
    'totalTokens',
    'modelCalls',
    'toolRounds',
    'queueDurationMs',
    'executionDurationMs',
    'externalRequests',
    'monetaryCost'
  ]);
  if (!isPlainRecord(value) || !hasOnlyKeys(value, usageKeys) || !isPlainRecord(value.monetaryCost)) return null;
  const pricingVersion = normalizeAgentIdentity(value.monetaryCost.pricingVersion);
  if (
    !hasOnlyKeys(value.monetaryCost, new Set(['currency', 'pricingVersion', 'estimated', 'actual'])) ||
    typeof value.monetaryCost.currency !== 'string' ||
    typeof value.monetaryCost.pricingVersion !== 'string' ||
    (value.monetaryCost.currency !== 'unknown' && !/^[A-Z]{3}$/.test(value.monetaryCost.currency)) ||
    !pricingVersion ||
    pricingVersion !== value.monetaryCost.pricingVersion
  ) {
    return null;
  }
  const numericKeys = [
    'inputTokens',
    'outputTokens',
    'totalTokens',
    'modelCalls',
    'toolRounds',
    'queueDurationMs',
    'executionDurationMs',
    'externalRequests'
  ] as const;
  if (
    numericKeys.some((key): boolean => {
      return !Number.isInteger(value[key]) || (value[key] as number) < 0;
    })
  ) {
    return null;
  }
  if ((value.totalTokens as number) !== (value.inputTokens as number) + (value.outputTokens as number)) return null;
  const isCost = (cost: unknown): cost is number | 'unknown' => cost === 'unknown' || (typeof cost === 'number' && Number.isFinite(cost) && cost >= 0);
  if (!isCost(value.monetaryCost.estimated) || !isCost(value.monetaryCost.actual)) return null;
  if (
    (value.monetaryCost.currency === 'unknown' || pricingVersion === 'unknown') &&
    (value.monetaryCost.estimated !== 'unknown' || value.monetaryCost.actual !== 'unknown')
  ) {
    return null;
  }

  return {
    inputTokens: value.inputTokens as number,
    outputTokens: value.outputTokens as number,
    totalTokens: value.totalTokens as number,
    modelCalls: value.modelCalls as number,
    toolRounds: value.toolRounds as number,
    queueDurationMs: value.queueDurationMs as number,
    executionDurationMs: value.executionDurationMs as number,
    externalRequests: value.externalRequests as number,
    monetaryCost: {
      currency: value.monetaryCost.currency,
      pricingVersion,
      estimated: value.monetaryCost.estimated,
      actual: value.monetaryCost.actual
    }
  };
}

/**
 * 对结构化克隆安全 payload 计算稳定 SHA-256。
 * @param payload - 待哈希的 allowlist payload
 * @returns 小写十六进制 SHA-256
 */
export function hashAgentPayload(payload: unknown): string {
  const serialized = JSON.stringify(canonicalize(payload));
  if (Buffer.byteLength(serialized, 'utf8') > AGENT_CANONICAL_PAYLOAD_MAX_BYTES) {
    throw new Error('Agent canonical payload exceeds size limit');
  }
  return createHash('sha256').update(serialized).digest('hex');
}

/**
 * 对不可变 Task Contract Snapshot 计算版本化 hash。
 * @param contractSnapshot - 规范化不可变契约
 * @returns 契约 SHA-256
 */
export function hashContractSnapshot(contractSnapshot: AgentTaskContractSnapshot): string {
  return hashAgentPayload({
    schemaVersion: AGENT_CONTRACT_SCHEMA_VERSION,
    contract: contractSnapshot
  });
}

/**
 * 对契约绑定的 Execution Plan 计算 planHash。
 * @param contractSnapshot - 计划授权使用的不可变契约
 * @param plan - 不含自描述 planHash 的计划字段
 * @returns 执行计划 SHA-256
 */
export function hashExecutionPlanSnapshot(contractSnapshot: AgentTaskContractSnapshot, plan: AgentExecutionPlanBody): string {
  return hashAgentPayload({
    planSchemaVersion: plan.planSchemaVersion,
    policyVersion: plan.policyVersion,
    contractSnapshot,
    capabilitySet: [...plan.capabilitySet].sort(),
    modelSnapshot: plan.modelSnapshot,
    permissionSnapshot: {
      scopeIds: [...plan.permissionSnapshot.scopeIds].sort()
    },
    resourceScopes: [...plan.resourceScopes].sort(),
    toolEffectSet: [...plan.toolEffectSet].sort((left, right): number => left.toolName.localeCompare(right.toolName)),
    commitPolicy: plan.commitPolicy,
    budget: plan.budget
  });
}

/**
 * 校验并规范化字符串集合。
 * @param value - 未可信数组
 * @param maxItems - 最大元素数量
 * @param allowEmpty - 是否允许空集合
 * @returns 排序后的唯一字符串，非法时返回 null
 */
function normalizeStringSet(value: unknown, maxItems: number, allowEmpty: boolean): string[] | null {
  if (!Array.isArray(value) || value.length > maxItems || (!allowEmpty && value.length === 0)) return null;
  const normalized = value.map(normalizeAgentIdentity);
  if (normalized.some((entry): boolean => entry === null)) return null;
  const entries = normalized as string[];
  if (new Set(entries).size !== entries.length) return null;
  return [...entries].sort();
}

/**
 * 校验无敏感配置的模型快照。
 * @param value - 未可信模型记录
 * @returns 规范化模型，非法时返回 null
 */
function normalizeModelSnapshot(value: unknown): AgentModelSnapshot | null {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, new Set(['providerId', 'modelId']))) return null;
  const providerId = normalizeAgentIdentity(value.providerId);
  const modelId = normalizeAgentIdentity(value.modelId);
  return providerId && modelId ? { providerId, modelId } : null;
}

/**
 * 校验任务或续接预算快照。
 * @param value - 未可信预算
 * @returns 规范化预算，非法时返回 null
 */
function normalizeBudgetSnapshot(value: unknown): AgentBudgetSnapshot | null {
  if (
    !isPlainRecord(value) ||
    !hasOnlyKeys(value, new Set(['tokenLimit', 'costLimitUsd', 'pricingVersion'])) ||
    !Number.isInteger(value.tokenLimit) ||
    (value.tokenLimit as number) <= 0 ||
    typeof value.costLimitUsd !== 'number' ||
    !Number.isFinite(value.costLimitUsd) ||
    value.costLimitUsd < 0
  ) {
    return null;
  }
  const pricingVersion = normalizeAgentIdentity(value.pricingVersion);
  if (!pricingVersion) return null;
  return {
    tokenLimit: value.tokenLimit as number,
    costLimitUsd: value.costLimitUsd,
    pricingVersion
  };
}

/**
 * 规范化 changeset 中单个文件操作。
 * @param value - 未可信操作快照
 * @returns allowlist 操作或 null
 */
function normalizeFileOperation(value: unknown): AgentFileOperationSnapshot | null {
  const allowedKeys = new Set([
    'operationId',
    'kind',
    'displayPath',
    'targetPath',
    'resourceScope',
    'baseRevision',
    'baseContentHash',
    'targetContentHash',
    'candidateReference',
    'rollbackReference',
    'byteLength'
  ]);
  if (!isPlainRecord(value) || !hasOnlyKeys(value, allowedKeys) || Object.keys(value).length !== allowedKeys.size) return null;
  const operationId = normalizeAgentIdentity(value.operationId);
  const displayPath = normalizeAgentIdentity(value.displayPath);
  const targetPath = normalizeAgentIdentity(value.targetPath);
  const resourceScope = normalizeAgentIdentity(value.resourceScope);
  const candidateReference = normalizeAgentIdentity(value.candidateReference);
  const rollbackReference = normalizeAgentIdentity(value.rollbackReference);
  if (
    !operationId ||
    (value.kind !== 'create' && value.kind !== 'replace') ||
    !displayPath ||
    !targetPath ||
    !resourceScope ||
    !isSha256(value.baseRevision) ||
    !isSha256(value.baseContentHash) ||
    !isSha256(value.targetContentHash) ||
    !candidateReference ||
    !rollbackReference ||
    !Number.isInteger(value.byteLength) ||
    (value.byteLength as number) < 0
  ) {
    return null;
  }
  return {
    operationId,
    kind: value.kind,
    displayPath,
    targetPath,
    resourceScope,
    baseRevision: value.baseRevision,
    baseContentHash: value.baseContentHash,
    targetContentHash: value.targetContentHash,
    candidateReference,
    rollbackReference,
    byteLength: value.byteLength as number
  };
}

/**
 * 规范化 write result draft。
 * @param value - 未可信结果草稿
 * @returns allowlist 草稿或 null
 */
function normalizeWriteDraft(value: unknown): AgentWriteResultDraft | null {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, new Set(['taskId', 'agentId', 'attemptId', 'summary', 'output', 'criteria', 'warnings', 'usage']))) {
    return null;
  }
  const taskId = normalizeAgentIdentity(value.taskId);
  const agentId = normalizeAgentIdentity(value.agentId);
  const attemptId = normalizeAgentIdentity(value.attemptId);
  const summary = normalizeDisplayText(value.summary);
  if (!taskId || !agentId || !attemptId || !summary || !Array.isArray(value.criteria) || !Array.isArray(value.warnings)) return null;
  const criteria = value.criteria.map(normalizeCriteria);
  const warnings = value.warnings.map(normalizeWarning);
  const usage = normalizeUsage(value.usage);
  if (
    criteria.some((criterion): boolean => criterion === null) ||
    warnings.some((warning): boolean => warning === null) ||
    new Set((criteria as AgentCriteriaResult[]).map((criterion): number => criterion.criterionIndex)).size !== criteria.length ||
    !usage
  ) {
    return null;
  }
  let output: unknown;
  if (value.output !== undefined) {
    try {
      if (hasSensitiveOutput(value.output)) return null;
      hashAgentPayload(value.output);
      output = structuredClone(value.output);
    } catch {
      return null;
    }
  }
  return {
    taskId,
    agentId,
    attemptId,
    summary,
    ...(value.output !== undefined ? { output } : {}),
    criteria: criteria as AgentCriteriaResult[],
    warnings: warnings as AgentTaskWarning[],
    usage
  };
}

/**
 * 对 changeset snapshot 计算版本化 hash。
 * @param changeset - 已规范化 changeset
 * @returns snapshot SHA-256
 */
export function hashChangesetSnapshot(changeset: AgentChangesetSnapshot): string {
  return hashAgentPayload({
    schemaVersion: changeset.changesetSchemaVersion,
    changeset
  });
}

/**
 * 对 confirmation request snapshot 计算版本化 hash。
 * @param request - 已规范化确认请求
 * @returns request SHA-256
 */
export function hashConfirmationRequestSnapshot(request: AgentConfirmationRequestSnapshot): string {
  return hashAgentPayload({
    schemaVersion: request.confirmationSchemaVersion,
    request
  });
}

/**
 * 对 commit intent snapshot 计算版本化 hash。
 * @param intent - 已规范化提交意图
 * @returns intent SHA-256
 */
export function hashCommitIntentSnapshot(intent: AgentCommitIntentSnapshot): string {
  return hashAgentPayload({
    schemaVersion: intent.journalSchemaVersion,
    intent
  });
}

/**
 * 校验、重算并深冻结 changeset snapshot。
 * @param input - 未可信 changeset
 * @param expectedHash - 持久化 snapshot hash
 * @returns hash-bound changeset 或稳定错误
 */
export function validateChangesetSnapshot(input: unknown, expectedHash: string): WriteSnapshotValidation<AgentChangesetSnapshot> {
  const fail = (reason: string, message: string): WriteSnapshotValidationFailure => ({
    ok: false,
    error: validationError('result_validation', reason, message)
  });
  const allowedKeys = new Set([
    'changesetSchemaVersion',
    'changesetId',
    'taskId',
    'attemptId',
    'agentId',
    'runtimeId',
    'planHash',
    'baseRevision',
    'diffReference',
    'diffHash',
    'operationSetHash',
    'resourceScopes',
    'operations',
    'createdAt'
  ]);
  if (
    !isPlainRecord(input) ||
    !hasOnlyKeys(input, allowedKeys) ||
    Object.keys(input).length !== allowedKeys.size ||
    input.changesetSchemaVersion !== AGENT_CHANGESET_SCHEMA_VERSION ||
    !isSha256(expectedHash)
  ) {
    return fail('changeset_schema_invalid', 'Changeset snapshot schema is invalid');
  }
  const changesetId = normalizeAgentIdentity(input.changesetId);
  const taskId = normalizeAgentIdentity(input.taskId);
  const attemptId = normalizeAgentIdentity(input.attemptId);
  const agentId = normalizeAgentIdentity(input.agentId);
  const runtimeId = normalizeAgentIdentity(input.runtimeId);
  const diffReference = normalizeAgentIdentity(input.diffReference);
  const resourceScopes = normalizeStringSet(input.resourceScopes, AGENT_MAX_RESOURCES, false);
  const createdAt = normalizeTimestamp(input.createdAt);
  if (
    !changesetId ||
    !taskId ||
    !attemptId ||
    !agentId ||
    !runtimeId ||
    !isSha256(input.planHash) ||
    !isSha256(input.baseRevision) ||
    !diffReference ||
    !isSha256(input.diffHash) ||
    !isSha256(input.operationSetHash) ||
    !resourceScopes ||
    !createdAt ||
    !Array.isArray(input.operations) ||
    input.operations.length === 0 ||
    input.operations.length > AGENT_MAX_RESOURCES
  ) {
    return fail('changeset_field_invalid', 'Changeset snapshot fields are invalid');
  }
  const operations = input.operations.map(normalizeFileOperation);
  if (
    operations.some((operation): boolean => operation === null) ||
    new Set(operations.map((operation): string | null => operation?.operationId ?? null)).size !== operations.length ||
    new Set(operations.map((operation): string | null => operation?.targetPath ?? null)).size !== operations.length
  ) {
    return fail('changeset_operation_invalid', 'Changeset operations are invalid or duplicated');
  }
  const changeset: AgentChangesetSnapshot = {
    changesetSchemaVersion: AGENT_CHANGESET_SCHEMA_VERSION,
    changesetId,
    taskId,
    attemptId,
    agentId,
    runtimeId,
    planHash: input.planHash,
    baseRevision: input.baseRevision,
    diffReference,
    diffHash: input.diffHash,
    operationSetHash: input.operationSetHash,
    resourceScopes,
    operations: operations as AgentFileOperationSnapshot[],
    createdAt
  };
  if (hashChangesetSnapshot(changeset) !== expectedHash) {
    return fail('changeset_hash_mismatch', 'Changeset snapshot hash does not match its content');
  }
  return { ok: true, snapshot: deepFreeze(changeset) };
}

/**
 * 校验、重算并深冻结 confirmation request snapshot。
 * @param input - 未可信确认请求
 * @param expectedHash - 持久化 request hash
 * @returns hash-bound request 或稳定错误
 */
export function validateConfirmationRequestSnapshot(input: unknown, expectedHash: string): WriteSnapshotValidation<AgentConfirmationRequestSnapshot> {
  const fail = (reason: string, message: string): WriteSnapshotValidationFailure => ({
    ok: false,
    error: validationError('confirmation', reason, message)
  });
  const allowedKeys = new Set([
    'confirmationSchemaVersion',
    'confirmationId',
    'sessionId',
    'turnId',
    'taskId',
    'attemptId',
    'agentId',
    'runtimeId',
    'toolCallId',
    'changesetId',
    'planHash',
    'baseRevision',
    'diffHash',
    'operationSetHash',
    'resourceScopes',
    'displayPaths',
    'unifiedDiffReference',
    'riskLevel',
    'createdAt'
  ]);
  if (
    !isPlainRecord(input) ||
    !hasOnlyKeys(input, allowedKeys) ||
    Object.keys(input).length !== allowedKeys.size ||
    input.confirmationSchemaVersion !== AGENT_CONFIRMATION_SCHEMA_VERSION ||
    !isSha256(expectedHash)
  ) {
    return fail('confirmation_schema_invalid', 'Confirmation request schema is invalid');
  }
  const identities = [
    input.confirmationId,
    input.sessionId,
    input.turnId,
    input.taskId,
    input.attemptId,
    input.agentId,
    input.runtimeId,
    input.toolCallId,
    input.changesetId
  ].map(normalizeAgentIdentity);
  const resourceScopes = normalizeStringSet(input.resourceScopes, AGENT_MAX_RESOURCES, false);
  const displayPaths = normalizeStringSet(input.displayPaths, AGENT_MAX_RESOURCES, false);
  const unifiedDiffReference = normalizeAgentIdentity(input.unifiedDiffReference);
  const createdAt = normalizeTimestamp(input.createdAt);
  if (
    identities.some((identity): boolean => identity === null) ||
    !isSha256(input.planHash) ||
    !isSha256(input.baseRevision) ||
    !isSha256(input.diffHash) ||
    !isSha256(input.operationSetHash) ||
    !resourceScopes ||
    !displayPaths ||
    !unifiedDiffReference ||
    (input.riskLevel !== 'write' && input.riskLevel !== 'dangerous') ||
    !createdAt
  ) {
    return fail('confirmation_field_invalid', 'Confirmation request fields are invalid');
  }
  const [confirmationId, sessionId, turnId, taskId, attemptId, agentId, runtimeId, toolCallId, changesetId] = identities as string[];
  const request: AgentConfirmationRequestSnapshot = {
    confirmationSchemaVersion: AGENT_CONFIRMATION_SCHEMA_VERSION,
    confirmationId,
    sessionId,
    turnId,
    taskId,
    attemptId,
    agentId,
    runtimeId,
    toolCallId,
    changesetId,
    planHash: input.planHash,
    baseRevision: input.baseRevision,
    diffHash: input.diffHash,
    operationSetHash: input.operationSetHash,
    resourceScopes,
    displayPaths,
    unifiedDiffReference,
    riskLevel: input.riskLevel,
    createdAt
  };
  if (hashConfirmationRequestSnapshot(request) !== expectedHash) {
    return fail('confirmation_hash_mismatch', 'Confirmation request hash does not match its content');
  }
  return { ok: true, snapshot: deepFreeze(request) };
}

/**
 * 校验、重算并深冻结 commit intent snapshot。
 * @param input - 未可信提交意图
 * @param expectedHash - 持久化 intent hash
 * @returns hash-bound intent 或稳定错误
 */
export function validateCommitIntentSnapshot(input: unknown, expectedHash: string): WriteSnapshotValidation<AgentCommitIntentSnapshot> {
  const fail = (reason: string, message: string): WriteSnapshotValidationFailure => ({
    ok: false,
    error: validationError('commit_validation', reason, message)
  });
  const allowedKeys = new Set([
    'journalSchemaVersion',
    'changesetSnapshotHash',
    'confirmationId',
    'confirmationVersion',
    'planHash',
    'resultDraft',
    'operations',
    'createdAt'
  ]);
  if (
    !isPlainRecord(input) ||
    !hasOnlyKeys(input, allowedKeys) ||
    Object.keys(input).length !== allowedKeys.size ||
    input.journalSchemaVersion !== AGENT_COMMIT_JOURNAL_SCHEMA_VERSION ||
    !isSha256(expectedHash)
  ) {
    return fail('commit_intent_schema_invalid', 'Commit intent schema is invalid');
  }
  const confirmationId = normalizeAgentIdentity(input.confirmationId);
  const resultDraft = normalizeWriteDraft(input.resultDraft);
  const createdAt = normalizeTimestamp(input.createdAt);
  if (
    !isSha256(input.changesetSnapshotHash) ||
    !confirmationId ||
    !Number.isInteger(input.confirmationVersion) ||
    (input.confirmationVersion as number) <= 0 ||
    !isSha256(input.planHash) ||
    !resultDraft ||
    !Array.isArray(input.operations) ||
    input.operations.length === 0 ||
    input.operations.length > AGENT_MAX_RESOURCES ||
    !createdAt
  ) {
    return fail('commit_intent_field_invalid', 'Commit intent fields are invalid');
  }
  const operations = input.operations.map(normalizeFileOperation);
  if (
    operations.some((operation): boolean => operation === null) ||
    new Set(operations.map((operation): string | null => operation?.operationId ?? null)).size !== operations.length
  ) {
    return fail('commit_intent_operation_invalid', 'Commit intent operations are invalid');
  }
  const intent: AgentCommitIntentSnapshot = {
    journalSchemaVersion: AGENT_COMMIT_JOURNAL_SCHEMA_VERSION,
    changesetSnapshotHash: input.changesetSnapshotHash,
    confirmationId,
    confirmationVersion: input.confirmationVersion as number,
    planHash: input.planHash,
    resultDraft,
    operations: operations as AgentFileOperationSnapshot[],
    createdAt
  };
  if (hashCommitIntentSnapshot(intent) !== expectedHash) {
    return fail('commit_intent_hash_mismatch', 'Commit intent hash does not match its content');
  }
  return { ok: true, snapshot: deepFreeze(intent) };
}

/**
 * 校验、重算并深冻结 contract-bound Execution Plan。
 * @param contractSnapshot - 计划必须绑定的不可变契约
 * @param input - 未可信计划
 * @returns 深冻结计划或稳定 plan_validation 错误
 */
export function validateExecutionPlanSnapshot(contractSnapshot: AgentTaskContractSnapshot, input: unknown): ExecutionPlanValidation {
  const fail = (reason: string, message: string): ExecutionPlanValidationFailure => ({
    ok: false,
    error: validationError('plan_validation', reason, message)
  });
  const allowedKeys = new Set([
    'planHash',
    'planSchemaVersion',
    'policyVersion',
    'capabilitySet',
    'modelSnapshot',
    'permissionSnapshot',
    'resourceScopes',
    'toolEffectSet',
    'commitPolicy',
    'budget'
  ]);
  if (!isPlainRecord(input) || !hasOnlyKeys(input, allowedKeys)) {
    return fail('plan_schema_invalid', 'Execution plan contains unknown or missing structure');
  }
  const expectedPolicyVersion = contractSnapshot.mode === 'write' ? AGENT_WRITE_PLAN_POLICY_VERSION : AGENT_READ_PLAN_POLICY_VERSION;
  if (input.planSchemaVersion !== AGENT_PLAN_SCHEMA_VERSION || input.policyVersion !== expectedPolicyVersion) {
    return fail('plan_version_unsupported', 'Execution plan schema or policy version is unsupported');
  }
  if (!isSha256(input.planHash)) return fail('plan_hash_invalid', 'Execution plan hash is invalid');

  const capabilitySet = normalizeStringSet(input.capabilitySet, AGENT_MAX_REQUESTED_TOOLS, false);
  if (!capabilitySet || capabilitySet.some((capability): boolean => !contractSnapshot.requestedTools.includes(capability))) {
    return fail('plan_capability_expanded', 'Execution plan capabilities must be a subset of the persisted contract');
  }
  const modelSnapshot = normalizeModelSnapshot(input.modelSnapshot);
  if (!modelSnapshot) return fail('plan_model_invalid', 'Execution plan model snapshot is invalid');
  if (!isPlainRecord(input.permissionSnapshot) || !hasOnlyKeys(input.permissionSnapshot, new Set(['scopeIds']))) {
    return fail('plan_permission_invalid', 'Execution plan permission snapshot is invalid');
  }
  const scopeIds = normalizeStringSet(input.permissionSnapshot.scopeIds, AGENT_MAX_RESOURCES, false);
  const resourceScopes = normalizeStringSet(input.resourceScopes, AGENT_MAX_RESOURCES, false);
  if (!scopeIds || !resourceScopes) return fail('plan_scope_invalid', 'Execution plan scopes are invalid');
  if (!Array.isArray(input.toolEffectSet) || input.toolEffectSet.length !== capabilitySet.length) {
    return fail('plan_effect_invalid', 'Execution plan tool effects must match the capability set');
  }
  const allowedEffects = new Set<AgentPlanToolEffect['effect']>(contractSnapshot.mode === 'write' ? ['pure_read', 'staged_file_write'] : ['pure_read']);
  const toolEffectSet = input.toolEffectSet.map((effect): AgentPlanToolEffect | null => {
    if (!isPlainRecord(effect) || !hasOnlyKeys(effect, new Set(['toolName', 'effect']))) return null;
    const toolName = normalizeAgentIdentity(effect.toolName);
    if (
      !toolName ||
      typeof effect.effect !== 'string' ||
      !allowedEffects.has(effect.effect as AgentPlanToolEffect['effect']) ||
      !capabilitySet.includes(toolName)
    ) {
      return null;
    }
    return { toolName, effect: effect.effect as AgentPlanToolEffect['effect'] };
  });
  if (
    toolEffectSet.some((effect): boolean => effect === null) ||
    new Set(toolEffectSet.map((effect): string | null => effect?.toolName ?? null)).size !== toolEffectSet.length
  ) {
    return fail('plan_effect_invalid', 'Execution plan tool effects are invalid');
  }
  const hasStagedEffect = toolEffectSet.some((effect): boolean => effect?.effect === 'staged_file_write');
  if (!isPlainRecord(input.commitPolicy) || !hasOnlyKeys(input.commitPolicy, new Set(['mode', 'adapter']))) {
    return fail('plan_commit_policy_invalid', 'Execution plan commit policy is invalid');
  }
  if (contractSnapshot.mode === 'read' && (input.commitPolicy.mode !== 'none' || input.commitPolicy.adapter !== undefined)) {
    return fail('plan_commit_policy_invalid', 'Read execution plans must use the no-write commit policy');
  }
  if (
    contractSnapshot.mode === 'write' &&
    (!hasStagedEffect || input.commitPolicy.mode !== 'staged' || input.commitPolicy.adapter !== AGENT_FILE_COMMIT_ADAPTER)
  ) {
    return hasStagedEffect
      ? fail('plan_commit_policy_invalid', 'Write execution plans must use the registered staged commit adapter')
      : fail('plan_effect_invalid', 'Write execution plans require at least one staged file capability');
  }
  const budget = normalizeBudgetSnapshot(input.budget);
  if (!budget) return fail('plan_budget_invalid', 'Execution plan budget is invalid');

  const commitPolicy: AgentCommitPolicy = contractSnapshot.mode === 'write' ? { mode: 'staged', adapter: AGENT_FILE_COMMIT_ADAPTER } : { mode: 'none' };
  const body: AgentExecutionPlanBody = {
    planSchemaVersion: AGENT_PLAN_SCHEMA_VERSION,
    policyVersion: expectedPolicyVersion,
    capabilitySet,
    modelSnapshot,
    permissionSnapshot: { scopeIds },
    resourceScopes,
    toolEffectSet: (toolEffectSet as AgentPlanToolEffect[]).sort((left, right): number => left.toolName.localeCompare(right.toolName)),
    commitPolicy,
    budget
  };
  const computedHash = hashExecutionPlanSnapshot(contractSnapshot, body);
  if (computedHash !== input.planHash) return fail('plan_hash_mismatch', 'Execution plan hash does not match its content');

  return {
    ok: true,
    plan: deepFreeze({
      ...body,
      planHash: computedHash
    })
  };
}

/**
 * 对 Continuation Snapshot 计算版本化 hash。
 * @param continuation - 已规范化续接快照
 * @returns 续接快照 SHA-256
 */
export function hashContinuationSnapshot(continuation: AgentDelegationContinuationSnapshot): string {
  return hashAgentPayload({
    schemaVersion: continuation.checkpointSchemaVersion,
    continuation
  });
}

/**
 * 校验、重算并深冻结 Runtime A 续接快照。
 * @param input - 未可信续接快照
 * @param expectedHash - 持久化的续接快照 hash
 * @returns 深冻结快照或稳定 recovery 错误
 */
export function validateContinuationSnapshot(input: unknown, expectedHash: unknown): ContinuationValidation {
  const fail = (reason: string, message: string): ContinuationValidationFailure => ({
    ok: false,
    error: validationError('recovery', reason, message)
  });
  const allowedKeys = new Set([
    'checkpointSchemaVersion',
    'policyVersion',
    'modelSnapshot',
    'continuationContextReference',
    'continuationContextHash',
    'sourceMessageRevision',
    'toolSchemaSnapshotHash',
    'orderedToolCalls',
    'reservedResumeBudget',
    'absoluteTurnDeadline'
  ]);
  if (!isPlainRecord(input) || !hasOnlyKeys(input, allowedKeys) || !isSha256(expectedHash)) {
    return fail('continuation_schema_invalid', 'Continuation snapshot structure or hash is invalid');
  }
  if (input.checkpointSchemaVersion !== AGENT_CHECKPOINT_SCHEMA_VERSION || input.policyVersion !== AGENT_FOUNDATION_POLICY_VERSION) {
    return fail('continuation_version_unsupported', 'Continuation schema or policy version is unsupported');
  }
  const modelSnapshot = normalizeModelSnapshot(input.modelSnapshot);
  const continuationContextReference = normalizeAgentIdentity(input.continuationContextReference);
  const sourceMessageRevision = normalizeAgentIdentity(input.sourceMessageRevision);
  const reservedResumeBudget = normalizeBudgetSnapshot(input.reservedResumeBudget);
  const absoluteTurnDeadline = normalizeDeadline(input.absoluteTurnDeadline);
  if (
    !modelSnapshot ||
    !continuationContextReference ||
    !sourceMessageRevision ||
    !isSha256(input.continuationContextHash) ||
    !isSha256(input.toolSchemaSnapshotHash) ||
    !reservedResumeBudget ||
    !absoluteTurnDeadline ||
    !Array.isArray(input.orderedToolCalls) ||
    input.orderedToolCalls.length === 0 ||
    input.orderedToolCalls.length > AGENT_MAX_REQUESTED_TOOLS
  ) {
    return fail('continuation_field_invalid', 'Continuation snapshot fields are invalid');
  }
  const orderedToolCalls = input.orderedToolCalls.map((entry): AgentOrderedToolCallSnapshot | null => {
    if (!isPlainRecord(entry) || !hasOnlyKeys(entry, new Set(['toolCallId', 'taskId', 'required', 'argumentsHash', 'providerMetadataHash']))) {
      return null;
    }
    const toolCallId = normalizeAgentIdentity(entry.toolCallId);
    const taskId = normalizeAgentIdentity(entry.taskId);
    if (!toolCallId || !taskId || typeof entry.required !== 'boolean' || !isSha256(entry.argumentsHash) || !isSha256(entry.providerMetadataHash)) {
      return null;
    }
    return {
      toolCallId,
      taskId,
      required: entry.required,
      argumentsHash: entry.argumentsHash,
      providerMetadataHash: entry.providerMetadataHash
    };
  });
  if (
    orderedToolCalls.some((entry): boolean => entry === null) ||
    new Set(orderedToolCalls.map((entry): string | null => entry?.toolCallId ?? null)).size !== orderedToolCalls.length ||
    new Set(orderedToolCalls.map((entry): string | null => entry?.taskId ?? null)).size !== orderedToolCalls.length
  ) {
    return fail('continuation_tool_calls_invalid', 'Continuation tool-call identities are invalid');
  }
  const continuation: AgentDelegationContinuationSnapshot = {
    checkpointSchemaVersion: AGENT_CHECKPOINT_SCHEMA_VERSION,
    policyVersion: AGENT_FOUNDATION_POLICY_VERSION,
    modelSnapshot,
    continuationContextReference,
    continuationContextHash: input.continuationContextHash,
    sourceMessageRevision,
    toolSchemaSnapshotHash: input.toolSchemaSnapshotHash,
    orderedToolCalls: orderedToolCalls as AgentOrderedToolCallSnapshot[],
    reservedResumeBudget,
    absoluteTurnDeadline
  };
  if (hashContinuationSnapshot(continuation) !== expectedHash) {
    return fail('continuation_hash_mismatch', 'Continuation snapshot hash does not match its content');
  }
  return { ok: true, continuation: deepFreeze(continuation) };
}

/** 当前共享类型声明的全部 Event 类型。 */
const AGENT_EVENT_TYPES = new Set<ChatAgentEventType>([
  'task.created',
  'task.status_changed',
  'plan.authorized',
  'task.queued',
  'delegation.checkpoint_created',
  'primary.suspended',
  'runtime.starting',
  'runtime.started',
  'runtime.replaced',
  'confirmation.requested',
  'confirmation.resolved',
  'confirmation.invalidated',
  'tool.started',
  'tool.completed',
  'changeset.prepared',
  'commit.journal_created',
  'commit.mutation_applied',
  'commit.finalized',
  'protocol.error',
  'child.result_recorded',
  'delegation.ready',
  'delegation.cancel_requested',
  'delegation.interrupted',
  'primary.resume_started',
  'delegation.completed',
  'task.completed',
  'task.failed',
  'task.cancelled',
  'task.tombstoned'
]);

/** Checkpoint 聚合拥有的 Event 类型。 */
const CHECKPOINT_EVENT_TYPES = new Set<ChatAgentCheckpointEventType>([
  'delegation.checkpoint_created',
  'primary.suspended',
  'child.result_recorded',
  'delegation.ready',
  'delegation.cancel_requested',
  'delegation.interrupted',
  'primary.resume_started',
  'delegation.completed'
]);

/** Event 来源 allowlist。 */
const EVENT_SOURCES = new Set<ChatAgentEventSource>(['primary', 'coordinator', 'child', 'runtime', 'user', 'system']);

/** Task 状态 allowlist，供 Event payload 校验。 */
const TASK_EVENT_STATUSES = new Set([
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

/**
 * 校验 Event payload 中一组必需字符串字段。
 * @param payload - 待校验 payload
 * @param keys - 必需且唯一的字段
 * @returns 是否为精确字符串 payload
 */
function hasEventStrings(payload: Record<string, unknown>, keys: readonly string[]): boolean {
  return hasExactKeys(payload, keys) && keys.every((key): boolean => typeof payload[key] === 'string' && normalizeAgentIdentity(payload[key]) !== null);
}

/**
 * 规范化含 reason 的 Event payload，身份字段拒绝凭据而 reason 仅做展示裁剪。
 * @param payload - 未可信 Event payload
 * @param identityKeys - reason 之外的身份字段
 * @returns 可安全 hash 和持久化的 payload，非法时返回 null
 */
function normalizeEventReason(payload: Record<string, unknown>, identityKeys: readonly string[]): Record<string, unknown> | null {
  if (!hasExactKeys(payload, [...identityKeys, 'reason'])) return null;
  const reason = normalizeDisplayText(payload.reason);
  if (!reason) return null;
  const identityEntries = identityKeys.map((key): [string, string] | null => {
    const value = normalizeAgentIdentity(payload[key]);
    return value ? [key, value] : null;
  });
  if (identityEntries.some((entry): boolean => entry === null)) return null;
  return {
    ...Object.fromEntries(identityEntries as [string, string][]),
    reason
  };
}

/**
 * 校验 Event type 对应的结构化 payload。
 * @param type - Event 类型
 * @param input - 未可信 payload
 * @returns JSON-safe allowlist payload，非法时返回 null
 */
function normalizeEventPayload(type: ChatAgentEventType, input: unknown): ChatAgentEventPayloadMap[ChatAgentEventType] | null {
  if (!isPlainRecord(input)) return null;
  let valid = false;
  let normalizedInput: Record<string, unknown> = input;
  switch (type) {
    case 'task.created':
      valid = hasEventStrings(input, ['checkpointId', 'toolCallId']);
      break;
    case 'task.status_changed':
      valid =
        hasOnlyKeys(input, new Set(['from', 'to', 'queuePhase'])) &&
        typeof input.from === 'string' &&
        TASK_EVENT_STATUSES.has(input.from) &&
        typeof input.to === 'string' &&
        TASK_EVENT_STATUSES.has(input.to) &&
        (input.queuePhase === undefined || input.queuePhase === 'start' || input.queuePhase === 'commit');
      break;
    case 'plan.authorized':
      valid =
        hasExactKeys(input, ['planHash', 'planSchemaVersion', 'policyVersion']) &&
        isSha256(input.planHash) &&
        input.planSchemaVersion === AGENT_PLAN_SCHEMA_VERSION &&
        (input.policyVersion === AGENT_READ_PLAN_POLICY_VERSION || input.policyVersion === AGENT_WRITE_PLAN_POLICY_VERSION);
      break;
    case 'task.queued':
      valid = hasExactKeys(input, ['queuePhase']) && (input.queuePhase === 'start' || input.queuePhase === 'commit');
      break;
    case 'delegation.checkpoint_created': {
      const taskIds = normalizeStringSet(input.taskIds, AGENT_MAX_REQUESTED_TOOLS, false);
      valid =
        hasExactKeys(input, ['taskIds', 'sourceRuntimeId']) &&
        taskIds !== null &&
        typeof input.sourceRuntimeId === 'string' &&
        normalizeAgentIdentity(input.sourceRuntimeId) !== null;
      break;
    }
    case 'primary.suspended':
      valid = hasEventStrings(input, ['sourceRuntimeId']);
      break;
    case 'runtime.starting':
    case 'runtime.started':
    case 'primary.resume_started':
      valid = hasEventStrings(input, ['runtimeId']);
      break;
    case 'runtime.replaced': {
      const normalized = normalizeEventReason(input, ['previousRuntimeId', 'nextRuntimeId']);
      valid = normalized !== null;
      if (normalized) normalizedInput = normalized;
      break;
    }
    case 'confirmation.requested':
      valid =
        hasExactKeys(input, ['requestId', 'requestHash', 'diffHash', 'version']) &&
        typeof input.requestId === 'string' &&
        normalizeAgentIdentity(input.requestId) !== null &&
        isSha256(input.requestHash) &&
        isSha256(input.diffHash) &&
        Number.isInteger(input.version) &&
        (input.version as number) > 0;
      break;
    case 'confirmation.resolved':
      valid =
        hasExactKeys(input, ['requestId', 'decision', 'diffHash', 'version']) &&
        typeof input.requestId === 'string' &&
        normalizeAgentIdentity(input.requestId) !== null &&
        (input.decision === 'approved' || input.decision === 'rejected') &&
        isSha256(input.diffHash) &&
        Number.isInteger(input.version) &&
        (input.version as number) > 0;
      break;
    case 'confirmation.invalidated': {
      const requestId = normalizeAgentIdentity(input.requestId);
      const reason = normalizeDisplayText(input.reason);
      valid =
        hasExactKeys(input, ['requestId', 'reason', 'version']) &&
        requestId !== null &&
        reason !== null &&
        Number.isInteger(input.version) &&
        (input.version as number) > 0;
      if (valid) normalizedInput = { requestId, reason, version: input.version };
      break;
    }
    case 'tool.started':
      valid = hasEventStrings(input, ['toolCallId', 'toolName']);
      break;
    case 'tool.completed':
      valid =
        hasExactKeys(input, ['toolCallId', 'toolName', 'resultHash']) &&
        typeof input.toolCallId === 'string' &&
        normalizeAgentIdentity(input.toolCallId) !== null &&
        typeof input.toolName === 'string' &&
        normalizeAgentIdentity(input.toolName) !== null &&
        isSha256(input.resultHash);
      break;
    case 'changeset.prepared':
      valid =
        hasExactKeys(input, ['changesetId', 'snapshotHash', 'diffHash']) &&
        typeof input.changesetId === 'string' &&
        normalizeAgentIdentity(input.changesetId) !== null &&
        isSha256(input.snapshotHash) &&
        isSha256(input.diffHash);
      break;
    case 'commit.journal_created':
      valid =
        hasExactKeys(input, ['journalId', 'changesetId', 'intentHash', 'confirmationVersion']) &&
        typeof input.journalId === 'string' &&
        normalizeAgentIdentity(input.journalId) !== null &&
        typeof input.changesetId === 'string' &&
        normalizeAgentIdentity(input.changesetId) !== null &&
        isSha256(input.intentHash) &&
        Number.isInteger(input.confirmationVersion) &&
        (input.confirmationVersion as number) > 0;
      break;
    case 'commit.mutation_applied':
      valid =
        hasExactKeys(input, ['journalId', 'operationId', 'targetHash']) &&
        typeof input.journalId === 'string' &&
        normalizeAgentIdentity(input.journalId) !== null &&
        typeof input.operationId === 'string' &&
        normalizeAgentIdentity(input.operationId) !== null &&
        isSha256(input.targetHash);
      break;
    case 'commit.finalized':
      valid =
        hasExactKeys(input, ['journalId', 'finalHash']) &&
        typeof input.journalId === 'string' &&
        normalizeAgentIdentity(input.journalId) !== null &&
        isSha256(input.finalHash);
      break;
    case 'protocol.error':
      valid =
        hasExactKeys(input, ['reason', 'expectedHash', 'actualHash']) &&
        typeof input.reason === 'string' &&
        normalizeAgentIdentity(input.reason) !== null &&
        isSha256(input.expectedHash) &&
        isSha256(input.actualHash);
      break;
    case 'child.result_recorded':
      valid =
        hasExactKeys(input, ['toolCallId', 'resultHash']) &&
        typeof input.toolCallId === 'string' &&
        normalizeAgentIdentity(input.toolCallId) !== null &&
        isSha256(input.resultHash);
      break;
    case 'delegation.ready':
      valid = hasExactKeys(input, ['resultCount']) && Number.isInteger(input.resultCount) && (input.resultCount as number) > 0;
      break;
    case 'delegation.cancel_requested': {
      const normalized = normalizeEventReason(input, []);
      valid = normalized !== null;
      if (normalized) normalizedInput = normalized;
      break;
    }
    case 'delegation.interrupted': {
      const error = normalizeTaskError(input.error);
      valid = hasExactKeys(input, ['error']) && error !== null;
      if (error) normalizedInput = { error };
      break;
    }
    case 'delegation.completed':
      valid = hasExactKeys(input, ['outcome']) && (input.outcome === 'completed' || input.outcome === 'failed' || input.outcome === 'cancelled');
      break;
    case 'task.completed':
      valid = hasExactKeys(input, ['resultHash']) && isSha256(input.resultHash);
      break;
    case 'task.failed': {
      const error = input.error === undefined ? undefined : normalizeTaskError(input.error);
      valid =
        hasOnlyKeys(input, new Set(['error', 'resultHash'])) &&
        (input.error === undefined || error !== null) &&
        (input.resultHash === undefined || isSha256(input.resultHash));
      if (valid) {
        normalizedInput = {
          ...(error ? { error } : {}),
          ...(typeof input.resultHash === 'string' ? { resultHash: input.resultHash } : {})
        };
      }
      break;
    }
    case 'task.cancelled':
      valid = hasOnlyKeys(input, new Set(['resultHash'])) && (input.resultHash === undefined || isSha256(input.resultHash));
      break;
    case 'task.tombstoned': {
      const normalized = normalizeEventReason(input, []);
      valid = normalized !== null;
      if (normalized) normalizedInput = normalized;
      break;
    }
    default:
      valid = false;
      break;
  }
  if (!valid) return null;
  try {
    hashAgentPayload(normalizedInput);
    return canonicalize(normalizedInput) as ChatAgentEventPayloadMap[ChatAgentEventType];
  } catch {
    return null;
  }
}

/**
 * 校验 Event envelope、聚合 identity 和 payload allowlist。
 * @param input - 未可信 Event
 * @returns 深冻结 Event 或稳定 recovery 错误
 */
export function validateChatAgentEvent(input: unknown): ChatAgentEventValidation {
  const fail = (reason: string, message: string): ChatAgentEventValidationFailure => ({
    ok: false,
    error: validationError('recovery', reason, message)
  });
  const envelopeKeys = new Set([
    'eventId',
    'aggregate',
    'taskId',
    'checkpointId',
    'sequence',
    'attemptId',
    'runtimeId',
    'type',
    'occurredAt',
    'source',
    'schemaVersion',
    'payload'
  ]);
  if (!isPlainRecord(input) || !hasOnlyKeys(input, envelopeKeys) || !isPlainRecord(input.aggregate)) {
    return fail('event_schema_invalid', 'Agent Event envelope is invalid');
  }
  if (!hasExactKeys(input.aggregate, ['kind', 'id'])) {
    return fail('event_aggregate_invalid', 'Agent Event aggregate is invalid');
  }
  const eventId = normalizeAgentIdentity(input.eventId);
  const aggregateId = normalizeAgentIdentity(input.aggregate.id);
  const occurredAt = normalizeTimestamp(input.occurredAt);
  if (
    !eventId ||
    !aggregateId ||
    !occurredAt ||
    typeof input.type !== 'string' ||
    !AGENT_EVENT_TYPES.has(input.type as ChatAgentEventType) ||
    typeof input.source !== 'string' ||
    !EVENT_SOURCES.has(input.source as ChatAgentEventSource) ||
    input.schemaVersion !== AGENT_EVENT_SCHEMA_VERSION ||
    !Number.isInteger(input.sequence) ||
    (input.sequence as number) <= 0
  ) {
    return fail('event_field_invalid', 'Agent Event fields are invalid');
  }
  const type = input.type as ChatAgentEventType;
  const checkpointAggregate = CHECKPOINT_EVENT_TYPES.has(type as ChatAgentCheckpointEventType);
  const taskId = input.taskId === undefined ? undefined : normalizeAgentIdentity(input.taskId);
  const checkpointId = input.checkpointId === undefined ? undefined : normalizeAgentIdentity(input.checkpointId);
  if (
    (input.taskId !== undefined && !taskId) ||
    (input.checkpointId !== undefined && !checkpointId) ||
    (checkpointAggregate && (input.aggregate.kind !== 'checkpoint' || checkpointId !== aggregateId)) ||
    (!checkpointAggregate && (input.aggregate.kind !== 'task' || taskId !== aggregateId))
  ) {
    return fail('event_aggregate_mismatch', 'Agent Event aggregate identity does not match its type');
  }
  const attemptId = input.attemptId === undefined ? undefined : normalizeAgentIdentity(input.attemptId);
  const runtimeId = input.runtimeId === undefined ? undefined : normalizeAgentIdentity(input.runtimeId);
  if ((input.attemptId !== undefined && !attemptId) || (input.runtimeId !== undefined && !runtimeId)) {
    return fail('event_link_invalid', 'Agent Event stable links are invalid');
  }
  const payload = normalizeEventPayload(type, input.payload);
  if (!payload) return fail('event_payload_invalid', 'Agent Event payload is invalid');

  const base = {
    eventId,
    aggregate: { kind: input.aggregate.kind, id: aggregateId },
    ...(taskId ? { taskId } : {}),
    ...(checkpointId ? { checkpointId } : {}),
    sequence: input.sequence as number,
    ...(attemptId ? { attemptId } : {}),
    ...(runtimeId ? { runtimeId } : {}),
    type,
    occurredAt,
    source: input.source as ChatAgentEventSource,
    schemaVersion: AGENT_EVENT_SCHEMA_VERSION,
    payload
  };
  return { ok: true, event: deepFreeze(base as ChatAgentEvent) };
}

/**
 * 校验基础 delegation.created Outbox payload 和 hash。
 * @param input - 未可信 Outbox 信封
 * @returns 深冻结 Outbox 或稳定恢复错误
 */
export function validateFoundationOutbox(input: unknown): FoundationOutboxValidation {
  const fail = (reason: string, message: string): FoundationOutboxValidationFailure => ({
    ok: false,
    error: validationError('recovery', reason, message)
  });
  if (
    !isPlainRecord(input) ||
    !hasExactKeys(input, ['eventType', 'payload', 'payloadHash', 'schemaVersion']) ||
    (input.eventType !== 'delegation.created' && input.eventType !== 'delegation.ready') ||
    input.schemaVersion !== 1 ||
    !isSha256(input.payloadHash) ||
    !isPlainRecord(input.payload)
  ) {
    return fail('outbox_schema_invalid', 'Foundation Outbox envelope is invalid');
  }
  const payloadKeys = input.eventType === 'delegation.ready' ? ['checkpointId', 'sessionId', 'turnId', 'resultCount'] : ['checkpointId', 'sessionId', 'turnId'];
  if (!hasExactKeys(input.payload, payloadKeys)) {
    return fail('outbox_schema_invalid', 'Foundation Outbox payload schema is invalid');
  }
  const checkpointId = normalizeAgentIdentity(input.payload.checkpointId);
  const sessionId = normalizeAgentIdentity(input.payload.sessionId);
  const turnId = normalizeAgentIdentity(input.payload.turnId);
  if (!checkpointId || !sessionId || !turnId) {
    return fail('outbox_payload_invalid', 'Foundation Outbox payload fields are invalid');
  }
  if (input.eventType === 'delegation.ready' && (!Number.isInteger(input.payload.resultCount) || (input.payload.resultCount as number) <= 0)) {
    return fail('outbox_payload_invalid', 'Foundation ready Outbox result count is invalid');
  }
  const payload: AgentDelegationCreatedPayload | AgentDelegationReadyPayload =
    input.eventType === 'delegation.ready'
      ? { checkpointId, sessionId, turnId, resultCount: input.payload.resultCount as number }
      : { checkpointId, sessionId, turnId };
  if (hashAgentPayload(payload) !== input.payloadHash) {
    return fail('outbox_hash_mismatch', 'Foundation Outbox hash does not match its payload');
  }
  const outbox: FoundationOutboxEnvelope =
    input.eventType === 'delegation.ready'
      ? {
          eventType: 'delegation.ready',
          payload: payload as AgentDelegationReadyPayload,
          payloadHash: input.payloadHash,
          schemaVersion: 1
        }
      : {
          eventType: 'delegation.created',
          payload: payload as AgentDelegationCreatedPayload,
          payloadHash: input.payloadHash,
          schemaVersion: 1
        };
  return { ok: true, outbox: deepFreeze(outbox) };
}

/**
 * 校验基础阶段可执行的最小任务包。
 * @param input - Provider 工具参数等未可信输入
 * @returns 深冻结规范化契约或稳定校验错误
 */
export function validateFoundationContract(input: unknown): FoundationContractValidation {
  const allowedKeys = new Set(['task', 'acceptanceCriteria', 'mode', 'resources', 'requestedTools', 'required', 'priority', 'deadlineAt']);
  if (!isPlainRecord(input) || !hasOnlyKeys(input, allowedKeys)) {
    return contractFailure('contract_unknown_field', 'Delegation contract contains unknown fields');
  }

  const task = normalizeAgentIdentity(input.task);
  if (!task) return contractFailure('contract_task_invalid', 'Task must be a non-empty string');
  if (input.mode !== 'read' && input.mode !== 'write') {
    return contractFailure('contract_mode_invalid', 'Task mode must be read or write');
  }
  if (!Array.isArray(input.acceptanceCriteria) || input.acceptanceCriteria.length === 0 || input.acceptanceCriteria.length > AGENT_MAX_ACCEPTANCE_CRITERIA) {
    return contractFailure('contract_criteria_invalid', 'At least one acceptance criterion is required');
  }
  const acceptanceCriteria = input.acceptanceCriteria.map(normalizeAgentIdentity);
  if (acceptanceCriteria.some((criterion): boolean => criterion === null)) {
    return contractFailure('contract_criteria_invalid', 'Acceptance criteria must be non-empty strings');
  }
  if (!Array.isArray(input.resources) || input.resources.length === 0 || input.resources.length > AGENT_MAX_RESOURCES) {
    return contractFailure('contract_resources_invalid', 'At least one explicit resource is required');
  }
  const resources = input.resources.map(normalizeResource);
  if (resources.some((resource): boolean => resource === null)) {
    return contractFailure('contract_resources_invalid', 'Resources must use the allowlisted schema');
  }
  if (
    input.mode === 'write' &&
    !(resources as AgentResourceReference[]).some((resource): boolean => resource.kind === 'file' || resource.kind === 'directory')
  ) {
    return contractFailure('write_resource_scope_invalid', 'Write tasks require at least one file or directory resource');
  }
  if (!Array.isArray(input.requestedTools) || input.requestedTools.length === 0 || input.requestedTools.length > AGENT_MAX_REQUESTED_TOOLS) {
    return contractFailure('contract_tools_invalid', 'At least one requested tool is required');
  }
  const requestedTools = input.requestedTools.map(normalizeAgentIdentity);
  if (requestedTools.some((tool): boolean => tool === null)) {
    return contractFailure('contract_tools_invalid', 'Requested tools must be non-empty strings');
  }
  const toolNames = requestedTools as string[];
  if (new Set(toolNames).size !== toolNames.length) {
    return contractFailure('contract_tools_duplicate', 'Requested tools must not contain duplicates');
  }
  if (toolNames.includes('delegate_task')) {
    return contractFailure('delegate_depth_exceeded', 'Child tasks cannot delegate recursively');
  }
  if (typeof input.required !== 'boolean') {
    return contractFailure('contract_required_invalid', 'Required must be a boolean');
  }
  if (typeof input.priority !== 'string' || !AGENT_PRIORITIES.has(input.priority as AgentTaskPriority)) {
    return contractFailure('contract_priority_invalid', 'Priority is invalid');
  }
  const deadlineAt = normalizeDeadline(input.deadlineAt);
  if (deadlineAt === null) return contractFailure('contract_deadline_invalid', 'Deadline must be an absolute ISO-8601 time');

  const normalized: DelegateTaskInput = {
    task,
    acceptanceCriteria: acceptanceCriteria as string[],
    mode: input.mode,
    resources: resources as AgentResourceReference[],
    requestedTools: [...toolNames].sort(),
    required: input.required,
    priority: input.priority as AgentTaskPriority,
    ...(deadlineAt ? { deadlineAt } : {})
  };
  const contractSnapshot: AgentTaskContractSnapshot = {
    contractSchemaVersion: AGENT_CONTRACT_SCHEMA_VERSION,
    task: normalized.task,
    acceptanceCriteria: [...normalized.acceptanceCriteria],
    mode: normalized.mode,
    resources: normalized.resources.map((resource): AgentResourceReference => ({ ...resource })),
    requestedTools: [...normalized.requestedTools],
    required: normalized.required
  };

  return {
    ok: true,
    contract: deepFreeze(normalized),
    contractSnapshot: deepFreeze(contractSnapshot),
    contractSnapshotHash: hashContractSnapshot(contractSnapshot)
  };
}

/**
 * 校验并裁剪 Primary Runtime B 可消费的结构化 Agent 结果。
 * @param input - Child、Coordinator 或恢复层提供的未可信结果
 * @returns 深冻结结果或稳定 result_validation 错误
 */
export function validateChatAgentResult(input: unknown): ChatAgentResultValidation {
  const allowedKeys = new Set([
    'taskId',
    'agentId',
    'attemptId',
    'executionStatus',
    'completion',
    'summary',
    'output',
    'warnings',
    'artifacts',
    'changeset',
    'usage',
    'error'
  ]);
  if (!isPlainRecord(input) || !hasOnlyKeys(input, allowedKeys)) {
    return resultFailure('result_unknown_field', 'Agent result contains unknown fields');
  }
  const taskId = normalizeAgentIdentity(input.taskId);
  const agentId = normalizeAgentIdentity(input.agentId);
  const attemptId = normalizeAgentIdentity(input.attemptId);
  const summary = normalizeDisplayText(input.summary);
  if (!taskId || !agentId || !attemptId || !summary) {
    return resultFailure('result_identity_invalid', 'Agent result identity and summary are required');
  }
  const executionStatuses = new Set<ChatAgentResult['executionStatus']>(['completed', 'failed', 'cancelled', 'deadline_exceeded', 'commit_failed']);
  if (typeof input.executionStatus !== 'string' || !executionStatuses.has(input.executionStatus as ChatAgentResult['executionStatus'])) {
    return resultFailure('result_status_invalid', 'Agent execution status is invalid');
  }
  if (!isPlainRecord(input.completion) || !hasOnlyKeys(input.completion, new Set(['level', 'criteria'])) || !Array.isArray(input.completion.criteria)) {
    return resultFailure('result_completion_invalid', 'Completion must contain an ordered criteria array');
  }
  if (input.completion.level !== 'full' && input.completion.level !== 'partial' && input.completion.level !== 'none') {
    return resultFailure('result_completion_invalid', 'Completion level is invalid');
  }
  const criteria = input.completion.criteria.map(normalizeCriteria);
  if (criteria.some((criterion): boolean => criterion === null)) {
    return resultFailure('result_criteria_invalid', 'Criteria must preserve claim and independent verification');
  }
  const criterionIndexes = (criteria as AgentCriteriaResult[]).map((criterion): number => criterion.criterionIndex);
  if (new Set(criterionIndexes).size !== criterionIndexes.length) {
    return resultFailure('result_criteria_duplicate', 'Criterion indexes must be unique');
  }
  const satisfiedCriteria = (criteria as AgentCriteriaResult[]).filter(
    (criterion): boolean => criterion.claim.status === 'satisfied' && criterion.verification.status === 'verified'
  ).length;
  let derivedCompletion: ChatAgentResult['completion']['level'] = 'partial';
  if (satisfiedCriteria === 0) derivedCompletion = 'none';
  if (criteria.length > 0 && satisfiedCriteria === criteria.length) derivedCompletion = 'full';
  if (input.completion.level !== derivedCompletion) {
    return resultFailure('result_completion_mismatch', 'Completion level must match satisfied and independently verified criteria');
  }
  if (!Array.isArray(input.warnings) || !Array.isArray(input.artifacts)) {
    return resultFailure('result_collections_invalid', 'Warnings and artifacts must be arrays');
  }
  const warnings = input.warnings.map(normalizeWarning);
  const artifacts = input.artifacts.map(normalizeArtifact);
  if (warnings.some((warning): boolean => warning === null)) {
    return resultFailure('result_warning_invalid', 'Warnings must use the allowlisted schema');
  }
  if (artifacts.some((artifact): boolean => artifact === null)) {
    return resultFailure('result_artifact_invalid', 'Artifacts must include ownership, visibility, reference, and time');
  }
  if (
    (artifacts as AgentArtifactReference[]).some((artifact): boolean => {
      return artifact.owner.taskId !== taskId || artifact.owner.agentId !== agentId || artifact.owner.attemptId !== attemptId;
    })
  ) {
    return resultFailure('result_artifact_owner_invalid', 'Artifact ownership must match the result identity');
  }
  if ((artifacts as AgentArtifactReference[]).some((artifact): boolean => artifact.visibility === 'user')) {
    return resultFailure('result_artifact_visibility_invalid', 'Foundation Child results cannot promote artifacts directly to user visibility');
  }
  const usage = normalizeUsage(input.usage);
  if (!usage) {
    return resultFailure('result_usage_invalid', 'Usage must include token, round, duration, request, and cost accounting');
  }
  const changeset = input.changeset === undefined ? undefined : normalizeChangesetResult(input.changeset);
  if (input.changeset !== undefined && !changeset) {
    return resultFailure('result_changeset_invalid', 'Changeset results must bind all integrity hashes');
  }
  const error = input.error === undefined ? undefined : normalizeTaskError(input.error);
  if (input.error !== undefined && !error) {
    return resultFailure('result_error_invalid', 'Error fields must use stable discriminants and scalar details');
  }
  const executionStatus = input.executionStatus as ChatAgentResult['executionStatus'];
  if (executionStatus === 'completed' && error) {
    return resultFailure('result_error_unexpected', 'Completed results cannot contain an error');
  }
  if (executionStatus !== 'completed' && !error) {
    return resultFailure('result_error_required', 'Non-completed results require a structured error');
  }
  if (error && !matchesResultError(executionStatus, error)) {
    return resultFailure('result_error_status_mismatch', 'Result error code, phase, or category does not match execution status');
  }
  let output: unknown;
  if (input.output !== undefined) {
    try {
      if (hasSensitiveOutput(input.output)) {
        return resultFailure('result_output_sensitive', 'Structured output cannot contain sensitive keys or credential-shaped values');
      }
      hashAgentPayload(input.output);
      output = structuredClone(input.output);
    } catch {
      return resultFailure('result_output_invalid', 'Structured output must be canonical payload safe');
    }
  }

  const result: ChatAgentResult = {
    taskId,
    agentId,
    attemptId,
    executionStatus,
    completion: {
      level: input.completion.level,
      criteria: criteria as AgentCriteriaResult[]
    },
    summary,
    ...(input.output !== undefined ? { output } : {}),
    warnings: warnings as AgentTaskWarning[],
    artifacts: artifacts as AgentArtifactReference[],
    ...(changeset ? { changeset } : {}),
    usage,
    ...(error ? { error } : {})
  };

  return {
    ok: true,
    result: deepFreeze(result)
  };
}

/**
 * 校验 Coordinator 在 Runtime 创建前生成的失败结果。
 * 该协议只接受不可重试的计划或资源失败、零 usage、空产物和未验证 criteria。
 * @param input - Store 生成或恢复读取的未可信结果
 * @returns 深冻结失败结果或稳定协议错误
 */
export function validatePreAttemptFailure(input: unknown): PreAttemptFailureValidation {
  const allowedKeys = new Set(['resultKind', 'taskId', 'agentId', 'executionStatus', 'completion', 'summary', 'warnings', 'artifacts', 'usage', 'error']);
  if (!isPlainRecord(input) || !hasOnlyKeys(input, allowedKeys)) {
    return resultFailure('pre_attempt_result_unknown_field', 'Pre-Attempt result contains unknown fields');
  }
  const taskId = normalizeAgentIdentity(input.taskId);
  const agentId = normalizeAgentIdentity(input.agentId);
  const summary = normalizeDisplayText(input.summary);
  if (input.resultKind !== 'pre_attempt_failure' || input.executionStatus !== 'failed' || !taskId || !agentId || !summary) {
    return resultFailure('pre_attempt_result_identity_invalid', 'Pre-Attempt result identity and discriminants are invalid');
  }
  if (
    !isPlainRecord(input.completion) ||
    !hasOnlyKeys(input.completion, new Set(['level', 'criteria'])) ||
    input.completion.level !== 'none' ||
    !Array.isArray(input.completion.criteria)
  ) {
    return resultFailure('pre_attempt_result_completion_invalid', 'Pre-Attempt completion must be none with ordered criteria');
  }
  const criteria = input.completion.criteria.map(normalizeCriteria);
  if (
    criteria.some((criterion): boolean => criterion === null) ||
    new Set((criteria as AgentCriteriaResult[]).map((criterion): number => criterion.criterionIndex)).size !== criteria.length ||
    (criteria as AgentCriteriaResult[]).some(
      (criterion): boolean =>
        criterion.claim.status !== 'unknown' ||
        criterion.claim.evidence.length !== 0 ||
        criterion.verification.status !== 'unverified' ||
        criterion.verification.verifier !== 'policy' ||
        criterion.verification.evidence.length !== 0
    )
  ) {
    return resultFailure('pre_attempt_result_criteria_invalid', 'Pre-Attempt criteria cannot claim execution evidence');
  }
  if (!Array.isArray(input.warnings) || input.warnings.length !== 0 || !Array.isArray(input.artifacts) || input.artifacts.length !== 0) {
    return resultFailure('pre_attempt_result_collections_invalid', 'Pre-Attempt results cannot contain warnings or artifacts');
  }
  const usage = normalizeUsage(input.usage);
  if (
    !usage ||
    usage.inputTokens !== 0 ||
    usage.outputTokens !== 0 ||
    usage.totalTokens !== 0 ||
    usage.modelCalls !== 0 ||
    usage.toolRounds !== 0 ||
    usage.queueDurationMs !== 0 ||
    usage.executionDurationMs !== 0 ||
    usage.externalRequests !== 0 ||
    usage.monetaryCost.currency !== 'unknown' ||
    usage.monetaryCost.pricingVersion !== 'unknown' ||
    usage.monetaryCost.estimated !== 'unknown' ||
    usage.monetaryCost.actual !== 'unknown'
  ) {
    return resultFailure('pre_attempt_result_usage_invalid', 'Pre-Attempt results require canonical zero usage');
  }
  const error = normalizeTaskError(input.error);
  if (!error || error.retryable || (error.phase !== 'plan_validation' && error.phase !== 'resource_validation') || !matchesResultError('failed', error)) {
    return resultFailure('pre_attempt_result_error_invalid', 'Pre-Attempt result requires a non-retryable planning or resource error');
  }
  return {
    ok: true,
    result: deepFreeze({
      resultKind: 'pre_attempt_failure',
      taskId,
      agentId,
      executionStatus: 'failed',
      completion: {
        level: 'none',
        criteria: criteria as AgentCriteriaResult[]
      },
      summary,
      warnings: [],
      artifacts: [],
      usage,
      error
    })
  };
}
