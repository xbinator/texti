// 服务模型类型
export type ServiceModelType = 'polish' | 'chat';

export interface ServiceModelConfig {
  providerId?: string;
  modelId?: string;
  customPrompt?: string;
  updatedAt: number;
}

export type ServiceModelConfigMap = Partial<Record<ServiceModelType, ServiceModelConfig>>;
