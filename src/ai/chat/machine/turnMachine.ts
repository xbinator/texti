/**
 * @file turnMachine.ts
 * @description 单个用户 Turn 与主 Agent 的 XState 定义。
 */
import type { ChatIntent, ChatWorkflowError } from '../types';
import type { AgentWaitingInteraction } from './agentMachine';
import type { ActorRefFrom } from 'xstate';
import { assign, enqueueActions, setup } from 'xstate';
import { agentMachine } from './agentMachine';

/** Turn machine 输入。 */
export interface TurnMachineInput {
  /** 会话 ID。 */
  sessionId: string;
  /** Turn ID。 */
  turnId: string;
  /** 当前聊天意图。 */
  intent: ChatIntent;
}

/** Turn machine context。 */
export interface TurnMachineContext extends TurnMachineInput {
  /** 当前 Turn 的主 Agent。 */
  primaryAgentRef?: ActorRefFrom<typeof agentMachine>;
  /** 已准备的 Runtime 请求数据。 */
  request?: Record<string, unknown>;
  /** 当前流程错误。 */
  error?: ChatWorkflowError;
  /** 当前委派 Checkpoint。 */
  checkpointId?: string;
  /** 被 Checkpoint 挂起的 Runtime A。 */
  sourceRuntimeId?: string;
}

/** Turn machine 领域事件。 */
export type TurnMachineEvent =
  | { type: 'turn.prepared'; request: Record<string, unknown> }
  | { type: 'turn.recovered'; runtimeId: string; interaction?: AgentWaitingInteraction }
  | { type: 'turn.recoveredChildren'; runtimeId: string; checkpointId: string }
  | { type: 'turn.waiting' }
  | { type: 'turn.waitingChildren'; runtimeId: string; checkpointId: string }
  | { type: 'turn.resumeStarted'; runtimeId: string; checkpointId: string }
  | { type: 'turn.resumeRejected'; checkpointId: string }
  | { type: 'turn.checkpointCompleted'; checkpointId: string }
  | { type: 'turn.checkpointFailed'; checkpointId: string; error: ChatWorkflowError }
  | { type: 'turn.checkpointCancelled'; checkpointId: string }
  | { type: 'turn.checkpointInterrupted'; checkpointId: string }
  | { type: 'turn.resume' }
  | { type: 'turn.userChoiceSubmissionFailed' }
  | { type: 'turn.interactionResolved' }
  | { type: 'turn.cancel' }
  | { type: 'turn.cancelled' }
  | { type: 'turn.completed'; runtimeId?: string }
  | { type: 'turn.failed'; error: ChatWorkflowError };

/** Turn machine。 */
export const turnMachine = setup({
  types: {
    context: {} as TurnMachineContext,
    input: {} as TurnMachineInput,
    events: {} as TurnMachineEvent,
    tags: {} as 'busy' | 'abortable' | 'waitingForUser' | 'waitingForChildren'
  },
  actors: { agentMachine },
  guards: {
    isRecoveredWaiting: ({ event }): boolean => event.type === 'turn.recovered' && event.interaction !== undefined,
    isMatchingCheckpoint: ({ context, event }): boolean => 'checkpointId' in event && context.checkpointId === event.checkpointId
  },
  actions: {
    assignPreparedRequestAndPrimaryAgent: assign({
      request: ({ event }): Record<string, unknown> | undefined => {
        if (event.type === 'turn.prepared') return event.request;
        if (event.type === 'turn.recovered' || event.type === 'turn.recoveredChildren') return {};
        return undefined;
      },
      primaryAgentRef: ({ context, spawn }): ActorRefFrom<typeof agentMachine> =>
        context.primaryAgentRef ??
        spawn('agentMachine', {
          id: 'primary',
          input: {
            address: {
              sessionId: context.sessionId,
              turnId: context.turnId,
              agentId: 'primary'
            }
          }
        })
    }),
    startRecoveredPrimaryAgent: enqueueActions(({ context, event, enqueue }): void => {
      if (event.type !== 'turn.recovered') return;
      if (!context.primaryAgentRef) return;
      enqueue.sendTo(context.primaryAgentRef, { type: 'runtime.started', runtimeId: event.runtimeId });
      if (event.interaction) {
        enqueue.sendTo(context.primaryAgentRef, { type: 'runtime.userChoiceRequired', runtimeId: event.runtimeId, interaction: event.interaction });
      }
    }),
    suspendPrimaryAgent: enqueueActions(({ context, event, enqueue }): void => {
      if (!context.primaryAgentRef || (event.type !== 'turn.waitingChildren' && event.type !== 'turn.recoveredChildren')) return;
      if (event.type === 'turn.recoveredChildren') {
        enqueue.sendTo(context.primaryAgentRef, { type: 'runtime.started', runtimeId: event.runtimeId });
      }
      enqueue.sendTo(context.primaryAgentRef, {
        type: 'runtime.suspended',
        runtimeId: event.runtimeId,
        checkpointId: event.checkpointId
      });
    }),
    resumePrimaryAgent: enqueueActions(({ context, event, enqueue }): void => {
      if (!context.primaryAgentRef || event.type !== 'turn.resumeStarted') return;
      enqueue.sendTo(context.primaryAgentRef, {
        type: 'runtime.resumeStarted',
        runtimeId: event.runtimeId,
        checkpointId: event.checkpointId
      });
    }),
    rejectPrimaryResume: enqueueActions(({ context, event, enqueue }): void => {
      if (!context.primaryAgentRef || event.type !== 'turn.resumeRejected') return;
      enqueue.sendTo(context.primaryAgentRef, { type: 'runtime.resumeRejected', checkpointId: event.checkpointId });
    }),
    completePrimaryCheckpoint: enqueueActions(({ context, event, enqueue }): void => {
      if (!context.primaryAgentRef || event.type !== 'turn.checkpointCompleted') return;
      enqueue.sendTo(context.primaryAgentRef, { type: 'checkpoint.completed', checkpointId: event.checkpointId });
    }),
    failPrimaryCheckpoint: enqueueActions(({ context, event, enqueue }): void => {
      if (!context.primaryAgentRef || event.type !== 'turn.checkpointFailed') return;
      enqueue.sendTo(context.primaryAgentRef, { type: 'checkpoint.failed', checkpointId: event.checkpointId, error: event.error });
    }),
    cancelPrimaryCheckpoint: enqueueActions(({ context, event, enqueue }): void => {
      if (!context.primaryAgentRef || event.type !== 'turn.checkpointCancelled') return;
      enqueue.sendTo(context.primaryAgentRef, { type: 'checkpoint.cancelled', checkpointId: event.checkpointId });
    }),
    interruptPrimaryCheckpoint: enqueueActions(({ context, event, enqueue }): void => {
      if (!context.primaryAgentRef || event.type !== 'turn.checkpointInterrupted') return;
      enqueue.sendTo(context.primaryAgentRef, { type: 'checkpoint.interrupted', checkpointId: event.checkpointId });
    }),
    assignDelegation: assign({
      checkpointId: ({ event }): string | undefined =>
        event.type === 'turn.waitingChildren' || event.type === 'turn.recoveredChildren' ? event.checkpointId : undefined,
      sourceRuntimeId: ({ event }): string | undefined =>
        event.type === 'turn.waitingChildren' || event.type === 'turn.recoveredChildren' ? event.runtimeId : undefined
    }),
    clearDelegation: assign({
      checkpointId: (): undefined => undefined,
      sourceRuntimeId: (): undefined => undefined
    }),
    cancelPrimaryAgent: enqueueActions(({ context, enqueue }): void => {
      if (context.primaryAgentRef) enqueue.sendTo(context.primaryAgentRef, { type: 'agent.cancel' });
    }),
    restorePrimaryAgentUserChoice: enqueueActions(({ context, enqueue }): void => {
      const runtimeId = context.primaryAgentRef?.getSnapshot().context.runtimeId;
      if (!context.primaryAgentRef || !runtimeId) return;
      enqueue.sendTo(context.primaryAgentRef, { type: 'runtime.userChoiceRequired', runtimeId, interaction: 'userChoice' });
    }),
    assignError: assign({
      error: ({ event }): ChatWorkflowError | undefined => (event.type === 'turn.failed' || event.type === 'turn.checkpointFailed' ? event.error : undefined)
    })
  }
}).createMachine({
  id: 'chatTurn',
  context: ({ input }): TurnMachineContext => ({ ...input }),
  initial: 'preparing',
  states: {
    preparing: {
      tags: ['busy'],
      on: {
        'turn.recoveredChildren': {
          target: 'waitingChildren',
          actions: ['assignPreparedRequestAndPrimaryAgent', 'assignDelegation', 'suspendPrimaryAgent']
        },
        'turn.recovered': [
          {
            target: 'waiting',
            guard: 'isRecoveredWaiting',
            actions: ['assignPreparedRequestAndPrimaryAgent', 'startRecoveredPrimaryAgent']
          },
          {
            target: 'running',
            actions: ['assignPreparedRequestAndPrimaryAgent', 'startRecoveredPrimaryAgent']
          }
        ],
        'turn.prepared': { target: 'running', actions: 'assignPreparedRequestAndPrimaryAgent' },
        'turn.waiting': 'waiting',
        'turn.waitingChildren': {
          target: 'waitingChildren',
          actions: ['assignDelegation', 'suspendPrimaryAgent']
        },
        'turn.userChoiceSubmissionFailed': {
          target: 'waiting',
          actions: 'restorePrimaryAgentUserChoice'
        },
        'turn.failed': { target: 'failed', actions: 'assignError' },
        'turn.cancel': { target: 'cancelling', actions: 'cancelPrimaryAgent' }
      }
    },
    running: {
      tags: ['busy', 'abortable'],
      on: {
        'turn.checkpointCompleted': {
          target: 'completed',
          guard: 'isMatchingCheckpoint',
          actions: ['completePrimaryCheckpoint', 'clearDelegation']
        },
        'turn.checkpointFailed': {
          target: 'failed',
          guard: 'isMatchingCheckpoint',
          actions: ['assignError', 'failPrimaryCheckpoint', 'clearDelegation']
        },
        'turn.resumeStarted': {
          guard: 'isMatchingCheckpoint',
          actions: 'resumePrimaryAgent'
        },
        'turn.waiting': 'waiting',
        'turn.waitingChildren': {
          target: 'waitingChildren',
          actions: ['assignDelegation', 'suspendPrimaryAgent']
        },
        'turn.userChoiceSubmissionFailed': {
          target: 'waiting',
          actions: 'restorePrimaryAgentUserChoice'
        },
        'turn.cancel': { target: 'cancelling', actions: 'cancelPrimaryAgent' },
        'turn.completed': 'completed',
        'turn.failed': { target: 'failed', actions: 'assignError' }
      }
    },
    waitingChildren: {
      tags: ['busy', 'abortable', 'waitingForChildren'],
      on: {
        'turn.resumeStarted': {
          target: 'running',
          guard: 'isMatchingCheckpoint',
          actions: 'resumePrimaryAgent'
        },
        'turn.resumeRejected': {
          guard: 'isMatchingCheckpoint',
          actions: 'rejectPrimaryResume'
        },
        'turn.checkpointCompleted': {
          target: 'completed',
          guard: 'isMatchingCheckpoint',
          actions: ['completePrimaryCheckpoint', 'clearDelegation']
        },
        'turn.checkpointFailed': {
          target: 'failed',
          guard: 'isMatchingCheckpoint',
          actions: ['assignError', 'failPrimaryCheckpoint', 'clearDelegation']
        },
        'turn.checkpointCancelled': {
          target: 'cancelled',
          guard: 'isMatchingCheckpoint',
          actions: ['cancelPrimaryCheckpoint', 'clearDelegation']
        },
        'turn.checkpointInterrupted': {
          target: 'interrupted',
          guard: 'isMatchingCheckpoint',
          actions: ['interruptPrimaryCheckpoint', 'clearDelegation']
        },
        'turn.cancel': {
          target: 'cancellingChildren',
          actions: 'cancelPrimaryAgent'
        }
      }
    },
    cancellingChildren: {
      tags: ['busy', 'abortable'],
      on: {
        'turn.checkpointCompleted': {
          target: 'completed',
          guard: 'isMatchingCheckpoint',
          actions: ['completePrimaryCheckpoint', 'clearDelegation']
        },
        'turn.checkpointFailed': {
          target: 'failed',
          guard: 'isMatchingCheckpoint',
          actions: ['assignError', 'failPrimaryCheckpoint', 'clearDelegation']
        },
        'turn.checkpointCancelled': {
          target: 'cancelled',
          guard: 'isMatchingCheckpoint',
          actions: ['cancelPrimaryCheckpoint', 'clearDelegation']
        },
        'turn.checkpointInterrupted': {
          target: 'interrupted',
          guard: 'isMatchingCheckpoint',
          actions: ['interruptPrimaryCheckpoint', 'clearDelegation']
        }
      }
    },
    waiting: {
      tags: ['abortable', 'waitingForUser'],
      on: {
        'turn.resume': 'preparing',
        'turn.interactionResolved': 'running',
        'turn.cancel': { target: 'cancelling', actions: 'cancelPrimaryAgent' },
        'turn.completed': 'completed',
        'turn.failed': { target: 'failed', actions: 'assignError' }
      }
    },
    cancelling: {
      tags: ['busy'],
      on: {
        'turn.cancelled': 'cancelled',
        'turn.failed': { target: 'failed', actions: 'assignError' }
      }
    },
    completed: { type: 'final' },
    cancelled: { type: 'final' },
    failed: { type: 'final' },
    interrupted: { type: 'final' }
  }
});
