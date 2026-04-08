import type { ServiceModelConfig, ServiceModelConfigMap, ServiceModelType } from './types';
import localforage from 'localforage';

const serviceModelStorage = localforage.createInstance({
  name: 'Texti',
  storeName: 'service_models',
  description: 'Texti 服务模型配置存储'
});

const SERVICE_MODELS_KEY = 'service_model_configs';

function cloneConfig(config: ServiceModelConfig): ServiceModelConfig {
  return { ...config };
}

export const serviceModelsStorage = {
  async getAllConfigs(): Promise<ServiceModelConfigMap> {
    const configs = await serviceModelStorage.getItem<ServiceModelConfigMap>(SERVICE_MODELS_KEY);
    return configs || {};
  },

  async getConfig(serviceType: ServiceModelType): Promise<ServiceModelConfig | null> {
    const configs = await this.getAllConfigs();
    const config = configs[serviceType];

    return config ? cloneConfig(config) : null;
  },

  async saveConfig(serviceType: ServiceModelType, config: Omit<ServiceModelConfig, 'updatedAt'>): Promise<ServiceModelConfig> {
    const configs = await this.getAllConfigs();
    const nextConfig: ServiceModelConfig = {
      ...config,
      updatedAt: Date.now()
    };

    configs[serviceType] = nextConfig;
    await serviceModelStorage.setItem(SERVICE_MODELS_KEY, configs);

    return cloneConfig(nextConfig);
  },

  async removeConfig(serviceType: ServiceModelType): Promise<void> {
    const configs = await this.getAllConfigs();
    delete configs[serviceType];
    await serviceModelStorage.setItem(SERVICE_MODELS_KEY, configs);
  }
};

export type { ServiceModelConfig, ServiceModelType };
