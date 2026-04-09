import type { AIError } from '../errors';
import type { AIProvider, AIProviderConfig, CreateLanguageModelInput, GenerateTextInput, GenerateTextResult } from '../types';
import type { LanguageModel, StreamTextResult } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { normalizeAnthropicError } from '../errors';
import { executeGenerateText, executeStreamText } from '../provider-helpers';

export class AnthropicProvider implements AIProvider {
  readonly type = 'anthropic' as const;

  normalizeError(error: unknown): AIError {
    return normalizeAnthropicError(error, 'Anthropic 服务调用失败');
  }

  createLanguageModel(input: CreateLanguageModelInput): LanguageModel {
    const { apiKey, baseUrl, providerId } = input.config;

    const provider = createAnthropic({ apiKey, baseURL: baseUrl, name: providerId });

    return provider.messages(input.modelId) as unknown as LanguageModel;
  }

  async generateText(config: AIProviderConfig, input: GenerateTextInput): Promise<GenerateTextResult> {
    return executeGenerateText(this, config, input);
  }

  async streamText(config: AIProviderConfig, input: GenerateTextInput): Promise<StreamTextResult<any, any>> {
    return executeStreamText(this, config, input);
  }
}
