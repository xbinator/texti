/**
 * @file selectors.ts
 * @description Chat XState snapshot 纯 selector。
 */
import type { SnapshotFrom } from 'xstate';
import { agentMachine } from './agentMachine';

/** Agent machine snapshot。 */
export type AgentMachineSnapshot = SnapshotFrom<typeof agentMachine>;

/**
 * 判断 Agent 是否占用当前 Turn。
 * @param snapshot - Agent snapshot
 * @returns 是否忙碌
 */
export function selectIsBusy(snapshot: AgentMachineSnapshot): boolean {
  return snapshot.hasTag('busy');
}

/**
 * 判断 Agent 是否可中止。
 * @param snapshot - Agent snapshot
 * @returns 是否可中止
 */
export function selectIsAbortable(snapshot: AgentMachineSnapshot): boolean {
  return snapshot.hasTag('abortable');
}

/**
 * 判断 Agent 是否等待用户交互。
 * @param snapshot - Agent snapshot
 * @returns 是否等待用户
 */
export function selectIsWaitingForUser(snapshot: AgentMachineSnapshot): boolean {
  return snapshot.hasTag('waitingForUser');
}

/**
 * 判断 Agent 是否等待 Child Checkpoint。
 * @param snapshot - Agent snapshot
 * @returns 是否等待 Child
 */
export function selectIsWaitingForChildren(snapshot: AgentMachineSnapshot): boolean {
  return snapshot.hasTag('waitingForChildren');
}

/**
 * 读取 Agent 当前 Runtime ID。
 * @param snapshot - Agent snapshot
 * @returns Runtime ID
 */
export function selectAgentRuntimeId(snapshot: AgentMachineSnapshot): string | undefined {
  return snapshot.context.runtimeId;
}

/**
 * 读取 Agent 当前委派 Checkpoint ID。
 * @param snapshot - Agent snapshot
 * @returns Checkpoint ID
 */
export function selectAgentCheckpointId(snapshot: AgentMachineSnapshot): string | undefined {
  return snapshot.context.checkpointId;
}
