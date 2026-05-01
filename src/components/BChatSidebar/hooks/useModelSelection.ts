/**
 * @file useModelSelection.ts
 * @description 模型选择状态管理 hook，管理当前选中模型、视觉能力判断和模型切换
 */
import { ref, watch } from 'vue';
import { getModelVisionSupport } from '@/ai/tools/policy';
import { serviceModelsStorage } from '@/shared/storage';

/**
 * 解析选中的模型标识结果
 */
interface ParsedModel {
  /** 服务商 ID */
  providerId: string;
  /** 模型 ID */
  modelId: string;
}

/**
 * 解析选中的模型标识。
 * @param value - providerId:modelId 格式的模型值
 * @returns 解析结果，无效时返回 null
 */
function parseSelectedModel(value: string | undefined): ParsedModel | null {
  if (!value) return null;
  const index = value.indexOf(':');
  if (index <= 0 || index === value.length - 1) return null;

  return {
    providerId: value.slice(0, index),
    modelId: value.slice(index + 1)
  };
}

/**
 * 模型选择状态管理 hook
 * @returns 模型选择状态和操作方法
 */
export function useModelSelection() {
  /** 当前选中的模型标识（providerId:modelId） */
  const selectedModel = ref<string | undefined>(undefined);
  /** 当前模型是否支持视觉识别 */
  const supportsVision = ref(false);
  /** 模型视觉能力检查版本号，用于防止快速切换模型时竞态覆盖 */
  let visionCheckVersion = 0;

  /**
   * 初始化加载当前选中的模型配置。
   * 从 serviceModelsStorage 读取 chat 场景的默认模型。
   */
  async function loadSelectedModel(): Promise<void> {
    const config = await serviceModelsStorage.getConfig('chat');
    selectedModel.value = config?.providerId && config?.modelId ? `${config.providerId}:${config.modelId}` : undefined;
  }

  /**
   * 处理模型变更。
   * @param value - 新选中的模型标识（providerId:modelId）
   */
  function onModelChange(value: string): void {
    selectedModel.value = value;
  }

  // 监听模型变更，派生视觉能力，含竞态保护
  watch(
    () => selectedModel.value,
    async (value) => {
      const version = ++visionCheckVersion;
      const parsed = parseSelectedModel(value);

      if (!parsed) {
        supportsVision.value = false;
        return;
      }

      const supported = await getModelVisionSupport(parsed.providerId, parsed.modelId);

      if (version === visionCheckVersion) {
        supportsVision.value = supported;
      }
    },
    { immediate: true }
  );

  return {
    selectedModel,
    supportsVision,
    loadSelectedModel,
    onModelChange
  };
}
