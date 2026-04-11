import type { AIProvider } from '../types.mjs';
import type { LanguageModel } from 'ai';
import type { AICreateOptions } from 'types/ai';
import { createAnthropic } from '@ai-sdk/anthropic';

export class AnthropicProvider implements AIProvider {
  readonly type = 'anthropic' as const;

  create(options: AICreateOptions) {
    const { apiKey, baseUrl: baseURL, providerName } = options;

    return createAnthropic({ apiKey, baseURL, name: providerName }) as unknown as LanguageModel;
  }
}
