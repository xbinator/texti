/**
 * @file state.test.ts
 * @description 验证 Agent Task 与 Delegation Checkpoint 的合法状态迁移。
 */
import type { AgentExecutionPlanSnapshot, AgentTaskContractSnapshot, AgentTaskStatus } from 'types/chat-agent';
import { describe, expect, it } from 'vitest';
import { hashExecutionPlanSnapshot } from '../../../../../../electron/main/modules/chat/agents/contracts.mts';
import {
  AGENT_CHECKPOINT_TERMINAL_STATES,
  AGENT_TASK_TERMINAL_STATES,
  canTransitionCheckpoint,
  canTransitionTask
} from '../../../../../../electron/main/modules/chat/agents/state.mts';
import { AgentStoreProtocolError } from '../../../../../../electron/main/modules/chat/agents/types.mts';

/** 与状态测试计划绑定的只读契约快照。 */
const contractSnapshot: AgentTaskContractSnapshot = {
  contractSchemaVersion: 1,
  task: 'Inspect CONTEXT.md',
  acceptanceCriteria: ['Return the project name'],
  mode: 'read',
  resources: [{ kind: 'file', reference: 'CONTEXT.md' }],
  requestedTools: ['read_file'],
  required: true
};

/** 满足授权迁移要求的冻结执行计划快照。 */
const executionPlanBody = {
  planSchemaVersion: 1,
  policyVersion: 'foundation-v1',
  capabilitySet: ['read_file'],
  modelSnapshot: { providerId: 'openai', modelId: 'gpt-5' },
  permissionSnapshot: { scopeIds: ['workspace-read'] },
  resourceScopes: ['file:CONTEXT.md'],
  toolEffectSet: [{ toolName: 'read_file', effect: 'pure_read' as const }],
  commitPolicy: { mode: 'none' as const },
  budget: { tokenLimit: 1000, costLimitUsd: 0.1, pricingVersion: 'test-v1' }
};

/** hash 与契约绑定的合法计划。 */
const executionPlan: AgentExecutionPlanSnapshot = {
  ...executionPlanBody,
  planHash: hashExecutionPlanSnapshot(contractSnapshot, executionPlanBody)
};

describe('agent task transitions', (): void => {
  it('allows the complete read execution path only with an immutable plan at authorization', (): void => {
    expect(canTransitionTask('created', 'planning')).toBe(true);
    expect(canTransitionTask('planning', 'authorized')).toBe(false);
    expect(canTransitionTask('planning', 'authorized', { contractSnapshot, executionPlanSnapshot: executionPlan })).toBe(true);
    expect(canTransitionTask('authorized', 'queued', { queuePhase: 'start' })).toBe(true);
    expect(canTransitionTask('queued', 'starting', { queuePhase: 'start' })).toBe(true);
    expect(canTransitionTask('starting', 'running')).toBe(true);
    expect(canTransitionTask('running', 'completed', { mode: 'read' })).toBe(true);
  });

  it('distinguishes start and commit queues', (): void => {
    expect(canTransitionTask('queued', 'starting', { queuePhase: 'commit' })).toBe(false);
    expect(canTransitionTask('queued', 'committing', { queuePhase: 'commit' })).toBe(true);
    expect(canTransitionTask('queued', 'queued', { queuePhase: 'commit', nextQueuePhase: 'start' })).toBe(true);
    expect(canTransitionTask('running', 'waiting_confirmation', { mode: 'write' })).toBe(true);
    expect(canTransitionTask('running', 'waiting_confirmation', { mode: 'read' })).toBe(false);
  });

  it('rejects shortcuts and gives every terminal state no outgoing transitions', (): void => {
    expect(canTransitionTask('created', 'completed')).toBe(false);
    expect(canTransitionTask('authorized', 'running')).toBe(false);

    AGENT_TASK_TERMINAL_STATES.forEach((status: AgentTaskStatus): void => {
      expect(canTransitionTask(status, 'running')).toBe(false);
      expect(canTransitionTask(status, 'deadline_exceeded')).toBe(false);
    });
  });

  it('models cooperative cancellation and deadline terminalization', (): void => {
    expect(canTransitionTask('running', 'cancelling', { mode: 'read' })).toBe(true);
    expect(canTransitionTask('cancelling', 'cancelled')).toBe(true);
    expect(canTransitionTask('running', 'deadline_exceeded', { mode: 'read' })).toBe(true);
    expect(canTransitionTask('committing', 'cancelling', { mode: 'write' })).toBe(false);
    expect(canTransitionTask('committing', 'deadline_exceeded', { mode: 'write' })).toBe(false);
  });

  it('rejects empty and forged plans at the authorization state guard', (): void => {
    expect(
      canTransitionTask('planning', 'authorized', {
        contractSnapshot,
        executionPlanSnapshot: {} as AgentExecutionPlanSnapshot
      })
    ).toBe(false);
    expect(
      canTransitionTask('planning', 'authorized', {
        contractSnapshot,
        executionPlanSnapshot: { ...executionPlan, planHash: 'f'.repeat(64) }
      })
    ).toBe(false);
  });

  it('exposes stable Store protocol fields independently from the display message', (): void => {
    const error = new AgentStoreProtocolError('immutable_snapshot_mismatch');

    expect(error).toMatchObject({
      code: 'protocol_error',
      reason: 'immutable_snapshot_mismatch',
      phase: 'recovery',
      category: 'protocol',
      retryable: false,
      details: { reason: 'immutable_snapshot_mismatch' }
    });
  });
});

describe('delegation checkpoint transitions', (): void => {
  it('allows the complete suspend and resume path', (): void => {
    expect(canTransitionCheckpoint('preparing', 'waiting_children')).toBe(true);
    expect(canTransitionCheckpoint('waiting_children', 'ready_to_resume')).toBe(true);
    expect(canTransitionCheckpoint('ready_to_resume', 'resuming')).toBe(true);
    expect(canTransitionCheckpoint('resuming', 'completed')).toBe(true);
  });

  it('allows cooperative cancellation without terminal shortcuts', (): void => {
    expect(canTransitionCheckpoint('waiting_children', 'cancelling')).toBe(true);
    expect(canTransitionCheckpoint('cancelling', 'cancelled')).toBe(true);
    expect(canTransitionCheckpoint('waiting_children', 'cancelled')).toBe(false);
    expect(canTransitionCheckpoint('cancelled', 'resuming')).toBe(false);
  });

  it('gives terminal checkpoints no outgoing transitions', (): void => {
    AGENT_CHECKPOINT_TERMINAL_STATES.forEach((status): void => {
      expect(canTransitionCheckpoint(status, 'resuming')).toBe(false);
      expect(canTransitionCheckpoint(status, 'interrupted')).toBe(false);
    });
  });
});
