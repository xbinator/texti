import type { AICreateOptions, AIRequestOptions } from 'types/ai';
import { generateText, streamText } from 'ai';
import { AIProviderRegistry } from './providers/_index.mjs';

interface AITextResult {
  text: string;
}

interface AITextStreamResult {
  textStream: AsyncIterable<string>;
}

class AIService {
  public aiProvider: AIProviderRegistry = new AIProviderRegistry();

  private createModel(createOptions: AICreateOptions) {
    return this.aiProvider.create(createOptions);
  }

  async generateText(createOptions: AICreateOptions, request: AIRequestOptions): Promise<AITextResult> {
    try {
      const model = this.createModel(createOptions);
      const { prompt, system, temperature } = request;
      const result = await generateText({ model, prompt, system, temperature });

      return { text: result.text };
    } catch (error: unknown) {
      throw this.aiProvider.normalizeError(error, createOptions.providerType);
    }
  }

  async streamText(createOptions: AICreateOptions, request: AIRequestOptions): Promise<AITextStreamResult> {
    try {
      const model = this.createModel(createOptions);
      const { prompt, system, temperature } = request;
      const result = streamText({ model, prompt, system, temperature });

      return { textStream: result.textStream };
    } catch (error: unknown) {
      throw this.aiProvider.normalizeError(error, createOptions.providerType);
    }
  }
}

export const aiService = new AIService();
