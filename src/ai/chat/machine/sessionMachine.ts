/**
 * @file sessionMachine.ts
 * @description 单会话聊天编排的 XState 定义。
 */
import type { PendingInteraction } from '../policies/pendingInteraction';
import type { ChatIntent, ChatSubmitInput, ChatWorkflowError } from '../types';
import type { AIUserChoiceAnswerData } from 'types/chat';
import type { ChatAgentCheckpointSnapshot } from 'types/chat-agent';
import type { ChatRuntimeRecoverySnapshot } from 'types/chat-runtime';
import type { ActorRefFrom } from 'xstate';
import { assign, enqueueActions, sendTo, setup } from 'xstate';
import { turnMachine } from './turnMachine';

/**
 * Session machine 输入。
 */
export interface SessionMachineInput {
  /** 会话 ID */
  sessionId: string;
}

/**
 * Session machine context。
 */
export interface SessionMachineContext extends SessionMachineInput {
  /** 当前 Turn 序号 */
  turnSequence: number;
  /** 当前 Turn actor */
  turnRef?: ActorRefFrom<typeof turnMachine>;
  /** 当前流程意图 */
  intent?: ChatIntent;
  /** 回退目标消息 ID */
  rollbackTargetMessageId?: string;
  /** 当前流程错误 */
  error?: ChatWorkflowError;
  /** 当前可恢复的用户交互。 */
  pendingInteraction?: PendingInteraction;
  /** 当前委派 Checkpoint。 */
  checkpointId?: string;
  /** 被 Checkpoint 挂起的 Runtime A。 */
  sourceRuntimeId?: string;
}

/**
 * Session machine 领域事件。
 */
export type SessionMachineEvent =
  | { type: 'session.recoverRuntime'; snapshot: ChatRuntimeRecoverySnapshot }
  | { type: 'session.recoverDelegation'; snapshot: ChatAgentCheckpointSnapshot }
  | { type: 'session.recoverInteraction'; interaction: PendingInteraction }
  | { type: 'session.submit'; input: ChatSubmitInput }
  | { type: 'session.compact' }
  | { type: 'session.regenerate'; targetMessageId: string }
  | { type: 'session.userChoiceSubmitted'; answer: AIUserChoiceAnswerData }
  | { type: 'session.userChoiceSubmissionFailed'; error: ChatWorkflowError }
  | { type: 'session.prepared' }
  | { type: 'session.preparationFailed'; error: ChatWorkflowError }
  | { type: 'session.preparationCancelled' }
  | { type: 'session.userChoiceRequired'; interaction?: PendingInteraction }
  | { type: 'session.waitingChildren'; runtimeId: string; checkpointId: string }
  | { type: 'session.resumeStarted'; runtimeId: string; checkpointId: string }
  | { type: 'session.resumeRejected'; checkpointId: string }
  | { type: 'session.checkpointCompleted'; checkpointId: string }
  | { type: 'session.checkpointFailed'; checkpointId: string; error: ChatWorkflowError }
  | { type: 'session.checkpointCancelled'; checkpointId: string }
  | { type: 'session.checkpointInterrupted'; checkpointId: string }
  | { type: 'session.interactionResolved' }
  | { type: 'session.completed' }
  | { type: 'session.failed'; error: ChatWorkflowError }
  | { type: 'session.cancelRequested' }
  | { type: 'session.runtimeCancelled' }
  | { type: 'session.cancelFailed'; error: ChatWorkflowError }
  | { type: 'session.rollbackRequested'; targetMessageId: string }
  | { type: 'session.rollbackCompleted' }
  | { type: 'session.rollbackFailed'; error: ChatWorkflowError };

/**
 * 将 Session 入口事件转换为新 Turn 意图。
 * @param event - Session 领域事件
 * @returns 新 Turn 意图
 */
function readNewTurnIntent(event: SessionMachineEvent): ChatIntent | undefined {
  if (event.type === 'session.submit') {
    return { type: 'submit', input: event.input };
  }
  if (event.type === 'session.compact') {
    return { type: 'compact' };
  }
  if (event.type === 'session.regenerate') {
    return { type: 'regenerate', targetMessageId: event.targetMessageId };
  }
  if (event.type === 'session.userChoiceSubmitted') {
    return { type: 'continue', answer: event.answer };
  }
  if (event.type === 'session.recoverRuntime') {
    return { type: 'recover', runtimeId: event.snapshot.runtimeId };
  }
  if (event.type === 'session.recoverDelegation') {
    return { type: 'recover', runtimeId: event.snapshot.sourceRuntimeId };
  }
  if (event.type === 'session.recoverInteraction') {
    return { type: 'recover', runtimeId: event.interaction.runtimeId };
  }

  return undefined;
}

/**
 * 单会话聊天状态机。
 */
export const sessionMachine = setup({
  types: {
    context: {} as SessionMachineContext,
    input: {} as SessionMachineInput,
    events: {} as SessionMachineEvent,
    tags: {} as 'busy' | 'abortable' | 'acceptsInput' | 'waitingForUser' | 'waitingForChildren'
  },
  actors: {
    turnMachine
  },
  guards: {
    isContinueIntent: ({ context }): boolean => context.intent?.type === 'continue',
    isRecoveredResuming: ({ event }): boolean => event.type === 'session.recoverDelegation' && event.snapshot.status === 'resuming',
    isRecoveredCancelling: ({ event }): boolean => event.type === 'session.recoverDelegation' && event.snapshot.status === 'cancelling',
    isMatchingCheckpoint: ({ context, event }): boolean => 'checkpointId' in event && context.checkpointId === event.checkpointId,
    isActiveRuntime: ({ context, event }): boolean =>
      event.type === 'session.waitingChildren' && context.turnRef?.getSnapshot().context.primaryAgentRef?.getSnapshot().context.runtimeId === event.runtimeId,
    hasPendingRecoveryInteraction: ({ event }): boolean =>
      event.type === 'session.recoverRuntime' && event.snapshot.pendingRequests.some((request): boolean => request.type === 'confirmation')
  },
  actions: {
    startNewTurn: assign({
      turnSequence: ({ context }): number => context.turnSequence + 1,
      intent: ({ event }): ChatIntent | undefined => readNewTurnIntent(event),
      turnRef: ({ context, event, spawn }): ActorRefFrom<typeof turnMachine> | undefined => {
        const intent = readNewTurnIntent(event);
        if (!intent) {
          return context.turnRef;
        }

        const turnSequence = context.turnSequence + 1;
        // 主进程恢复快照已经冻结 Turn 身份；Renderer 重载时不得生成新的逻辑 Turn。
        const turnId =
          event.type === 'session.recoverRuntime' || event.type === 'session.recoverDelegation'
            ? event.snapshot.turnId
            : `${context.sessionId}:turn:${turnSequence}`;
        const turnRef = spawn('turnMachine', {
          id: `turn-${turnSequence}`,
          input: {
            sessionId: context.sessionId,
            turnId,
            intent
          }
        });
        return turnRef;
      },
      pendingInteraction: ({ event }): PendingInteraction | undefined => (event.type === 'session.recoverInteraction' ? event.interaction : undefined),
      error: (): undefined => undefined
    }),
    assignDelegation: assign({
      checkpointId: ({ event }): string | undefined => {
        if (event.type === 'session.waitingChildren') return event.checkpointId;
        if (event.type === 'session.recoverDelegation') return event.snapshot.checkpointId;
        return undefined;
      },
      sourceRuntimeId: ({ event }): string | undefined => {
        if (event.type === 'session.waitingChildren') return event.runtimeId;
        if (event.type === 'session.recoverDelegation') return event.snapshot.sourceRuntimeId;
        return undefined;
      }
    }),
    resumeTurn: assign({
      intent: ({ event }): ChatIntent | undefined => (event.type === 'session.userChoiceSubmitted' ? { type: 'continue', answer: event.answer } : undefined),
      error: (): undefined => undefined
    }),
    notifyTurnResume: enqueueActions(({ context, enqueue }): void => {
      if (context.turnRef) enqueue.sendTo(context.turnRef, { type: 'turn.resume' });
    }),
    notifyTurnPrepared: sendTo(({ context }) => context.turnRef as ActorRefFrom<typeof turnMachine>, { type: 'turn.prepared', request: {} }),
    notifyTurnWaiting: enqueueActions(({ context, enqueue }): void => {
      if (context.turnRef) enqueue.sendTo(context.turnRef, { type: 'turn.waiting' });
    }),
    notifyTurnChildren: enqueueActions(({ context, event, enqueue }): void => {
      if (!context.turnRef || event.type !== 'session.waitingChildren') return;
      enqueue.sendTo(context.turnRef, {
        type: 'turn.waitingChildren',
        runtimeId: event.runtimeId,
        checkpointId: event.checkpointId
      });
    }),
    notifyTurnResumeStarted: enqueueActions(({ context, event, enqueue }): void => {
      if (!context.turnRef || event.type !== 'session.resumeStarted') return;
      enqueue.sendTo(context.turnRef, {
        type: 'turn.resumeStarted',
        runtimeId: event.runtimeId,
        checkpointId: event.checkpointId
      });
    }),
    notifyTurnResumeRejected: enqueueActions(({ context, event, enqueue }): void => {
      if (!context.turnRef || event.type !== 'session.resumeRejected') return;
      enqueue.sendTo(context.turnRef, { type: 'turn.resumeRejected', checkpointId: event.checkpointId });
    }),
    notifyTurnCheckpointCompleted: enqueueActions(({ context, event, enqueue }): void => {
      if (!context.turnRef || event.type !== 'session.checkpointCompleted') return;
      enqueue.sendTo(context.turnRef, { type: 'turn.checkpointCompleted', checkpointId: event.checkpointId });
    }),
    notifyTurnCheckpointFailed: enqueueActions(({ context, event, enqueue }): void => {
      if (!context.turnRef || event.type !== 'session.checkpointFailed') return;
      enqueue.sendTo(context.turnRef, { type: 'turn.checkpointFailed', checkpointId: event.checkpointId, error: event.error });
    }),
    notifyTurnCheckpointCancelled: enqueueActions(({ context, event, enqueue }): void => {
      if (!context.turnRef || event.type !== 'session.checkpointCancelled') return;
      enqueue.sendTo(context.turnRef, { type: 'turn.checkpointCancelled', checkpointId: event.checkpointId });
    }),
    notifyTurnCheckpointInterrupted: enqueueActions(({ context, event, enqueue }): void => {
      if (!context.turnRef || event.type !== 'session.checkpointInterrupted') return;
      enqueue.sendTo(context.turnRef, { type: 'turn.checkpointInterrupted', checkpointId: event.checkpointId });
    }),
    notifyTurnInteractionResolved: enqueueActions(({ context, enqueue }): void => {
      if (context.turnRef) enqueue.sendTo(context.turnRef, { type: 'turn.interactionResolved' });
    }),
    notifyTurnCancel: enqueueActions(({ context, enqueue }): void => {
      if (context.turnRef) enqueue.sendTo(context.turnRef, { type: 'turn.cancel' });
    }),
    notifyTurnCancelled: enqueueActions(({ context, enqueue }): void => {
      if (context.turnRef) enqueue.sendTo(context.turnRef, { type: 'turn.cancelled' });
    }),
    notifyTurnCompleted: enqueueActions(({ context, enqueue }): void => {
      if (context.turnRef) enqueue.sendTo(context.turnRef, { type: 'turn.completed' });
    }),
    notifyTurnFailed: enqueueActions(({ context, event, enqueue }): void => {
      if (context.turnRef && 'error' in event) enqueue.sendTo(context.turnRef, { type: 'turn.failed', error: event.error });
    }),
    restoreTurnWaiting: enqueueActions(({ context, enqueue }): void => {
      if (context.turnRef) enqueue.sendTo(context.turnRef, { type: 'turn.waiting' });
    }),
    restoreTurnUserChoice: enqueueActions(({ context, enqueue }): void => {
      if (context.turnRef) enqueue.sendTo(context.turnRef, { type: 'turn.userChoiceSubmissionFailed' });
    }),
    hydrateRecoveredTurn: enqueueActions(({ context, event, enqueue }): void => {
      if (!context.turnRef) return;
      if (event.type === 'session.recoverInteraction') {
        enqueue.sendTo(context.turnRef, {
          type: 'turn.recovered',
          runtimeId: event.interaction.runtimeId,
          interaction: 'userChoice'
        });
        return;
      }
      if (event.type !== 'session.recoverRuntime') return;
      enqueue.sendTo(context.turnRef, {
        type: 'turn.recovered',
        runtimeId: event.snapshot.runtimeId,
        interaction: event.snapshot.pendingRequests.some((request): boolean => request.type === 'confirmation') ? 'confirmation' : undefined
      });
    }),
    hydrateDelegatedTurn: enqueueActions(({ context, event, enqueue }): void => {
      if (!context.turnRef || event.type !== 'session.recoverDelegation') return;
      enqueue.sendTo(context.turnRef, {
        type: 'turn.recoveredChildren',
        runtimeId: event.snapshot.sourceRuntimeId,
        checkpointId: event.snapshot.checkpointId
      });
      if (event.snapshot.status === 'resuming' && event.snapshot.resumeRuntimeId) {
        enqueue.sendTo(context.turnRef, {
          type: 'turn.resumeStarted',
          runtimeId: event.snapshot.resumeRuntimeId,
          checkpointId: event.snapshot.checkpointId
        });
      } else if (event.snapshot.status === 'cancelling') {
        enqueue.sendTo(context.turnRef, { type: 'turn.cancel' });
      }
    }),
    markInteractionSubmitting: assign({
      pendingInteraction: ({ context }): PendingInteraction | undefined =>
        context.pendingInteraction ? { ...context.pendingInteraction, status: 'submitting' } : undefined
    }),
    restoreInteractionPending: assign({
      pendingInteraction: ({ context }): PendingInteraction | undefined =>
        context.pendingInteraction ? { ...context.pendingInteraction, status: 'pending' } : undefined
    }),
    markInteractionResolved: assign({
      pendingInteraction: ({ context }): PendingInteraction | undefined =>
        context.pendingInteraction ? { ...context.pendingInteraction, status: 'resolved' } : undefined
    }),
    capturePendingInteraction: assign({
      pendingInteraction: ({ context, event }): PendingInteraction | undefined =>
        event.type === 'session.userChoiceRequired' ? event.interaction ?? context.pendingInteraction : context.pendingInteraction
    }),
    assignRollbackTarget: assign({
      rollbackTargetMessageId: ({ event }): string | undefined => (event.type === 'session.rollbackRequested' ? event.targetMessageId : undefined)
    }),
    assignError: assign({
      error: ({ event }): ChatWorkflowError | undefined => ('error' in event ? event.error : undefined)
    }),
    clearActiveTurn: assign({
      turnRef: (): undefined => undefined,
      intent: (): undefined => undefined,
      pendingInteraction: (): undefined => undefined,
      checkpointId: (): undefined => undefined,
      sourceRuntimeId: (): undefined => undefined
    }),
    clearRollback: assign({
      rollbackTargetMessageId: (): undefined => undefined
    })
  }
}).createMachine({
  id: 'chatSession',
  context: ({ input }): SessionMachineContext => ({ ...input, turnSequence: 0 }),
  initial: 'idle',
  states: {
    idle: {
      tags: ['acceptsInput'],
      on: {
        'session.recoverDelegation': [
          {
            target: 'running',
            guard: 'isRecoveredResuming',
            actions: ['startNewTurn', 'assignDelegation', 'hydrateDelegatedTurn']
          },
          {
            target: 'cancellingChildren',
            guard: 'isRecoveredCancelling',
            actions: ['startNewTurn', 'assignDelegation', 'hydrateDelegatedTurn']
          },
          {
            target: 'waitingChildren',
            actions: ['startNewTurn', 'assignDelegation', 'hydrateDelegatedTurn']
          }
        ],
        'session.recoverInteraction': {
          target: 'waitingForUser',
          actions: ['startNewTurn', 'hydrateRecoveredTurn']
        },
        'session.recoverRuntime': [
          {
            target: 'waitingForUser',
            guard: 'hasPendingRecoveryInteraction',
            actions: ['startNewTurn', 'hydrateRecoveredTurn']
          },
          {
            target: 'running',
            actions: ['startNewTurn', 'hydrateRecoveredTurn']
          }
        ],
        'session.submit': {
          target: 'preparing',
          actions: 'startNewTurn'
        },
        'session.compact': {
          target: 'preparing',
          actions: 'startNewTurn'
        },
        'session.regenerate': {
          target: 'preparing',
          actions: 'startNewTurn'
        },
        'session.userChoiceSubmitted': {
          target: 'preparing',
          actions: 'startNewTurn'
        },
        'session.rollbackRequested': {
          target: 'rollingBack.applyingRollback',
          actions: 'assignRollbackTarget'
        }
      }
    },
    preparing: {
      tags: ['busy'],
      on: {
        'session.prepared': {
          target: 'running',
          actions: ['notifyTurnPrepared', 'markInteractionResolved']
        },
        'session.preparationFailed': [
          {
            target: 'waitingForUser',
            guard: 'isContinueIntent',
            actions: ['assignError', 'restoreTurnWaiting', 'restoreInteractionPending']
          },
          {
            target: 'idle',
            actions: ['assignError', 'notifyTurnFailed', 'clearActiveTurn']
          }
        ],
        'session.preparationCancelled': [
          {
            target: 'waitingForUser',
            guard: 'isContinueIntent',
            actions: ['restoreTurnWaiting', 'restoreInteractionPending']
          },
          {
            target: 'idle',
            actions: ['notifyTurnCancel', 'notifyTurnCancelled', 'clearActiveTurn']
          }
        ],
        'session.userChoiceSubmissionFailed': {
          target: 'waitingForUser',
          actions: ['assignError', 'restoreTurnUserChoice', 'restoreInteractionPending']
        },
        'session.cancelRequested': {
          target: 'cancelling',
          actions: 'notifyTurnCancel'
        }
      }
    },
    running: {
      tags: ['busy', 'abortable'],
      on: {
        'session.checkpointCompleted': {
          target: 'idle',
          guard: 'isMatchingCheckpoint',
          actions: ['notifyTurnCheckpointCompleted', 'clearActiveTurn']
        },
        'session.checkpointFailed': {
          target: 'idle',
          guard: 'isMatchingCheckpoint',
          actions: ['assignError', 'notifyTurnCheckpointFailed', 'clearActiveTurn']
        },
        'session.resumeStarted': {
          guard: 'isMatchingCheckpoint',
          actions: 'notifyTurnResumeStarted'
        },
        'session.waitingChildren': {
          target: 'waitingChildren',
          guard: 'isActiveRuntime',
          actions: ['assignDelegation', 'notifyTurnChildren']
        },
        'session.userChoiceRequired': {
          target: 'waitingForUser',
          actions: ['notifyTurnWaiting', 'capturePendingInteraction']
        },
        'session.userChoiceSubmissionFailed': {
          target: 'waitingForUser',
          actions: ['assignError', 'restoreTurnUserChoice', 'restoreInteractionPending']
        },
        'session.completed': {
          target: 'idle',
          actions: ['notifyTurnCompleted', 'clearActiveTurn']
        },
        'session.failed': {
          target: 'idle',
          actions: ['assignError', 'notifyTurnFailed', 'clearActiveTurn']
        },
        'session.cancelRequested': {
          target: 'cancelling',
          actions: 'notifyTurnCancel'
        },
        'session.rollbackRequested': {
          target: 'rollingBack.cancellingActiveRuntime',
          actions: ['assignRollbackTarget', 'notifyTurnCancel']
        }
      }
    },
    waitingChildren: {
      tags: ['busy', 'abortable', 'waitingForChildren'],
      on: {
        'session.resumeStarted': {
          target: 'running',
          guard: 'isMatchingCheckpoint',
          actions: 'notifyTurnResumeStarted'
        },
        'session.resumeRejected': {
          guard: 'isMatchingCheckpoint',
          actions: 'notifyTurnResumeRejected'
        },
        'session.checkpointCompleted': {
          target: 'idle',
          guard: 'isMatchingCheckpoint',
          actions: ['notifyTurnCheckpointCompleted', 'clearActiveTurn']
        },
        'session.checkpointFailed': {
          target: 'idle',
          guard: 'isMatchingCheckpoint',
          actions: ['assignError', 'notifyTurnCheckpointFailed', 'clearActiveTurn']
        },
        'session.cancelRequested': {
          target: 'cancellingChildren',
          actions: 'notifyTurnCancel'
        },
        'session.checkpointCancelled': {
          target: 'idle',
          guard: 'isMatchingCheckpoint',
          actions: ['notifyTurnCheckpointCancelled', 'clearActiveTurn']
        },
        'session.checkpointInterrupted': {
          target: 'idle',
          guard: 'isMatchingCheckpoint',
          actions: ['notifyTurnCheckpointInterrupted', 'clearActiveTurn']
        }
      }
    },
    cancellingChildren: {
      tags: ['busy', 'abortable'],
      on: {
        'session.checkpointCompleted': {
          target: 'idle',
          guard: 'isMatchingCheckpoint',
          actions: ['notifyTurnCheckpointCompleted', 'clearActiveTurn']
        },
        'session.checkpointFailed': {
          target: 'idle',
          guard: 'isMatchingCheckpoint',
          actions: ['assignError', 'notifyTurnCheckpointFailed', 'clearActiveTurn']
        },
        'session.checkpointCancelled': {
          target: 'idle',
          guard: 'isMatchingCheckpoint',
          actions: ['notifyTurnCheckpointCancelled', 'clearActiveTurn']
        },
        'session.checkpointInterrupted': {
          target: 'idle',
          guard: 'isMatchingCheckpoint',
          actions: ['notifyTurnCheckpointInterrupted', 'clearActiveTurn']
        }
      }
    },
    waitingForUser: {
      tags: ['acceptsInput', 'abortable', 'waitingForUser'],
      on: {
        'session.userChoiceSubmitted': {
          target: 'preparing',
          actions: ['resumeTurn', 'notifyTurnResume', 'markInteractionSubmitting']
        },
        'session.interactionResolved': {
          target: 'running',
          actions: 'notifyTurnInteractionResolved'
        },
        'session.completed': {
          target: 'idle',
          actions: ['notifyTurnCompleted', 'clearActiveTurn']
        },
        'session.failed': {
          target: 'idle',
          actions: ['assignError', 'notifyTurnFailed', 'clearActiveTurn']
        },
        'session.cancelRequested': {
          target: 'cancelling',
          actions: 'notifyTurnCancel'
        },
        'session.rollbackRequested': {
          target: 'rollingBack.cancellingActiveRuntime',
          actions: ['assignRollbackTarget', 'notifyTurnCancel']
        }
      }
    },
    cancelling: {
      tags: ['busy'],
      on: {
        'session.runtimeCancelled': {
          target: 'idle',
          actions: ['notifyTurnCancelled', 'clearActiveTurn']
        },
        'session.cancelFailed': {
          target: 'cancelFailed',
          actions: 'assignError'
        }
      }
    },
    cancelFailed: {
      on: {
        'session.cancelRequested': {
          target: 'cancelling',
          actions: 'notifyTurnCancel'
        },
        'session.runtimeCancelled': {
          target: 'idle',
          actions: ['notifyTurnCancelled', 'clearActiveTurn']
        }
      }
    },
    rollingBack: {
      tags: ['busy'],
      initial: 'cancellingActiveRuntime',
      states: {
        cancellingActiveRuntime: {
          on: {
            'session.runtimeCancelled': {
              target: 'applyingRollback',
              actions: ['notifyTurnCancelled', 'clearActiveTurn']
            },
            'session.cancelFailed': {
              target: '#chatSession.cancelFailed',
              actions: 'assignError'
            }
          }
        },
        applyingRollback: {
          on: {
            'session.rollbackCompleted': {
              target: '#chatSession.idle',
              actions: 'clearRollback'
            },
            'session.rollbackFailed': {
              target: '#chatSession.idle',
              actions: ['assignError', 'clearRollback']
            }
          }
        }
      }
    }
  }
});
