/**
 * @file service.mts
 * @description Child Agent 委派契约校验、原子 prepare、continuation fence 与启动恢复服务。
 */
import { readFileSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {
  AgentAttemptProjection,
  AgentCheckpointRecord,
  AgentDelegationStore,
  AgentOutboxRecord,
  AgentStoreDatabase,
  AgentTaskRecord,
  BeginAgentAttemptInput,
  MarkAgentAttemptInput,
  PrepareAgentTaskInput,
  PrepareDelegationInput
} from './types.mjs';
import type { ChatRuntimeDelegationPrepareAck, ChatRuntimeDelegationPrepareInput, ChatRuntimePrimaryContinuationContext } from '../runtime/types.mjs';
import type { ChatMessageRecord } from 'types/chat';
import type {
  AgentBudgetSnapshot,
  AgentDelegationContinuationSnapshot,
  AgentDelegationCreatedPayload,
  AgentDelegationReadyPayload,
  ChatAgentApplicationEvent,
  ChatAgentCancelCheckpointInput,
  ChatAgentCheckpointSnapshot,
  ChatAgentConfirmationSnapshot,
  ChatAgentResolveConfirmationInput,
  AgentModelSnapshot,
  AgentOrderedToolCallSnapshot,
  PrimaryDelegationFeatureConfig,
  AgentTaskError,
  AgentUsageAccounting,
  ChatAgentResult,
  ChatAgentResumePrimaryInput,
  ChatAgentResumeResult,
  DelegateTaskInput
} from 'types/chat-agent';
import type { ChatRuntimeAddress } from 'types/chat-runtime';
import { app, BrowserWindow } from 'electron';
import { nanoid } from 'nanoid';
import { getToolRegistryEntry } from '../../../../../shared/ai/tools/index.js';
import { aiService } from '../../ai/service.mjs';
import { dbExecute, dbSelect, transaction } from '../../database/service.mjs';
import { chatRuntimeLocks, getSessionHistoryScope, type RuntimeContinuationFenceHandle, type RuntimeLockRegistry } from '../runtime/infrastructure/locks.mjs';
import { finishAssistantMessageInterrupted } from '../runtime/messages/finalizer.mjs';
import { createDefaultChatModelResolver } from '../runtime/model/resolver.mjs';
import { getRuntimeTaskDeadlineAt } from '../runtime/task-clock.mjs';
import { chatSessionManager } from '../service.mjs';
import { createAgentBudgetLedger, type AgentBudgetLedger } from './budget.mjs';
import { createChildActorRegistry } from './child-registry.mjs';
import { createAgentConfirmationQueue, type AgentConfirmationQueue } from './confirmation-store.mjs';
import {
  AGENT_CHECKPOINT_SCHEMA_VERSION,
  AGENT_FOUNDATION_POLICY_VERSION,
  hashAgentPayload,
  hashContinuationSnapshot,
  validateAgentTaskError,
  validateContinuationSnapshot,
  validateFoundationContract
} from './contracts.mjs';
import { createAgentCoordinator, type AgentCoordinator } from './coordinator.mjs';
import { createChildRuntimeExecutor } from './executor.mjs';
import { createAgentFileCommitter, type AgentFileCommitInput, type AgentFileCommitResult, type AgentFileCommitter } from './file-commit.mjs';
import { compileAgentPlan, type AgentPlanCompileInput, type AgentPlanCompileResult } from './plan-compiler.mjs';
import { resolveAgentScopes } from './resource-scopes.mjs';
import { validateAgentResult } from './result.mjs';
import { createAgentResourceScheduler } from './scheduler.mjs';
import { createAgentDelegationStore } from './store.mjs';

/** Runtime B 续接允许保留的非敏感内存上下文。 */
export type ContinuationRuntimeContext = ChatRuntimePrimaryContinuationContext;

/** 委派服务仅使用的 Store 最小能力。 */
export type ChatAgentDelegationStore = Pick<
  AgentDelegationStore,
  | 'prepareDelegation'
  | 'authorizeTask'
  | 'recordPreAttemptFailure'
  | 'recordTaskResult'
  | 'getTask'
  | 'getCheckpoint'
  | 'getOutbox'
  | 'claimResume'
  | 'finalizeResume'
  | 'cancelCheckpoint'
  | 'interruptCheckpoint'
  | 'interruptActive'
  | 'listEvents'
  | 'listActive'
  | 'listPendingOutbox'
  | 'markOutboxDelivered'
>;

/** 主进程授权器为一个只读 Task 分配的当前上限。 */
export interface ChatAgentReadPlanLimits {
  /** 主进程此刻实际可用的工具名称。 */
  readonly availableToolNames: readonly string[];
  /** 权限系统批准的 scope IDs。 */
  readonly permissionScopeIds: readonly string[];
  /** Task 独立预算上限。 */
  readonly budget: AgentBudgetSnapshot;
}

/** 委派服务稳定 ID 域。 */
export type ChatAgentDelegationIdKind = 'task' | 'child' | 'outbox' | 'continuation' | 'runtime';

/** Runtime service 内部 Primary 续接启动输入。 */
export interface ChatAgentPrimaryContinuationInput {
  /** 已 CAS claim 的 Checkpoint。 */
  readonly checkpoint: AgentCheckpointRecord;
  /** Checkpoint 绑定的新 Runtime B。 */
  readonly runtimeId: string;
  /** 已完成完整性校验的易失上下文。 */
  readonly context: ContinuationRuntimeContext;
}

/** Runtime service 内部 Primary 续接执行结果。 */
export type ChatAgentPrimaryContinuationResult =
  | {
      /** Runtime B 已安全完成模型执行。 */
      readonly outcome: 'completed';
    }
  | {
      /** Runtime B 已把失败安全写入 owner assistant。 */
      readonly outcome: 'failed';
      /** 失败发生在启动还是模型执行阶段。 */
      readonly phase: 'starting' | 'runtime';
      /** 已校验且可直接持久化的机器错误。 */
      readonly error: AgentTaskError;
    };

/** 委派服务依赖。 */
export interface ChatAgentDelegationServiceDependencies {
  /** 同步持久化事实 Store。 */
  store: ChatAgentDelegationStore;
  /** Chat 与 Runtime 共享锁注册表。 */
  locks: RuntimeLockRegistry;
  /**
   * 同一 SQLite 事务中的 assistant 写入回调。
   * @param message - 含完整 deferred tool-call 的 assistant
   * @returns 必须同步完成
   */
  persistAssistant: (message: ChatMessageRecord, ownerCheckpointId?: string) => undefined;
  /**
   * 读取会话完整消息，用于 Checkpoint 终态化 source assistant。
   * @param sessionId - 会话 ID
   * @returns 按持久化顺序排列的消息
   */
  readMessages: (sessionId: string) => ChatMessageRecord[];
  /**
   * 广播已由 fence owner 持久化的 source assistant 更新。
   * @param message - 已终态化 assistant
   * @param checkpoint - 消息所属 Checkpoint
   */
  publishAssistant: (message: ChatMessageRecord, checkpoint: AgentCheckpointRecord) => void;
  /**
   * 发布已持久化 Outbox 事件。
   * @param eventType - 事件类型
   * @param payload - allowlist payload
   */
  publish: (eventType: 'delegation.created' | 'delegation.ready', payload: AgentDelegationCreatedPayload | AgentDelegationReadyPayload) => void;
  /**
   * 在 Renderer 投影之前交付强制 Main 内部消费者。
   * @param eventType - 持久化 Outbox 事件类型
   * @param payload - allowlist payload
   */
  dispatchInternal?: (
    eventType: 'delegation.created' | 'delegation.ready',
    payload: AgentDelegationCreatedPayload | AgentDelegationReadyPayload
  ) => Promise<void>;
  /**
   * 发布已持久化的公开 Checkpoint 或 confirmation 投影。
   * @param event - 判别式 application event
   */
  publishCheckpoint: (event: ChatAgentApplicationEvent) => void;
  /** Main-owned 持久化 confirmation queue；隔离测试可省略以保持旧只读 fixture。 */
  confirmationQueue?: AgentConfirmationQueue;
  /** Main-owned 委派灰度配置；缺省时受控写入保持关闭。 */
  featureConfig?: Readonly<PrimaryDelegationFeatureConfig>;
  /**
   * 创建稳定身份。
   * @param kind - 身份域
   * @param index - 同一 prepare 内从一开始的序号
   * @returns 新身份
   */
  createId: (kind: ChatAgentDelegationIdKind, index?: number) => string;
  /** @returns 当前 ISO-8601 时间。 */
  now: () => string;
  /**
   * 从主进程权限、可用性和预算事实解析当前 Task 上限。
   * @param task - 不可变 Task
   * @param checkpoint - Task 所属 Checkpoint
   * @param context - 已通过 hash 校验的冻结上下文
   * @returns 不接受 Renderer 覆盖的当前上限
   */
  resolveReadLimits?: (task: AgentTaskRecord, checkpoint: AgentCheckpointRecord, context: ContinuationRuntimeContext) => ChatAgentReadPlanLimits;
  /** Main-owned 持久化 Turn/Task 预算账本；生产授权必须注入。 */
  budgetLedger?: AgentBudgetLedger;
  /**
   * 使用主进程 registry 与 policy 编译计划。
   * @param input - 持久化事实和可信授权上限
   * @returns 已冻结计划或结构化失败
   */
  compileReadPlan?: (input: AgentPlanCompileInput) => AgentPlanCompileResult;
  /**
   * 启动只接受内部冻结输入的 Primary Runtime B。
   * @param input - claimed Checkpoint、Runtime ID 与易失上下文
   * @returns 安全完成或已持久化失败
   */
  startPrimaryContinuation: (input: ChatAgentPrimaryContinuationInput) => Promise<ChatAgentPrimaryContinuationResult>;
}

/** 服务边界接收的未可信 Child 终态结果。 */
export interface ChatAgentRecordTaskResultInput {
  /** 结果所属 Task。 */
  taskId: string;
  /** 汇合结果的 Checkpoint。 */
  checkpointId: string;
  /** 原始 Provider tool-call ID。 */
  toolCallId: string;
  /** Child 提交的未可信结果；不接受其自报 hash。 */
  result: unknown;
}

/** 委派服务公开能力。 */
export interface ChatAgentDelegationService {
  /**
   * 同步校验并原子提交委派事实。
   * @param input - Runtime A 的完整 prepare 输入
   * @returns 精确同步 ACK
   */
  prepareDelegation(input: ChatRuntimeDelegationPrepareInput): ChatRuntimeDelegationPrepareAck;
  /**
   * 从持久化事实和主进程可信依赖编译并原子授权一个 Task。
   * @param taskId - created 状态的 Task
   * @returns queued(start) 状态的 Task
   */
  authorizeTask(taskId: string): AgentTaskRecord;
  /**
   * 规范化并原子记录一个 Child 终态结果。
   * @param input - 不含 Child hash 的 Task 结果
   * @returns 最新 Checkpoint 投影
   */
  recordTaskResult(input: ChatAgentRecordTaskResultInput): ReturnType<AgentDelegationStore['recordTaskResult']>;
  /**
   * 原子记录一个不伪造 Attempt 的授权前失败。
   * @param task - 失败所属持久化 Task
   * @param error - 不可重试的计划或资源错误
   * @returns 最新 Checkpoint 投影
   */
  recordPreFailure(task: AgentTaskRecord, error: AgentTaskError): ReturnType<AgentDelegationStore['recordPreAttemptFailure']>;
  /**
   * 使用当前 ready 版本 CAS claim 唯一 Runtime B。
   * @param checkpointId - ready Checkpoint
   * @returns claim 成功后的 Checkpoint，竞争失败为 null
   */
  claimPrimaryResume(checkpointId: string): AgentCheckpointRecord | null;
  /**
   * CAS claim 并启动唯一 Primary Runtime B。
   * @param input - Renderer 只能提议身份与观察版本
   * @returns 启动确认与 Main 派生地址，不等待模型完成
   */
  resumePrimary(input: ChatAgentResumePrimaryInput): Promise<ChatAgentResumeResult>;
  /** @returns 所有公开非终态 Checkpoint 投影。 */
  listActive(): ChatAgentCheckpointSnapshot[];
  /** @returns 所有公开 pending confirmation 投影。 */
  listConfirmations(): ChatAgentConfirmationSnapshot[];
  /**
   * 使用 Renderer 观察版本决议 confirmation。
   * @param input - 最小 CAS 输入
   * @returns 权威 confirmation 投影
   */
  resolveConfirmation(input: ChatAgentResolveConfirmationInput): ChatAgentConfirmationSnapshot;
  /**
   * 持久化 cooperative cancellation 并安全终态化 source assistant。
   * @param input - 最小取消输入
   * @returns 当前公开 Checkpoint 投影
   */
  cancelCheckpoint(input: ChatAgentCancelCheckpointInput): ChatAgentCheckpointSnapshot;
  /**
   * 由可信 Main 协调器使用稳定机器原因持久化 cooperative cancellation。
   * @param checkpointId - 目标 Checkpoint
   * @param reason - 不依赖展示文本的机器原因
   * @returns 当前公开 Checkpoint 投影
   */
  cancelInternal(checkpointId: string, reason: string): ChatAgentCheckpointSnapshot;
  /**
   * 读取进程内 allowlist continuation context。
   * @param checkpointId - Checkpoint ID
   * @returns 不可变上下文 clone
   */
  getContinuationContext(checkpointId: string): ContinuationRuntimeContext | undefined;
  /**
   * 启动时中断无法跨进程恢复的 Checkpoint。
   * @returns 被中断的 Checkpoint 数
   */
  interruptUnrecoverableCheckpoints(): number;
  /** 重放全部待交付 Outbox，并等待强制内部消费者接受。 */
  drainOutbox(): Promise<void>;
}

/** 可直接抛给 Runtime 的结构化委派错误。 */
class ChatAgentDelegationError extends Error implements AgentTaskError {
  /** 稳定机器错误码。 */
  readonly code: AgentTaskError['code'];

  /** 错误阶段。 */
  readonly phase: AgentTaskError['phase'];

  /** 错误分类。 */
  readonly category: AgentTaskError['category'];

  /** 是否允许重试。 */
  readonly retryable: boolean;

  /** allowlist 机器详情。 */
  readonly details?: AgentTaskError['details'];

  /**
   * 创建结构化委派错误。
   * @param error - 已校验 Agent 错误
   */
  constructor(error: AgentTaskError) {
    super(error.message ?? error.code);
    this.name = 'ChatAgentDelegationError';
    this.code = error.code;
    this.phase = error.phase;
    this.category = error.category;
    this.retryable = error.retryable;
    this.details = error.details;
  }
}

/**
 * 创建恢复阶段协议错误。
 * @param checkpointId - Checkpoint ID
 * @param reason - 稳定机器原因
 * @returns 可抛出的错误
 */
function createFenceError(checkpointId: string, reason: string): ChatAgentDelegationError {
  return new ChatAgentDelegationError({
    code: 'protocol_error',
    phase: 'recovery',
    category: 'protocol',
    retryable: false,
    message: '无法为已提交委派取得 continuation fence',
    details: { checkpointId, reason }
  });
}

/**
 * 从 resolved model 构造无凭据模型快照。
 * @param input - prepare 输入
 * @returns 模型快照
 */
function createModelSnapshot(input: ChatRuntimeDelegationPrepareInput): AgentModelSnapshot {
  const resolution = input.runtime.resolvedModel;
  const providerId = resolution?.createOptions.providerId?.trim();
  const modelId = resolution?.modelId.trim();
  if (!providerId || !modelId) {
    throw new ChatAgentDelegationError({
      code: 'protocol_error',
      phase: 'recovery',
      category: 'protocol',
      retryable: false,
      message: '委派挂起前必须冻结实际模型',
      details: { reason: 'resolved_model_missing', runtimeId: input.runtime.runtimeId }
    });
  }
  return { providerId, modelId };
}

/**
 * 按 allowlist 构造进程内 continuation context。
 * @param input - prepare 输入
 * @param modelSnapshot - 已冻结模型身份
 * @returns 不含 Provider 凭据的上下文
 */
function createRuntimeContext(input: ChatRuntimeDelegationPrepareInput, modelSnapshot: AgentModelSnapshot): ContinuationRuntimeContext {
  const { runtime } = input;
  return structuredClone({
    clientId: runtime.clientId,
    modelSnapshot,
    toolSchemaSnapshot: structuredClone(runtime.tools ?? []),
    ...(runtime.contextWindow ? { contextWindow: runtime.contextWindow } : {}),
    ...(runtime.system ? { system: runtime.system } : {}),
    ...(runtime.workspaceRoot ? { workspaceRoot: runtime.workspaceRoot } : {}),
    ...(runtime.capabilities ? { capabilities: runtime.capabilities } : {}),
    ...(runtime.skillContentHashes ? { skillContentHashes: runtime.skillContentHashes } : {}),
    ...(runtime.runtimeContext ? { runtimeContext: runtime.runtimeContext } : {})
  });
}

/**
 * 投影为与 SQLite JSON 持久化一致的快照，移除可选字段中的 undefined。
 * @param value - 结构化克隆安全输入
 * @returns 仅含 JSON 值的快照
 */
function createJsonSnapshot(value: unknown): unknown {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new ChatAgentDelegationError({
      code: 'protocol_error',
      phase: 'recovery',
      category: 'protocol',
      retryable: false,
      message: '委派快照无法转换为 JSON',
      details: { reason: 'delegation_snapshot_not_json' }
    });
  }
  return JSON.parse(serialized) as unknown;
}

/**
 * 校验 Primary Runtime A 身份边界。
 * @param input - prepare 输入
 */
function assertPrimaryRuntime(input: ChatRuntimeDelegationPrepareInput): void {
  if (input.runtime.agentId === 'primary' && !input.runtime.parentAgentId) return;
  throw new ChatAgentDelegationError({
    code: 'capability_denied',
    phase: 'contract_validation',
    category: 'policy',
    retryable: false,
    message: '只有顶层 Primary Runtime 可以创建 Child 委派',
    details: { reason: 'delegation_caller_not_primary', runtimeId: input.runtime.runtimeId }
  });
}

/**
 * 验证单个 deferred 调用并创建 Task 持久化输入。
 * @param input - prepare 输入
 * @param checkpointId - Checkpoint ID
 * @param index - 有序调用索引
 * @param createId - ID 生成器
 * @returns Task、规范化契约和 ordered-call 链接
 */
function createTaskFacts(
  input: ChatRuntimeDelegationPrepareInput,
  checkpointId: string,
  index: number,
  createId: ChatAgentDelegationServiceDependencies['createId']
): { task: PrepareAgentTaskInput; contract: Readonly<DelegateTaskInput>; orderedCall: AgentOrderedToolCallSnapshot } {
  const deferredCall = input.suspension.toolCalls[index];
  if (!deferredCall) throw createFenceError(checkpointId, 'deferred_call_missing');
  const validation = validateFoundationContract(deferredCall.input);
  if (!validation.ok) throw new ChatAgentDelegationError(validation.error);
  const taskId = createId('task', index + 1);
  const agentId = createId('child', index + 1);
  return {
    task: {
      taskId,
      sessionId: input.runtime.sessionId,
      turnId: input.runtime.turnId,
      agentId,
      parentAgentId: input.runtime.agentId,
      rootRuntimeId: input.runtime.rootRuntimeId,
      checkpointId,
      toolCallId: deferredCall.toolCallId,
      contractSnapshot: validation.contractSnapshot,
      contractSnapshotHash: validation.contractSnapshotHash,
      priority: validation.contract.priority,
      ...(validation.contract.deadlineAt ? { deadlineAt: validation.contract.deadlineAt } : {})
    },
    contract: validation.contract,
    orderedCall: {
      toolCallId: deferredCall.toolCallId,
      taskId,
      required: validation.contract.required,
      argumentsHash: deferredCall.argumentsHash,
      providerMetadataHash: deferredCall.providerMetadataHash ?? hashAgentPayload(null)
    }
  };
}

/**
 * 投影 Renderer 可见的 Checkpoint allowlist。
 * @param checkpoint - 完整内部 Checkpoint
 * @param checkpointSequence - 持久化事件 cursor
 * @returns 不含 continuation 与 Child 结果的公开投影
 */
function projectCheckpoint(checkpoint: AgentCheckpointRecord, checkpointSequence: number): ChatAgentCheckpointSnapshot {
  return Object.freeze({
    checkpointId: checkpoint.checkpointId,
    sessionId: checkpoint.sessionId,
    turnId: checkpoint.turnId,
    primaryAgentId: checkpoint.primaryAgentId,
    rootRuntimeId: checkpoint.rootRuntimeId,
    sourceRuntimeId: checkpoint.sourceRuntimeId,
    status: checkpoint.status,
    version: checkpoint.version,
    ...(checkpoint.resumeRuntimeId ? { resumeRuntimeId: checkpoint.resumeRuntimeId } : {}),
    checkpointSequence,
    createdAt: checkpoint.createdAt,
    updatedAt: checkpoint.updatedAt
  });
}

/**
 * 从 Checkpoint 不可变身份派生 Primary Runtime B 地址。
 * @param checkpoint - 已 claim Checkpoint
 * @param runtimeId - Checkpoint 绑定的 Runtime B
 * @returns 完整 Runtime 地址
 */
function createResumeAddress(checkpoint: AgentCheckpointRecord, runtimeId: string): ChatRuntimeAddress {
  return Object.freeze({
    sessionId: checkpoint.sessionId,
    turnId: checkpoint.turnId,
    agentId: checkpoint.primaryAgentId,
    runtimeId,
    parentRuntimeId: checkpoint.sourceRuntimeId,
    rootRuntimeId: checkpoint.rootRuntimeId,
    continuationOfRuntimeId: checkpoint.sourceRuntimeId
  });
}

/**
 * 判断 Checkpoint 是否已经形成可幂等观察的终态。
 * @param status - Checkpoint 状态
 * @returns 是否为 settled resume 结果
 */
function isSettledStatus(
  status: AgentCheckpointRecord['status']
): status is Extract<AgentCheckpointRecord['status'], 'completed' | 'failed' | 'cancelled' | 'interrupted'> {
  return status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'interrupted';
}

/** 首版 Child Runtime 显式允许的本地纯读工具。 */
const CHILD_READ_TOOL_NAMES = new Set(['glob', 'grep', 'read_directory', 'read_file']);

/** Main-owned 单 Turn Child/Primary 共享 token ceiling。 */
const DEFAULT_TURN_BUDGET: AgentBudgetSnapshot = Object.freeze({
  tokenLimit: 32_768,
  costLimitUsd: 0,
  pricingVersion: 'unknown'
});

/** 首版单个 Child Task 的最大 token 预留。 */
const DEFAULT_CHILD_BUDGET: AgentBudgetSnapshot = Object.freeze({
  tokenLimit: 4_096,
  costLimitUsd: 0,
  pricingVersion: 'unknown'
});

/**
 * 在层级预算账本接入前拒绝生产默认授权。
 * @param task - 当前 Task
 * @param checkpoint - 当前 Checkpoint
 * @param context - 已校验冻结上下文
 * @returns 不会返回；必须由 Main 注入可信权限与预算提供器
 */
function resolveDefaultLimits(task: AgentTaskRecord, checkpoint: AgentCheckpointRecord, context: ContinuationRuntimeContext): ChatAgentReadPlanLimits {
  const hasFrozenAuthority = task.checkpointId === checkpoint.checkpointId && checkpoint.status === 'waiting_children' && Boolean(context.workspaceRoot);
  throw new ChatAgentDelegationError({
    code: 'capability_denied',
    phase: 'plan_validation',
    category: 'policy',
    retryable: false,
    message: '层级预算与父权限提供器尚未接入，默认授权保持关闭',
    details: {
      reason: hasFrozenAuthority ? 'plan_budget_allocator_unavailable' : 'plan_parent_authority_invalid',
      taskId: task.taskId,
      checkpointId: checkpoint.checkpointId
    }
  });
}

/**
 * 使用主进程 registry、scope resolver 与显式 policy 编译计划。
 * @param input - 持久化事实和可信当前上限
 * @returns 已冻结计划或结构化错误
 */
function compileDefaultPlan(input: AgentPlanCompileInput): AgentPlanCompileResult {
  return compileAgentPlan(input, {
    resolveScopes: resolveAgentScopes,
    getToolEntry: getToolRegistryEntry,
    isToolAllowed: (toolName: string): boolean => CHILD_READ_TOOL_NAMES.has(toolName),
    // 当前输入本身来自一次已发生的 delegate_task tool-call，因此冻结模型已证明支持工具调用。
    isModelToolCapable: (): boolean => input.checkpoint.continuationSnapshot.orderedToolCalls.length > 0
  });
}

/**
 * 创建 Child Agent 委派服务。
 * @param dependencies - 同步 Store、共享锁和事件依赖
 * @returns 委派服务
 */
export function createChatAgentDelegationService(dependencies: ChatAgentDelegationServiceDependencies): ChatAgentDelegationService {
  const continuationContexts = new Map<string, ContinuationRuntimeContext>();
  const fenceHandles = new Map<string, RuntimeContinuationFenceHandle>();
  const deliveryInFlight = new Map<string, Promise<void>>();
  let deliveryTail = Promise.resolve();

  /**
   * 读取已接线的 Main-owned confirmation queue。
   * @returns confirmation queue
   */
  function getConfirmationQueue(): AgentConfirmationQueue {
    if (dependencies.confirmationQueue) return dependencies.confirmationQueue;
    throw createFenceError('confirmation-queue', 'confirmation_queue_unavailable');
  }

  /**
   * 按当前持久化 Checkpoint 状态判断 Outbox 是否仍可交付。
   * @param outbox - 待交付事实
   * @returns 中断、终态或 tombstone 聚合一律不可继续消费旧事件
   */
  function isOutboxEligible(outbox: AgentOutboxRecord): boolean {
    const checkpoint = dependencies.store.getCheckpoint(outbox.payload.checkpointId);
    if (!checkpoint || checkpoint.recordState !== 'active') return false;
    if (outbox.eventType === 'delegation.created') return checkpoint.status === 'waiting_children';
    return checkpoint.status === 'ready_to_resume';
  }

  /**
   * 先交付强制 Main 内部消费者，再发布 Renderer 投影并确认 Outbox。
   * @param outbox - 已持久化 Outbox
   */
  async function deliverOutbox(outbox: AgentOutboxRecord): Promise<void> {
    if (outbox.deliveryStatus === 'delivered' || !isOutboxEligible(outbox)) return;
    const existing = deliveryInFlight.get(outbox.outboxId);
    if (existing) return existing;
    const delivery = (async (): Promise<void> => {
      if (outbox.eventType === 'delegation.created') {
        if (dependencies.dispatchInternal) {
          await dependencies.dispatchInternal('delegation.created', outbox.payload);
        }
        dependencies.publish('delegation.created', outbox.payload);
      } else {
        if (dependencies.dispatchInternal) {
          await dependencies.dispatchInternal('delegation.ready', outbox.payload);
        }
        dependencies.publish('delegation.ready', outbox.payload);
      }
      dependencies.store.markOutboxDelivered({
        outboxId: outbox.outboxId,
        deliveredAt: dependencies.now()
      });
    })().finally((): void => {
      deliveryInFlight.delete(outbox.outboxId);
    });
    deliveryInFlight.set(outbox.outboxId, delivery);
    return delivery;
  }

  /**
   * 后台尝试交付 Outbox；失败记录保持 pending，供恢复流程重放。
   * @param outbox - 已持久化 Outbox
   */
  function queueOutbox(outbox: AgentOutboxRecord): void {
    const scheduled = deliveryTail.then((): Promise<void> => deliverOutbox(outbox));
    deliveryTail = scheduled.catch((): void => {
      // transactional Outbox 失败时不修改交付状态，后续按 dedupeKey 重放。
    });
  }

  /**
   * 读取 Checkpoint 事务内创建的 delegation.ready Outbox。
   * @param checkpoint - 已 ready 的 Checkpoint
   * @returns 对应待交付或已交付 Outbox
   */
  function findReadyOutbox(checkpoint: AgentCheckpointRecord): AgentOutboxRecord {
    const readyOutbox = dependencies.store.getOutbox(`delegation.ready:${checkpoint.checkpointId}`);
    if (!readyOutbox || readyOutbox.eventType !== 'delegation.ready') {
      throw new ChatAgentDelegationError({
        code: 'protocol_error',
        phase: 'recovery',
        category: 'protocol',
        retryable: false,
        message: 'Ready Checkpoint is missing its transactional Outbox fact',
        details: { reason: 'delegation_ready_outbox_missing', checkpointId: checkpoint.checkpointId }
      });
    }
    return readyOutbox;
  }

  /**
   * 在 Checkpoint 已安全终态化后释放内存上下文与 fence。
   * @param checkpointId - 已完成或失败的 Checkpoint
   */
  function releaseContinuation(checkpointId: string): void {
    const fence = fenceHandles.get(checkpointId);
    if (fence) {
      fence.release();
      fenceHandles.delete(checkpointId);
    }
    continuationContexts.delete(checkpointId);
  }

  /**
   * 读取 Checkpoint 当前持久化事件 cursor。
   * @param checkpointId - Checkpoint ID
   * @returns 最新 sequence
   */
  function readCheckpointSequence(checkpointId: string): number {
    return dependencies.store.listEvents('checkpoint', checkpointId).at(-1)?.sequence ?? 0;
  }

  /**
   * 构造并广播公开 Checkpoint application event。
   * @param checkpoint - 已持久化 Checkpoint
   * @returns 同一份公开投影
   */
  function publishCheckpointSnapshot(checkpoint: AgentCheckpointRecord): ChatAgentCheckpointSnapshot {
    const snapshot = projectCheckpoint(checkpoint, readCheckpointSequence(checkpoint.checkpointId));
    try {
      dependencies.publishCheckpoint({
        schemaVersion: 1,
        type: 'checkpoint.updated',
        checkpoint: snapshot,
        checkpointSequence: snapshot.checkpointSequence
      });
    } catch {
      // application event 是可通过 listActive 补偿的投影，发布失败不能回滚持久化事实。
    }
    return snapshot;
  }

  /**
   * 校验易失上下文仍与不可变 Continuation Snapshot 一致。
   * @param checkpoint - 已 claim Checkpoint
   * @param context - 进程内 allowlist 上下文
   */
  function assertResumeContext(
    checkpoint: AgentCheckpointRecord,
    context: ContinuationRuntimeContext | undefined
  ): asserts context is ContinuationRuntimeContext {
    if (!context) throw createFenceError(checkpoint.checkpointId, 'continuation_context_missing');
    const snapshot = checkpoint.continuationSnapshot;
    const modelMatches =
      context.modelSnapshot.providerId === snapshot.modelSnapshot.providerId && context.modelSnapshot.modelId === snapshot.modelSnapshot.modelId;
    const contextHash = hashAgentPayload(createJsonSnapshot(context));
    const toolSchemaHash = hashAgentPayload(createJsonSnapshot(context.toolSchemaSnapshot));
    if (
      !modelMatches ||
      contextHash !== snapshot.continuationContextHash ||
      toolSchemaHash !== snapshot.toolSchemaSnapshotHash ||
      context.toolSchemaSnapshot.some((tool): boolean => tool.name === 'delegate_task') === false
    ) {
      throw createFenceError(checkpoint.checkpointId, 'continuation_context_hash_mismatch');
    }
  }

  /**
   * CAS claim 当前 ready Checkpoint 的唯一 Runtime B。
   * @param checkpointId - Checkpoint ID
   * @returns claim 成功后的 Checkpoint
   */
  function claimPrimaryResume(checkpointId: string): AgentCheckpointRecord | null {
    const checkpoint = dependencies.store.getCheckpoint(checkpointId);
    if (!checkpoint || checkpoint.status !== 'ready_to_resume' || checkpoint.recordState !== 'active') return null;
    // 易失上下文必须在 CAS 前通过不可变快照校验，避免把不可启动事实推进到 resuming。
    assertResumeContext(checkpoint, continuationContexts.get(checkpoint.checkpointId));
    const resumeRuntimeId = dependencies.createId('runtime', 1);
    return dependencies.store.claimResume({
      checkpointId: checkpoint.checkpointId,
      expectedVersion: checkpoint.version,
      resumeRuntimeId,
      occurredAt: dependencies.now()
    });
  }

  /**
   * claim、启动并终态化唯一 Primary Runtime B。
   * @param checkpointId - ready Checkpoint
   * @returns 本次调用是否取得 claim
   */
  async function finalizePrimaryResume(claimed: AgentCheckpointRecord, completion: Promise<ChatAgentPrimaryContinuationResult>): Promise<void> {
    const runtimeResult = await completion;
    if (runtimeResult.outcome === 'failed') {
      const validatedError = validateAgentTaskError(runtimeResult.error);
      if (!validatedError || validatedError.phase !== runtimeResult.phase || !['runtime_start_failed', 'runtime_failed'].includes(validatedError.code)) {
        throw createFenceError(claimed.checkpointId, 'continuation_failure_result_invalid');
      }
    }
    if (!claimed.resumeRuntimeId) throw createFenceError(claimed.checkpointId, 'resume_runtime_missing');
    const finalized = dependencies.store.finalizeResume({
      checkpointId: claimed.checkpointId,
      expectedVersion: claimed.version,
      resumeRuntimeId: claimed.resumeRuntimeId,
      outcome: runtimeResult.outcome,
      occurredAt: dependencies.now(),
      ...(runtimeResult.outcome === 'failed' ? { error: runtimeResult.error } : {})
    });
    const [budgetRelease] = await Promise.allSettled([
      Promise.resolve().then((): void => {
        dependencies.budgetLedger?.releaseCheckpoint(claimed.checkpointId);
      })
    ]);
    // finalize 成功证明 assistant 已安全终态化；预算释放失败留给恢复，但不能继续占用 history fence。
    releaseContinuation(claimed.checkpointId);
    publishCheckpointSnapshot(finalized);
    if (budgetRelease.status === 'rejected') throw budgetRelease.reason;
  }

  /**
   * CAS claim 并启动唯一 Primary Runtime B，不等待模型完成。
   * @param input - Renderer 的身份提议与观察版本
   * @returns 启动确认或已存在的权威 Runtime 地址
   */
  async function resumePrimary(input: ChatAgentResumePrimaryInput): Promise<ChatAgentResumeResult> {
    const current = dependencies.store.getCheckpoint(input.checkpointId);
    if (!current || current.recordState !== 'active') {
      throw new ChatAgentDelegationError({
        code: 'protocol_error',
        phase: 'recovery',
        category: 'protocol',
        retryable: false,
        message: 'Checkpoint 不存在或已删除',
        details: { reason: 'checkpoint_not_found', checkpointId: input.checkpointId }
      });
    }
    if (current.status === 'resuming' && current.resumeRuntimeId) {
      const checkpoint = projectCheckpoint(current, readCheckpointSequence(current.checkpointId));
      return {
        status: 'already_started',
        checkpoint,
        address: createResumeAddress(current, current.resumeRuntimeId)
      };
    }
    if (isSettledStatus(current.status)) {
      const checkpoint = Object.freeze({
        ...projectCheckpoint(current, readCheckpointSequence(current.checkpointId)),
        status: current.status
      });
      return {
        status: 'settled',
        checkpoint,
        ...(current.resumeRuntimeId ? { address: createResumeAddress(current, current.resumeRuntimeId) } : {})
      };
    }
    if (current.status !== 'ready_to_resume' || current.version !== input.expectedVersion) {
      throw new ChatAgentDelegationError({
        code: 'protocol_error',
        phase: 'recovery',
        category: 'protocol',
        retryable: true,
        message: 'Checkpoint 状态或版本已变化',
        details: {
          reason: 'checkpoint_resume_conflict',
          checkpointId: input.checkpointId,
          status: current.status,
          expectedVersion: input.expectedVersion,
          actualVersion: current.version
        }
      });
    }
    assertResumeContext(current, continuationContexts.get(current.checkpointId));
    const claimed = dependencies.store.claimResume({
      checkpointId: current.checkpointId,
      expectedVersion: input.expectedVersion,
      resumeRuntimeId: input.resumeRuntimeId,
      occurredAt: dependencies.now()
    });
    if (!claimed?.resumeRuntimeId) {
      const winner = dependencies.store.getCheckpoint(input.checkpointId);
      if (winner?.status === 'resuming' && winner.resumeRuntimeId) {
        return {
          status: 'already_started',
          checkpoint: projectCheckpoint(winner, readCheckpointSequence(winner.checkpointId)),
          address: createResumeAddress(winner, winner.resumeRuntimeId)
        };
      }
      throw createFenceError(input.checkpointId, 'resume_claim_conflict');
    }
    const { resumeRuntimeId } = claimed;
    const context = continuationContexts.get(claimed.checkpointId);
    assertResumeContext(claimed, context);
    const snapshot = publishCheckpointSnapshot(claimed);
    // completion rejection 表示 Runtime 未能证明失败 assistant 已安全持久化，必须保留 resuming 与 fence。
    const completion = dependencies.startPrimaryContinuation({
      checkpoint: claimed,
      runtimeId: resumeRuntimeId,
      context: structuredClone(context)
    });
    finalizePrimaryResume(claimed, completion).catch((): void => {
      // 未能安全终态化时保留 resuming、易失上下文与 continuation fence，等待恢复流程介入。
      console.error(`[chat-agent-resume-finalize] checkpointId=${claimed.checkpointId}`);
    });
    return {
      status: 'started',
      checkpoint: snapshot,
      address: createResumeAddress(claimed, resumeRuntimeId)
    };
  }

  /**
   * 编译并原子授权一个 created Task。
   * @param taskId - 目标 Task
   * @returns queued(start) Task
   */
  function authorizeTask(taskId: string): AgentTaskRecord {
    const normalizedTaskId = taskId.trim();
    const task = normalizedTaskId ? dependencies.store.getTask(normalizedTaskId) : null;
    const checkpoint = task ? dependencies.store.getCheckpoint(task.checkpointId) : null;
    if (!task || !checkpoint) {
      throw new ChatAgentDelegationError({
        code: 'protocol_error',
        phase: 'plan_validation',
        category: 'protocol',
        retryable: false,
        message: 'Task 或所属 Checkpoint 不存在',
        details: { reason: 'authorization_context_missing', taskId: normalizedTaskId }
      });
    }
    if (task.contractSnapshot.mode === 'write' && dependencies.featureConfig?.controlledWriteChildEnabled !== true) {
      throw new ChatAgentDelegationError({
        code: 'capability_denied',
        phase: 'plan_validation',
        category: 'policy',
        retryable: false,
        message: '受控写入 Child 尚未由主进程启用',
        details: { reason: 'controlled_write_child_disabled', taskId: task.taskId }
      });
    }
    const context = continuationContexts.get(checkpoint.checkpointId);
    assertResumeContext(checkpoint, context);
    if (!context.workspaceRoot) {
      throw new ChatAgentDelegationError({
        code: 'resource_scope_invalid',
        phase: 'resource_validation',
        category: 'resource',
        retryable: false,
        message: 'Child Task 缺少冻结工作区',
        details: { reason: 'workspace_root_missing', taskId: task.taskId }
      });
    }

    const limitsResolver = dependencies.resolveReadLimits ?? resolveDefaultLimits;
    const compiler = dependencies.compileReadPlan ?? compileDefaultPlan;
    const limits = limitsResolver(task, checkpoint, context);
    const compiled = compiler({
      task,
      checkpoint,
      parentToolNames: context.toolSchemaSnapshot.map((tool): string => tool.name),
      availableToolNames: limits.availableToolNames,
      permissionScopeIds: limits.permissionScopeIds,
      workspaceRoot: context.workspaceRoot,
      budget: limits.budget
    });
    if (!compiled.ok) throw new ChatAgentDelegationError(compiled.error);
    dependencies.budgetLedger?.reserveTask(task.taskId, compiled.plan.budget);
    try {
      return dependencies.store.authorizeTask({
        taskId: task.taskId,
        executionPlanSnapshot: compiled.plan,
        executionPlanSnapshotHash: compiled.plan.planHash,
        occurredAt: dependencies.now(),
        source: 'coordinator'
      });
    } catch (error) {
      dependencies.budgetLedger?.releaseTask(task.taskId);
      throw error;
    }
  }

  /**
   * 返回所有公开非终态 Checkpoint 投影。
   * @returns 按 Store 顺序排列的 allowlist 快照
   */
  function listActive(): ChatAgentCheckpointSnapshot[] {
    return dependencies.store.listActive().map((recovery): ChatAgentCheckpointSnapshot => projectCheckpoint(recovery.checkpoint, recovery.eventSequence));
  }

  /**
   * 返回所有公开 pending confirmation 投影。
   * @returns Main 持久化事实的 allowlist 快照
   */
  function listConfirmations(): ChatAgentConfirmationSnapshot[] {
    return getConfirmationQueue().listPending();
  }

  /**
   * 通过 Main-owned queue 执行 confirmation CAS。
   * @param input - Renderer 最小决议输入
   * @returns 权威 allowlist 快照
   */
  function resolveConfirmation(input: ChatAgentResolveConfirmationInput): ChatAgentConfirmationSnapshot {
    return getConfirmationQueue().resolve(input);
  }

  /**
   * 终态化 cancelled Checkpoint 的 source assistant、预算和 continuation fence。
   * @param checkpoint - Store 已持久化的 cancelled Checkpoint
   */
  function finishCancellation(checkpoint: AgentCheckpointRecord): void {
    const sourceAssistant = dependencies
      .readMessages(checkpoint.sessionId)
      .find((message): boolean => message.id === checkpoint.assistantMessageId && message.role === 'assistant');
    if (!sourceAssistant) {
      throw createFenceError(checkpoint.checkpointId, 'cancel_source_assistant_missing');
    }
    const interruptedAssistant = structuredClone(sourceAssistant);
    finishAssistantMessageInterrupted(interruptedAssistant);
    dependencies.persistAssistant(interruptedAssistant, checkpoint.checkpointId);
    dependencies.publishAssistant(interruptedAssistant, checkpoint);
    dependencies.budgetLedger?.releaseCheckpoint(checkpoint.checkpointId);
    // Store cancellation、assistant 终态和预算释放都已持久化并广播后，才允许释放历史 fence。
    releaseContinuation(checkpoint.checkpointId);
  }

  /**
   * 使用可信机器原因持久化 cooperative cancellation，并在 Store 安全终态后关闭 source assistant。
   * @param checkpointId - 目标 Checkpoint
   * @param reason - 稳定机器原因
   * @returns 当前公开 Checkpoint
   */
  function cancelWithReason(checkpointId: string, reason: string): ChatAgentCheckpointSnapshot {
    const normalizedReason = reason.trim();
    if (!normalizedReason) throw createFenceError(checkpointId, 'cancel_reason_invalid');
    const taskIds = dependencies.store
      .listActive()
      .find((recovery): boolean => recovery.checkpoint.checkpointId === checkpointId)
      ?.tasks.map((task): string => task.taskId);
    const checkpoint = dependencies.store.cancelCheckpoint({
      checkpointId,
      reason: normalizedReason,
      occurredAt: dependencies.now()
    });
    // 先持久化 checkpoint/task cancellation intent，再撤销仍 pending 的确认。
    taskIds?.forEach((taskId): void => {
      dependencies.confirmationQueue?.revokeTask(taskId, normalizedReason);
    });
    if (checkpoint.status !== 'cancelled') {
      return publishCheckpointSnapshot(checkpoint);
    }

    finishCancellation(checkpoint);
    return publishCheckpointSnapshot(checkpoint);
  }

  /**
   * 持久化 Renderer 发起的 cooperative cancellation。
   * @param input - 最小取消输入
   * @returns 当前公开 Checkpoint
   */
  function cancelCheckpoint(input: ChatAgentCancelCheckpointInput): ChatAgentCheckpointSnapshot {
    return cancelWithReason(input.checkpointId, 'user_cancelled');
  }

  return {
    prepareDelegation(input: ChatRuntimeDelegationPrepareInput): ChatRuntimeDelegationPrepareAck {
      assertPrimaryRuntime(input);
      const checkpointId = input.checkpointId.trim();
      if (!checkpointId || input.suspension.toolCalls.length === 0) {
        throw createFenceError(input.checkpointId, 'delegation_prepare_identity_invalid');
      }
      const modelSnapshot = createModelSnapshot(input);
      const continuationContext = createRuntimeContext(input, modelSnapshot);
      const taskFacts = input.suspension.toolCalls.map((_toolCall, index) => createTaskFacts(input, checkpointId, index, dependencies.createId));
      const continuationSnapshot: AgentDelegationContinuationSnapshot = {
        checkpointSchemaVersion: AGENT_CHECKPOINT_SCHEMA_VERSION,
        policyVersion: AGENT_FOUNDATION_POLICY_VERSION,
        modelSnapshot,
        continuationContextReference: dependencies.createId('continuation', 1),
        continuationContextHash: hashAgentPayload(createJsonSnapshot(continuationContext)),
        sourceMessageRevision: hashAgentPayload(createJsonSnapshot(input.assistantMessage)),
        toolSchemaSnapshotHash: hashAgentPayload(createJsonSnapshot(input.runtime.tools ?? [])),
        orderedToolCalls: taskFacts.map((facts): AgentOrderedToolCallSnapshot => facts.orderedCall),
        reservedResumeBudget: {
          tokenLimit: 4096,
          costLimitUsd: 0,
          pricingVersion: 'unknown'
        },
        absoluteTurnDeadline: new Date(getRuntimeTaskDeadlineAt(input.runtime)).toISOString()
      };
      const continuationSnapshotHash = hashContinuationSnapshot(continuationSnapshot);
      const continuationValidation = validateContinuationSnapshot(continuationSnapshot, continuationSnapshotHash);
      if (!continuationValidation.ok) throw new ChatAgentDelegationError(continuationValidation.error);
      const outboxPayload: AgentDelegationCreatedPayload = {
        checkpointId,
        sessionId: input.runtime.sessionId,
        turnId: input.runtime.turnId
      };
      const outboxId = dependencies.createId('outbox', 1);
      const occurredAt = dependencies.now();
      const prepareInput: PrepareDelegationInput = {
        tasks: taskFacts.map((facts): PrepareAgentTaskInput => facts.task),
        checkpoint: {
          checkpointId,
          sessionId: input.runtime.sessionId,
          turnId: input.runtime.turnId,
          primaryAgentId: input.runtime.agentId,
          rootRuntimeId: input.runtime.rootRuntimeId,
          sourceRuntimeId: input.runtime.runtimeId,
          assistantMessageId: input.assistantMessage.id,
          continuationSnapshot: continuationValidation.continuation,
          continuationSnapshotHash
        },
        outbox: {
          outboxId,
          dedupeKey: `delegation.created:${checkpointId}`,
          eventType: 'delegation.created',
          payload: outboxPayload,
          payloadHash: hashAgentPayload(outboxPayload),
          schemaVersion: 1
        },
        occurredAt
      };

      // Store 写入前只预留 scope；inactive reservation 不会阻止当前 Runtime 的 history 写入。
      const fenceReservation = dependencies.locks.reserveContinuationFence({
        scope: getSessionHistoryScope(input.runtime.sessionId),
        checkpointId
      });
      if (!fenceReservation) {
        throw createFenceError(checkpointId, 'continuation_fence_reservation_unavailable');
      }
      try {
        dependencies.store.prepareDelegation(prepareInput, (): undefined => {
          return dependencies.persistAssistant(structuredClone(input.assistantMessage));
        });
      } catch (error) {
        // 事务失败时没有持久化委派事实，释放 inactive reservation 即可安全重试。
        fenceReservation.release();
        throw error;
      }

      // 预留 token 在提交后同步转为 active fence，不再存在二次竞争窗口。
      const fence = fenceReservation.activate();
      fenceHandles.set(checkpointId, fence);
      continuationContexts.set(checkpointId, Object.freeze(structuredClone(continuationContext)));
      const preparedCheckpoint = dependencies.store.getCheckpoint(checkpointId);
      if (!preparedCheckpoint) throw createFenceError(checkpointId, 'prepared_checkpoint_missing');
      publishCheckpointSnapshot(preparedCheckpoint);
      const createdOutbox = dependencies.store.getOutbox(`delegation.created:${checkpointId}`);
      if (!createdOutbox || createdOutbox.eventType !== 'delegation.created' || createdOutbox.outboxId !== outboxId) {
        throw createFenceError(checkpointId, 'delegation_created_outbox_missing');
      }
      queueOutbox(createdOutbox);
      return { prepared: true };
    },

    authorizeTask,

    recordPreFailure(task: AgentTaskRecord, error: AgentTaskError): ReturnType<AgentDelegationStore['recordPreAttemptFailure']> {
      const current = dependencies.store.getTask(task.taskId);
      const validatedError = validateAgentTaskError(error);
      if (
        !current ||
        current.checkpointId !== task.checkpointId ||
        current.toolCallId !== task.toolCallId ||
        !validatedError ||
        validatedError.retryable ||
        (validatedError.phase !== 'plan_validation' && validatedError.phase !== 'resource_validation')
      ) {
        throw new ChatAgentDelegationError({
          code: 'protocol_error',
          phase: 'plan_validation',
          category: 'protocol',
          retryable: false,
          message: 'Coordinator pre-Attempt failure does not match one persisted Task',
          details: { reason: 'pre_attempt_failure_context_invalid', taskId: task.taskId, checkpointId: task.checkpointId }
        });
      }
      const checkpoint = dependencies.store.recordPreAttemptFailure({
        taskId: current.taskId,
        checkpointId: current.checkpointId,
        toolCallId: current.toolCallId,
        error: validatedError,
        occurredAt: dependencies.now()
      });
      publishCheckpointSnapshot(checkpoint);
      if (checkpoint.status === 'ready_to_resume') queueOutbox(findReadyOutbox(checkpoint));
      return checkpoint;
    },

    recordTaskResult(input: ChatAgentRecordTaskResultInput): ReturnType<AgentDelegationStore['recordTaskResult']> {
      const task = dependencies.store.getTask(input.taskId);
      if (!task || task.checkpointId !== input.checkpointId || task.toolCallId !== input.toolCallId || !task.currentAttemptId || !task.executionPlanSnapshot) {
        throw new ChatAgentDelegationError({
          code: 'result_evidence_invalid',
          phase: 'result_validation',
          category: 'integrity',
          retryable: false,
          message: 'Child result does not match one runnable persisted Task',
          details: { reason: 'result_task_context_invalid', taskId: input.taskId, checkpointId: input.checkpointId }
        });
      }
      const validation = validateAgentResult(input.result, {
        taskId: task.taskId,
        agentId: task.agentId,
        attemptId: task.currentAttemptId,
        contractSnapshot: task.contractSnapshot,
        executionPlanSnapshot: task.executionPlanSnapshot
      });
      if (!validation.ok) throw new ChatAgentDelegationError(validation.error);
      const occurredAt = dependencies.now();
      const checkpoint = dependencies.store.recordTaskResult({
        taskId: task.taskId,
        checkpointId: input.checkpointId,
        toolCallId: task.toolCallId,
        result: structuredClone(validation.result),
        resultHash: validation.resultHash,
        occurredAt
      });
      if (checkpoint.status === 'cancelled') {
        finishCancellation(checkpoint);
        publishCheckpointSnapshot(checkpoint);
        return checkpoint;
      }
      publishCheckpointSnapshot(checkpoint);
      if (checkpoint.status !== 'ready_to_resume') return checkpoint;

      const readyOutbox = findReadyOutbox(checkpoint);
      queueOutbox(readyOutbox);
      return checkpoint;
    },

    claimPrimaryResume,

    resumePrimary,

    listActive,

    listConfirmations,

    resolveConfirmation,

    cancelCheckpoint,

    cancelInternal(checkpointId: string, reason: string): ChatAgentCheckpointSnapshot {
      return cancelWithReason(checkpointId, reason);
    },

    getContinuationContext(checkpointId: string): ContinuationRuntimeContext | undefined {
      const context = continuationContexts.get(checkpointId);
      return context ? structuredClone(context) : undefined;
    },

    interruptUnrecoverableCheckpoints(): number {
      const activeBeforeInterrupt = dependencies.store.listActive();
      const interruptedCount = dependencies.store.interruptActive({
        code: 'runtime_interrupted',
        phase: 'recovery',
        category: 'runtime',
        retryable: false,
        message: '主进程重启后不自动恢复模型执行',
        details: { reason: 'process_restart' }
      });
      const survivors = dependencies.store.listActive();
      const survivorIds = new Set(survivors.map((snapshot): string => snapshot.checkpoint.checkpointId));
      activeBeforeInterrupt.forEach((snapshot): void => {
        if (!survivorIds.has(snapshot.checkpoint.checkpointId)) {
          dependencies.budgetLedger?.releaseCheckpoint(snapshot.checkpoint.checkpointId);
        }
      });

      // 只有已被 Store 收敛为终态的 Checkpoint 可以释放旧 fence。
      fenceHandles.forEach((handle, checkpointId): void => {
        if (survivorIds.has(checkpointId)) return;
        handle.release();
        fenceHandles.delete(checkpointId);
      });
      continuationContexts.clear();

      // journal 阻塞的 survivor 必须继续持有或重建 fence，但绝不恢复易失 Runtime 上下文。
      survivors.forEach((snapshot): void => {
        const { checkpoint } = snapshot;
        const scope = getSessionHistoryScope(checkpoint.sessionId);
        const existingFence = dependencies.locks.getContinuationFence(scope);
        if (existingFence) {
          if (existingFence.checkpointId !== checkpoint.checkpointId) {
            throw createFenceError(checkpoint.checkpointId, 'startup_survivor_fence_conflict');
          }
          return;
        }

        const fence = dependencies.locks.acquireContinuationFence({
          scope,
          checkpointId: checkpoint.checkpointId
        });
        if (!fence) {
          throw createFenceError(checkpoint.checkpointId, 'startup_survivor_fence_conflict');
        }
        fenceHandles.set(checkpoint.checkpointId, fence);
      });
      return interruptedCount;
    },

    async drainOutbox(): Promise<void> {
      const pending = dependencies.store.listPendingOutbox();
      await pending.reduce((previous, outbox): Promise<void> => previous.then((): Promise<void> => deliverOutbox(outbox)), Promise.resolve());
    }
  };
}

/** 与聊天消息共享 SQLite 事务域的默认 Agent Store 适配器。 */
const agentStoreDatabase: AgentStoreDatabase = {
  execute(sql: string, params: readonly unknown[] = []): { changes: number; lastInsertRowid: number | bigint } {
    return dbExecute(sql, [...params]);
  },
  select<T>(sql: string, params: readonly unknown[] = []): T[] {
    return dbSelect<T>(sql, [...params]);
  },
  transaction<T>(operation: () => T): T {
    return transaction(operation);
  }
};

/**
 * 向全部应用窗口发布内部 delegation.created 投影事件。
 * @param eventType - 事件类型
 * @param payload - allowlist payload
 */
function publishDelegation(eventType: 'delegation.created' | 'delegation.ready', payload: AgentDelegationCreatedPayload | AgentDelegationReadyPayload): void {
  BrowserWindow.getAllWindows().forEach((window): void => {
    window.webContents.send('chat:agent:outbox-event', { type: eventType, payload });
  });
}

/**
 * 向全部应用窗口发布公开 Agent application event。
 * @param event - allowlist application event
 */
function publishCheckpoint(event: ChatAgentApplicationEvent): void {
  BrowserWindow.getAllWindows().forEach((window): void => {
    window.webContents.send('chat:agent:event', event);
  });
}

/**
 * 广播由 Checkpoint fence owner 终态化的 source assistant。
 * @param message - 已持久化 assistant
 * @param checkpoint - assistant 所属 Checkpoint
 */
function publishAssistant(message: ChatMessageRecord, checkpoint: AgentCheckpointRecord): void {
  BrowserWindow.getAllWindows().forEach((window): void => {
    window.webContents.send('chat:runtime:message-updated', {
      runtimeId: checkpoint.sourceRuntimeId,
      sessionId: checkpoint.sessionId,
      turnId: checkpoint.turnId,
      clientId: 'agent-continuation',
      agentId: checkpoint.primaryAgentId,
      rootRuntimeId: checkpoint.rootRuntimeId,
      message: structuredClone(message)
    });
  });
}

/** 主进程默认 Agent Store，供 Service 与 Coordinator 共享同一事实源。 */
const defaultAgentStore = createAgentDelegationStore(agentStoreDatabase);

/** 主进程默认持久化 confirmation queue。 */
const defaultConfirmationQueue = createAgentConfirmationQueue({
  store: defaultAgentStore,
  readUnifiedDiff: (reference: string): string => readFileSync(reference, 'utf8'),
  publish: publishCheckpoint,
  now: (): string => new Date().toISOString()
});

/** 主进程默认持久化 Turn/Checkpoint/Task 预算账本。 */
const defaultBudgetLedger = createAgentBudgetLedger({
  database: agentStoreDatabase,
  resolveTurnBudget: (): AgentBudgetSnapshot => DEFAULT_TURN_BUDGET,
  now: (): string => new Date().toISOString()
});

/** 主进程默认稳定 Child Actor 注册表。 */
const defaultChildRegistry = createChildActorRegistry();

/** 主进程默认 resource-scoped Child 调度器。 */
const defaultResourceScheduler = createAgentResourceScheduler();

/** 主进程默认冻结模型解析器。 */
const defaultChildModelResolver = createDefaultChatModelResolver();

/**
 * 创建并返回 Main userData 下的私有 Agent 目录。
 * @param kind - overlay 或 journal 子目录
 * @returns canonical 私有目录
 */
async function ensureAgentDirectory(kind: 'overlays' | 'journals'): Promise<string> {
  const directory = path.join(app.getPath('userData'), 'agent-runtime', kind);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  return fs.realpath(directory);
}

/** 延迟解析 userData 的默认 durable file committer。 */
const defaultFileCommitter: AgentFileCommitter = {
  async commit(input: AgentFileCommitInput): Promise<AgentFileCommitResult> {
    const journalRoot = await ensureAgentDirectory('journals');
    return createAgentFileCommitter({
      store: defaultAgentStore,
      journalRoot,
      now: (): string => new Date().toISOString(),
      createId: (): string => `journal-${nanoid()}`,
      // 生产 write flag 当前固定关闭；Task 8 接入权限恢复后才允许返回当前 write scopes。
      getPermissionScopeIds: (): readonly string[] => []
    }).commit(input);
  },
  async recover(): Promise<[]> {
    // Task 8 在启动恢复阶段接入共享 committer；Task 7 不自动重放 write journal。
    return [];
  }
};

/** 模块初始化完成后由默认内部 Outbox consumer 使用的 Coordinator。 */
let defaultCoordinator: AgentCoordinator | null = null;

/**
 * 返回当前 Main registry 中实际可执行的本地 pure-read 工具。
 * @returns 已排序的安全工具集合
 */
function listChildReadTools(): string[] {
  return [...CHILD_READ_TOOL_NAMES]
    .filter((toolName): boolean => {
      const entry = getToolRegistryEntry(toolName);
      return entry?.runtime === 'main' && entry.executionClass === 'direct' && entry.effect.effect === 'pure_read';
    })
    .sort();
}

/** 主进程默认 Child Agent 委派服务。 */
export const chatAgentDelegationService = createChatAgentDelegationService({
  store: defaultAgentStore,
  locks: chatRuntimeLocks,
  persistAssistant(message: ChatMessageRecord, ownerCheckpointId?: string): undefined {
    chatSessionManager.updateMessage(message, ownerCheckpointId);
    return undefined;
  },
  readMessages: (sessionId: string): ChatMessageRecord[] => chatSessionManager.getAllMessages(sessionId),
  publishAssistant,
  publish: publishDelegation,
  async dispatchInternal(
    eventType: 'delegation.created' | 'delegation.ready',
    payload: AgentDelegationCreatedPayload | AgentDelegationReadyPayload
  ): Promise<void> {
    if (!defaultCoordinator) throw new Error('agent_coordinator_not_initialized');
    if (eventType === 'delegation.created') {
      await defaultCoordinator.accept(payload as AgentDelegationCreatedPayload);
    }
  },
  publishCheckpoint,
  confirmationQueue: defaultConfirmationQueue,
  featureConfig: {
    enabled: process.env.TIBIS_PRIMARY_DELEGATION_ENABLED === '1',
    pureReadChildEnabled: true,
    controlledWriteChildEnabled: false,
    maxParallelReadChildren: 3
  },
  createId(kind: ChatAgentDelegationIdKind): string {
    return `${kind}-${nanoid()}`;
  },
  now: (): string => new Date().toISOString(),
  resolveReadLimits(task: AgentTaskRecord, checkpoint: AgentCheckpointRecord, context: ContinuationRuntimeContext): ChatAgentReadPlanLimits {
    if (task.checkpointId !== checkpoint.checkpointId || checkpoint.status !== 'waiting_children' || !context.workspaceRoot) {
      return resolveDefaultLimits(task, checkpoint, context);
    }
    return {
      availableToolNames: listChildReadTools(),
      permissionScopeIds: ['workspace:read'],
      budget: DEFAULT_CHILD_BUDGET
    };
  },
  budgetLedger: defaultBudgetLedger,
  async startPrimaryContinuation(input: ChatAgentPrimaryContinuationInput): Promise<ChatAgentPrimaryContinuationResult> {
    const { chatRuntimeService } = await import('../runtime/service.mjs');
    return chatRuntimeService.resumePrimary(input);
  }
});

/** 主进程默认无消息持久化 Child executor。 */
const defaultChildExecutor = createChildRuntimeExecutor({
  resolver: defaultChildModelResolver,
  streamText: aiService.streamText.bind(aiService),
  resolveWorkspaceRoot: (checkpointId: string): string | undefined => chatAgentDelegationService.getContinuationContext(checkpointId)?.workspaceRoot,
  resolveOverlayRoot: async (): Promise<string> => ensureAgentDirectory('overlays'),
  createOverlayId: (kind: 'changeset' | 'operation'): string => `${kind}-${nanoid()}`,
  calculateCost: (): AgentUsageAccounting['monetaryCost'] => ({
    currency: 'unknown',
    pricingVersion: 'unknown',
    estimated: 'unknown',
    actual: 'unknown'
  }),
  now: (): number => Date.now()
});

/** 主进程默认 Coordinator；Actor 创建和授权只消费持久化事实。 */
export const chatAgentCoordinator = createAgentCoordinator({
  listActive: () => defaultAgentStore.listActive(),
  authorizeTask: (taskId: string): AgentTaskRecord => chatAgentDelegationService.authorizeTask(taskId),
  recordPreFailure: (task: AgentTaskRecord, error: AgentTaskError): AgentCheckpointRecord => chatAgentDelegationService.recordPreFailure(task, error),
  reserveResume: (checkpointId: string, budget: AgentBudgetSnapshot): void => defaultBudgetLedger.reserveResume(checkpointId, budget),
  scheduler: defaultResourceScheduler,
  beginAttempt: (input: BeginAgentAttemptInput): AgentAttemptProjection => defaultAgentStore.beginAttempt(input),
  markAttemptRunning: (input: MarkAgentAttemptInput): AgentAttemptProjection => defaultAgentStore.markAttemptRunning(input),
  recordTaskResult: (task: AgentTaskRecord, result: ChatAgentResult): AgentCheckpointRecord =>
    chatAgentDelegationService.recordTaskResult({
      taskId: task.taskId,
      checkpointId: task.checkpointId,
      toolCallId: task.toolCallId,
      result
    }),
  settleTask: (taskId: string, usage: AgentUsageAccounting): void => defaultBudgetLedger.settleAttempt(taskId, usage),
  releaseBudget: (taskId: string): void => defaultBudgetLedger.releaseTask(taskId),
  executor: defaultChildExecutor,
  prepareChangeset: (input) => defaultAgentStore.prepareChangeset(input),
  confirmationQueue: defaultConfirmationQueue,
  getConfirmation: (confirmationId: string) => defaultAgentStore.getConfirmation(confirmationId),
  queueCommit: (input) => defaultAgentStore.queueCommit(input),
  fileCommitter: defaultFileCommitter,
  createConfirmationId: (task: AgentTaskRecord): string => `confirmation-${task.taskId}-${nanoid()}`,
  getTask: (taskId: string): AgentTaskRecord | null => defaultAgentStore.getTask(taskId),
  createRuntimeId: (task: AgentTaskRecord): string => `runtime-${task.taskId}-${nanoid()}`,
  cancelCheckpoint(checkpointId: string, reason: string): ChatAgentCheckpointSnapshot {
    if (!reason.trim()) throw new Error('agent_coordinator_cancel_reason_invalid');
    return chatAgentDelegationService.cancelInternal(checkpointId, reason);
  },
  now: (): string => new Date().toISOString(),
  registry: defaultChildRegistry
});
defaultCoordinator = chatAgentCoordinator;
