/**
 * @file supervisorMachine.ts
 * @description 多会话 Chat Session Actor 管理与 Runtime 事件路由。
 */
import type { ChatActorAddress } from '../types';
import type { AgentMachineEvent } from './agentMachine';
import type { ActorRefFrom } from 'xstate';
import { assign, enqueueActions, setup, stopChild } from 'xstate';
import { sessionMachine, type SessionMachineEvent } from './sessionMachine';

/** Runtime 可路由到 Agent 的事件。 */
type RuntimeAgentEvent = Extract<AgentMachineEvent, { runtimeId: string }>;

/**
 * Supervisor context。
 */
export interface SupervisorMachineContext {
  /** Session ID 到 Session actor */
  sessions: Map<string, ActorRefFrom<typeof sessionMachine>>;
  /** Runtime ID 到完整 Actor 地址 */
  runtimeRoutes: Map<string, ChatActorAddress>;
  /** 检测到身份冲突并拒绝覆盖的 Runtime ID。 */
  routeConflicts: Set<string>;
}

/**
 * Supervisor 领域事件。
 */
export type SupervisorMachineEvent =
  | { type: 'supervisor.ensureSession'; sessionId: string }
  | { type: 'supervisor.removeSession'; sessionId: string }
  | { type: 'supervisor.sendToSession'; sessionId: string; event: SessionMachineEvent }
  | { type: 'runtime.register'; address: ChatActorAddress }
  | { type: 'runtime.unregister'; runtimeId: string }
  | { type: 'runtime.event'; runtimeId: string; event: RuntimeAgentEvent };

/** 由 Supervisor 父级停止待删除的 Session child。 */
const stopRemovedSession = stopChild<SupervisorMachineContext, SupervisorMachineEvent, undefined, SupervisorMachineEvent>(({ context, event }) => {
  if (event.type !== 'supervisor.removeSession') {
    throw new Error(`Unexpected event for Session removal: ${event.type}`);
  }

  const sessionRef = context.sessions.get(event.sessionId);
  if (!sessionRef) {
    throw new Error(`Chat Session actor does not exist: ${event.sessionId}`);
  }

  return sessionRef;
});

/**
 * 从路由地址查找目标 Agent actor。
 * @param context - Supervisor context
 * @param address - Runtime Actor 地址
 * @returns 目标 Agent actor
 */
function findAddressedAgent(context: SupervisorMachineContext, address: ChatActorAddress) {
  const sessionRef = context.sessions.get(address.sessionId);
  const turnRef = sessionRef?.getSnapshot().context.turnRef;
  if (!turnRef || turnRef.getSnapshot().context.turnId !== address.turnId) {
    return undefined;
  }

  return address.agentId === 'primary' ? turnRef.getSnapshot().context.primaryAgentRef : undefined;
}

/**
 * 比较完整 Runtime Actor 地址，避免相同 Runtime ID 被改绑到其他资源域。
 * @param left - 已持久化路由
 * @param right - 新注册路由
 * @returns 是否为同一不可变地址
 */
function isSameAddress(left: ChatActorAddress, right: ChatActorAddress): boolean {
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
 * 多会话 Supervisor machine。
 */
export const supervisorMachine = setup({
  types: {
    context: {} as SupervisorMachineContext,
    events: {} as SupervisorMachineEvent
  },
  actors: {
    sessionMachine
  },
  guards: {
    hasSessionToRemove: ({ context, event }): boolean => event.type === 'supervisor.removeSession' && context.sessions.has(event.sessionId)
  },
  actions: {
    ensureSession: assign({
      sessions: ({ context, event, spawn }): Map<string, ActorRefFrom<typeof sessionMachine>> => {
        if (event.type !== 'supervisor.ensureSession' || context.sessions.has(event.sessionId)) {
          return context.sessions;
        }

        const sessions = new Map(context.sessions);
        sessions.set(
          event.sessionId,
          spawn('sessionMachine', {
            id: `session-${event.sessionId}`,
            input: { sessionId: event.sessionId }
          })
        );
        return sessions;
      }
    }),
    removeSession: assign({
      sessions: ({ context, event }): Map<string, ActorRefFrom<typeof sessionMachine>> => {
        if (event.type !== 'supervisor.removeSession') {
          return context.sessions;
        }

        const sessions = new Map(context.sessions);
        sessions.delete(event.sessionId);
        return sessions;
      },
      runtimeRoutes: ({ context, event }): Map<string, ChatActorAddress> => {
        if (event.type !== 'supervisor.removeSession') {
          return context.runtimeRoutes;
        }

        return new Map([...context.runtimeRoutes].filter(([, address]): boolean => address.sessionId !== event.sessionId));
      },
      routeConflicts: ({ context, event }): Set<string> => {
        if (event.type !== 'supervisor.removeSession') {
          return context.routeConflicts;
        }

        const routeConflicts = new Set(context.routeConflicts);
        context.runtimeRoutes.forEach((address, runtimeId): void => {
          if (address.sessionId === event.sessionId) routeConflicts.delete(runtimeId);
        });
        return routeConflicts;
      }
    }),
    sendToSession: enqueueActions(({ context, event, enqueue }): void => {
      if (event.type !== 'supervisor.sendToSession') return;
      const sessionRef = context.sessions.get(event.sessionId);
      if (sessionRef) enqueue.sendTo(sessionRef, event.event);
    }),
    registerRuntime: assign({
      runtimeRoutes: ({ context, event }): Map<string, ChatActorAddress> => {
        if (event.type !== 'runtime.register') {
          return context.runtimeRoutes;
        }

        const existing = context.runtimeRoutes.get(event.address.runtimeId);
        if (existing && !isSameAddress(existing, event.address)) {
          return context.runtimeRoutes;
        }
        const runtimeRoutes = new Map(context.runtimeRoutes);
        runtimeRoutes.set(event.address.runtimeId, event.address);
        return runtimeRoutes;
      },
      routeConflicts: ({ context, event }): Set<string> => {
        if (event.type !== 'runtime.register') return context.routeConflicts;
        const existing = context.runtimeRoutes.get(event.address.runtimeId);
        if (!existing || isSameAddress(existing, event.address)) return context.routeConflicts;
        const conflicts = new Set(context.routeConflicts);
        conflicts.add(event.address.runtimeId);
        return conflicts;
      }
    }),
    unregisterRuntime: assign({
      runtimeRoutes: ({ context, event }): Map<string, ChatActorAddress> => {
        if (event.type !== 'runtime.unregister') {
          return context.runtimeRoutes;
        }

        const runtimeRoutes = new Map(context.runtimeRoutes);
        runtimeRoutes.delete(event.runtimeId);
        return runtimeRoutes;
      },
      routeConflicts: ({ context, event }): Set<string> => {
        if (event.type !== 'runtime.unregister' || !context.routeConflicts.has(event.runtimeId)) return context.routeConflicts;
        const conflicts = new Set(context.routeConflicts);
        conflicts.delete(event.runtimeId);
        return conflicts;
      }
    }),
    routeRuntimeEvent: enqueueActions(({ context, event, enqueue }): void => {
      if (event.type !== 'runtime.event' || event.event.runtimeId !== event.runtimeId) {
        return;
      }

      const address = context.runtimeRoutes.get(event.runtimeId);
      const agentRef = address ? findAddressedAgent(context, address) : undefined;
      if (agentRef) enqueue.sendTo(agentRef, event.event);
    })
  }
}).createMachine({
  id: 'chatSupervisor',
  context: {
    sessions: new Map(),
    runtimeRoutes: new Map(),
    routeConflicts: new Set()
  },
  initial: 'active',
  states: {
    active: {
      on: {
        'supervisor.ensureSession': { actions: 'ensureSession' },
        'supervisor.removeSession': [{ guard: 'hasSessionToRemove', actions: [stopRemovedSession, 'removeSession'] }, { actions: 'removeSession' }],
        'supervisor.sendToSession': { actions: 'sendToSession' },
        'runtime.register': { actions: 'registerRuntime' },
        'runtime.unregister': { actions: 'unregisterRuntime' },
        'runtime.event': { actions: 'routeRuntimeEvent' }
      }
    }
  }
});
