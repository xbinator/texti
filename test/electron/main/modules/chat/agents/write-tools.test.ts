/**
 * @file write-tools.test.ts
 * @description 验证 Child write Runtime 的纯读与 staged 工具组合、逐次授权和 cooperative cancellation。
 */
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AgentExecutionPlanBody } from '../../../../../../electron/main/modules/chat/agents/contracts.mjs';
import type { AgentAttemptRecord, AgentTaskRecord } from '../../../../../../electron/main/modules/chat/agents/types.mjs';
import type { ActiveChatRuntime } from '../../../../../../electron/main/modules/chat/runtime/types.mjs';
import type { AgentExecutionPlanSnapshot } from 'types/chat-agent';
import { afterEach, describe, expect, it } from 'vitest';
import {
  hashExecutionPlanSnapshot,
  validateExecutionPlanSnapshot,
  validateFoundationContract
} from '../../../../../../electron/main/modules/chat/agents/contracts.mjs';
import { createChildWriteTools } from '../../../../../../electron/main/modules/chat/agents/write-tools.mjs';

/** 测试创建并负责清理的临时目录。 */
const temporaryRoots: string[] = [];

/** 固定测试时间。 */
const occurredAt = '2026-07-27T00:00:00.000Z';

/** write tools 测试所需持久化事实。 */
interface WriteToolFacts {
  /** running write Task。 */
  task: AgentTaskRecord;
  /** 当前 running Attempt。 */
  attempt: AgentAttemptRecord;
  /** 包含 pure-read 与 staged-write 能力的冻结计划。 */
  plan: AgentExecutionPlanSnapshot;
}

/** 单次测试目录。 */
interface WriteToolRoots {
  /** 临时总根。 */
  root: string;
  /** 真实工作区根。 */
  workspaceRoot: string;
  /** Attempt 私有 overlay 根。 */
  overlayRoot: string;
}

/**
 * 创建隔离工作区和 overlay 根。
 * @returns 已 canonicalize 的测试目录
 */
async function createRoots(): Promise<WriteToolRoots> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tibis-agent-write-tools-'));
  const workspaceRoot = path.join(root, 'workspace');
  const overlayRoot = path.join(root, 'overlays');
  await fs.mkdir(workspaceRoot, { recursive: true });
  await fs.mkdir(overlayRoot, { recursive: true });
  temporaryRoots.push(root);
  return {
    root,
    workspaceRoot: await fs.realpath(workspaceRoot),
    overlayRoot: await fs.realpath(overlayRoot)
  };
}

/**
 * 创建混合 pure-read 与 staged-write 的合法 write 事实。
 * @param resourceScopes - canonical 文件资源范围
 * @returns write Task、Attempt 与 Plan
 */
function createFacts(resourceScopes: readonly string[]): WriteToolFacts {
  const contractValidation = validateFoundationContract({
    task: 'Read and stage controlled file changes',
    acceptanceCriteria: ['Return one integrity-bound changeset'],
    mode: 'write',
    resources: [{ kind: 'directory', reference: '.' }],
    requestedTools: ['read_file', 'stage_file_edit', 'stage_file_write'],
    required: true,
    priority: 'normal'
  });
  if (!contractValidation.ok) throw new Error('Write tool contract fixture must be valid');
  const body: AgentExecutionPlanBody = {
    planSchemaVersion: 1,
    policyVersion: 'controlled-write-v1',
    capabilitySet: ['read_file', 'stage_file_edit', 'stage_file_write'],
    modelSnapshot: { providerId: 'openai', modelId: 'gpt-5' },
    permissionSnapshot: { scopeIds: ['workspace-write'] },
    resourceScopes,
    toolEffectSet: [
      { toolName: 'read_file', effect: 'pure_read' },
      { toolName: 'stage_file_edit', effect: 'staged_file_write' },
      { toolName: 'stage_file_write', effect: 'staged_file_write' }
    ],
    commitPolicy: { mode: 'staged', adapter: 'atomic-file-v1' },
    budget: { tokenLimit: 1000, costLimitUsd: 1, pricingVersion: 'test-v1' }
  };
  const candidate: AgentExecutionPlanSnapshot = {
    ...body,
    planHash: hashExecutionPlanSnapshot(contractValidation.contractSnapshot, body)
  };
  const planValidation = validateExecutionPlanSnapshot(contractValidation.contractSnapshot, candidate);
  if (!planValidation.ok) throw new Error('Write tool plan fixture must be valid');
  const { plan } = planValidation;
  const task: AgentTaskRecord = {
    taskId: 'task-write-tools',
    sessionId: 'session-write-tools',
    turnId: 'turn-write-tools',
    agentId: 'child-write-tools',
    parentAgentId: 'primary',
    rootRuntimeId: 'runtime-root',
    checkpointId: 'checkpoint-write-tools',
    toolCallId: 'delegate-write-tools',
    contractSnapshot: contractValidation.contractSnapshot,
    contractSnapshotHash: contractValidation.contractSnapshotHash,
    executionPlanSnapshot: plan,
    executionPlanSnapshotHash: plan.planHash,
    status: 'running',
    priority: 'normal',
    currentAttemptId: 'attempt-write-tools',
    recordState: 'active',
    unfinishedJournalCount: 0,
    createdAt: occurredAt,
    updatedAt: occurredAt
  };
  const attempt: AgentAttemptRecord = {
    attemptId: 'attempt-write-tools',
    taskId: task.taskId,
    attemptNumber: 1,
    parentRuntimeId: 'runtime-parent',
    planHash: plan.planHash,
    initialRuntimeId: 'runtime-write-tools',
    currentRuntimeId: 'runtime-write-tools',
    runtimeSequence: 1,
    status: 'running',
    usageSnapshot: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      modelCalls: 0,
      toolRounds: 0,
      queueDurationMs: 0,
      executionDurationMs: 0,
      externalRequests: 0,
      monetaryCost: { currency: 'USD', pricingVersion: 'test-v1', estimated: 0, actual: 'unknown' }
    },
    usageComplete: false,
    usageUpdatedAt: occurredAt,
    startedAt: occurredAt,
    createdAt: occurredAt
  };
  return { task, attempt, plan };
}

/**
 * 创建与 write Attempt 对齐的活跃 Runtime。
 * @param facts - write 事实
 * @param signalController - Runtime cancellation controller
 * @returns 可传给 tool guard/executor 的 Runtime
 */
function createRuntime(facts: WriteToolFacts, signalController: AbortController): ActiveChatRuntime {
  return {
    sessionId: facts.task.sessionId,
    turnId: facts.task.turnId,
    agentId: facts.task.agentId,
    runtimeId: facts.attempt.currentRuntimeId,
    parentAgentId: facts.task.parentAgentId,
    parentRuntimeId: facts.attempt.parentRuntimeId,
    rootRuntimeId: facts.task.rootRuntimeId,
    clientId: 'client-write-tools',
    status: 'running',
    phase: 'streaming',
    abortController: signalController,
    createdAt: Date.parse(occurredAt)
  };
}

/**
 * 创建确定性 changeset/operation ID。
 * @returns 单调递增 ID 工厂
 */
function createIdFactory(): (kind: 'changeset' | 'operation') => string {
  const counters = new Map<'changeset' | 'operation', number>();
  return (kind: 'changeset' | 'operation'): string => {
    const next = (counters.get(kind) ?? 0) + 1;
    counters.set(kind, next);
    return `${kind}-${next}`;
  };
}

afterEach(async (): Promise<void> => {
  const roots = temporaryRoots.splice(0);
  await Promise.allSettled(roots.map((root): Promise<void> => fs.rm(root, { recursive: true, force: true })));
});

describe('child write tools', (): void => {
  it('combines pure-read and staged tools without mutating the workspace', async (): Promise<void> => {
    const roots = await createRoots();
    const targetPath = path.join(roots.workspaceRoot, 'notes.md');
    await fs.writeFile(targetPath, 'old content', 'utf8');
    const facts = createFacts([`directory:${roots.workspaceRoot}/**`]);
    const controller = new AbortController();
    const runtime = createRuntime(facts, controller);
    const writeTools = await createChildWriteTools({
      ...facts,
      runtimeId: runtime.runtimeId,
      workspaceRoot: roots.workspaceRoot,
      overlayRoot: roots.overlayRoot,
      signal: controller.signal,
      now: (): string => occurredAt,
      createId: createIdFactory()
    });

    expect(writeTools.tools.map((tool): string => tool.name).sort()).toEqual(['read_file', 'stage_file_edit', 'stage_file_write']);
    const readResult = await writeTools.executeMainTool({
      runtime,
      toolCallId: 'read-call',
      toolName: 'read_file',
      input: { path: 'notes.md' }
    });
    expect(readResult).toMatchObject({ status: 'success' });

    const writeResult = await writeTools.executeMainTool({
      runtime,
      toolCallId: 'write-call',
      toolName: 'stage_file_write',
      input: { path: 'notes.md', content: 'candidate content' }
    });
    expect(writeResult).toMatchObject({
      status: 'success',
      data: { displayPath: 'notes.md', changed: true }
    });
    expect(await fs.readFile(targetPath, 'utf8')).toBe('old content');
    expect(await writeTools.prepare()).toMatchObject({
      operations: [{ kind: 'replace', displayPath: 'notes.md' }]
    });
    expect(await fs.readFile(targetPath, 'utf8')).toBe('old content');
  });

  it('rejects non-local staged results and invalid staged inputs before any write', async (): Promise<void> => {
    const roots = await createRoots();
    const facts = createFacts([`directory:${roots.workspaceRoot}/**`]);
    const controller = new AbortController();
    const runtime = createRuntime(facts, controller);
    const writeTools = await createChildWriteTools({
      ...facts,
      runtimeId: runtime.runtimeId,
      workspaceRoot: roots.workspaceRoot,
      overlayRoot: roots.overlayRoot,
      signal: controller.signal,
      now: (): string => occurredAt,
      createId: createIdFactory()
    });

    await expect(
      writeTools.guardToolCall({
        runtime,
        toolCallId: 'provider-call',
        toolName: 'stage_file_write',
        input: { path: 'notes.md', content: 'candidate' },
        source: 'provider'
      })
    ).resolves.toMatchObject({
      status: 'failure',
      error: { details: { reason: 'non_local_result_forbidden' } }
    });
    await expect(
      writeTools.guardToolCall({
        runtime,
        toolCallId: 'invalid-call',
        toolName: 'stage_file_write',
        input: { path: 'notes.md', content: 'candidate', unexpected: true },
        source: 'main'
      })
    ).resolves.toMatchObject({
      status: 'failure',
      error: { code: 'INVALID_INPUT', details: { reason: 'stage_file_write_input_invalid' } }
    });
    expect(await writeTools.prepare()).toBeNull();
  });

  it('rechecks the frozen capability and cooperative cancellation on every call', async (): Promise<void> => {
    const roots = await createRoots();
    const facts = createFacts([`directory:${roots.workspaceRoot}/**`]);
    const mutablePlan = structuredClone(facts.plan);
    const controller = new AbortController();
    const runtime = createRuntime({ ...facts, plan: mutablePlan }, controller);
    const writeTools = await createChildWriteTools({
      ...facts,
      plan: mutablePlan,
      runtimeId: runtime.runtimeId,
      workspaceRoot: roots.workspaceRoot,
      overlayRoot: roots.overlayRoot,
      signal: controller.signal,
      now: (): string => occurredAt,
      createId: createIdFactory()
    });

    Object.assign(mutablePlan, { capabilitySet: ['read_file'] });
    await expect(
      writeTools.guardToolCall({
        runtime,
        toolCallId: 'removed-capability-call',
        toolName: 'stage_file_edit',
        input: { path: 'notes.md', oldString: 'old', newString: 'new', replaceAll: false },
        source: 'main'
      })
    ).resolves.toMatchObject({
      status: 'failure',
      error: { details: { reason: 'frozen_capability_denied' } }
    });

    controller.abort();
    await expect(
      writeTools.executeMainTool({
        runtime,
        toolCallId: 'cancelled-call',
        toolName: 'read_file',
        input: { path: 'notes.md' }
      })
    ).resolves.toMatchObject({
      status: 'cancelled',
      error: { code: 'USER_CANCELLED' }
    });
  });
});
