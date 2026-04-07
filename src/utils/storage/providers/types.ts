/**
 * 存储的文件信息
 */
export interface StoredFile {
  /** 文件唯一标识符 */
  id: string;
  /** 文件路径，可为空 */
  path: string | null;
  /** 文件内容 */
  content: string;
  /** 文件名称 */
  name: string;
  /** 文件扩展名 */
  ext: string;
}

/**
 * 提供商模型配置
 */
export interface ProviderModel {
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
 * 提供商请求格式类型
 * - openai: OpenAI 兼容格式
 * - anthropic: Anthropic 格式
 * - google: Google 格式
 */
export type ProviderRequestFormat = 'openai' | 'anthropic' | 'google';

/**
 * AI 提供商配置
 */
export interface Provider {
  /** 提供商唯一标识符 */
  id: string;
  /** 提供商显示名称 */
  name: string;
  /** 提供商描述 */
  description: string;
  /** 提供商请求格式类型 */
  type: ProviderRequestFormat;
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
  models?: ProviderModel[];
}

/**
 * 存储的提供商设置（用于持久化）
 */
export interface StoredProviderSettings {
  /** 是否启用 */
  isEnabled?: boolean;
  /** API 密钥 */
  apiKey?: string;
  /** 自定义 API 基础地址 */
  baseUrl?: string;
  /** 模型配置列表 */
  models?: ProviderModel[];
}

/**
 * 自定义提供商创建/更新的数据结构
 */
export interface CustomProviderPayload {
  /** 提供商唯一标识符 */
  id: string;
  /** 提供商显示名称 */
  name: string;
  /** 提供商描述 */
  description?: string;
  /** 提供商请求格式类型 */
  type: ProviderRequestFormat;
  /** 提供商标识 Logo */
  logo?: string;
  /** 是否启用 */
  isEnabled?: boolean;
  /** API 密钥 */
  apiKey?: string;
  /** 自定义 API 基础地址 */
  baseUrl?: string;
}

/**
 * 设置状态
 */
export interface SettingsState {
  /** 提供商设置映射表，键为提供商 ID */
  providers: Record<string, StoredProviderSettings>;
}
