/**
 * @file _index.mts
 * @description AI 服务商注册表，管理所有 AI 服务商的创建和错误处理
 */
import type { AIProvider } from '../types.mjs';
import type { LanguageModel } from 'ai';
import type { AIServiceError, AIProviderType, AICreateOptions } from 'types/ai';
import { AnthropicProvider } from './anthropic.mjs';
import { DeepSeekProvider } from './deepseek.mjs';
import { GoogleProvider } from './google.mjs';
import { OpenAIProvider } from './openai.mjs';

/**
 * AI 服务商注册表
 * @description 管理所有 AI 服务商的注册、创建和错误处理
 */
export class AIProviderRegistry {
  /** 服务商映射表 */
  private readonly providers = new Map<AIProviderType, AIProvider>();

  constructor() {
    // 注册内置服务商
    this.register(new OpenAIProvider());
    this.register(new AnthropicProvider());
    this.register(new GoogleProvider());
    this.register(new DeepSeekProvider());
  }

  /**
   * 注册服务商
   * @param provider - 服务商实例
   */
  register(provider: AIProvider): void {
    this.providers.set(provider.type, provider);
  }

  /**
   * 创建语言模型实例
   * @param options - 创建选项（包含服务商类型、API Key 等）
   * @param modelId - 模型 ID
   * @returns 语言模型实例
   */
  create(options: AICreateOptions, modelId: string): LanguageModel {
    const driver = this.providers.get(options.providerType);

    return driver?.create(options, modelId) as LanguageModel;
  }

  /**
   * 统一错误处理分发
   * @param error - 原始错误
   * @param providerType - 服务商类型
   * @returns 标准化的 AIServiceError
   */
  normalizeError(error: unknown, providerType: AIProviderType): AIServiceError {
    const driver = this.providers.get(providerType);

    if (driver) {
      return driver.normalizeError(error);
    }

    // 如果找不到对应的 driver，默认使用 openai 的错误处理逻辑兜底
    return this.providers.get('openai')!.normalizeError(error);
  }
}
