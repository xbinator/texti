/**
 * @file state.mts
 * @description 定义 Agent Task 与 Delegation Checkpoint 的穷举合法状态迁移。
 */
import type {
  AgentCheckpointStatus,
  AgentExecutionPlanSnapshot,
  AgentTaskContractSnapshot,
  AgentTaskMode,
  AgentTaskQueuePhase,
  AgentTaskStatus
} from 'types/chat-agent';
import { validateExecutionPlanSnapshot } from './contracts.mjs';

/** Task 状态迁移所需的不可变上下文。 */
export interface AgentTaskTransitionContext {
  /** Task 冻结模式，用于限制 read/write 分支。 */
  mode?: AgentTaskMode;
  /** 当前 queued 记录或目标 queued 记录的阶段。 */
  queuePhase?: AgentTaskQueuePhase;
  /** queued → queued 时的新阶段。 */
  nextQueuePhase?: AgentTaskQueuePhase;
  /** planning → authorized 时必须提供的完整计划。 */
  executionPlanSnapshot?: AgentExecutionPlanSnapshot;
  /** planning → authorized 时计划必须绑定的不可变契约。 */
  contractSnapshot?: AgentTaskContractSnapshot;
}

/** Task 终态集合；终态没有任何执行状态出边。 */
export const AGENT_TASK_TERMINAL_STATES: readonly AgentTaskStatus[] = ['completed', 'failed', 'cancelled', 'deadline_exceeded', 'commit_failed'];

/** Checkpoint 终态集合；终态没有任何执行状态出边。 */
export const AGENT_CHECKPOINT_TERMINAL_STATES: readonly AgentCheckpointStatus[] = ['completed', 'failed', 'cancelled', 'interrupted'];

/** Task 基础迁移图，模式和 queue phase 约束在守卫中进一步收缩。 */
const TASK_TRANSITIONS: Readonly<Record<AgentTaskStatus, readonly AgentTaskStatus[]>> = {
  created: ['planning', 'cancelling', 'deadline_exceeded'],
  planning: ['authorized', 'failed', 'cancelling', 'deadline_exceeded'],
  authorized: ['queued', 'cancelling', 'deadline_exceeded'],
  queued: ['queued', 'starting', 'committing', 'cancelling', 'deadline_exceeded'],
  starting: ['running', 'failed', 'cancelling', 'deadline_exceeded'],
  running: ['waiting_confirmation', 'queued', 'completed', 'failed', 'cancelling', 'deadline_exceeded'],
  waiting_confirmation: ['queued', 'failed', 'cancelling', 'deadline_exceeded'],
  committing: ['completed', 'cancelled', 'commit_failed'],
  cancelling: ['cancelled', 'failed', 'deadline_exceeded'],
  completed: [],
  failed: [],
  cancelled: [],
  deadline_exceeded: [],
  commit_failed: []
};

/** Checkpoint 完整迁移图。 */
const CHECKPOINT_TRANSITIONS: Readonly<Record<AgentCheckpointStatus, readonly AgentCheckpointStatus[]>> = {
  preparing: ['waiting_children'],
  waiting_children: ['ready_to_resume', 'cancelling', 'interrupted'],
  ready_to_resume: ['resuming', 'cancelling', 'interrupted'],
  resuming: ['completed', 'failed', 'interrupted'],
  cancelling: ['cancelled', 'interrupted'],
  completed: [],
  failed: [],
  cancelled: [],
  interrupted: []
};

/**
 * 判断 Task 状态迁移是否合法。
 * @param from - 当前状态
 * @param to - 目标状态
 * @param context - 模式、队列阶段和授权计划
 * @returns 是否允许在同一事务中执行迁移
 */
export function canTransitionTask(from: AgentTaskStatus, to: AgentTaskStatus, context: AgentTaskTransitionContext = {}): boolean {
  if (!TASK_TRANSITIONS[from].includes(to)) return false;
  if (from === 'planning' && to === 'authorized') {
    if (!context.contractSnapshot || !context.executionPlanSnapshot) return false;
    return validateExecutionPlanSnapshot(context.contractSnapshot, context.executionPlanSnapshot).ok;
  }
  if (from === 'authorized' && to === 'queued') return context.queuePhase === 'start';
  if (from === 'queued' && to === 'starting') return context.queuePhase === 'start';
  if (from === 'queued' && to === 'committing') return context.queuePhase === 'commit';
  if (from === 'queued' && to === 'queued') {
    return context.queuePhase === 'commit' && context.nextQueuePhase === 'start';
  }
  if (from === 'running' && to === 'waiting_confirmation') return context.mode === 'write';
  if (from === 'running' && to === 'queued') return context.mode === 'write' && context.queuePhase === 'commit';
  if (from === 'waiting_confirmation' && to === 'queued') {
    return context.queuePhase === 'commit' || context.queuePhase === 'start';
  }
  return true;
}

/**
 * 判断 Delegation Checkpoint 状态迁移是否合法。
 * @param from - 当前状态
 * @param to - 目标状态
 * @returns 是否存在明确协议边
 */
export function canTransitionCheckpoint(from: AgentCheckpointStatus, to: AgentCheckpointStatus): boolean {
  return CHECKPOINT_TRANSITIONS[from].includes(to);
}

/**
 * 判断 Task 是否已经进入执行终态。
 * @param status - Task 状态
 * @returns 是否为终态
 */
export function isTaskTerminal(status: AgentTaskStatus): boolean {
  return AGENT_TASK_TERMINAL_STATES.includes(status);
}

/**
 * 判断 Checkpoint 是否已经进入执行终态。
 * @param status - Checkpoint 状态
 * @returns 是否为终态
 */
export function isCheckpointTerminal(status: AgentCheckpointStatus): boolean {
  return AGENT_CHECKPOINT_TERMINAL_STATES.includes(status);
}
