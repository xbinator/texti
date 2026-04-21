/**
 * @file service-model.d.ts
 * @description 服务模型相关类型定义
 */

/**
 * 服务模型类型
 */
export type ModelServiceType = 'polish' | 'chat';

/**
 * 服务模型配置
 */
export interface ModelServiceConfig {
  /** 提供商 ID */
  providerId?: string;
  /** 模型 ID */
  modelId?: string;
  /** 自定义提示词 */
  customPrompt?: string;
  /** 更新时间戳 */
  updatedAt: number;
}

/**
 * 服务模型配置映射
 */
export type ModeServicelConfigMap = Partial<Record<ModelServiceType, ModelServiceConfig>>;
