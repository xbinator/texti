/**
 * @file useModelSelection.ts
 * @description 模型选择状态管理 hook，从 service-model store 读取选中模型，
 * 从 provider store 派生视觉能力，自动响应所有数据变更。
 */
import { computed } from 'vue';
import { useProviderStore } from '@/stores/provider';
import { useServiceModelStore } from '@/stores/service-model';

/**
 * 模型选择状态管理 hook
 * @returns 模型选择状态和操作方法
 */
export function useModelSelection() {
  const serviceModelStore = useServiceModelStore();
  const providerStore = useProviderStore();

  /** 当前选中的模型标识，从 store 读取 */
  const selectedModel = computed(() => serviceModelStore.chatModel);

  /** 当前模型是否支持视觉识别，从 providerStore 响应式派生 */
  const supportsVision = computed(() => {
    const model = selectedModel.value;
    if (!model) return false;
    const provider = providerStore.providers.find((p) => p.id === model.providerId);
    const foundModel = provider?.models?.find((m) => m.id === model.modelId);
    return foundModel?.supportsVision === true;
  });

  /**
   * 初始化加载当前选中的模型配置。
   * 从 serviceModelsStorage 读取 chat 场景的默认模型并写入 store。
   */
  async function loadSelectedModel(): Promise<void> {
    await serviceModelStore.loadChatModel();
  }

  /**
   * 处理模型变更。
   * 通过 store 保存并更新状态，computed 自动派生 supportsVision。
   * @param model - 新选中的模型标识
   */
  async function onModelChange(model: { providerId: string; modelId: string }): Promise<void> {
    await serviceModelStore.setChatModel(model);
  }

  return {
    selectedModel,
    supportsVision,
    loadSelectedModel,
    onModelChange
  };
}
