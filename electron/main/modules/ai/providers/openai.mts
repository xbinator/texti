import type { AIProvider } from '../types.mjs';
import type { LanguageModel } from 'ai';
import type { AICreateOptions } from 'types/ai';
import { createOpenAI } from '@ai-sdk/openai';

export class OpenAIProvider implements AIProvider {
  readonly type = 'openai' as const;

  create(options: AICreateOptions) {
    const { apiKey, baseUrl: baseURL, providerName } = options;

    return createOpenAI({ apiKey, baseURL, name: providerName }) as unknown as LanguageModel;
  }
}
