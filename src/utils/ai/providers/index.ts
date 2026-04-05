import type { AIModel, AIProviderConfig } from '../types';
import type { Provider } from '@/services/settings/types';
import { createAnthropicModel } from './anthropic';
import { getDefaultBaseUrl, isProviderOpenAICompatible } from './config';
import { createGoogleModel } from './google';
import { createOpenAIModel } from './openai';

export function getModelClient(provider: Provider, config: AIProviderConfig, modelId: string): AIModel {
  const baseURL = config.baseURL || getDefaultBaseUrl(provider);

  const providerConfig: AIProviderConfig = {
    apiKey: config.apiKey,
    baseURL
  };

  if (isProviderOpenAICompatible(provider)) {
    return createOpenAIModel(providerConfig, modelId);
  }

  switch (provider) {
    case 'anthropic':
      return createAnthropicModel(providerConfig, modelId);
    case 'google':
      return createGoogleModel(providerConfig, modelId);
    default:
      return createOpenAIModel(providerConfig, modelId);
  }
}

export { getDefaultBaseUrl, isProviderOpenAICompatible };
