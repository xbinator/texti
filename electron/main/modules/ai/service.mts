import type { AICreateOptions, AIRequestOptions } from 'types/ai';
import { generateText, streamText } from 'ai';
import { AIProviderRegistry } from './providers/_index.mjs';

class AIService {
  public aiProvider = new AIProviderRegistry();

  async generateText(createOptions: AICreateOptions, request: AIRequestOptions) {
    const model = this.aiProvider.create(createOptions);

    const { prompt, system, temperature } = request;

    return generateText({ model, prompt, system, temperature });
  }

  async streamText(createOptions: AICreateOptions, request: AIRequestOptions) {
    const model = this.aiProvider.create(createOptions);

    const { prompt, system, temperature } = request;

    return streamText({ model, prompt, system, temperature });
  }
}

export const aiService = new AIService();
