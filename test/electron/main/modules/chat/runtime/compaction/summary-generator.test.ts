/**
 * @file summary-generator.test.ts
 * @description 结构化上下文摘要模型调用与失败语义测试。
 */
import type { CompactionSourceSnapshot } from '../../../../../../../electron/main/modules/chat/runtime/compaction/types.mjs';
import type { AICreateOptions, AIInvokeResult, AIRequestOptions } from 'types/ai';
import type { CompactionBudgetSnapshot, StructuredContextSummary } from 'types/chat';
import { describe, expect, it, vi } from 'vitest';
import {
  generateStructuredSummary,
  type SummaryGeneratorDependencies
} from '../../../../../../../electron/main/modules/chat/runtime/compaction/summary-generator.mjs';

/**
 * 创建摘要生成预算。
 * @returns 预算快照
 */
function createBudget(): CompactionBudgetSnapshot {
  return {
    outputReserve: 8_192,
    safetyReserve: 6_400,
    usableInputTokens: 113_408,
    triggerTokens: 90_726,
    targetTokens: 62_374,
    summaryMaxTokens: 8_000,
    rawTailMaxTokens: 20_000
  };
}

/**
 * 创建摘要生成源快照。
 * @returns 冻结源
 */
function createSource(): CompactionSourceSnapshot {
  return {
    sourceParts: [{ messageId: 'message-1', part: { id: 'part-1', type: 'text', text: '用户决定使用结构化 checkpoint' } }],
    boundaryPartId: 'part-1',
    sourceFingerprint: 'sha256:source'
  };
}

/**
 * 创建合法生成摘要。
 * @returns 结构化摘要
 */
function createSummary(): StructuredContextSummary {
  return {
    schemaVersion: 1,
    objectives: [],
    facts: [{ id: 'fact-1', type: 'decision', content: '使用结构化 checkpoint', sourcePartIds: ['part-1'] }],
    artifacts: [],
    completedActions: [],
    pendingActions: [],
    openQuestions: [],
    failures: []
  };
}

describe('structured summary generator', (): void => {
  it('使用当前模型、禁用工具并返回脱敏 modelSnapshot', async (): Promise<void> => {
    const summary = createSummary();
    const createOptionCalls: AICreateOptions[] = [];
    const requestCalls: AIRequestOptions[] = [];
    const generateText = vi.fn(async (createOptions: AICreateOptions, request: AIRequestOptions): Promise<[undefined, AIInvokeResult]> => {
      createOptionCalls.push(createOptions);
      requestCalls.push(request);
      return [undefined, { text: '', output: summary, totalUsage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 } }];
    });

    const result = await generateStructuredSummary(
      {
        runtimeId: 'runtime-1',
        contextWindow: 128_000,
        budgetSnapshot: createBudget(),
        sourceSnapshot: createSource()
      },
      {
        resolveModel: async () => ({
          createOptions: {
            providerType: 'anthropic',
            providerId: 'provider-1',
            providerName: 'Anthropic',
            apiKey: 'secret',
            baseUrl: 'https://secret.example'
          },
          modelId: 'claude-test'
        }),
        generateText
      }
    );

    expect(result).toEqual({
      status: 'success',
      summary,
      modelSnapshot: {
        providerType: 'anthropic',
        providerId: 'provider-1',
        modelId: 'claude-test',
        contextWindow: 128_000
      },
      usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 }
    });
    expect(createOptionCalls[0]).toMatchObject({ providerType: 'anthropic', providerId: 'provider-1' });
    const request = requestCalls[0];
    expect(request).toMatchObject({
      requestId: 'runtime-1',
      modelId: 'claude-test',
      maxOutputTokens: 8_000,
      output: { name: 'context_compaction' }
    });
    expect(request).not.toHaveProperty('tools');
    expect(request).not.toHaveProperty('tavily');
    expect(request).not.toHaveProperty('mcp');
    expect(request.prompt).not.toContain('checkpoint-pending');
    expect(generateText.mock.calls[0]).toHaveLength(2);
  });

  it('结构化输出首次无效时按子错误码重试一次', async (): Promise<void> => {
    const summary = createSummary();
    const generateText = vi
      .fn<SummaryGeneratorDependencies['generateText']>()
      .mockResolvedValueOnce([undefined, { text: '', output: { schemaVersion: 1 }, totalUsage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 } }])
      .mockResolvedValueOnce([undefined, { text: '', output: summary, totalUsage: { inputTokens: 120, outputTokens: 20, totalTokens: 140 } }]);
    const result = await generateStructuredSummary(
      {
        runtimeId: 'runtime-1',
        contextWindow: 128_000,
        budgetSnapshot: createBudget(),
        sourceSnapshot: createSource()
      },
      {
        resolveModel: async () => ({
          createOptions: { providerType: 'openai', providerId: 'provider-1', providerName: 'OpenAI' },
          modelId: 'model-1'
        }),
        generateText
      }
    );

    expect(result).toEqual({
      status: 'success',
      summary,
      modelSnapshot: {
        providerType: 'openai',
        providerId: 'provider-1',
        modelId: 'model-1',
        contextWindow: 128_000
      },
      usage: { inputTokens: 220, outputTokens: 30, totalTokens: 250 },
      repairAttempted: true,
      validationErrorCode: 'INVALID_SHAPE'
    });
    expect(generateText).toHaveBeenCalledTimes(2);
    expect(generateText.mock.calls[1]?.[1].prompt).toContain('INVALID_SHAPE');
  });

  it('结构化输出重试后仍无效时保留最终子错误码', async (): Promise<void> => {
    const invalidReferenceSummary = createSummary();
    invalidReferenceSummary.facts[0].sourcePartIds = ['missing-part'];
    const generateText = vi
      .fn<SummaryGeneratorDependencies['generateText']>()
      .mockResolvedValueOnce([undefined, { text: '', output: { schemaVersion: 1 } }])
      .mockResolvedValueOnce([undefined, { text: '', output: invalidReferenceSummary }]);

    const result = await generateStructuredSummary(
      {
        runtimeId: 'runtime-1',
        contextWindow: 128_000,
        budgetSnapshot: createBudget(),
        sourceSnapshot: createSource()
      },
      {
        resolveModel: async () => ({
          createOptions: { providerType: 'deepseek', providerId: 'deepseek', providerName: 'DeepSeek' },
          modelId: 'deepseek-v4-pro'
        }),
        generateText
      }
    );

    expect(result).toEqual({
      status: 'failed',
      errorCode: 'SCHEMA_INVALID',
      validationErrorCode: 'INVALID_REFERENCE',
      repairAttempted: true
    });
    expect(generateText).toHaveBeenCalledTimes(2);
  });

  it('当前模型不可用时不发起摘要请求', async (): Promise<void> => {
    const generateText = vi.fn();

    const result = await generateStructuredSummary(
      {
        runtimeId: 'runtime-1',
        contextWindow: 128_000,
        budgetSnapshot: createBudget(),
        sourceSnapshot: createSource()
      },
      { resolveModel: async () => null, generateText }
    );

    expect(result).toEqual({ status: 'failed', errorCode: 'MODEL_NOT_FOUND' });
    expect(generateText).not.toHaveBeenCalled();
  });
});
