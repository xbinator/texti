/**
 * 服务商管理相关的 Hook
 * 提供服务商的加载、更新、切换状态等功能
 */
import type { Provider, Model } from '../types';
import { computed, ref } from 'vue';
import { cloneDeep } from 'lodash-es';
import type { CustomProviderPayload } from '@/shared/storage';
import { DEFAULT_PROVIDERS, providerStorage } from '@/shared/storage';

/**
 * 模块级共享的服务商列表状态
 * 所有调用 useProviders 的组件共用同一份响应式数据
 */
const providers = ref<Provider[]>(DEFAULT_PROVIDERS.map((provider: Provider) => cloneDeep(provider)));

/**
 * 用于防止重复加载的 Promise 实例
 */
let loadPromise: Promise<void> | null = null;

/**
 * 从存储中加载服务商列表
 */
async function loadProviders(): Promise<void> {
  providers.value = await providerStorage.listProviders();
}

/**
 * 确保服务商列表已加载
 * 防止重复加载，使用 Promise 缓存
 */
function ensureProvidersLoaded(): Promise<void> {
  if (loadPromise) return loadPromise;

  loadPromise = loadProviders().finally(() => {
    loadPromise = null;
  });

  return loadPromise;
}

/**
 * 更新服务商信息
 * @param id 服务商 ID
 * @param patch 要更新的服务商信息
 * @returns 更新后的服务商信息，未找到则返回 null
 */
async function updateProvider(id: string, patch: Partial<Provider>): Promise<Provider | null> {
  const nextProvider = await providerStorage.updateProvider(id, {
    isEnabled: patch.isEnabled,
    apiKey: patch.apiKey,
    baseUrl: patch.baseUrl,
    models: patch.models
  });

  await loadProviders();

  return nextProvider;
}

/**
 * 切换服务商的启用状态
 * @param id 服务商 ID
 * @param enabled 是否启用
 * @returns 切换后的服务商信息，未找到则返回 null
 */
async function toggleProvider(id: string, enabled: boolean): Promise<Provider | null> {
  const nextProvider = await providerStorage.toggleProvider(id, enabled);

  await loadProviders();

  return nextProvider;
}

/**
 * 保存服务商的配置信息
 * @param id 服务商 ID
 * @param config 配置信息，包含 apiKey 和 baseUrl
 * @returns 保存后的服务商信息，未找到则返回 null
 */
async function saveProviderConfig(id: string, config: Pick<Provider, 'apiKey' | 'baseUrl'>): Promise<Provider | null> {
  const nextProvider = await providerStorage.saveProviderConfig(id, config);
  await loadProviders();
  return nextProvider;
}

/**
 * 保存服务商的模型列表
 * @param id 服务商 ID
 * @param models 模型列表
 * @returns 保存后的服务商信息，未找到则返回 null
 */
async function saveProviderModels(id: string, models: Model[]): Promise<Provider | null> {
  const nextProvider = await providerStorage.saveProviderModels(id, models);

  await loadProviders();

  return nextProvider;
}

/**
 * 创建或更新自定义服务商
 * @param payload 自定义服务商信息
 * @returns 保存后的服务商信息，失败时返回 null
 */
async function saveCustomProvider(payload: CustomProviderPayload): Promise<Provider | null> {
  const nextProvider = await providerStorage.createOrUpdateCustomProvider(payload);

  await loadProviders();

  return nextProvider;
}

/**
 * 根据 ID 获取服务商信息
 * @param id 服务商 ID
 * @returns 服务商信息，未找到则返回 null
 */
async function getProviderById(id: string): Promise<Provider | null> {
  await ensureProvidersLoaded();

  return providers.value.find((provider: Provider) => provider.id === id) || null;
}

/**
 * 删除自定义服务商
 * @param id 服务商 ID
 * @returns 是否删除成功
 */
async function deleteCustomProvider(id: string): Promise<boolean> {
  const result = await providerStorage.deleteCustomProvider(id);

  if (result) {
    await loadProviders();
  }

  return result;
}

/**
 * 用于下拉选择的服务商列表
 * 格式为 { label: 服务商名称, value: 服务商 ID }
 */
const providerList = computed(() => providers.value.map((provider: Provider) => ({ label: provider.name, value: provider.id })));

const providerStore = {
  providers,
  providerList,
  loadProviders,
  getProviderById,
  updateProvider,
  toggleProvider,
  saveProviderConfig,
  saveProviderModels,
  saveCustomProvider,
  deleteCustomProvider
};

let initialized = false;

export function useProviders() {
  if (!initialized) {
    initialized = true;
    ensureProvidersLoaded();
  }

  return providerStore;
}
