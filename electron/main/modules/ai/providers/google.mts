import type { AIProvider } from '../types.mjs';
import type { LanguageModel } from 'ai';
import type { AICreateOptions } from 'types/ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';

export class GoogleProvider implements AIProvider {
  readonly type = 'google' as const;

  create(options: AICreateOptions) {
    const { apiKey, baseUrl: baseURL, providerName } = options;

    return createGoogleGenerativeAI({ apiKey, baseURL, name: providerName }) as unknown as LanguageModel;
  }
}
