/**
 * @file plan-compiler.test.ts
 * @description 验证 Child 只读计划的精确能力交集、模型继承和恢复单调性。
 */
import type { AgentCheckpointRecord, AgentTaskRecord } from '../../../../../../electron/main/modules/chat/agents/types.mjs';
import type { ToolRegistryEntry, ToolRuntimeOwner } from '../../../../../../shared/ai/tools/index.js';
import type { AgentBudgetSnapshot } from 'types/chat-agent';
import { describe, expect, it } from 'vitest';
import {
  compileAgentPlan,
  restoreAgentPlan,
  type AgentPlanCompilerDependencies,
  type AgentPlanCompileInput
} from '../../../../../../electron/main/modules/chat/agents/plan-compiler.mjs';

/** 计划测试使用的固定 Task 预算。 */
const budget: AgentBudgetSnapshot = {
  tokenLimit: 800,
  costLimitUsd: 0.08,
  pricingVersion: 'test-v1'
};

/**
 * 创建最小可信 Task 投影。
 * @param requestedTools - 不可变契约请求的工具集合
 * @returns created 状态的只读 Task
 */
function createTask(requestedTools: readonly string[]): AgentTaskRecord {
  return {
    taskId: 'task-1',
    sessionId: 'session-1',
    turnId: 'turn-1',
    agentId: 'child-1',
    parentAgentId: 'primary',
    rootRuntimeId: 'runtime-root-1',
    checkpointId: 'checkpoint-1',
    toolCallId: 'tool-call-1',
    contractSnapshot: {
      contractSchemaVersion: 1,
      task: 'Inspect the explicit resources',
      acceptanceCriteria: ['Return a concise summary'],
      mode: 'read',
      resources: [{ kind: 'file', reference: 'CONTEXT.md' }],
      requestedTools: [...requestedTools].sort(),
      required: true
    },
    contractSnapshotHash: 'a'.repeat(64),
    status: 'created',
    priority: 'normal',
    recordState: 'active',
    unfinishedJournalCount: 0,
    createdAt: '2026-07-24T08:00:00.000Z',
    updatedAt: '2026-07-24T08:00:00.000Z'
  };
}

/**
 * 创建与 Task 身份和模型绑定的 Checkpoint。
 * @returns waiting_children Checkpoint
 */
function createCheckpoint(): AgentCheckpointRecord {
  return {
    checkpointId: 'checkpoint-1',
    sessionId: 'session-1',
    turnId: 'turn-1',
    primaryAgentId: 'primary',
    rootRuntimeId: 'runtime-root-1',
    sourceRuntimeId: 'runtime-a-1',
    assistantMessageId: 'assistant-1',
    continuationSnapshot: {
      checkpointSchemaVersion: 1,
      policyVersion: 'foundation-v1',
      modelSnapshot: { providerId: 'openai', modelId: 'gpt-5' },
      continuationContextReference: 'continuation-1',
      continuationContextHash: 'b'.repeat(64),
      sourceMessageRevision: 'c'.repeat(64),
      toolSchemaSnapshotHash: 'd'.repeat(64),
      orderedToolCalls: [
        {
          toolCallId: 'tool-call-1',
          taskId: 'task-1',
          required: true,
          argumentsHash: 'e'.repeat(64),
          providerMetadataHash: 'f'.repeat(64)
        }
      ],
      reservedResumeBudget: { tokenLimit: 512, costLimitUsd: 0, pricingVersion: 'unknown' },
      absoluteTurnDeadline: '2026-07-24T09:00:00.000Z'
    },
    continuationSnapshotHash: '1'.repeat(64),
    status: 'waiting_children',
    version: 1,
    terminalResults: {},
    recordState: 'active',
    createdAt: '2026-07-24T08:00:00.000Z',
    updatedAt: '2026-07-24T08:00:00.000Z'
  };
}

/**
 * 创建指定安全元数据的工具 registry 条目。
 * @param toolName - 工具名称
 * @param effect - 副作用类别
 * @param resolver - 资源解析器名称
 * @param runtime - Runtime owner
 * @param executionClass - 执行方式
 * @returns registry 条目
 */
function createToolEntry(
  toolName: string,
  effect: ToolRegistryEntry['effect']['effect'] = 'pure_read',
  resolver = 'file-path',
  runtime: ToolRuntimeOwner = 'main',
  executionClass: ToolRegistryEntry['executionClass'] = 'direct'
): ToolRegistryEntry {
  return {
    runtime,
    group: 'file',
    exposure: 'conditional-readonly',
    executionClass,
    effect: {
      effect,
      resourceScopeResolver: resolver,
      reversible: true
    },
    definition: {
      name: toolName,
      description: toolName,
      source: 'builtin',
      riskLevel: 'read',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false
      }
    }
  };
}

/**
 * 创建可控 registry 与资源解析依赖。
 * @param entries - 当前注册工具
 * @param policyTools - 当前 Child policy 允许的工具
 * @returns 计划编译依赖
 */
function createDependencies(entries: readonly ToolRegistryEntry[], policyTools: readonly string[] = entries.map((entry): string => entry.definition.name)) {
  const registry = new Map(entries.map((entry): [string, ToolRegistryEntry] => [entry.definition.name, entry]));
  const policy = new Set(policyTools);
  return {
    resolveScopes: () => ({
      ok: true as const,
      workspaceRealRoot: '/repo',
      resourceScopes: ['file:/repo/CONTEXT.md']
    }),
    getToolEntry: (toolName: string): ToolRegistryEntry | undefined => registry.get(toolName),
    isToolAllowed: (toolName: string): boolean => policy.has(toolName),
    isModelToolCapable: (): boolean => true
  } satisfies AgentPlanCompilerDependencies;
}

/**
 * 创建标准计划编译输入。
 * @param task - 待编译 Task
 * @returns 继承固定 Checkpoint 的输入
 */
function createCompileInput(task: AgentTaskRecord): AgentPlanCompileInput {
  return {
    task,
    checkpoint: createCheckpoint(),
    parentToolNames: ['delegate_task', 'external_tool', 'grep', 'read_file', 'unknown_tool', 'write_file'],
    availableToolNames: ['delegate_task', 'external_tool', 'grep', 'read_file', 'unknown_tool', 'write_file'],
    permissionScopeIds: ['workspace:repo:read'],
    workspaceRoot: '/repo',
    budget
  };
}

describe('agent read plan compiler', (): void => {
  it('computes the exact sorted pure-read capability intersection and inherits the frozen model', (): void => {
    const task = createTask(['read_file', 'write_file', 'external_tool', 'unknown_tool']);
    const dependencies = createDependencies([
      createToolEntry('read_file'),
      createToolEntry('grep', 'pure_read', 'grep-root'),
      createToolEntry('write_file', 'staged_file_write'),
      createToolEntry('external_tool', 'external_read'),
      createToolEntry('unknown_tool', 'unknown')
    ]);

    const result = compileAgentPlan(createCompileInput(task), dependencies);

    expect(result).toMatchObject({
      ok: true,
      plan: {
        capabilitySet: ['read_file'],
        modelSnapshot: createCheckpoint().continuationSnapshot.modelSnapshot,
        permissionSnapshot: { scopeIds: ['workspace:repo:read'] },
        resourceScopes: ['file:/repo/CONTEXT.md'],
        toolEffectSet: [{ toolName: 'read_file', effect: 'pure_read' }],
        commitPolicy: { mode: 'none' },
        budget
      }
    });
  });

  it.each([
    ['renderer runtime', createToolEntry('unsafe_tool', 'pure_read', 'file-path', 'renderer')],
    ['deferred execution', createToolEntry('unsafe_tool', 'pure_read', 'file-path', 'main', 'deferred-coordination')],
    ['external read', createToolEntry('unsafe_tool', 'external_read')],
    ['unknown effect', createToolEntry('unsafe_tool', 'unknown')],
    ['unsupported resolver', createToolEntry('unsafe_tool', 'pure_read', 'active-document')],
    ['recursive delegation', createToolEntry('delegate_task', 'pure_read', 'file-path', 'coordinator', 'deferred-coordination')]
  ] as const)('rejects %s when no safe requested capability remains', (_caseName, entry): void => {
    const task = createTask([entry.definition.name]);
    const input = {
      ...createCompileInput(task),
      parentToolNames: [entry.definition.name],
      availableToolNames: [entry.definition.name]
    };

    expect(compileAgentPlan(input, createDependencies([entry], [entry.definition.name]))).toMatchObject({
      ok: false,
      error: {
        code: 'capability_denied',
        phase: 'plan_validation',
        category: 'policy'
      }
    });
  });

  it('rejects tools absent from the frozen parent schema or current availability', (): void => {
    const task = createTask(['read_file']);
    const dependencies = createDependencies([createToolEntry('read_file')]);

    expect(compileAgentPlan({ ...createCompileInput(task), parentToolNames: [] }, dependencies)).toMatchObject({
      ok: false,
      error: { code: 'capability_denied' }
    });
    expect(compileAgentPlan({ ...createCompileInput(task), availableToolNames: [] }, dependencies)).toMatchObject({
      ok: false,
      error: { code: 'capability_denied' }
    });
  });

  it('rejects mismatched aggregate identity before compiling a plan', (): void => {
    const task = { ...createTask(['read_file']), checkpointId: 'checkpoint-forged' };

    expect(compileAgentPlan(createCompileInput(task), createDependencies([createToolEntry('read_file')]))).toMatchObject({
      ok: false,
      error: {
        code: 'protocol_error',
        phase: 'plan_validation',
        details: { reason: 'plan_aggregate_identity_invalid' }
      }
    });
  });

  it('restores only monotonic capability, permission, resource and budget intersections without mutating the persisted plan', (): void => {
    const task = createTask(['grep', 'read_file']);
    const compiled = compileAgentPlan(
      {
        ...createCompileInput(task),
        parentToolNames: ['grep', 'read_file'],
        availableToolNames: ['grep', 'read_file']
      },
      createDependencies([createToolEntry('grep', 'pure_read', 'grep-root'), createToolEntry('read_file')])
    );
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const persistedPlan = compiled.plan;

    const restored = restoreAgentPlan(
      {
        task: {
          ...task,
          status: 'queued',
          queuePhase: 'start',
          executionPlanSnapshot: persistedPlan,
          executionPlanSnapshotHash: persistedPlan.planHash
        },
        checkpoint: createCheckpoint(),
        availableToolNames: ['new_tool', 'read_file'],
        permissionScopeIds: ['workspace:repo:read', 'workspace:new:read'],
        resourceScopes: ['file:/repo/CONTEXT.md', 'file:/repo/new.md'],
        budget: { tokenLimit: 400, costLimitUsd: 0.04, pricingVersion: 'test-v2' },
        previousEffective: null
      },
      createDependencies([createToolEntry('read_file'), createToolEntry('new_tool')], ['new_tool', 'read_file'])
    );

    expect(restored).toMatchObject({
      ok: true,
      restored: {
        persistedPlan,
        effectiveCapabilitySet: ['read_file'],
        effectivePermissionScopeIds: ['workspace:repo:read'],
        effectiveResourceScopes: ['file:/repo/CONTEXT.md'],
        effectiveBudget: { tokenLimit: 400, costLimitUsd: 0.04, pricingVersion: 'test-v1' }
      }
    });
    expect(compiled.plan).toBe(persistedPlan);
    expect(Object.isFrozen(persistedPlan)).toBe(true);
  });

  it('never re-expands a prior effective projection when current capabilities or scopes return', (): void => {
    const task = createTask(['grep', 'read_file']);
    const dependencies = {
      ...createDependencies([createToolEntry('grep', 'pure_read', 'grep-root'), createToolEntry('read_file')]),
      resolveScopes: () => ({
        ok: true as const,
        workspaceRealRoot: '/repo',
        resourceScopes: ['file:/repo/CONTEXT.md', 'file:/repo/README.md']
      })
    };
    const compiled = compileAgentPlan(
      {
        ...createCompileInput(task),
        parentToolNames: ['grep', 'read_file'],
        availableToolNames: ['grep', 'read_file'],
        permissionScopeIds: ['workspace:docs:read', 'workspace:repo:read']
      },
      dependencies
    );
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const persistedTask: AgentTaskRecord = {
      ...task,
      status: 'queued',
      queuePhase: 'start',
      executionPlanSnapshot: compiled.plan,
      executionPlanSnapshotHash: compiled.plan.planHash
    };
    const firstRestore = restoreAgentPlan(
      {
        task: persistedTask,
        checkpoint: createCheckpoint(),
        availableToolNames: ['read_file'],
        permissionScopeIds: ['workspace:repo:read'],
        resourceScopes: ['file:/repo/CONTEXT.md'],
        budget: { tokenLimit: 300, costLimitUsd: 0.03, pricingVersion: 'current-v1' },
        previousEffective: null
      },
      dependencies
    );
    expect(firstRestore.ok).toBe(true);
    if (!firstRestore.ok) return;

    const secondRestore = restoreAgentPlan(
      {
        task: persistedTask,
        checkpoint: createCheckpoint(),
        availableToolNames: ['grep', 'read_file'],
        permissionScopeIds: ['workspace:docs:read', 'workspace:repo:read'],
        resourceScopes: ['file:/repo/CONTEXT.md', 'file:/repo/README.md'],
        budget: { tokenLimit: 800, costLimitUsd: 0.08, pricingVersion: 'current-v2' },
        previousEffective: firstRestore.restored
      },
      dependencies
    );

    expect(secondRestore).toMatchObject({
      ok: true,
      restored: {
        effectiveCapabilitySet: ['read_file'],
        effectivePermissionScopeIds: ['workspace:repo:read'],
        effectiveResourceScopes: ['file:/repo/CONTEXT.md'],
        effectiveBudget: { tokenLimit: 300, costLimitUsd: 0.03, pricingVersion: 'test-v1' }
      }
    });
  });

  it('fails restoration when registry metadata drifts or no persisted capability remains', (): void => {
    const task = createTask(['read_file']);
    const compiled = compileAgentPlan(createCompileInput(task), createDependencies([createToolEntry('read_file')]));
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const restoreInput = {
      task: {
        ...task,
        status: 'queued' as const,
        queuePhase: 'start' as const,
        executionPlanSnapshot: compiled.plan,
        executionPlanSnapshotHash: compiled.plan.planHash
      },
      checkpoint: createCheckpoint(),
      availableToolNames: ['read_file'],
      permissionScopeIds: ['workspace:repo:read'],
      resourceScopes: ['file:/repo/CONTEXT.md'],
      budget,
      previousEffective: null
    };

    const drifted = restoreAgentPlan(restoreInput, createDependencies([createToolEntry('read_file', 'external_read')]));
    const unavailable = restoreAgentPlan({ ...restoreInput, availableToolNames: [] }, createDependencies([createToolEntry('read_file')]));

    expect(drifted).toMatchObject({ ok: false, error: { phase: 'recovery', details: { reason: 'restore_tool_metadata_drift' } } });
    expect(unavailable).toMatchObject({ ok: false, error: { phase: 'recovery' } });
  });

  it.each(['completed', 'failed', 'cancelled'] as const)('does not restore a terminal %s Task', (status): void => {
    const task = createTask(['read_file']);
    const compiled = compileAgentPlan(createCompileInput(task), createDependencies([createToolEntry('read_file')]));
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    expect(
      restoreAgentPlan(
        {
          task: {
            ...task,
            status,
            executionPlanSnapshot: compiled.plan,
            executionPlanSnapshotHash: compiled.plan.planHash
          },
          checkpoint: createCheckpoint(),
          availableToolNames: ['read_file'],
          permissionScopeIds: ['workspace:repo:read'],
          resourceScopes: ['file:/repo/CONTEXT.md'],
          budget,
          previousEffective: null
        },
        createDependencies([createToolEntry('read_file')])
      )
    ).toMatchObject({ ok: false, error: { details: { reason: 'restore_plan_identity_invalid' } } });
  });

  it('rejects non-finite current recovery budgets', (): void => {
    const task = createTask(['read_file']);
    const compiled = compileAgentPlan(createCompileInput(task), createDependencies([createToolEntry('read_file')]));
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    expect(
      restoreAgentPlan(
        {
          task: {
            ...task,
            status: 'queued',
            queuePhase: 'start',
            executionPlanSnapshot: compiled.plan,
            executionPlanSnapshotHash: compiled.plan.planHash
          },
          checkpoint: createCheckpoint(),
          availableToolNames: ['read_file'],
          permissionScopeIds: ['workspace:repo:read'],
          resourceScopes: ['file:/repo/CONTEXT.md'],
          budget: { ...budget, tokenLimit: Number.NaN },
          previousEffective: null
        },
        createDependencies([createToolEntry('read_file')])
      )
    ).toMatchObject({ ok: false, error: { details: { reason: 'restore_budget_invalid' } } });
  });
});
