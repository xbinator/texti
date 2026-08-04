/**
 * @file executor.test.ts
 * @description 上下文压缩原子执行、取消与提交校验测试。
 */
import type { SummaryGenerationInput, SummaryGenerationResult } from '../../../../../../../electron/main/modules/chat/runtime/compaction/summary-generator.mjs';
import type { ChatMessageCompactionPart, ChatMessagePart, ChatMessageRecord, StructuredContextSummary } from 'types/chat';
import { describe, expect, it, vi } from 'vitest';
import {
  createCompactionExecutor,
  type CompactionExecuteInput,
  type CompactionExecutorDependencies,
  type CompactionExecutorStage
} from '../../../../../../../electron/main/modules/chat/runtime/compaction/executor.mjs';

/**
 * 创建已完成消息。
 * @param id - 消息标识
 * @param role - 消息角色
 * @param parts - 消息 Part
 * @returns 聊天消息
 */
function createMessage(id: string, role: 'user' | 'assistant', parts: ChatMessagePart[]): ChatMessageRecord {
  return {
    id,
    sessionId: 'session-1',
    role,
    content: '',
    parts,
    createdAt: `2026-07-16T00:00:0${id.length}.000Z`,
    loading: false,
    finished: true
  };
}

/**
 * 创建合法摘要。
 * @param content - 事实内容
 * @returns 结构化摘要
 */
function createSummary(content = '保留 checkpoint 事实'): StructuredContextSummary {
  return {
    schemaVersion: 1,
    objectives: [],
    facts: [{ id: 'fact-1', type: 'decision', content, sourcePartIds: ['source-1'] }],
    artifacts: [],
    completedActions: [],
    pendingActions: [],
    openQuestions: [],
    failures: []
  };
}

/**
 * 创建成功摘要结果。
 * @param content - 摘要事实内容
 * @returns 摘要生成结果
 */
function createGeneration(content?: string): SummaryGenerationResult {
  return {
    status: 'success',
    summary: createSummary(content),
    modelSnapshot: {
      providerType: 'openai',
      providerId: 'provider-1',
      modelId: 'model-1',
      contextWindow: 32_000,
      maxOutputTokens: 2_000
    }
  };
}

/**
 * 创建 executor 输入。
 * @param assistantMessage - 承载 compaction Part 的消息
 * @returns executor 输入
 */
function createInput(assistantMessage: ChatMessageRecord): CompactionExecuteInput {
  return {
    runtimeId: 'runtime-1',
    sessionId: 'session-1',
    trigger: 'manual',
    assistantMessage,
    contextWindow: 32_000,
    maxOutputTokens: 2_000,
    modelSnapshot: {
      providerType: 'openai',
      providerId: 'provider-1',
      modelId: 'model-1',
      contextWindow: 32_000,
      maxOutputTokens: 2_000
    }
  };
}

/**
 * 创建可观察的 executor 测试环境。
 * @param generateSummary - 摘要生成函数
 * @returns executor、消息存储、阶段和写入快照
 */
function createHarness(generateSummary: (input: SummaryGenerationInput) => Promise<SummaryGenerationResult>) {
  const assistantMessage = createMessage('assistant-current', 'assistant', []);
  assistantMessage.loading = true;
  assistantMessage.finished = false;
  const messages = [createMessage('old-assistant', 'assistant', [{ id: 'source-1', type: 'text', text: '历史事实' }])];
  const stages: CompactionExecutorStage[] = [];
  const writes: ChatMessageRecord[] = [];
  let leaseActive = true;
  const dependencies: CompactionExecutorDependencies = {
    readMessages: async (): Promise<ChatMessageRecord[]> => structuredClone(messages),
    writeMessage: async (message: ChatMessageRecord): Promise<void> => {
      writes.push(structuredClone(message));
      const index = messages.findIndex((candidate: ChatMessageRecord): boolean => candidate.id === message.id);
      if (index >= 0) messages[index] = structuredClone(message);
      else messages.push(structuredClone(message));
    },
    generateSummary,
    hasLease: (): boolean => leaseActive,
    abortSummary: vi.fn(),
    createPartId: (): string => 'checkpoint-1',
    now: (): number => 1_000,
    onStage: (stage: CompactionExecutorStage): void => {
      stages.push(stage);
    }
  };
  const executor = createCompactionExecutor(dependencies);

  return {
    assistantMessage,
    messages,
    stages,
    writes,
    dependencies,
    executor,
    releaseLease: (): void => {
      leaseActive = false;
    }
  };
}

describe('compaction executor', (): void => {
  it('按冻结、规划、pending、生成、校验、复验和 success 的顺序执行', async (): Promise<void> => {
    let generatorSnapshot: SummaryGenerationInput | undefined;
    const harness = createHarness(async (input: SummaryGenerationInput): Promise<SummaryGenerationResult> => {
      generatorSnapshot = structuredClone(input);
      return createGeneration();
    });

    const result = await harness.executor.execute(createInput(harness.assistantMessage));

    expect(harness.stages).toEqual(['capture', 'plan', 'write:pending', 'generate', 'validate', 'verify', 'write:success']);
    expect(generatorSnapshot?.sourceSnapshot.sourceParts.some((source) => source.part.type === 'compaction')).toBe(false);
    expect(generatorSnapshot).not.toHaveProperty('taskDeadlineAt');
    expect(harness.writes).toHaveLength(2);
    expect(harness.writes[0].parts.at(-1)).toMatchObject({ type: 'compaction', status: 'pending' });
    expect(harness.writes[1].parts.at(-1)).toMatchObject({ type: 'compaction', status: 'success' });
    expect(result.status).toBe('success');
    const successPart = harness.assistantMessage.parts.at(-1) as ChatMessageCompactionPart;
    expect(Object.isFrozen(successPart)).toBe(true);
    expect(Reflect.set(successPart, 'status', 'failed')).toBe(false);
  });

  it('pending 首次写入失败时在内存和后续持久化中收敛为 failed', async (): Promise<void> => {
    const generateSummary = vi.fn(async (): Promise<SummaryGenerationResult> => createGeneration());
    const harness = createHarness(generateSummary);
    const persistedMessages: ChatMessageRecord[] = [];
    let writeCount = 0;
    harness.dependencies.writeMessage = async (message: ChatMessageRecord): Promise<void> => {
      writeCount += 1;
      if (writeCount === 1) throw new Error('first pending write failed');
      persistedMessages.push(structuredClone(message));
    };

    const result = await harness.executor.execute(createInput(harness.assistantMessage));

    expect(result).toEqual({ status: 'failed', errorCode: 'PERSIST_FAILED' });
    expect(generateSummary).not.toHaveBeenCalled();
    expect(writeCount).toBe(2);
    expect(harness.assistantMessage.parts.at(-1)).toMatchObject({ status: 'failed', errorCode: 'PERSIST_FAILED' });
    expect(persistedMessages.at(-1)?.parts.at(-1)).toMatchObject({ status: 'failed', errorCode: 'PERSIST_FAILED' });
  });

  it('摘要模型失败时原子写入 failed 且不携带 summary', async (): Promise<void> => {
    const harness = createHarness(async (): Promise<SummaryGenerationResult> => ({ status: 'failed', errorCode: 'MODEL_CALL_FAILED' }));
    const diagnosticLog = vi.fn();
    harness.dependencies.diagnosticLog = diagnosticLog;

    const result = await harness.executor.execute(createInput(harness.assistantMessage));

    expect(result).toEqual({ status: 'failed', errorCode: 'MODEL_CALL_FAILED' });
    expect(harness.assistantMessage.parts.at(-1)).toMatchObject({ status: 'failed', errorCode: 'MODEL_CALL_FAILED' });
    expect(harness.assistantMessage.parts.at(-1)).not.toHaveProperty('summary');
    expect(diagnosticLog).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimeId: 'runtime-1',
        sessionId: 'session-1',
        checkpointId: 'checkpoint-1',
        status: 'failed',
        errorCode: 'MODEL_CALL_FAILED',
        modelSnapshot: expect.objectContaining({ providerId: 'provider-1', modelId: 'model-1', contextWindow: 32_000 })
      })
    );
  });

  it('摘要修复失败时持久化脱敏校验子错误码并写入诊断日志', async (): Promise<void> => {
    const harness = createHarness(
      async (): Promise<SummaryGenerationResult> => ({
        status: 'failed',
        errorCode: 'SCHEMA_INVALID',
        validationErrorCode: 'INVALID_REFERENCE',
        repairAttempted: true
      })
    );
    const diagnosticLog = vi.fn();
    harness.dependencies.diagnosticLog = diagnosticLog;

    const result = await harness.executor.execute(createInput(harness.assistantMessage));

    expect(result).toEqual({
      status: 'failed',
      errorCode: 'SCHEMA_INVALID',
      validationErrorCode: 'INVALID_REFERENCE',
      repairAttempted: true
    });
    expect(harness.assistantMessage.parts.at(-1)).toMatchObject({
      status: 'failed',
      errorCode: 'SCHEMA_INVALID',
      validationErrorCode: 'INVALID_REFERENCE'
    });
    expect(diagnosticLog).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        errorCode: 'SCHEMA_INVALID',
        validationErrorCode: 'INVALID_REFERENCE',
        repairAttempted: true
      })
    );
  });

  it('提交前实际源发生变化时重新计算 fingerprint 并写 SOURCE_CHANGED', async (): Promise<void> => {
    const harness = createHarness(async (): Promise<SummaryGenerationResult> => {
      const source = harness.messages[0].parts[0];
      if (source.type === 'text') source.text = '压缩期间被修改';
      return createGeneration();
    });

    const result = await harness.executor.execute(createInput(harness.assistantMessage));

    expect(result).toEqual({ status: 'failed', errorCode: 'SOURCE_CHANGED' });
    expect(harness.assistantMessage.parts.at(-1)).toMatchObject({ status: 'failed', errorCode: 'SOURCE_CHANGED' });
  });

  it('提交前写入 lease 丢失时拒绝 success', async (): Promise<void> => {
    const harness = createHarness(async (): Promise<SummaryGenerationResult> => {
      harness.releaseLease();
      return createGeneration();
    });

    const result = await harness.executor.execute(createInput(harness.assistantMessage));

    expect(result).toEqual({ status: 'failed', errorCode: 'SOURCE_CHANGED' });
  });

  it('用户取消时中止摘要并把 pending 更新为 cancelled', async (): Promise<void> => {
    let resolveGeneration: ((result: SummaryGenerationResult) => void) | undefined;
    let resolveTerminalWrite: (() => void) | undefined;
    let terminalWriteStarted = false;
    const generationPromise = new Promise<SummaryGenerationResult>((resolve): void => {
      resolveGeneration = resolve;
    });
    const terminalWriteGate = new Promise<void>((resolve): void => {
      resolveTerminalWrite = resolve;
    });
    const harness = createHarness(async (): Promise<SummaryGenerationResult> => generationPromise);
    const baseWriteMessage = harness.dependencies.writeMessage;
    harness.dependencies.writeMessage = async (message: ChatMessageRecord): Promise<void> => {
      const checkpoint = message.parts.find((part: ChatMessagePart): boolean => part.type === 'compaction');
      if (checkpoint?.type === 'compaction' && checkpoint.status === 'cancelled') {
        terminalWriteStarted = true;
        await terminalWriteGate;
      }
      await baseWriteMessage(message);
    };
    const execution = harness.executor.execute(createInput(harness.assistantMessage));
    await vi.waitFor((): void => {
      expect(harness.writes).toHaveLength(1);
    });

    let cancellationSettled = false;
    const cancellation = Promise.resolve(harness.executor.cancel('runtime-1')).then((): void => {
      cancellationSettled = true;
    });
    resolveGeneration?.({ status: 'failed', errorCode: 'MODEL_CALL_FAILED' });
    await vi.waitFor((): void => {
      expect(terminalWriteStarted).toBe(true);
    });
    expect(cancellationSettled).toBe(false);
    resolveTerminalWrite?.();
    await cancellation;
    const result = await execution;

    expect(harness.dependencies.abortSummary).toHaveBeenCalledWith('runtime-1');
    expect(result.status).toBe('cancelled');
    expect(harness.assistantMessage.parts.at(-1)).toMatchObject({ status: 'cancelled' });
  });

  it('生成摘要后超过 55% 目标预算时不提交 success', async (): Promise<void> => {
    const harness = createHarness(async (): Promise<SummaryGenerationResult> => createGeneration('x'.repeat(100_000)));

    const result = await harness.executor.execute(createInput(harness.assistantMessage));

    expect(result).toEqual({ status: 'failed', errorCode: 'TARGET_BUDGET_EXCEEDED' });
    expect(harness.assistantMessage.parts.at(-1)).toMatchObject({ status: 'failed', errorCode: 'TARGET_BUDGET_EXCEEDED' });
  });
});
