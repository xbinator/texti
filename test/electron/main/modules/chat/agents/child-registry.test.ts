/**
 * @file child-registry.test.ts
 * @description 验证 Child Actor 稳定身份与可替换 Runtime 绑定相互独立。
 */
import type { AgentTaskRecord } from '../../../../../../electron/main/modules/chat/agents/types.mjs';
import type { AgentTaskError } from 'types/chat-agent';
import type { ChatRuntimeAddress } from 'types/chat-runtime';
import { describe, expect, it } from 'vitest';
import { createChildActorRegistry } from '../../../../../../electron/main/modules/chat/agents/child-registry.mjs';

/**
 * 创建可注册的已授权 Child Task。
 * @param suffix - 身份后缀
 * @returns Child Task 投影
 */
function createTask(suffix = '1'): AgentTaskRecord {
  return {
    taskId: `task-${suffix}`,
    sessionId: 'session-1',
    turnId: 'turn-1',
    agentId: `child-${suffix}`,
    parentAgentId: 'primary',
    rootRuntimeId: 'runtime-root',
    checkpointId: 'checkpoint-1',
    toolCallId: `tool-call-${suffix}`,
    contractSnapshot: {
      contractSchemaVersion: 1,
      task: `Inspect resource ${suffix}`,
      acceptanceCriteria: ['Return a summary'],
      mode: 'read',
      resources: [{ kind: 'file', reference: `resource-${suffix}.md` }],
      requestedTools: ['read_file'],
      required: true
    },
    contractSnapshotHash: 'a'.repeat(64),
    executionPlanSnapshotHash: 'b'.repeat(64),
    status: 'queued',
    queuePhase: 'start',
    priority: 'normal',
    recordState: 'active',
    unfinishedJournalCount: 0,
    createdAt: '2026-07-27T00:00:00.000Z',
    updatedAt: '2026-07-27T00:00:00.000Z'
  };
}

/**
 * 创建与稳定 Child Actor 匹配的完整 Runtime 地址。
 * @param task - Runtime 所属 Task
 * @param runtimeId - 可替换 Runtime 身份
 * @returns 完整 Runtime 地址
 */
function createAddress(task: AgentTaskRecord, runtimeId: string): ChatRuntimeAddress {
  return {
    sessionId: task.sessionId,
    turnId: task.turnId,
    agentId: task.agentId,
    runtimeId,
    parentAgentId: task.parentAgentId,
    parentRuntimeId: 'runtime-parent',
    rootRuntimeId: task.rootRuntimeId
  };
}

describe('child actor registry', (): void => {
  it('keeps one stable Actor while Runtime bindings are replaced', (): void => {
    const registry = createChildActorRegistry();
    const task = createTask();
    const actor = registry.ensureActor(task);

    registry.bindRuntime(createAddress(task, 'runtime-1'), task.executionPlanSnapshotHash as string);
    expect(registry.getRuntime('runtime-1')).toMatchObject({
      taskId: task.taskId,
      planHash: task.executionPlanSnapshotHash
    });

    registry.unbindRuntime('runtime-1');
    registry.bindRuntime(createAddress(task, 'runtime-2'), task.executionPlanSnapshotHash as string);

    expect(registry.ensureActor(task)).toBe(actor);
    expect(registry.getRuntime('runtime-1')).toBeUndefined();
    expect(registry.getRuntime('runtime-2')?.address.runtimeId).toBe('runtime-2');
  });

  it('rejects an incomplete lineage or a Runtime already owned by another Actor', (): void => {
    const registry = createChildActorRegistry();
    const first = createTask('1');
    const second = createTask('2');
    registry.ensureActor(first);
    registry.ensureActor(second);
    registry.bindRuntime(createAddress(first, 'runtime-shared'), first.executionPlanSnapshotHash as string);
    expect((): void => {
      registry.bindRuntime(createAddress(first, 'runtime-shared'), first.executionPlanSnapshotHash as string);
    }).not.toThrow();

    expect((): void => {
      registry.bindRuntime(createAddress(second, 'runtime-shared'), second.executionPlanSnapshotHash as string);
    }).toThrowError(/runtime_binding_conflict/);
    expect((): void => {
      registry.bindRuntime({ ...createAddress(second, 'runtime-2'), rootRuntimeId: 'wrong-root' }, second.executionPlanSnapshotHash as string);
    }).toThrowError(/runtime_address_mismatch/);
  });

  it('keeps an aborted Actor for audit but rejects new Runtime bindings', (): void => {
    const registry = createChildActorRegistry();
    const task = createTask();
    const error: AgentTaskError = {
      code: 'cancelled',
      phase: 'runtime',
      category: 'user',
      retryable: false,
      details: { reason: 'user_cancelled' }
    };
    const actor = registry.ensureActor(task);

    registry.abortTask(task.taskId, error);

    expect(registry.ensureActor(task)).toBe(actor);
    expect(registry.getActor(task.taskId)?.abortReason).toEqual(error);
    expect((): void => {
      registry.bindRuntime(createAddress(task, 'runtime-after-abort'), task.executionPlanSnapshotHash as string);
    }).toThrowError(/actor_aborted/);
  });
});
