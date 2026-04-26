import type { AIProvider, AIProviderModel, AICustomProvider } from 'types/ai';
import { defineStore } from 'pinia';
import { cloneDeep } from 'lodash-es';
import { DEFAULT_PROVIDERS, providerStorage } from '@/shared/storage';

/** Provider 状态 */
interface ProviderState {
  /** 服务商列表 */
  providers: AIProvider[];
  /** 是否正在加载 */
  loading: boolean;
}

/** Provider Store */
export const useProviderStore = defineStore('provider', {
  state: (): ProviderState => ({
    providers: DEFAULT_PROVIDERS.map((p) => cloneDeep(p)),
    loading: false
  }),

  getters: {
    /** 可用于下拉选择的服务商列表 */
    providerList: (state) => state.providers.map((p) => ({ label: p.name, value: p.id })),

    /** 启用的服务商列表 */
    enabledProviders: (state) => state.providers.filter((p) => p.isEnabled)
  },

  actions: {
    /**
     * 加载服务商列表
     */
    async loadProviders(): Promise<void> {
      this.loading = true;
      try {
        this.providers = await providerStorage.listProviders();
      } finally {
        this.loading = false;
      }
    },

    /**
     * 获取服务商信息
     * @param id 服务商 ID
     */
    async getProviderById(id: string): Promise<AIProvider | null> {
      if (!this.providers.length) {
        await this.loadProviders();
      }
      return this.providers.find((p) => p.id === id) || null;
    },

    /**
     * 更新服务商信息
     * @param id 服务商 ID
     * @param patch 要更新的服务商信息
     */
    async updateProvider(id: string, patch: Partial<AIProvider>): Promise<AIProvider | null> {
      const nextProvider = await providerStorage.updateProvider(id, {
        isEnabled: patch.isEnabled,
        apiKey: patch.apiKey,
        baseUrl: patch.baseUrl,
        models: patch.models
      });
      await this.loadProviders();
      return nextProvider;
    },

    /**
     * 切换服务商的启用状态
     * @param id 服务商 ID
     * @param enabled 是否启用
     */
    async toggleProvider(id: string, enabled: boolean): Promise<AIProvider | null> {
      const nextProvider = await providerStorage.toggleProvider(id, enabled);
      await this.loadProviders();
      return nextProvider;
    },

    /**
     * 保存服务商的配置信息
     * @param id 服务商 ID
     * @param config 配置信息，包含 apiKey 和 baseUrl
     */
    async saveProviderConfig(id: string, config: Pick<AIProvider, 'apiKey' | 'baseUrl'>): Promise<AIProvider | null> {
      const nextProvider = await providerStorage.saveProviderConfig(id, config);
      await this.loadProviders();
      return nextProvider;
    },

    /**
     * 保存服务商的模型列表
     * @param id 服务商 ID
     * @param models 模型列表
     */
    async saveProviderModels(id: string, models: AIProviderModel[]): Promise<AIProvider | null> {
      const nextProvider = await providerStorage.saveProviderModels(id, models);
      await this.loadProviders();
      return nextProvider;
    },

    /**
     * 创建或更新自定义服务商
     * @param payload 自定义服务商信息
     */
    async saveCustomProvider(payload: AICustomProvider): Promise<AIProvider | null> {
      const nextProvider = await providerStorage.createOrUpdateCustomProvider(payload);
      await this.loadProviders();
      return nextProvider;
    },

    /**
     * 删除自定义服务商
     * @param id 服务商 ID
     */
    async deleteCustomProvider(id: string): Promise<boolean> {
      const result = await providerStorage.deleteCustomProvider(id);
      if (result) {
        await this.loadProviders();
      }
      return result;
    }
  }
});
