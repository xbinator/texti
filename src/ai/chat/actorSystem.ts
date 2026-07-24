/**
 * @file actorSystem.ts
 * @description 应用级 Chat Supervisor、Runtime 能力和 Session UI 事件外观。
 */
import type { SessionMachineEvent } from './machine/sessionMachine';
import type { ChatActorAddress } from './types';
import type { ChatAgentCheckpointSnapshot } from 'types/chat-agent';
import type { ChatRuntimeRecoverySnapshot } from 'types/chat-runtime';
import type { ActorRefFrom } from 'xstate';
import { createActor } from 'xstate';
import { supervisorMachine, type SupervisorMachineEvent } from './machine/supervisorMachine';
import { createRuntimeCapabilityRegistry, type RuntimeExecutionCapabilities } from './runtimeCapabilities';
import { createChatSessionEventBus, type ChatSessionUIEvent, type ChatSessionUIEventListener } from './sessionEvents';

/**
 * Runtime 恢复协议错误。
 */
export class ChatActorProtocolError extends Error {
  /** 稳定错误码。 */
  readonly code = 'protocol_error';

  /**
   * 创建恢复协议错误。
   * @param message - 协议错误详情
   */
  constructor(message: string) {
    super(`protocol_error: ${message}`);
    this.name = 'ChatActorProtocolError';
  }
}

/**
 * 从主进程恢复快照提取不可变 Runtime 地址。
 * @param snapshot - 主进程恢复快照
 * @returns 完整 Runtime 地址
 */
function createRecoveryAddress(snapshot: ChatRuntimeRecoverySnapshot): ChatActorAddress {
  return {
    sessionId: snapshot.sessionId,
    turnId: snapshot.turnId,
    agentId: snapshot.agentId,
    runtimeId: snapshot.runtimeId,
    parentAgentId: snapshot.parentAgentId,
    parentRuntimeId: snapshot.parentRuntimeId,
    rootRuntimeId: snapshot.rootRuntimeId,
    continuationOfRuntimeId: snapshot.continuationOfRuntimeId
  };
}

/**
 * 判断两个 Runtime 地址是否属于完全相同的不可变身份。
 * @param left - 已注册地址
 * @param right - 恢复地址
 * @returns 所有身份字段是否一致
 */
function isSameRuntimeAddress(left: ChatActorAddress, right: ChatActorAddress): boolean {
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
 * 从 allowlist Checkpoint 投影派生 Primary Runtime B 地址。
 * @param snapshot - 主进程权威 Checkpoint 投影
 * @param runtimeId - 已 CAS 或即将 CAS 的 Runtime B
 * @returns 不含 renderer 自报能力的完整地址
 */
export function createResumeAddress(snapshot: ChatAgentCheckpointSnapshot, runtimeId: string): ChatActorAddress {
  return {
    sessionId: snapshot.sessionId,
    turnId: snapshot.turnId,
    agentId: snapshot.primaryAgentId,
    runtimeId,
    parentRuntimeId: snapshot.sourceRuntimeId,
    rootRuntimeId: snapshot.rootRuntimeId,
    continuationOfRuntimeId: snapshot.sourceRuntimeId
  };
}

/**
 * 应用级 Chat Actor system。
 */
export interface ChatActorSystem {
  /** Supervisor actor */
  actor: ActorRefFrom<typeof supervisorMachine>;
  /** 启动 Actor system */
  start: () => void;
  /** 停止 Actor system */
  stop: () => void;
  /** 确保 Session actor 存在 */
  ensureSession: (sessionId: string) => NonNullable<ReturnType<ChatActorSystem['getSession']>>;
  /** 读取 Session actor */
  getSession: (
    sessionId: string
  ) => ReturnType<ActorRefFrom<typeof supervisorMachine>['getSnapshot']>['context']['sessions'] extends Map<string, infer TSession>
    ? TSession | undefined
    : never;
  /** 向 Supervisor 发送领域事件 */
  send: (event: SupervisorMachineEvent) => void;
  /** 向 Session 发送领域事件 */
  sendToSession: (sessionId: string, event: SessionMachineEvent) => void;
  /** 注册 Runtime 地址和 renderer 能力 */
  registerRuntime: (address: ChatActorAddress, capabilities: RuntimeExecutionCapabilities) => void;
  /** 从主进程快照恢复 Runtime 地址、Actor 与 renderer 能力 */
  recoverRuntime: (snapshot: ChatRuntimeRecoverySnapshot, capabilities: RuntimeExecutionCapabilities) => void;
  /** 从公开 Checkpoint 快照恢复或推进等待 Child 的 Actor 投影。 */
  recoverDelegation: (snapshot: ChatAgentCheckpointSnapshot) => void;
  /** 注销 Runtime 地址和 renderer 能力 */
  unregisterRuntime: (runtimeId: string) => void;
  /** 读取 Runtime renderer 能力 */
  getRuntimeCapabilities: (runtimeId: string) => RuntimeExecutionCapabilities | undefined;
  /** 订阅 Session UI 事件 */
  subscribeSessionEvents: (sessionId: string, listener: ChatSessionUIEventListener) => () => void;
  /** 发布 Session UI 事件 */
  emitSessionEvent: (sessionId: string, event: ChatSessionUIEvent) => void;
  /** 判断 Session 是否有可见 UI 订阅 */
  hasSessionUISubscribers: (sessionId: string) => boolean;
  /** 清除已处理的 Session 待确认交互 */
  clearSessionPendingInteraction: (sessionId: string, confirmationId: string) => void;
}

/**
 * 创建应用级 Chat Actor system。
 * @returns Chat Actor system
 */
export function createChatActorSystem(): ChatActorSystem {
  const actor = createActor(supervisorMachine);
  const capabilityRegistry = createRuntimeCapabilityRegistry();
  const sessionEventBus = createChatSessionEventBus();

  return {
    actor,
    start(): void {
      actor.start();
    },
    stop(): void {
      actor.stop();
      capabilityRegistry.clear();
      sessionEventBus.clear();
    },
    ensureSession(sessionId: string) {
      actor.send({ type: 'supervisor.ensureSession', sessionId });
      const sessionRef = actor.getSnapshot().context.sessions.get(sessionId);
      if (!sessionRef) {
        throw new Error(`Failed to create chat session actor: ${sessionId}`);
      }
      return sessionRef;
    },
    getSession(sessionId: string) {
      return actor.getSnapshot().context.sessions.get(sessionId);
    },
    send(event: SupervisorMachineEvent): void {
      actor.send(event);
    },
    sendToSession(sessionId: string, event: SessionMachineEvent): void {
      actor.send({ type: 'supervisor.sendToSession', sessionId, event });
    },
    registerRuntime(address: ChatActorAddress, capabilities: RuntimeExecutionCapabilities): void {
      const existingAddress = actor.getSnapshot().context.runtimeRoutes.get(address.runtimeId);
      if (existingAddress && !isSameRuntimeAddress(existingAddress, address)) {
        actor.send({ type: 'runtime.register', address });
        throw new ChatActorProtocolError(`Runtime ${address.runtimeId} address conflicts with the registered route`);
      }
      actor.send({ type: 'runtime.register', address });
      capabilityRegistry.register(address.runtimeId, capabilities);
    },
    recoverRuntime(snapshot: ChatRuntimeRecoverySnapshot, capabilities: RuntimeExecutionCapabilities): void {
      const recoveryAddress = createRecoveryAddress(snapshot);
      const sessionRef = this.ensureSession(snapshot.sessionId);
      const sessionSnapshot = sessionRef.getSnapshot();
      const activeTurnId = sessionSnapshot.context.turnRef?.getSnapshot().context.turnId;
      if (!sessionSnapshot.matches('idle') && activeTurnId !== snapshot.turnId) {
        throw new ChatActorProtocolError(`Session ${snapshot.sessionId} already owns active Turn ${activeTurnId ?? 'unknown'} instead of ${snapshot.turnId}`);
      }
      const existingAddress = actor.getSnapshot().context.runtimeRoutes.get(snapshot.runtimeId);
      if (existingAddress) {
        if (!isSameRuntimeAddress(existingAddress, recoveryAddress)) {
          throw new ChatActorProtocolError(`Runtime ${snapshot.runtimeId} recovery address does not match the registered route`);
        }
        return;
      }

      if (sessionSnapshot.matches('idle')) {
        sessionRef.send({ type: 'session.recoverRuntime', snapshot });
      }
      const { turnRef } = sessionRef.getSnapshot().context;
      const turnId = turnRef?.getSnapshot().context.turnId;
      if (!turnId) {
        throw new ChatActorProtocolError(`Runtime ${snapshot.runtimeId} recovery did not create a Turn`);
      }
      if (turnId !== snapshot.turnId) {
        throw new ChatActorProtocolError(`Runtime ${snapshot.runtimeId} recovery resolved unexpected Turn ${turnId}`);
      }

      this.registerRuntime(recoveryAddress, capabilities);
    },
    recoverDelegation(snapshot: ChatAgentCheckpointSnapshot): void {
      const sessionRef = this.ensureSession(snapshot.sessionId);
      const sessionSnapshot = sessionRef.getSnapshot();
      const activeTurnId = sessionSnapshot.context.turnRef?.getSnapshot().context.turnId;
      const activeCheckpointId = sessionSnapshot.context.checkpointId;
      if (!sessionSnapshot.matches('idle') && activeTurnId !== snapshot.turnId) {
        throw new ChatActorProtocolError(
          `Session ${snapshot.sessionId} already owns active Turn ${activeTurnId ?? 'unknown'} instead of delegated Turn ${snapshot.turnId}`
        );
      }
      if (activeCheckpointId && activeCheckpointId !== snapshot.checkpointId) {
        throw new ChatActorProtocolError(`Session ${snapshot.sessionId} already owns Checkpoint ${activeCheckpointId} instead of ${snapshot.checkpointId}`);
      }
      if (['completed', 'failed', 'cancelled', 'interrupted'].includes(snapshot.status)) {
        if (sessionSnapshot.matches('idle')) return;
        if (snapshot.status === 'completed') {
          sessionRef.send({ type: 'session.checkpointCompleted', checkpointId: snapshot.checkpointId });
        } else if (snapshot.status === 'failed') {
          sessionRef.send({
            type: 'session.checkpointFailed',
            checkpointId: snapshot.checkpointId,
            error: { code: 'runtime_failed', message: 'Primary continuation failed' }
          });
        } else if (snapshot.status === 'cancelled') {
          sessionRef.send({ type: 'session.checkpointCancelled', checkpointId: snapshot.checkpointId });
        } else if (snapshot.status === 'interrupted') {
          sessionRef.send({ type: 'session.checkpointInterrupted', checkpointId: snapshot.checkpointId });
        }
        return;
      }
      if (sessionSnapshot.matches('idle')) {
        sessionRef.send({ type: 'session.recoverDelegation', snapshot });
        return;
      }
      if (!activeCheckpointId && ['waiting_children', 'ready_to_resume', 'cancelling'].includes(snapshot.status)) {
        sessionRef.send({
          type: 'session.waitingChildren',
          checkpointId: snapshot.checkpointId,
          runtimeId: snapshot.sourceRuntimeId
        });
      }
      if (snapshot.status === 'resuming' && snapshot.resumeRuntimeId) {
        sessionRef.send({
          type: 'session.resumeStarted',
          checkpointId: snapshot.checkpointId,
          runtimeId: snapshot.resumeRuntimeId
        });
      } else if (snapshot.status === 'cancelling') {
        sessionRef.send({ type: 'session.cancelRequested' });
      }
    },
    unregisterRuntime(runtimeId: string): void {
      actor.send({ type: 'runtime.unregister', runtimeId });
      capabilityRegistry.delete(runtimeId);
    },
    getRuntimeCapabilities(runtimeId: string): RuntimeExecutionCapabilities | undefined {
      return capabilityRegistry.get(runtimeId);
    },
    subscribeSessionEvents(sessionId: string, listener: ChatSessionUIEventListener): () => void {
      return sessionEventBus.subscribe(sessionId, listener);
    },
    emitSessionEvent(sessionId: string, event: ChatSessionUIEvent): void {
      sessionEventBus.emit(sessionId, event);
    },
    hasSessionUISubscribers(sessionId: string): boolean {
      return sessionEventBus.hasSubscribers(sessionId);
    },
    clearSessionPendingInteraction(sessionId: string, confirmationId: string): void {
      sessionEventBus.clearPendingInteraction(sessionId, confirmationId);
    }
  };
}
