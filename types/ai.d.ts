/**
 * 提供商请求格式类型
 * - openai: OpenAI 兼容格式
 * - anthropic: Anthropic 格式
 * - google: Google 格式
 */
export type AIProviderType = 'openai' | 'anthropic' | 'google';

export interface AICreateOptions {
  // 提供商类型
  providerType: AIProviderType;
  // 提供商 ID
  providerId: string;
  // 提供商 名称
  providerName: string;
  // 服务商 API 密钥
  apiKey?: string;
  // 自定义 API 基础地址
  baseUrl?: string;
}

export interface AIRequestOptions {
  // 模型 ID
  modelId: string;
  // 提示词
  prompt: string;
  // 系统提示
  system?: string;
  // 温度
  temperature?: number;
}

/**
 * 提供商模型配置
 */
export interface AIProviderModel {
  /** 模型唯一标识符 */
  id: string;
  /** 模型显示名称 */
  name: string;
  /** 模型类型 */
  type: string;
  /** 是否启用该模型 */
  isEnabled: boolean;
}

/**
 * AI 服务错误类型
 * 扩展了标准 Error 对象，添加了错误代码和原因字段
 */
export interface AIServiceError {
  /** 错误代码 */
  code: AIErrorCode;
  /** 错误原因 */
  message: string;
}

/**
 * AI 提供商配置
 */
export interface AIProvider {
  /** 提供商唯一标识符 */
  id: string;
  /** 提供商显示名称 */
  name: string;
  /** 提供商描述 */
  description: string;
  /** 提供商请求格式类型 */
  type: AIProviderType;
  /** 是否启用该提供商 */
  isEnabled: boolean;
  /** API 密钥 */
  apiKey?: string;
  /** 自定义 API 基础地址 */
  baseUrl?: string;
  /** 提供商标识 Logo */
  logo?: string;
  /** 是否为用户自定义提供商 */
  isCustom?: boolean;
  /** 是否为只读提供商（不可修改或删除） */
  readonly?: boolean;
  /** 提供商支持的模型列表 */
  models?: AIProviderModel[];
}

/**
 * 自定义提供商创建/更新的数据结构
 */
export interface AICustomProvider {
  /** 提供商唯一标识符 */
  id: string;
  /** 提供商显示名称 */
  name: string;
  /** 提供商描述 */
  description?: string;
  /** 提供商请求格式类型 */
  type: AIProviderType;
  /** 提供商标识 Logo */
  logo?: string;
  /** 是否启用 */
  isEnabled?: boolean;
  /** API 密钥 */
  apiKey?: string;
  /** 自定义 API 基础地址 */
  baseUrl?: string;
}
