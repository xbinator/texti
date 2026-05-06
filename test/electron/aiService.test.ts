/**
 * @file aiService.test.ts
 * @description 验证 Electron AI 服务的结构化输出接入与错误日志分级行为。
 */
import type { AICreateOptions, AIRequestOptions } from 'types/ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const generateTextMock = vi.fn<() => Promise<never>>();
const jsonSchemaMock = vi.fn();
const outputObjectMock = vi.fn();
const logErrorMock = vi.fn();
const logWarnMock = vi.fn();

vi.mock('ai', () => ({
  Output: {
    object: outputObjectMock
  },
  generateText: generateTextMock,
  jsonSchema: jsonSchemaMock,
  streamText: vi.fn(),
  tool: vi.fn()
}));

vi.mock('../../electron/main/modules/logger/service.mjs', () => ({
  log: {
    info: vi.fn(),
    warn: logWarnMock,
    error: logErrorMock
  }
}));

vi.mock('../../electron/main/modules/ai/providers/_index.mjs', () => ({
  AIProviderRegistry: class MockAIProviderRegistry {
    /**
     * 创建测试模型实例。
     * @returns 测试模型
     */
    create(): unknown {
      return {};
    }

    /**
     * 将测试错误标准化为限流错误。
     * @returns 标准化限流错误
     */
    normalizeError(): { code: string; message: string } {
      return { code: 'RATE_LIMITED', message: '请求过于频繁或额度已耗尽，请稍后重试' };
    }
  }
}));

describe('aiService', () => {
  beforeEach(() => {
    vi.resetModules();
    generateTextMock.mockReset();
    jsonSchemaMock.mockReset();
    outputObjectMock.mockReset();
    logErrorMock.mockReset();
    logWarnMock.mockReset();
  });

  it('passes structured output schema to AI SDK when request asks for object output', async () => {
    const { aiService } = await import('../../electron/main/modules/ai/service.mjs');
    const createOptions: AICreateOptions = { providerType: 'openai', providerId: 'provider-1', providerName: 'OpenAI' };
    const request: AIRequestOptions = {
      modelId: 'model-1',
      prompt: '生成结构化摘要',
      output: {
        schema: {
          type: 'object',
          properties: {
            goal: { type: 'string' }
          },
          required: ['goal'],
          additionalProperties: false
        },
        name: 'conversation_summary'
      }
    };

    jsonSchemaMock.mockImplementation((schema) => schema);
    outputObjectMock.mockReturnValue({ mocked: true });
    generateTextMock.mockResolvedValue({
      text: '{"goal":"整理需求"}',
      output: { goal: '整理需求' },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
    });

    const [error, result] = await aiService.generateText(createOptions, request);

    expect(error).toBeUndefined();
    expect(outputObjectMock).toHaveBeenCalledWith({
      schema: request.output?.schema,
      name: 'conversation_summary',
      description: undefined
    });
    expect(generateTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: '生成结构化摘要',
        output: { mocked: true }
      })
    );
    expect(result?.text).toBe('{"goal":"整理需求"}');
  });

  it('logs rate limited invoke errors without dumping the original stack', async () => {
    const { aiService } = await import('../../electron/main/modules/ai/service.mjs');
    const createOptions: AICreateOptions = { providerType: 'anthropic', providerId: 'provider-1', providerName: 'Anthropic' };
    const request: AIRequestOptions = { modelId: 'model-1', prompt: '生成标题' };
    const overloadedError = new Error('overloaded_error (529)');

    generateTextMock.mockRejectedValue(overloadedError);

    const [error] = await aiService.generateText(createOptions, request);

    expect(error?.code).toBe('RATE_LIMITED');
    expect(logWarnMock).toHaveBeenCalledWith('[AIService] generateText RATE_LIMITED:', '请求过于频繁或额度已耗尽，请稍后重试');
    expect(logErrorMock).not.toHaveBeenCalledWith('[AIService] generateText error:', overloadedError);
  });
});
