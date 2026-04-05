import type { Provider } from '@/services/settings/types';

export interface ModelConfig {
  provider: Provider;
  modelId: string;
  apiKey: string;
  baseUrl?: string | null;
  temperature?: number;
  maxTokens?: number;
}

export interface AIProviderConfig {
  apiKey: string;
  baseURL?: string;
}

export type AIModel = string;

export function createModel(provider: string, modelId: string): string {
  return modelId;
}
