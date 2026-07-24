/**
 * @file service.mts
 * @description Child Agent 委派契约校验、原子 prepare、continuation fence 与启动恢复服务。
 */
import type { AgentCheckpointRecord, AgentDelegationStore, AgentStoreDatabase, PrepareAgentTaskInput, PrepareDelegationInput } from './types.mjs';
import type { ChatRuntimeDelegationPrepareAck, ChatRuntimeDelegationPrepareInput, ChatRuntimePrimaryContinuationContext } from '../runtime/types.mjs';
import type { ChatMessageRecord } from 'types/chat';
import type {
  AgentDelegationContinuationSnapshot,
  AgentDelegationCreatedPayload,
  AgentDelegationReadyPayload,
  ChatAgentApplicationEvent,
  ChatAgentCancelCheckpointInput,
  ChatAgentCheckpointSnapshot,
  AgentModelSnapshot,
  AgentOrderedToolCallSnapshot,
  AgentTaskError,
  ChatAgentResumePrimaryInput,
  ChatAgentResumeResult,
  DelegateTaskInput
} from 'types/chat-agent';
import type { ChatRuntimeAddress } from 'types/chat-runtime';
import { BrowserWindow } from 'electron';
import { nanoid } from 'nanoid';
import { dbExecute, dbSelect, transaction } from '../../database/service.mjs';
import { chatRuntimeLocks, getSessionHistoryScope, type RuntimeContinuationFenceHandle, type RuntimeLockRegistry } from '../runtime/infrastructure/locks.mjs';
import { finishAssistantMessageInterrupted } from '../runtime/messages/finalizer.mjs';
import { getRuntimeTaskDeadlineAt } from '../runtime/task-clock.mjs';
import { chatSessionManager } from '../service.mjs';
import {
  AGENT_CHECKPOINT_SCHEMA_VERSION,
  AGENT_FOUNDATION_POLICY_VERSION,
  hashAgentPayload,
  hashContinuationSnapshot,
  validateAgentTaskError,
  validateContinuationSnapshot,
  validateFoundationContract
} from './contracts.mjs';
import { validateAgentResult } from './result.mjs';
import { createAgentDelegationStore } from './store.mjs';

/** Runtime B 续接允许保留的非敏感内存上下文。 */
export type ContinuationRuntimeContext = ChatRuntimePrimaryContinuationContext;

/** 委派服务仅使用的 Store 最小能力。 */
export type ChatAgentDelegationStore = Pick<
  AgentDelegationStore,
  | 'prepareDelegation'
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
   * 发布已持久化的公开 Checkpoint 投影。
   * @param event - 单调 application event
   */
  publishCheckpoint: (event: ChatAgentApplicationEvent) => void;
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
   * 规范化并原子记录一个 Child 终态结果。
   * @param input - 不含 Child hash 的 Task 结果
   * @returns 最新 Checkpoint 投影
   */
  recordTaskResult(input: ChatAgentRecordTaskResultInput): ReturnType<AgentDelegationStore['recordTaskResult']>;
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
  /**
   * 持久化 cooperative cancellation 并安全终态化 source assistant。
   * @param input - 最小取消输入
   * @returns 当前公开 Checkpoint 投影
   */
  cancelCheckpoint(input: ChatAgentCancelCheckpointInput): ChatAgentCheckpointSnapshot;
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

/**
 * 创建 Child Agent 委派服务。
 * @param dependencies - 同步 Store、共享锁和事件依赖
 * @returns 委派服务
 */
export function createChatAgentDelegationService(dependencies: ChatAgentDelegationServiceDependencies): ChatAgentDelegationService {
  const continuationContexts = new Map<string, ContinuationRuntimeContext>();
  const fenceHandles = new Map<string, RuntimeContinuationFenceHandle>();

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
    // finalize 成功证明 assistant 已安全终态化；此前绝不释放 history fence。
    releaseContinuation(claimed.checkpointId);
    publishCheckpointSnapshot(finalized);
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
   * 返回所有公开非终态 Checkpoint 投影。
   * @returns 按 Store 顺序排列的 allowlist 快照
   */
  function listActive(): ChatAgentCheckpointSnapshot[] {
    return dependencies.store.listActive().map((recovery): ChatAgentCheckpointSnapshot => projectCheckpoint(recovery.checkpoint, recovery.eventSequence));
  }

  /**
   * 持久化 cooperative cancellation，并在 Store 安全终态后关闭 source assistant。
   * @param input - 最小取消输入
   * @returns 当前公开 Checkpoint
   */
  function cancelCheckpoint(input: ChatAgentCancelCheckpointInput): ChatAgentCheckpointSnapshot {
    const checkpoint = dependencies.store.cancelCheckpoint({
      checkpointId: input.checkpointId,
      reason: 'user_cancelled',
      occurredAt: dependencies.now()
    });
    if (checkpoint.status !== 'cancelled') {
      return publishCheckpointSnapshot(checkpoint);
    }

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
    // Store cancellation 与 assistant 终态都已持久化并广播后，才允许释放历史 fence。
    releaseContinuation(checkpoint.checkpointId);
    return publishCheckpointSnapshot(checkpoint);
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

      try {
        dependencies.publish('delegation.created', outboxPayload);
      } catch {
        return { prepared: true };
      }
      try {
        dependencies.store.markOutboxDelivered({ outboxId, deliveredAt: occurredAt });
      } catch {
        // 已发布但尚未确认交付的 Outbox 保持 pending，后续可按 dedupeKey 重放。
      }
      return { prepared: true };
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
      publishCheckpointSnapshot(checkpoint);
      if (checkpoint.status !== 'ready_to_resume') return checkpoint;

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
      if (readyOutbox.deliveryStatus === 'delivered') return checkpoint;
      try {
        dependencies.publish(readyOutbox.eventType, readyOutbox.payload);
      } catch {
        return checkpoint;
      }
      try {
        dependencies.store.markOutboxDelivered({ outboxId: readyOutbox.outboxId, deliveredAt: occurredAt });
      } catch {
        // 已发布但尚未确认交付的 ready Outbox 保持 pending，按 dedupeKey 安全重放。
      }
      return checkpoint;
    },

    claimPrimaryResume,

    resumePrimary,

    listActive,

    cancelCheckpoint,

    getContinuationContext(checkpointId: string): ContinuationRuntimeContext | undefined {
      const context = continuationContexts.get(checkpointId);
      return context ? structuredClone(context) : undefined;
    },

    interruptUnrecoverableCheckpoints(): number {
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
 * 向全部应用窗口发布公开 Checkpoint 投影。
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

/** 主进程默认 Child Agent 委派服务。 */
export const chatAgentDelegationService = createChatAgentDelegationService({
  store: createAgentDelegationStore(agentStoreDatabase),
  locks: chatRuntimeLocks,
  persistAssistant(message: ChatMessageRecord, ownerCheckpointId?: string): undefined {
    chatSessionManager.updateMessage(message, ownerCheckpointId);
    return undefined;
  },
  readMessages: (sessionId: string): ChatMessageRecord[] => chatSessionManager.getAllMessages(sessionId),
  publishAssistant,
  publish: publishDelegation,
  publishCheckpoint,
  createId(kind: ChatAgentDelegationIdKind): string {
    return `${kind}-${nanoid()}`;
  },
  now: (): string => new Date().toISOString(),
  async startPrimaryContinuation(input: ChatAgentPrimaryContinuationInput): Promise<ChatAgentPrimaryContinuationResult> {
    const { chatRuntimeService } = await import('../runtime/service.mjs');
    return chatRuntimeService.resumePrimary(input);
  }
});
