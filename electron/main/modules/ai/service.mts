import type { AICreateOptions, AIRequestOptions, AIInvokeResult, AIStreamResult, AIServiceError } from 'types/ai';
import { generateText, streamText } from 'ai';
import { log } from '../logger/service.mjs';
import { AIProviderRegistry } from './providers/_index.mjs';

class AIService {
  public aiProvider: AIProviderRegistry = new AIProviderRegistry();

  private createModel(createOptions: AICreateOptions, modelId: string) {
    return this.aiProvider.create(createOptions, modelId);
  }

  async generateText(createOptions: AICreateOptions, request: AIRequestOptions): Promise<[AIServiceError] | [undefined, AIInvokeResult]> {
    try {
      const model = this.createModel(createOptions, request.modelId);
      const { prompt, system, temperature } = request;

      log.info(`[AIService] generateText: Provider=${createOptions.providerType}, Model=${request.modelId}`);
      log.info(`[AIService] generateText payload:`, { prompt, system, temperature });

      const result = await generateText({ model, prompt, system, temperature });

      const { inputTokens = 0, outputTokens = 0, totalTokens = 0 } = result.usage || {};

      return [undefined, { text: result.text, usage: { inputTokens, outputTokens, totalTokens } }];
    } catch (error: unknown) {
      log.error('[AIService] generateText error:', error);

      return [this.aiProvider.normalizeError(error, createOptions.providerType)];
    }
  }

  async streamText(createOptions: AICreateOptions, request: AIRequestOptions): Promise<[AIServiceError] | [undefined, AIStreamResult]> {
    try {
      const model = this.createModel(createOptions, request.modelId);
      const { prompt, system, temperature } = request;

      log.info(`[AIService] streamText: Provider=${createOptions.providerType}, Model=${request.modelId}`);
      log.info(`[AIService] streamText payload:`, { prompt, system, temperature });

      const result = streamText({ model, prompt, system, temperature });

      return [undefined, { stream: result.textStream }];
    } catch (error: unknown) {
      log.error('[AIService] streamText error:', error);

      return [this.aiProvider.normalizeError(error, createOptions.providerType)];
    }
  }
}

export const aiService = new AIService();
