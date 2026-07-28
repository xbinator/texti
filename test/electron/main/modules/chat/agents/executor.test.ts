/**
 * @file executor.test.ts
 * @description 验证只读 Child Runtime 的最小上下文、冻结模型、工具门禁、取消和真实预算记账。
 */
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type {
  AgentAttemptRecord,
  AgentCheckpointRecord,
  AgentTaskRecord,
  RecordAttemptUsageInput
} from '../../../../../../electron/main/modules/chat/agents/types.mjs';
import type { ChatModelResolution, ChatModelResolver } from '../../../../../../electron/main/modules/chat/runtime/model/resolver.mjs';
import type { RuntimeStreamText } from '../../../../../../electron/main/modules/chat/runtime/stream/index.mjs';
import type { AIStreamResult, AIToolExecutionResult } from 'types/ai';
import type { AgentUsageAccounting, ChatAgentResult } from 'types/chat-agent';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createChildRuntimeExecutor,
  type ChildExecutionOutcome,
  type ChildTaskRuntimeExecutor
} from '../../../../../../electron/main/modules/chat/agents/executor.mjs';

/** 当前测试创建、并在 afterEach 清理的隔离工作区。 */
const temporaryRoots: string[] = [];

/**
 * 创建隔离工作区与一个授权文件。
 * @returns 工作区根目录和文件真实路径
 */
async function createWorkspace(): Promise<{ workspaceRoot: string; filePath: string; overlayRoot: string }> {
  const createdRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tibis-child-agent-'));
  const workspacePath = path.join(createdRoot, 'workspace');
  const overlayPath = path.join(createdRoot, 'overlays');
  await Promise.all([fs.mkdir(workspacePath), fs.mkdir(overlayPath)]);
  const workspaceRoot = await fs.realpath(workspacePath);
  const overlayRoot = await fs.realpath(overlayPath);
  const filePath = path.join(workspaceRoot, 'CONTEXT.md');
  await fs.writeFile(filePath, '# Tibis\nChild runtime context.', 'utf8');
  temporaryRoots.push(createdRoot);
  return { workspaceRoot, filePath, overlayRoot };
}

/**
 * 创建冻结只读计划的运行中 Task。
 * @param filePath - 计划授权的真实文件路径
 * @param tokenLimit - Task token 上限
 * @param mode - read 或受控 write
 * @returns 运行中 Task 投影
 */
function createTask(filePath: string, tokenLimit = 100, mode: 'read' | 'write' = 'read'): AgentTaskRecord {
  const planHash = 'a'.repeat(64);
  const writeMode = mode === 'write';
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
      mode,
      resources: [{ kind: 'file', reference: 'CONTEXT.md' }],
      requestedTools: writeMode ? ['read_file', 'stage_file_edit', 'stage_file_write'] : ['read_file'],
      required: true
    },
    contractSnapshotHash: 'b'.repeat(64),
    executionPlanSnapshot: {
      planHash,
      planSchemaVersion: 1,
      policyVersion: writeMode ? 'controlled-write-v1' : 'read-runtime-v1',
      capabilitySet: writeMode ? ['read_file', 'stage_file_edit', 'stage_file_write'] : ['read_file'],
      modelSnapshot: { providerId: 'openai', modelId: 'gpt-5' },
      permissionSnapshot: { scopeIds: [writeMode ? 'workspace-write' : 'workspace-read'] },
      resourceScopes: [`file:${filePath}`],
      toolEffectSet: writeMode
        ? [
            { toolName: 'read_file', effect: 'pure_read' },
            { toolName: 'stage_file_edit', effect: 'staged_file_write' },
            { toolName: 'stage_file_write', effect: 'staged_file_write' }
          ]
        : [{ toolName: 'read_file', effect: 'pure_read' }],
      commitPolicy: writeMode ? { mode: 'staged', adapter: 'atomic-file-v1' } : { mode: 'none' },
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
    usageSnapshot: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      modelCalls: 0,
      toolRounds: 0,
      queueDurationMs: 0,
      executionDurationMs: 0,
      externalRequests: 0,
      monetaryCost: {
        currency: 'USD',
        pricingVersion: 'pricing-v1',
        estimated: 0,
        actual: 'unknown'
      }
    },
    usageComplete: false,
    usageUpdatedAt: '2026-07-27T00:00:01.000Z',
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
 * Child 工具审计测试回调。
 */
interface ToolEventCallbacks {
  /** 观察裁剪后的 started 写入。 */
  readonly started?: (input: unknown) => void;
  /** 观察裁剪后的 completed 写入。 */
  readonly completed?: (input: unknown) => void;
  /** 观察每个 Provider 完整 usage 边界。 */
  readonly usage?: (input: RecordAttemptUsageInput) => void;
}

/**
 * 创建 Child executor 的共享依赖。
 * @param workspaceRoot - 冻结 Checkpoint 关联的工作区
 * @param streamText - 测试模型流
 * @param resolver - 可观察模型 resolver
 * @param toolEvents - 可选工具审计观察回调
 * @returns Child executor
 */
function createExecutor(
  workspaceRoot: string,
  streamText: RuntimeStreamText,
  resolver: ChatModelResolver = createResolver(),
  toolEvents: ToolEventCallbacks = {}
): ChildTaskRuntimeExecutor {
  const overlayRoot = path.resolve(workspaceRoot, '..', 'overlays');
  return createChildRuntimeExecutor({
    resolver,
    streamText,
    resolveWorkspaceRoot: (): string => workspaceRoot,
    resolveOverlayRoot: (): string => overlayRoot,
    createOverlayId: (kind): string => `${kind}-1`,
    calculateCost: (): AgentUsageAccounting['monetaryCost'] => {
      return {
        currency: 'USD',
        pricingVersion: 'pricing-v1',
        estimated: 0.001,
        actual: 'unknown'
      };
    },
    recordToolStarted: (input): void => toolEvents.started?.(input),
    recordToolCompleted: (input): void => toolEvents.completed?.(input),
    recordAttemptUsage: (input): void => toolEvents.usage?.(input),
    now: (): number => Date.parse('2026-07-27T00:00:02.000Z')
  });
}

/**
 * 从 executor 判别结果中读取终态结果。
 * @param outcome - Child executor 结果
 * @returns terminal result
 */
function readTerminal(outcome: ChildExecutionOutcome): ChatAgentResult {
  if (outcome.kind !== 'terminal') throw new Error('Expected terminal Child execution outcome');
  return outcome.result;
}

afterEach(async (): Promise<void> => {
  const roots = temporaryRoots.splice(0);
  await Promise.allSettled(roots.map((root): Promise<void> => fs.rm(root, { recursive: true, force: true })));
});

describe('child task runtime executor', (): void => {
  it('records only Child tool identities and the normalized result hash', async (): Promise<void> => {
    const { workspaceRoot, filePath } = await createWorkspace();
    const started = vi.fn();
    const completed = vi.fn();
    const streamText = vi.fn<RuntimeStreamText>().mockResolvedValue(
      createStreamResult([
        { type: 'tool-call', toolCallId: 'read-audit', toolName: 'read_file', input: { path: 'CONTEXT.md' } },
        { type: 'finish', finishReason: 'tool-calls', totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }
      ])
    );
    const executor = createExecutor(workspaceRoot, streamText, createResolver(), { started, completed });

    await executor.execute({
      task: createTask(filePath),
      attempt: createAttempt(),
      checkpoint: createCheckpoint(),
      signal: new AbortController().signal
    });

    expect(started).toHaveBeenCalledWith({
      taskId: 'task-1',
      attemptId: 'attempt-1',
      runtimeId: 'runtime-child-1',
      toolCallId: 'read-audit',
      toolName: 'read_file',
      occurredAt: '2026-07-27T00:00:02.000Z'
    });
    expect(started).toHaveBeenCalledOnce();
    expect(completed).toHaveBeenCalledWith({
      taskId: 'task-1',
      attemptId: 'attempt-1',
      runtimeId: 'runtime-child-1',
      toolCallId: 'read-audit',
      toolName: 'read_file',
      resultHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      occurredAt: '2026-07-27T00:00:02.000Z'
    });
    expect(completed).toHaveBeenCalledOnce();
    expect(JSON.stringify([...started.mock.calls, ...completed.mock.calls])).not.toContain('CONTEXT.md');
  });

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
    const usage = vi.fn<(input: RecordAttemptUsageInput) => void>();
    const executor = createExecutor(workspaceRoot, streamText, resolver, { usage });
    const task = createTask(filePath);

    const outcome = await executor.execute({
      task,
      attempt: createAttempt(),
      checkpoint: createCheckpoint(),
      signal: new AbortController().signal
    });
    const result = readTerminal(outcome);

    expect(resolver.resolve).toHaveBeenCalledWith(task.executionPlanSnapshot?.modelSnapshot);
    expect(streamText).toHaveBeenCalledTimes(2);
    expect(usage).toHaveBeenCalledTimes(2);
    expect(usage.mock.calls.map((call): RecordAttemptUsageInput => call[0])).toEqual([
      expect.objectContaining({
        taskId: 'task-1',
        attemptId: 'attempt-1',
        usage: expect.objectContaining({ inputTokens: 8, outputTokens: 2, totalTokens: 10, modelCalls: 1, toolRounds: 1 }),
        complete: false
      }),
      expect.objectContaining({
        taskId: 'task-1',
        attemptId: 'attempt-1',
        usage: expect.objectContaining({ inputTokens: 14, outputTokens: 6, totalTokens: 20, modelCalls: 2, toolRounds: 1 }),
        complete: false
      })
    ]);
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

    const outcome = await executor.execute({
      task: createTask(filePath),
      attempt: createAttempt(),
      checkpoint: createCheckpoint(),
      signal: new AbortController().signal
    });
    const result = readTerminal(outcome);

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

    const outcome = await executor.execute({
      task: createTask(filePath),
      attempt: createAttempt(),
      checkpoint: createCheckpoint(),
      signal: controller.signal
    });
    const result = readTerminal(outcome);

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

    const outcome = await executor.execute({
      task: createTask(filePath, 100),
      attempt: createAttempt(),
      checkpoint: createCheckpoint(),
      signal: new AbortController().signal
    });
    const result = readTerminal(outcome);

    expect(result).toMatchObject({
      executionStatus: 'failed',
      error: { code: 'budget_exceeded', phase: 'runtime', category: 'policy' },
      usage: { inputTokens: 80, outputTokens: 40, totalTokens: 120, modelCalls: 1 }
    });
  });

  it('returns a prepared write outcome and retains protected references until Coordinator discard', async (): Promise<void> => {
    const { workspaceRoot, filePath, overlayRoot } = await createWorkspace();
    const streamText = vi.fn<RuntimeStreamText>();
    streamText
      .mockResolvedValueOnce(
        createStreamResult([
          {
            type: 'tool-call',
            toolCallId: 'write-1',
            toolName: 'stage_file_edit',
            input: { path: 'CONTEXT.md', oldString: 'Child runtime context.', newString: 'Controlled write context.', replaceAll: false }
          },
          { type: 'finish', finishReason: 'tool-calls', totalUsage: { inputTokens: 8, outputTokens: 2, totalTokens: 10 } }
        ])
      )
      .mockResolvedValueOnce(
        createStreamResult([
          { type: 'text-delta', text: 'Prepared the requested controlled edit.' },
          { type: 'finish', finishReason: 'stop', totalUsage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 } }
        ])
      );
    const executor = createExecutor(workspaceRoot, streamText);
    const task = createTask(filePath, 100, 'write');
    const attempt = createAttempt();

    const outcome = await executor.execute({
      task,
      attempt,
      checkpoint: createCheckpoint(),
      signal: new AbortController().signal
    });

    expect(outcome).toMatchObject({
      kind: 'changeset_prepared',
      changeset: {
        taskId: task.taskId,
        attemptId: attempt.attemptId,
        runtimeId: attempt.currentRuntimeId,
        operations: [{ displayPath: 'CONTEXT.md' }]
      },
      draft: {
        taskId: task.taskId,
        attemptId: attempt.attemptId,
        summary: 'Prepared the requested controlled edit.',
        criteria: [{ verification: { status: 'unverified', verifier: 'policy', evidence: [] } }]
      }
    });
    if (outcome.kind !== 'changeset_prepared') throw new Error('Expected prepared changeset');
    expect(await fs.readFile(filePath, 'utf8')).toBe('# Tibis\nChild runtime context.');
    await expect(fs.readFile(outcome.changeset.operations[0]?.candidateReference as string, 'utf8')).resolves.toContain('Controlled write context.');

    await fs.chmod(path.join(overlayRoot, task.taskId), 0o500);
    await expect(executor.discard(attempt.currentRuntimeId)).rejects.toMatchObject({ code: 'EACCES' });
    await fs.chmod(path.join(overlayRoot, task.taskId), 0o700);
    await executor.discard(attempt.currentRuntimeId);

    await expect(fs.stat(outcome.changeset.operations[0]?.candidateReference as string)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('fails in recovery when a rejected write Runtime cannot remove its overlay', async (): Promise<void> => {
    const { workspaceRoot, filePath, overlayRoot } = await createWorkspace();
    const streamText = vi.fn<RuntimeStreamText>();
    streamText
      .mockResolvedValueOnce(
        createStreamResult([
          {
            type: 'tool-call',
            toolCallId: 'write-cleanup-1',
            toolName: 'stage_file_edit',
            input: { path: 'CONTEXT.md', oldString: 'Child runtime context.', newString: 'Temporary candidate.', replaceAll: false }
          },
          { type: 'finish', finishReason: 'tool-calls', totalUsage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 } }
        ])
      )
      .mockImplementationOnce(async (): Promise<[undefined, AIStreamResult]> => {
        await fs.chmod(path.join(overlayRoot, 'task-1'), 0o500);
        throw new Error('provider_rejected');
      });
    const executor = createExecutor(workspaceRoot, streamText);

    const outcome = await executor.execute({
      task: createTask(filePath, 100, 'write'),
      attempt: createAttempt(),
      checkpoint: createCheckpoint(),
      signal: new AbortController().signal
    });
    await fs.chmod(path.join(overlayRoot, 'task-1'), 0o700);
    const result = readTerminal(outcome);

    expect(result).toMatchObject({
      executionStatus: 'failed',
      error: {
        code: 'runtime_interrupted',
        phase: 'recovery',
        category: 'runtime',
        retryable: true,
        details: { reason: 'write_overlay_cleanup_failed' }
      }
    });
  });

  it('returns a completed terminal result without changeset for a no-op write', async (): Promise<void> => {
    const { workspaceRoot, filePath } = await createWorkspace();
    const streamText = vi.fn<RuntimeStreamText>();
    streamText
      .mockResolvedValueOnce(
        createStreamResult([
          {
            type: 'tool-call',
            toolCallId: 'write-noop-1',
            toolName: 'stage_file_write',
            input: { path: 'CONTEXT.md', content: '# Tibis\nChild runtime context.' }
          },
          { type: 'finish', finishReason: 'tool-calls', totalUsage: { inputTokens: 6, outputTokens: 2, totalTokens: 8 } }
        ])
      )
      .mockResolvedValueOnce(
        createStreamResult([
          { type: 'text-delta', text: 'No file changes were required.' },
          { type: 'finish', finishReason: 'stop', totalUsage: { inputTokens: 4, outputTokens: 4, totalTokens: 8 } }
        ])
      );
    const executor = createExecutor(workspaceRoot, streamText);

    const outcome = await executor.execute({
      task: createTask(filePath, 100, 'write'),
      attempt: createAttempt(),
      checkpoint: createCheckpoint(),
      signal: new AbortController().signal
    });
    const result = readTerminal(outcome);

    expect(result).toMatchObject({
      executionStatus: 'completed',
      summary: 'No file changes were required.'
    });
    expect(result.changeset).toBeUndefined();
  });
});
