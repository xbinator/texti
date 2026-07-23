/**
 * @file service.mts
 * @description Child Agent 委派契约校验、原子 prepare、continuation fence 与启动恢复服务。
 */
import type { AgentDelegationStore, AgentStoreDatabase, PrepareAgentTaskInput, PrepareDelegationInput } from './types.mjs';
import type { ChatRuntimeDelegationPrepareAck, ChatRuntimeDelegationPrepareInput } from '../runtime/types.mjs';
import type { ChatMessageRecord } from 'types/chat';
import type {
  AgentDelegationContinuationSnapshot,
  AgentDelegationCreatedPayload,
  AgentModelSnapshot,
  AgentOrderedToolCallSnapshot,
  AgentTaskError,
  DelegateTaskInput
} from 'types/chat-agent';
import type { ChatRuntimeCapabilityDescriptor, ChatRuntimeContext } from 'types/chat-runtime';
import { BrowserWindow } from 'electron';
import { nanoid } from 'nanoid';
import { dbExecute, dbSelect, transaction } from '../../database/service.mjs';
import { chatRuntimeLocks, getSessionHistoryScope, type RuntimeContinuationFenceHandle, type RuntimeLockRegistry } from '../runtime/infrastructure/locks.mjs';
import { getRuntimeTaskDeadlineAt } from '../runtime/task-clock.mjs';
import { chatSessionManager } from '../service.mjs';
import {
  AGENT_CHECKPOINT_SCHEMA_VERSION,
  AGENT_FOUNDATION_POLICY_VERSION,
  hashAgentPayload,
  hashContinuationSnapshot,
  validateContinuationSnapshot,
  validateFoundationContract
} from './contracts.mjs';
import { createAgentDelegationStore } from './store.mjs';

/** Runtime B 续接允许保留的非敏感内存上下文。 */
export interface ContinuationRuntimeContext {
  /** Renderer 路由客户端。 */
  readonly clientId: string;
  /** 冻结模型身份，不含 Provider 凭据。 */
  readonly modelSnapshot: AgentModelSnapshot;
  /** 可选上下文窗口。 */
  readonly contextWindow?: number;
  /** 可选系统提示。 */
  readonly system?: string;
  /** 可选工作区根目录。 */
  readonly workspaceRoot?: string;
  /** Renderer 能力描述符。 */
  readonly capabilities?: ChatRuntimeCapabilityDescriptor;
  /** 当前启用 Skill 的内容版本。 */
  readonly skillContentHashes?: Readonly<Record<string, string>>;
  /** 当前 Turn 的临时上下文。 */
  readonly runtimeContext?: ChatRuntimeContext;
}

/** 委派服务仅使用的 Store 最小能力。 */
export type ChatAgentDelegationStore = Pick<
  AgentDelegationStore,
  'prepareDelegation' | 'interruptCheckpoint' | 'interruptActive' | 'listActive' | 'markOutboxDelivered'
>;

/** 委派服务稳定 ID 域。 */
export type ChatAgentDelegationIdKind = 'task' | 'child' | 'outbox' | 'continuation';

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
  persistAssistant: (message: ChatMessageRecord) => undefined;
  /**
   * 发布已持久化 Outbox 事件。
   * @param eventType - 事件类型
   * @param payload - allowlist payload
   */
  publish: (eventType: 'delegation.created', payload: AgentDelegationCreatedPayload) => void;
  /**
   * 创建稳定身份。
   * @param kind - 身份域
   * @param index - 同一 prepare 内从一开始的序号
   * @returns 新身份
   */
  createId: (kind: ChatAgentDelegationIdKind, index?: number) => string;
  /** @returns 当前 ISO-8601 时间。 */
  now: () => string;
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
 * 创建 Child Agent 委派服务。
 * @param dependencies - 同步 Store、共享锁和事件依赖
 * @returns 委派服务
 */
export function createChatAgentDelegationService(dependencies: ChatAgentDelegationServiceDependencies): ChatAgentDelegationService {
  const continuationContexts = new Map<string, ContinuationRuntimeContext>();
  const fenceHandles = new Map<string, RuntimeContinuationFenceHandle>();

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
function publishDelegation(eventType: 'delegation.created', payload: AgentDelegationCreatedPayload): void {
  BrowserWindow.getAllWindows().forEach((window): void => {
    window.webContents.send('chat:agent:event', { type: eventType, payload });
  });
}

/** 主进程默认 Child Agent 委派服务。 */
export const chatAgentDelegationService = createChatAgentDelegationService({
  store: createAgentDelegationStore(agentStoreDatabase),
  locks: chatRuntimeLocks,
  persistAssistant(message: ChatMessageRecord): undefined {
    chatSessionManager.updateMessage(message);
    return undefined;
  },
  publish: publishDelegation,
  createId(kind: ChatAgentDelegationIdKind): string {
    return `${kind}-${nanoid()}`;
  },
  now: (): string => new Date().toISOString()
});
