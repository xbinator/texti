import type { AIProviderConfig, AIModel } from '../types';
import { createOpenAI } from '@ai-sdk/openai';

export function createOpenAIProvider(config: AIProviderConfig): AIModel {
  const openai = createOpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL
  });

  return openai;
}

export function createOpenAIModel(config: AIProviderConfig, modelId: string): AIModel {
  const openai = createOpenAIProvider(config);
  return openai(modelId);
}
