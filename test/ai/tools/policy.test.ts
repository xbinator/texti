/**
 * @file policy.test.ts
 * @description AI 工具策略测试。
 */
import type { AIProvider } from 'types/ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDefaultBuiltinChatToolNames } from '@/ai/tools/builtin/catalog';
import { getDefaultChatToolNames, getModelToolSupport } from '@/ai/tools/policy';

type GetProviderMock = (providerId: string) => Promise<AIProvider | null>;

/**
 * 模拟服务商读取行为。
 */
const mocks = vi.hoisted(() => ({
  getProvider: vi.fn<GetProviderMock>()
}));

vi.mock('@/shared/storage/providers', () => ({
  providerStorage: {
    getProvider: mocks.getProvider
  }
}));

describe('AI tool policy', () => {
  beforeEach(() => {
    mocks.getProvider.mockReset();
  });

  it('enables tools when the selected model declares tool support', async () => {
    mocks.getProvider.mockResolvedValue({
      id: 'openai',
      name: 'OpenAI',
      description: 'OpenAI',
      type: 'openai',
      isEnabled: true,
      models: [{ id: 'gpt-5', name: 'GPT-5', type: 'chat', isEnabled: true, supportsTools: true }]
    });

    await expect(getModelToolSupport('openai', 'gpt-5')).resolves.toEqual({ supported: true });
  });

  it('disables tools when the selected model does not declare tool support', async () => {
    mocks.getProvider.mockResolvedValue({
      id: 'openai',
      name: 'OpenAI',
      description: 'OpenAI',
      type: 'openai',
      isEnabled: true,
      models: [{ id: 'gpt-basic', name: 'GPT Basic', type: 'chat', isEnabled: true }]
    });

    await expect(getModelToolSupport('openai', 'gpt-basic')).resolves.toEqual({
      supported: false,
      reason: '当前模型不支持工具调用'
    });
  });

  it('disables tools when provider or model is missing', async () => {
    mocks.getProvider.mockResolvedValueOnce(null);
    await expect(getModelToolSupport('missing', 'gpt-5')).resolves.toEqual({ supported: false, reason: '当前服务商不存在' });

    mocks.getProvider.mockResolvedValueOnce({
      id: 'openai',
      name: 'OpenAI',
      description: 'OpenAI',
      type: 'openai',
      isEnabled: true,
      models: []
    });
    await expect(getModelToolSupport('openai', 'missing-model')).resolves.toEqual({ supported: false, reason: '当前模型不存在' });
  });

  it('returns the default low-risk chat tool names', () => {
    expect(getDefaultChatToolNames()).toEqual(getDefaultBuiltinChatToolNames());
  });
});
