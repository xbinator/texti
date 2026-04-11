import type { AIServiceError } from './errors/codes.mjs';
import type { LanguageModel } from 'ai';
import type { AIProviderType, AICreateOptions } from 'types/ai';

export interface AIProvider {
  readonly type: AIProviderType;

  create(options: AICreateOptions): LanguageModel;

  normalizeError(error: unknown, fallbackMessage?: string): AIServiceError;
}
