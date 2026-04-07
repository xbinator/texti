import type { LanguageModel } from 'ai';
import type { Provider, ProviderModel, ProviderRequestFormat } from '@/utils/storage';

export type AIProviderType = ProviderRequestFormat;

export interface AIProviderConfig {
  // 服务商 ID
  providerId: string;
  // 服务商类型
  type: AIProviderType;
  // API 密钥
  apiKey: string;
  // API 基础 URL
  baseUrl?: string;
}

/**
 * 生成文本的输入参数
 */
export interface GenerateTextInput {
  /** 模型 ID */
  modelId: string;
  /** 系统提示词 */
  system?: string;
  /** 用户提示词 */
  prompt: string;
  /** 温度参数，控制输出的随机性 */
  temperature?: number;
  /** 最大生成 token 数 */
  maxTokens?: number;
}

/**
 * 生成文本的结果
 */
export interface GenerateTextResult {
  /** 生成的文本内容 */
  text: string;
}

export type AIServiceResult<T> = Promise<[error: Error] | [undefined, T]>;

/**
 * 解析后的服务商模型信息
 */
export interface ResolvedProviderModel {
  /** 服务商信息 */
  provider: Provider;
  /** 模型信息 */
  model: ProviderModel;
}

/**
 * 创建语言模型的输入参数
 */
export interface CreateLanguageModelInput {
  /** AI 服务商配置 */
  config: AIProviderConfig;
  /** 模型 ID */
  modelId: string;
}

/**
 * AI 服务商驱动接口
 */
export interface AIProviderDriver {
  /** 服务商类型 */
  readonly type: AIProviderType;

  /**
   * 创建语言模型实例
   * @param input 创建语言模型的输入参数
   * @returns 语言模型实例
   */
  createLanguageModel(input: CreateLanguageModelInput): LanguageModel;

  /**
   * 生成文本
   * @param config AI 服务商配置
   * @param input 生成文本的输入参数
   * @returns 生成文本的结果
   */
  generateText(config: AIProviderConfig, input: GenerateTextInput): Promise<GenerateTextResult>;
}

export type AIProvider = AIProviderDriver;
