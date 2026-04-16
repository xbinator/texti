import type { AIProviderModel } from 'types/ai';

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
  /** 最近一次与磁盘同步的内容 */
  savedContent?: string;
  /** 文件名称 */
  name: string;
  /** 文件扩展名 */
  ext: string;
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
  models?: AIProviderModel[];
}

/**
 * 设置状态
 */
export interface SettingsState {
  /** 提供商设置映射表，键为提供商 ID */
  providers: Record<string, StoredProviderSettings>;
}
