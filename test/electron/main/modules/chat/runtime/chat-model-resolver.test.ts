/**
 * @file chat-model-resolver.test.ts
 * @description ChatRuntime chat 模型配置解析测试。
 */
import type { AIProvider } from 'types/ai';
import { describe, expect, it, vi } from 'vitest';
import { createChatModelResolver } from '../../../../../../electron/main/modules/chat/runtime/model/resolver.mjs';

describe('createChatModelResolver', (): void => {
  it('resolves enabled chat provider and model into AI create options', async (): Promise<void> => {
    const provider: AIProvider = {
      id: 'openai',
      name: 'OpenAI',
      description: 'OpenAI provider',
      type: 'openai',
      isEnabled: true,
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      models: [{ id: 'gpt-test', name: 'GPT Test', type: 'chat', isEnabled: true, maxOutputTokens: 8_192 }]
    };
    const resolver = createChatModelResolver({
      getChatModelConfig: vi.fn().mockResolvedValue({ providerId: 'openai', modelId: 'gpt-test' }),
      getProvider: vi.fn().mockResolvedValue(provider)
    });

    await expect(resolver.resolve()).resolves.toEqual({
      createOptions: {
        providerId: 'openai',
        providerName: 'OpenAI',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1',
        providerType: 'openai'
      },
      modelId: 'gpt-test',
      maxOutputTokens: 8_192
    });
  });

  it('returns null when selected provider is disabled or model is unavailable', async (): Promise<void> => {
    const resolver = createChatModelResolver({
      getChatModelConfig: vi.fn().mockResolvedValue({ providerId: 'openai', modelId: 'missing-model' }),
      getProvider: vi.fn().mockResolvedValue({
        id: 'openai',
        name: 'OpenAI',
        description: 'OpenAI provider',
        type: 'openai',
        isEnabled: false,
        models: [{ id: 'gpt-test', name: 'GPT Test', type: 'chat', isEnabled: true }]
      } satisfies AIProvider)
    });

    await expect(resolver.resolve()).resolves.toBeNull();
  });

  it('prefers an explicit runtime model without reading the global chat model', async (): Promise<void> => {
    const getChatModelConfig = vi.fn().mockResolvedValue({ providerId: 'global', modelId: 'global-model' });
    const getProvider = vi.fn().mockResolvedValue({
      id: 'session-provider',
      name: 'Session Provider',
      description: 'Session provider',
      type: 'anthropic',
      isEnabled: true,
      apiKey: 'session-key',
      models: [{ id: 'session-model', name: 'Session Model', type: 'chat', isEnabled: true }]
    } satisfies AIProvider);
    const resolver = createChatModelResolver({ getChatModelConfig, getProvider });

    const result = await resolver.resolve({ providerId: 'session-provider', modelId: 'session-model' });

    expect(getChatModelConfig).not.toHaveBeenCalled();
    expect(getProvider).toHaveBeenCalledWith('session-provider');
    expect(result?.modelId).toBe('session-model');
    expect(result?.createOptions.providerId).toBe('session-provider');
  });

  it('does not fall back when an explicit runtime model is invalid', async (): Promise<void> => {
    const getChatModelConfig = vi.fn().mockResolvedValue({ providerId: 'global', modelId: 'global-model' });
    const resolver = createChatModelResolver({ getChatModelConfig, getProvider: vi.fn().mockResolvedValue(null) });

    await expect(resolver.resolve({ providerId: 'missing', modelId: 'missing-model' })).resolves.toBeNull();
    expect(getChatModelConfig).not.toHaveBeenCalled();
  });
});
