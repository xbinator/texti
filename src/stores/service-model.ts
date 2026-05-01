import type { ModelServiceConfig, ModelServiceType } from 'types/model';
import { defineStore } from 'pinia';
import { providerStorage, serviceModelsStorage } from '@/shared/storage';
import { local } from '@/shared/storage/base';
import { dispatchServiceModelUpdated } from '@/shared/storage/service-models/events';

/** 本地存储键名 */
const STORAGE_KEY = 'service_model_settings';

/**
 * 选中的模型标识。
 */
export interface SelectedModel {
  /** 服务商 ID */
  providerId: string;
  /** 模型 ID */
  modelId: string;
}

/** 服务模型设置 */
interface ServiceModelSettings {
  /** 折叠状态记录 */
  collapsedSections: Record<string, boolean>;
}

/** 服务模型状态 */
interface ServiceModelState {
  /** 设置信息 */
  settings: ServiceModelSettings;
  /** 当前智能对话助手选中的模型标识 */
  chatModel: SelectedModel | undefined;
}

/** 可用的服务模型配置 */
export interface AvailableServiceModelConfig extends ModelServiceConfig {
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

/**
 * 持久化写入时的竞态保护版本号。
 * 模块级变量，不污染 store state。连续快速切换模型时保证只有最后一次派发事件。
 */
let saveVersion = 0;

/** 服务模型 Store */
export const useServiceModelStore = defineStore('serviceModel', {
  state: (): ServiceModelState => ({
    settings: loadSettings(),
    chatModel: undefined
  }),

  actions: {
    /**
     * 获取服务配置
     * @param serviceType - 服务类型
     * @returns 服务模型配置
     */
    async getServiceConfig(serviceType: ModelServiceType): Promise<ModelServiceConfig | null> {
      return serviceModelsStorage.getConfig(serviceType);
    },

    /**
     * 获取可用的服务配置
     * @param serviceType - 服务类型
     * @returns 可用的服务模型配置
     */
    async getAvailableServiceConfig(serviceType: ModelServiceType): Promise<AvailableServiceModelConfig | null> {
      const config = await this.getServiceConfig(serviceType);
      if (!config?.providerId || !config?.modelId) return null;

      const provider = await providerStorage.getProvider(config.providerId);
      if (!provider?.isEnabled) return null;

      return { ...config, providerId: config.providerId, modelId: config.modelId };
    },

    /**
     * 检查服务是否可用
     * @param serviceType - 服务类型
     * @returns 是否可用
     */
    async isServiceAvailable(serviceType: ModelServiceType): Promise<boolean> {
      const config = await this.getAvailableServiceConfig(serviceType);
      return Boolean(config);
    },

    /**
     * 加载当前 chat 服务选中的模型。
     * 从 serviceModelsStorage 读取并写入 store 状态。
     */
    async loadChatModel(): Promise<void> {
      const config = await serviceModelsStorage.getConfig('chat');
      this.chatModel = config?.providerId && config?.modelId ? { providerId: config.providerId, modelId: config.modelId } : undefined;
    },

    /**
     * 设置当前 chat 服务选中的模型（乐观更新）。
     * 先更新 store 让 UI 立即响应，再异步持久化。
     * 版本号保证连续快速切换时只有最后一次派发事件。
     * @param model - 选中的模型标识
     */
    async setChatModel(model: SelectedModel): Promise<void> {
      const { providerId, modelId } = model;

      // 乐观更新
      this.chatModel = model;

      const version = ++saveVersion;
      await serviceModelsStorage.saveConfig('chat', { providerId, modelId });
      if (version === saveVersion) {
        dispatchServiceModelUpdated('chat');
      }
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
