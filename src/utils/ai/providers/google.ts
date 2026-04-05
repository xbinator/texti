import type { AIProviderConfig, AIModel } from '../types';
import { createGoogleGenerativeAI } from '@ai-sdk/google';

export function createGoogleProvider(config: AIProviderConfig): AIModel {
  const google = createGoogleGenerativeAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL
  });

  return google;
}

export function createGoogleModel(config: AIProviderConfig, modelId: string): AIModel {
  const google = createGoogleProvider(config);
  return google(modelId);
}
