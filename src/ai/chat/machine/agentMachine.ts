/**
 * @file agentMachine.ts
 * @description 单个 Chat Agent 的 XState 生命周期定义。
 */
import type { ChatAgentAddress, ChatWorkflowError } from '../types';
import { assign, setup } from 'xstate';

/**
 * Agent 等待的 renderer 交互类型。
 */
export type AgentWaitingInteraction = 'userChoice' | 'confirmation';

/**
 * Agent machine 创建输入。
 */
export interface AgentMachineInput {
  /** 不含 Runtime ID 的稳定 Actor 地址 */
  address: ChatAgentAddress;
}

/**
 * Agent machine context。
 */
export interface AgentMachineContext {
  /** 不含 Runtime ID 的稳定 Actor 地址 */
  address: ChatAgentAddress;
  /** 主进程 Runtime ID */
  runtimeId?: string;
  /** 当前等待交互类型 */
  interaction?: AgentWaitingInteraction;
  /** 当前流程错误 */
  error?: ChatWorkflowError;
}

/**
 * Agent machine 领域事件。
 */
export type AgentMachineEvent =
  | { type: 'agent.cancel' }
  | { type: 'runtime.started'; runtimeId: string }
  | { type: 'runtime.userChoiceRequired'; runtimeId: string; interaction: AgentWaitingInteraction }
  | { type: 'runtime.interactionResolved'; runtimeId: string }
  | { type: 'runtime.completed'; runtimeId: string }
  | { type: 'runtime.cancelled'; runtimeId: string }
  | { type: 'runtime.failed'; runtimeId: string; error: ChatWorkflowError }
  | { type: 'runtime.cancelFailed'; runtimeId: string; error: ChatWorkflowError }
  | { type: 'runtime.startFailed'; error: ChatWorkflowError };

/**
 * 判断事件是否携带 Runtime ID。
 * @param event - Agent 领域事件
 * @returns 是否携带 Runtime ID
 */
function hasRuntimeId(event: AgentMachineEvent): event is AgentMachineEvent & { runtimeId: string } {
  return 'runtimeId' in event;
}

/**
 * 单 Agent 生命周期 machine。
 */
export const agentMachine = setup({
  types: {
    context: {} as AgentMachineContext,
    input: {} as AgentMachineInput,
    events: {} as AgentMachineEvent,
    tags: {} as 'busy' | 'abortable' | 'waitingForUser'
  },
  guards: {
    isMatchingRuntime: ({ context, event }): boolean => hasRuntimeId(event) && context.runtimeId === event.runtimeId
  },
  actions: {
    assignRuntime: assign({
      runtimeId: ({ event }): string | undefined => (event.type === 'runtime.started' ? event.runtimeId : undefined),
      error: (): undefined => undefined
    }),
    assignInteraction: assign({
      interaction: ({ event }): AgentWaitingInteraction | undefined => (event.type === 'runtime.userChoiceRequired' ? event.interaction : undefined)
    }),
    clearInteraction: assign({
      interaction: (): undefined => undefined
    }),
    assignRuntimeError: assign({
      error: ({ event }): ChatWorkflowError | undefined =>
        event.type === 'runtime.failed' || event.type === 'runtime.cancelFailed' || event.type === 'runtime.startFailed' ? event.error : undefined
    }),
    clearError: assign({
      error: (): undefined => undefined
    })
  }
}).createMachine({
  id: 'chatAgent',
  context: ({ input }): AgentMachineContext => ({ address: input.address }),
  initial: 'starting',
  states: {
    starting: {
      tags: ['busy'],
      on: {
        'runtime.started': {
          target: 'running',
          actions: 'assignRuntime'
        },
        'runtime.startFailed': {
          target: 'failed',
          actions: 'assignRuntimeError'
        },
        'agent.cancel': 'cancelled'
      }
    },
    running: {
      tags: ['busy', 'abortable'],
      on: {
        'runtime.userChoiceRequired': {
          target: 'waiting',
          guard: 'isMatchingRuntime',
          actions: 'assignInteraction'
        },
        'runtime.completed': {
          target: 'completed',
          guard: 'isMatchingRuntime'
        },
        'runtime.failed': {
          target: 'failed',
          guard: 'isMatchingRuntime',
          actions: 'assignRuntimeError'
        },
        'agent.cancel': 'cancelling'
      }
    },
    waiting: {
      tags: ['busy', 'abortable', 'waitingForUser'],
      on: {
        'runtime.started': {
          target: 'running',
          actions: ['assignRuntime', 'clearInteraction']
        },
        'runtime.interactionResolved': {
          target: 'running',
          guard: 'isMatchingRuntime',
          actions: 'clearInteraction'
        },
        'agent.cancel': 'cancelling',
        'runtime.completed': {
          target: 'completed',
          guard: 'isMatchingRuntime'
        },
        'runtime.failed': {
          target: 'failed',
          guard: 'isMatchingRuntime',
          actions: 'assignRuntimeError'
        }
      }
    },
    cancelling: {
      tags: ['busy'],
      on: {
        'runtime.cancelled': {
          target: 'cancelled',
          guard: 'isMatchingRuntime'
        },
        'runtime.cancelFailed': {
          target: 'cancelFailed',
          guard: 'isMatchingRuntime',
          actions: 'assignRuntimeError'
        }
      }
    },
    cancelFailed: {
      on: {
        'agent.cancel': { target: 'cancelling', actions: 'clearError' },
        'runtime.cancelled': {
          target: 'cancelled',
          guard: 'isMatchingRuntime'
        }
      }
    },
    completed: {
      type: 'final'
    },
    cancelled: {
      type: 'final'
    },
    failed: {
      type: 'final'
    }
  }
});
