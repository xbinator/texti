import type { AIProvider } from '../types.mjs';
import type { LanguageModel } from 'ai';
import type { AIProviderType, AICreateOptions } from 'types/ai';
import { AnthropicProvider } from './anthropic.mjs';
import { GoogleProvider } from './google.mjs';
import { OpenAIProvider } from './openai.mjs';

export class AIProviderRegistry {
  private readonly providers = new Map<AIProviderType, AIProvider>();

  constructor() {
    this.register(new OpenAIProvider());
    this.register(new AnthropicProvider());
    this.register(new GoogleProvider());
  }

  register(provider: AIProvider): void {
    this.providers.set(provider.type, provider);
  }

  // 创建语言模型
  create(options: AICreateOptions): LanguageModel {
    const driver = this.providers.get(options.providerType);

    return driver?.create(options) as LanguageModel;
  }
}
