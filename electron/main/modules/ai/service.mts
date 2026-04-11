import type { LanguageModel } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText, streamText } from 'ai';

export type ProviderRequestFormat = 'openai' | 'anthropic' | 'google';

export interface AIRequest {
  providerId: string;
  modelId: string;
  prompt: string;
  system?: string;
  temperature?: number;
}

export interface ProviderConfig {
  type: ProviderRequestFormat;
  apiKey: string;
  baseUrl?: string;
}

type ModelFactory = (modelId: string) => LanguageModel;

class ElectronAIService {
  private providers: Map<string, ProviderConfig> = new Map();

  setProvider(providerId: string, config: ProviderConfig): void {
    this.providers.set(providerId, config);
  }

  getProvider(providerId: string): ProviderConfig | undefined {
    return this.providers.get(providerId);
  }

  removeProvider(providerId: string): void {
    this.providers.delete(providerId);
  }

  private createModelFactory(config: ProviderConfig): ModelFactory {
    const { type, apiKey, baseUrl } = config;

    switch (type) {
      case 'openai': {
        const provider = createOpenAI({
          apiKey,
          baseURL: baseUrl
        });
        return (modelId: string) => provider.chat(modelId) as unknown as LanguageModel;
      }

      case 'anthropic': {
        const provider = createAnthropic({
          apiKey,
          baseURL: baseUrl
        });
        return (modelId: string) => provider(modelId) as unknown as LanguageModel;
      }

      case 'google': {
        const provider = createGoogleGenerativeAI({
          apiKey,
          baseURL: baseUrl
        });
        return (modelId: string) => provider(modelId) as unknown as LanguageModel;
      }

      default:
        throw new Error(`Unsupported provider type: ${type}`);
    }
  }

  async generateText(request: AIRequest): Promise<{ text: string }> {
    const config = this.providers.get(request.providerId);
    if (!config) {
      throw new Error(`Provider ${request.providerId} not configured`);
    }

    const createModel = this.createModelFactory(config);
    const model = createModel(request.modelId);

    const result = await generateText({
      model,
      prompt: request.prompt,
      system: request.system,
      temperature: request.temperature
    });

    return { text: result.text };
  }

  async *streamText(request: AIRequest): AsyncGenerator<string> {
    const config = this.providers.get(request.providerId);
    if (!config) {
      throw new Error(`Provider ${request.providerId} not configured`);
    }

    const createModel = this.createModelFactory(config);
    const model = createModel(request.modelId);

    const stream = streamText({ model, prompt: request.prompt, system: request.system, temperature: request.temperature });

    for await (const chunk of stream.textStream) {
      yield chunk;
    }
  }
}

export const aiService = new ElectronAIService();
