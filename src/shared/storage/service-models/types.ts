//
export type ServiceModelType = 'polish';

export interface ServiceModelConfig {
  providerId?: string;
  modelId?: string;
  customPrompt?: string;
  updatedAt: number;
}

export type ServiceModelConfigMap = Partial<Record<ServiceModelType, ServiceModelConfig>>;
