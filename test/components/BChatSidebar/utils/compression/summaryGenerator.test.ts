/**
 * @file summaryGenerator.test.ts
 * @description 验证摘要生成器会请求 AI SDK 的结构化输出能力。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const aiInvokeMock = vi.fn();
const getProviderMock = vi.fn();
const getConfigMock = vi.fn();

vi.mock('@/shared/platform/electron-api', () => ({
  getElectronAPI: vi.fn(() => ({
    aiInvoke: aiInvokeMock
  }))
}));

vi.mock('@/shared/storage', () => ({
  providerStorage: {
    getProvider: getProviderMock
  },
  serviceModelsStorage: {
    getConfig: getConfigMock
  }
}));

describe('summaryGenerator', () => {
  beforeEach(() => {
    aiInvokeMock.mockReset();
    getProviderMock.mockReset();
    getConfigMock.mockReset();
  });

  it('requests structured output schema when generating summary', async () => {
    const { generateStructuredSummary } = await import('@/components/BChatSidebar/utils/compression/summaryGenerator');

    getConfigMock.mockResolvedValue({ providerId: 'provider-1', modelId: 'model-1' });
    getProviderMock.mockResolvedValue({
      id: 'provider-1',
      name: 'Provider',
      type: 'openai',
      isEnabled: true,
      apiKey: 'key'
    });
    aiInvokeMock.mockResolvedValue([
      undefined,
      {
        text: '{"goal":"整理需求","recentTopic":"上下文压缩","userPreferences":[],"constraints":[],"decisions":[],"importantFacts":[],"fileContext":[],"openQuestions":[],"pendingActions":[]}',
        output: {
          goal: '整理需求',
          recentTopic: '上下文压缩',
          userPreferences: [],
          constraints: [],
          decisions: [],
          importantFacts: [],
          fileContext: [],
          openQuestions: [],
          pendingActions: []
        }
      }
    ]);

    const result = await generateStructuredSummary([
      {
        messageId: 'm1',
        role: 'user',
        trimmedText: '请总结这段会话'
      }
    ]);

    expect(aiInvokeMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        output: expect.objectContaining({
          name: 'conversation_summary',
          schema: expect.objectContaining({
            type: 'object',
            properties: expect.objectContaining({
              goal: expect.any(Object),
              recentTopic: expect.any(Object),
              fileContext: expect.any(Object)
            })
          })
        })
      })
    );
    expect(result.goal).toBe('整理需求');
    expect(result.recentTopic).toBe('上下文压缩');
  });
});
