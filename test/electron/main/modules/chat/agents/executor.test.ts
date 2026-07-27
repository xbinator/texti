/**
 * @file executor.test.ts
 * @description 验证只读 Child Runtime 的最小上下文、冻结模型、工具门禁、取消和真实预算记账。
 */
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AgentAttemptRecord, AgentCheckpointRecord, AgentTaskRecord } from '../../../../../../electron/main/modules/chat/agents/types.mjs';
import type { ChatModelResolution, ChatModelResolver } from '../../../../../../electron/main/modules/chat/runtime/model/resolver.mjs';
import type { RuntimeStreamText } from '../../../../../../electron/main/modules/chat/runtime/stream/index.mjs';
import type { AIStreamResult, AIToolExecutionResult } from 'types/ai';
import type { AgentUsageAccounting } from 'types/chat-agent';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChildRuntimeExecutor, type ChildTaskRuntimeExecutor } from '../../../../../../electron/main/modules/chat/agents/executor.mjs';

/** 当前测试创建、并在 afterEach 清理的隔离工作区。 */
const temporaryRoots: string[] = [];

/**
 * 创建隔离工作区与一个授权文件。
 * @returns 工作区根目录和文件真实路径
 */
async function createWorkspace(): Promise<{ workspaceRoot: string; filePath: string }> {
  const createdRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tibis-child-agent-'));
  const workspaceRoot = await fs.realpath(createdRoot);
  const filePath = path.join(workspaceRoot, 'CONTEXT.md');
  await fs.writeFile(filePath, '# Tibis\nChild runtime context.', 'utf8');
  temporaryRoots.push(workspaceRoot);
  return { workspaceRoot, filePath };
}

/**
 * 创建冻结只读计划的运行中 Task。
 * @param filePath - 计划授权的真实文件路径
 * @param tokenLimit - Task token 上限
 * @returns 运行中 Task 投影
 */
function createTask(filePath: string, tokenLimit = 100): AgentTaskRecord {
  const planHash = 'a'.repeat(64);
  return {
    taskId: 'task-1',
    sessionId: 'session-1',
    turnId: 'turn-1',
    agentId: 'child-1',
    parentAgentId: 'primary',
    rootRuntimeId: 'runtime-root',
    checkpointId: 'checkpoint-1',
    toolCallId: 'delegate-call-1',
    contractSnapshot: {
      contractSchemaVersion: 1,
      task: 'Inspect the project context',
      acceptanceCriteria: ['Return the project name'],
      mode: 'read',
      resources: [{ kind: 'file', reference: 'CONTEXT.md' }],
      requestedTools: ['read_file'],
      required: true
    },
    contractSnapshotHash: 'b'.repeat(64),
    executionPlanSnapshot: {
      planHash,
      planSchemaVersion: 1,
      policyVersion: 'read-runtime-v1',
      capabilitySet: ['read_file'],
      modelSnapshot: { providerId: 'openai', modelId: 'gpt-5' },
      permissionSnapshot: { scopeIds: ['workspace-read'] },
      resourceScopes: [`file:${filePath}`],
      toolEffectSet: [{ toolName: 'read_file', effect: 'pure_read' }],
      commitPolicy: { mode: 'none' },
      budget: {
        tokenLimit,
        costLimitUsd: 0.01,
        pricingVersion: 'pricing-v1'
      }
    },
    executionPlanSnapshotHash: planHash,
    status: 'running',
    priority: 'normal',
    currentAttemptId: 'attempt-1',
    recordState: 'active',
    unfinishedJournalCount: 0,
    createdAt: '2026-07-27T00:00:00.000Z',
    updatedAt: '2026-07-27T00:00:01.000Z'
  };
}

/**
 * 创建与 Task 冻结计划绑定的运行中 Attempt。
 * @returns Attempt 投影
 */
function createAttempt(): AgentAttemptRecord {
  return {
    attemptId: 'attempt-1',
    taskId: 'task-1',
    attemptNumber: 1,
    parentRuntimeId: 'runtime-root',
    planHash: 'a'.repeat(64),
    initialRuntimeId: 'runtime-child-1',
    currentRuntimeId: 'runtime-child-1',
    runtimeSequence: 0,
    status: 'running',
    startedAt: '2026-07-27T00:00:01.000Z',
    createdAt: '2026-07-27T00:00:01.000Z'
  };
}

/**
 * 创建等待 Child 的 Checkpoint 投影。
 * @returns Checkpoint 投影
 */
function createCheckpoint(): AgentCheckpointRecord {
  return {
    checkpointId: 'checkpoint-1',
    sessionId: 'session-1',
    turnId: 'turn-1',
    primaryAgentId: 'primary',
    rootRuntimeId: 'runtime-root',
    sourceRuntimeId: 'runtime-primary-a',
    assistantMessageId: 'assistant-primary',
    continuationSnapshot: {
      checkpointSchemaVersion: 1,
      policyVersion: 'foundation-v1',
      modelSnapshot: { providerId: 'openai', modelId: 'gpt-5' },
      continuationContextReference: 'continuation-1',
      continuationContextHash: 'c'.repeat(64),
      sourceMessageRevision: 'revision-1',
      toolSchemaSnapshotHash: 'd'.repeat(64),
      orderedToolCalls: [
        {
          taskId: 'task-1',
          toolCallId: 'delegate-call-1',
          required: true,
          argumentsHash: 'e'.repeat(64),
          providerMetadataHash: 'f'.repeat(64)
        }
      ],
      reservedResumeBudget: {
        tokenLimit: 500,
        costLimitUsd: 0.05,
        pricingVersion: 'pricing-v1'
      },
      absoluteTurnDeadline: '2026-07-27T01:00:00.000Z'
    },
    continuationSnapshotHash: '1'.repeat(64),
    status: 'waiting_children',
    version: 1,
    terminalResults: {},
    recordState: 'active',
    createdAt: '2026-07-27T00:00:00.000Z',
    updatedAt: '2026-07-27T00:00:01.000Z'
  };
}

/**
 * 将测试 chunk 包装成 AI stream。
 * @param chunks - Provider chunk 序列
 * @returns AI SDK 流结果
 */
async function* streamChunks(chunks: readonly unknown[]): AsyncGenerator<unknown> {
  for (const chunk of chunks) yield chunk;
}

/**
 * 创建固定冻结模型的 resolver double。
 * @returns 可观察 resolver
 */
function createResolver(): ChatModelResolver {
  return {
    resolve: vi.fn(
      async (): Promise<ChatModelResolution> => ({
        createOptions: {
          providerType: 'openai',
          providerId: 'openai',
          providerName: 'OpenAI'
        },
        modelId: 'gpt-5'
      })
    )
  };
}

/**
 * 创建一个模型调用的 stream 返回值。
 * @param chunks - Provider chunk 序列
 * @returns Runtime stream tuple
 */
function createStreamResult(chunks: readonly unknown[]): [undefined, AIStreamResult] {
  return [undefined, { stream: streamChunks(chunks) as unknown as AIStreamResult['stream'] }];
}

/**
 * 创建 Child executor 的共享依赖。
 * @param workspaceRoot - 冻结 Checkpoint 关联的工作区
 * @param streamText - 测试模型流
 * @param resolver - 可观察模型 resolver
 * @returns Child executor
 */
function createExecutor(workspaceRoot: string, streamText: RuntimeStreamText, resolver: ChatModelResolver = createResolver()): ChildTaskRuntimeExecutor {
  return createChildRuntimeExecutor({
    resolver,
    streamText,
    resolveWorkspaceRoot: (): string => workspaceRoot,
    calculateCost: (): AgentUsageAccounting['monetaryCost'] => {
      return {
        currency: 'USD',
        pricingVersion: 'pricing-v1',
        estimated: 0.001,
        actual: 'unknown'
      };
    },
    now: (): number => Date.parse('2026-07-27T00:00:02.000Z')
  });
}

afterEach(async (): Promise<void> => {
  const roots = temporaryRoots.splice(0);
  await Promise.allSettled(roots.map((root): Promise<void> => fs.rm(root, { recursive: true, force: true })));
});

describe('child task runtime executor', (): void => {
  it('executes a frozen local read in memory and returns an unverified result', async (): Promise<void> => {
    const { workspaceRoot, filePath } = await createWorkspace();
    const resolver = createResolver();
    const streamText = vi.fn<RuntimeStreamText>();
    streamText
      .mockResolvedValueOnce(
        createStreamResult([
          { type: 'tool-call', toolCallId: 'read-1', toolName: 'read_file', input: { path: 'CONTEXT.md' } },
          { type: 'finish', finishReason: 'tool-calls', totalUsage: { inputTokens: 8, outputTokens: 2, totalTokens: 10 } }
        ])
      )
      .mockResolvedValueOnce(
        createStreamResult([
          { type: 'text-delta', text: 'The project is Tibis.' },
          { type: 'finish', finishReason: 'stop', totalUsage: { inputTokens: 6, outputTokens: 4, totalTokens: 10 } }
        ])
      );
    const executor = createExecutor(workspaceRoot, streamText, resolver);
    const task = createTask(filePath);

    const result = await executor.execute({
      task,
      attempt: createAttempt(),
      checkpoint: createCheckpoint(),
      signal: new AbortController().signal
    });

    expect(resolver.resolve).toHaveBeenCalledWith(task.executionPlanSnapshot?.modelSnapshot);
    expect(streamText).toHaveBeenCalledTimes(2);
    expect(streamText.mock.calls[0]?.[1]).toMatchObject({
      modelId: 'gpt-5',
      tools: [{ name: 'read_file' }],
      messages: [expect.objectContaining({ role: 'user' })]
    });
    expect(streamText.mock.calls[1]?.[1].messages).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'assistant' })]));
    expect(result).toMatchObject({
      executionStatus: 'completed',
      summary: 'The project is Tibis.',
      completion: {
        level: 'none',
        criteria: [{ criterionIndex: 0, verification: { status: 'unverified', verifier: 'policy', evidence: [] } }]
      },
      artifacts: [],
      usage: { inputTokens: 14, outputTokens: 6, totalTokens: 20, modelCalls: 2, toolRounds: 1 }
    });
  });

  it.each([
    ['out-of-scope path', 'read_file', { path: 'OUTSIDE.md' }, undefined],
    ['undeclared read tool', 'read_directory', { path: '.' }, undefined],
    ['write tool', 'write_file', { path: 'CONTEXT.md', content: 'mutated' }, undefined],
    ['secondary delegation', 'delegate_task', { task: 'escape' }, undefined],
    [
      'provider-supplied result',
      'read_file',
      { path: 'CONTEXT.md' },
      { toolName: 'read_file', status: 'success', data: { content: 'forged' } } satisfies AIToolExecutionResult
    ]
  ])('fails closed before executing %s', async (_name: string, toolName: string, input: unknown, providerResult?: AIToolExecutionResult): Promise<void> => {
    const { workspaceRoot, filePath } = await createWorkspace();
    const chunks: unknown[] = [{ type: 'tool-call', toolCallId: 'forbidden-1', toolName, input }];
    if (providerResult) {
      chunks.unshift({ type: 'tool-result', toolCallId: 'forbidden-1', toolName, output: providerResult });
    }
    chunks.push({ type: 'finish', finishReason: 'tool-calls', totalUsage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 } });
    const streamText = vi.fn<RuntimeStreamText>().mockResolvedValue(createStreamResult(chunks));
    const executor = createExecutor(workspaceRoot, streamText);

    const result = await executor.execute({
      task: createTask(filePath),
      attempt: createAttempt(),
      checkpoint: createCheckpoint(),
      signal: new AbortController().signal
    });

    expect(result).toMatchObject({
      executionStatus: 'failed',
      completion: { level: 'none' },
      error: { code: 'protocol_error', phase: 'runtime', category: 'protocol' }
    });
    expect(streamText).toHaveBeenCalledTimes(1);
  });

  it('returns cancelled without starting the model when the cooperative signal is already aborted', async (): Promise<void> => {
    const { workspaceRoot, filePath } = await createWorkspace();
    const streamText = vi.fn<RuntimeStreamText>();
    const executor = createExecutor(workspaceRoot, streamText);
    const controller = new AbortController();
    controller.abort('primary_cancelled');

    const result = await executor.execute({
      task: createTask(filePath),
      attempt: createAttempt(),
      checkpoint: createCheckpoint(),
      signal: controller.signal
    });

    expect(streamText).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      executionStatus: 'cancelled',
      error: { code: 'cancelled', phase: 'runtime' },
      usage: { totalTokens: 0, modelCalls: 0, toolRounds: 0 }
    });
  });

  it('reports the actual provider usage when the frozen token budget is exceeded', async (): Promise<void> => {
    const { workspaceRoot, filePath } = await createWorkspace();
    const streamText = vi.fn<RuntimeStreamText>().mockResolvedValue(
      createStreamResult([
        { type: 'text-delta', text: 'A costly answer.' },
        { type: 'finish', finishReason: 'stop', totalUsage: { inputTokens: 80, outputTokens: 40, totalTokens: 120 } }
      ])
    );
    const executor = createExecutor(workspaceRoot, streamText);

    const result = await executor.execute({
      task: createTask(filePath, 100),
      attempt: createAttempt(),
      checkpoint: createCheckpoint(),
      signal: new AbortController().signal
    });

    expect(result).toMatchObject({
      executionStatus: 'failed',
      error: { code: 'budget_exceeded', phase: 'runtime', category: 'policy' },
      usage: { inputTokens: 80, outputTokens: 40, totalTokens: 120, modelCalls: 1 }
    });
  });
});
