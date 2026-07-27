/**
 * @file child-registry.mts
 * @description 在主进程中分离稳定 Child Actor 身份与可替换 Runtime 实例绑定。
 */
import type { AgentTaskRecord } from './types.mjs';
import type { AgentTaskError } from 'types/chat-agent';
import type { ChatRuntimeAddress } from 'types/chat-runtime';
import { validateAgentTaskError } from './contracts.mjs';

/** 稳定 Child Actor 句柄；Runtime 解绑不会删除该身份。 */
export interface ChildActorHandle {
  /** Actor 所属 Task。 */
  readonly taskId: string;
  /** 稳定 Child Actor ID。 */
  readonly agentId: string;
  /** 所属 Session。 */
  readonly sessionId: string;
  /** 所属 Turn。 */
  readonly turnId: string;
  /** Primary Actor。 */
  readonly parentAgentId: string;
  /** Turn 根 Runtime。 */
  readonly rootRuntimeId: string;
  /** 首次授权冻结的 Execution Plan hash。 */
  readonly planHash: string;
  /** cooperative abort 的结构化原因。 */
  readonly abortReason?: AgentTaskError;
}

/** Registry 内部唯一允许更新 abortReason 的 Actor 投影。 */
interface MutableChildActor extends Omit<ChildActorHandle, 'abortReason'> {
  /** cooperative abort 的结构化原因。 */
  abortReason?: AgentTaskError;
}

/** 一个具体 Child Runtime 的易失绑定。 */
export interface ChildRuntimeBinding {
  /** Runtime 所属稳定 Task。 */
  readonly taskId: string;
  /** 完整路由与 lineage 地址。 */
  readonly address: Readonly<ChatRuntimeAddress>;
  /** Runtime 必须执行的冻结计划 hash。 */
  readonly planHash: string;
}

/** Child Actor 与 Runtime 注册表边界。 */
export interface ChildActorRegistry {
  /**
   * 幂等注册一个稳定 Child Actor。
   * @param task - 已持久化 Task 投影
   * @returns 同一 Task 的稳定 Actor 句柄
   */
  ensureActor(task: AgentTaskRecord): ChildActorHandle;
  /**
   * 把一个完整 Runtime 地址绑定到已注册 Actor。
   * @param address - 完整 Child Runtime 地址
   * @param planHash - 冻结执行计划 hash
   */
  bindRuntime(address: ChatRuntimeAddress, planHash: string): void;
  /**
   * 解绑可替换 Runtime，但保留稳定 Actor。
   * @param runtimeId - Runtime 身份
   */
  unbindRuntime(runtimeId: string): void;
  /**
   * 标记稳定 Actor 已收到 cooperative abort。
   * @param taskId - Actor 所属 Task
   * @param reason - 结构化取消原因
   */
  abortTask(taskId: string, reason: AgentTaskError): void;
  /**
   * 读取稳定 Actor。
   * @param taskId - Actor 所属 Task
   * @returns Actor，不存在时为 undefined
   */
  getActor(taskId: string): ChildActorHandle | undefined;
  /**
   * 读取具体 Runtime 绑定。
   * @param runtimeId - Runtime 身份
   * @returns Runtime 绑定，不存在时为 undefined
   */
  getRuntime(runtimeId: string): ChildRuntimeBinding | undefined;
}

/**
 * 创建包含稳定机器原因的 Registry 错误。
 * @param reason - 稳定原因
 * @returns 可被 Coordinator 捕获的错误
 */
function createRegistryError(reason: string): Error {
  const error = new Error(reason);
  error.name = 'ChildActorRegistryError';
  return error;
}

/**
 * 判断已有 Actor 与新 Task 的不可变身份是否一致。
 * @param actor - 已注册 Actor
 * @param task - 新读取的 Task 投影
 * @returns 身份是否完全一致
 */
function matchesActor(actor: ChildActorHandle, task: AgentTaskRecord): boolean {
  return (
    actor.taskId === task.taskId &&
    actor.agentId === task.agentId &&
    actor.sessionId === task.sessionId &&
    actor.turnId === task.turnId &&
    actor.parentAgentId === task.parentAgentId &&
    actor.rootRuntimeId === task.rootRuntimeId &&
    actor.planHash === task.executionPlanSnapshotHash
  );
}

/**
 * 判断 Runtime 地址是否是同一条不可变路由与 lineage。
 * @param left - 已绑定地址
 * @param right - 重放地址
 * @returns 是否完全一致
 */
function matchesAddress(left: Readonly<ChatRuntimeAddress>, right: ChatRuntimeAddress): boolean {
  return (
    left.sessionId === right.sessionId &&
    left.turnId === right.turnId &&
    left.agentId === right.agentId &&
    left.runtimeId === right.runtimeId &&
    left.parentAgentId === right.parentAgentId &&
    left.parentRuntimeId === right.parentRuntimeId &&
    left.rootRuntimeId === right.rootRuntimeId &&
    left.continuationOfRuntimeId === right.continuationOfRuntimeId
  );
}

/**
 * 创建一个进程内 Child Actor Registry。
 * @returns 空 Registry
 */
export function createChildActorRegistry(): ChildActorRegistry {
  const actorsByTask = new Map<string, MutableChildActor>();
  const taskByAgent = new Map<string, string>();
  const runtimes = new Map<string, ChildRuntimeBinding>();
  const runtimeByTask = new Map<string, string>();

  return {
    ensureActor(task: AgentTaskRecord): ChildActorHandle {
      if (!task.taskId || !task.agentId || !task.executionPlanSnapshotHash || task.recordState !== 'active') {
        throw createRegistryError('actor_task_invalid');
      }
      const existing = actorsByTask.get(task.taskId);
      if (existing) {
        if (!matchesActor(existing, task)) throw createRegistryError('actor_identity_conflict');
        return existing;
      }
      const ownedTaskId = taskByAgent.get(task.agentId);
      if (ownedTaskId && ownedTaskId !== task.taskId) {
        throw createRegistryError('actor_identity_conflict');
      }
      const actor: MutableChildActor = {
        taskId: task.taskId,
        agentId: task.agentId,
        sessionId: task.sessionId,
        turnId: task.turnId,
        parentAgentId: task.parentAgentId,
        rootRuntimeId: task.rootRuntimeId,
        planHash: task.executionPlanSnapshotHash
      };
      actorsByTask.set(task.taskId, actor);
      taskByAgent.set(task.agentId, task.taskId);
      return actor;
    },

    bindRuntime(address: ChatRuntimeAddress, planHash: string): void {
      const taskId = taskByAgent.get(address.agentId);
      const actor = taskId ? actorsByTask.get(taskId) : undefined;
      if (!actor) throw createRegistryError('actor_not_registered');
      if (actor.abortReason) throw createRegistryError('actor_aborted');
      if (
        !planHash ||
        planHash !== actor.planHash ||
        actor.sessionId !== address.sessionId ||
        actor.turnId !== address.turnId ||
        actor.agentId !== address.agentId ||
        actor.parentAgentId !== address.parentAgentId ||
        actor.rootRuntimeId !== address.rootRuntimeId ||
        !address.parentRuntimeId
      ) {
        throw createRegistryError('runtime_address_mismatch');
      }
      const existingRuntime = runtimes.get(address.runtimeId);
      if (existingRuntime) {
        if (existingRuntime.taskId === actor.taskId && existingRuntime.planHash === planHash && matchesAddress(existingRuntime.address, address)) return;
        throw createRegistryError('runtime_binding_conflict');
      }
      if (runtimeByTask.has(actor.taskId)) {
        throw createRegistryError('runtime_binding_conflict');
      }
      const binding: ChildRuntimeBinding = Object.freeze({
        taskId: actor.taskId,
        address: Object.freeze(structuredClone(address)),
        planHash
      });
      runtimes.set(address.runtimeId, binding);
      runtimeByTask.set(actor.taskId, address.runtimeId);
    },

    unbindRuntime(runtimeId: string): void {
      const binding = runtimes.get(runtimeId);
      if (!binding) return;
      runtimes.delete(runtimeId);
      runtimeByTask.delete(binding.taskId);
    },

    abortTask(taskId: string, reason: AgentTaskError): void {
      const actor = actorsByTask.get(taskId);
      const validated = validateAgentTaskError(reason);
      if (!actor) throw createRegistryError('actor_not_registered');
      if (!validated) throw createRegistryError('actor_abort_reason_invalid');
      actor.abortReason = Object.freeze(structuredClone(validated));
      const runtimeId = runtimeByTask.get(taskId);
      if (runtimeId) {
        runtimes.delete(runtimeId);
        runtimeByTask.delete(taskId);
      }
    },

    getActor(taskId: string): ChildActorHandle | undefined {
      return actorsByTask.get(taskId);
    },

    getRuntime(runtimeId: string): ChildRuntimeBinding | undefined {
      return runtimes.get(runtimeId);
    }
  };
}
