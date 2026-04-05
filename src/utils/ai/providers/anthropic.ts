import type { AIProviderConfig, AIModel } from '../types';
import { createAnthropic } from '@ai-sdk/anthropic';

export function createAnthropicProvider(config: AIProviderConfig): AIModel {
  const anthropic = createAnthropic({
    apiKey: config.apiKey,
    baseURL: config.baseURL
  });

  return anthropic;
}

export function createAnthropicModel(config: AIProviderConfig, modelId: string): AIModel {
  const anthropic = createAnthropicProvider(config);
  return anthropic(modelId);
}
