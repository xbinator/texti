import { defineStore } from 'pinia';
import { providerStorage, serviceModelsStorage } from '@/shared/storage';
import { local } from '@/shared/storage/base';
import type { ServiceModelConfig, ServiceModelType } from '@/shared/storage/service-models';

/** 本地存储键名 */
const STORAGE_KEY = 'service_model_settings';

/** 服务模型设置 */
interface ServiceModelSettings {
  /** 折叠状态记录 */
  collapsedSections: Record<string, boolean>;
}

/** 服务模型状态 */
interface ServiceModelState {
  /** 设置信息 */
  settings: ServiceModelSettings;
}

/** 可用的服务模型配置 */
export interface AvailableServiceModelConfig extends ServiceModelConfig {
  /** 提供商ID */
  providerId: string;
  /** 模型ID */
  modelId: string;
}

/**
 * 从本地存储加载设置
 * @returns 服务模型设置
 */
function loadSettings(): ServiceModelSettings {
  return local.getItem<ServiceModelSettings>(STORAGE_KEY) ?? { collapsedSections: {} };
}

/**
 * 保存设置到本地存储
 * @param settings - 服务模型设置
 */
function saveSettings(settings: ServiceModelSettings): void {
  local.setItem(STORAGE_KEY, settings);
}

/** 服务模型 Store */
export const useServiceModelStore = defineStore('serviceModel', {
  state: (): ServiceModelState => ({
    settings: loadSettings()
  }),

  actions: {
    /**
     * 获取服务配置
     * @param serviceType - 服务类型
     * @returns 服务模型配置
     */
    async getServiceConfig(serviceType: ServiceModelType): Promise<ServiceModelConfig | null> {
      return serviceModelsStorage.getConfig(serviceType);
    },

    /**
     * 获取可用的服务配置
     * @param serviceType - 服务类型
     * @returns 可用的服务模型配置
     */
    async getAvailableServiceConfig(serviceType: ServiceModelType): Promise<AvailableServiceModelConfig | null> {
      const config = await this.getServiceConfig(serviceType);
      if (!config?.providerId || !config?.modelId) return null;

      const provider = await providerStorage.getProvider(config.providerId);
      if (!provider?.isEnabled || !provider.apiKey) return null;

      return { ...config, providerId: config.providerId, modelId: config.modelId };
    },

    /**
     * 检查服务是否可用
     * @param serviceType - 服务类型
     * @returns 是否可用
     */
    async isServiceAvailable(serviceType: ServiceModelType): Promise<boolean> {
      const config = await this.getAvailableServiceConfig(serviceType);
      return Boolean(config);
    },

    /**
     * 获取区域是否折叠
     * @param serviceType - 服务类型
     * @param section - 区域名称
     * @returns 是否折叠
     */
    isSectionCollapsed(serviceType: string, section: string): boolean {
      const key = `${serviceType}:${section}`;
      return this.settings.collapsedSections[key] ?? false;
    },

    /**
     * 切换区域折叠状态
     * @param serviceType - 服务类型
     * @param section - 区域名称
     */
    toggleSectionCollapsed(serviceType: string, section: string): void {
      const key = `${serviceType}:${section}`;
      this.settings.collapsedSections[key] = !this.settings.collapsedSections[key];
      saveSettings(this.settings);
    },

    /**
     * 设置区域折叠状态
     * @param serviceType - 服务类型
     * @param section - 区域名称
     * @param collapsed - 是否折叠
     */
    setSectionCollapsed(serviceType: string, section: string, collapsed: boolean): void {
      const key = `${serviceType}:${section}`;
      this.settings.collapsedSections[key] = collapsed;
      saveSettings(this.settings);
    }
  }
});
