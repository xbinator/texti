import type { AIServiceError, AIRequestOptions, AICreateOptions } from 'types/ai';
import { computed, toValue, type MaybeRefOrGetter } from 'vue';
import { getElectronAPI } from '@/shared/platform/electron-api';
import { providerStorage } from '@/shared/storage';
import { asyncTo } from '@/utils/asyncTo';

export interface UseStreamOptions {
  /** 服务商 ID */
  providerId: MaybeRefOrGetter<string | undefined>;
  // 其他选项...
  /** 是否忽略服务商启用状态 */
  ignoreEnabled?: boolean;
  /** 错误回调 */
  onError?: (error: AIServiceError) => void;
  /** 流式数据回调 */
  onChunk?: (chunk: string) => void;
  /** 完成回调 */
  onComplete?: (text: string) => void;
}

/**
 * AI 流式文本生成 Hook
 * 提供流式文本生成能力，支持实时获取生成内容
 */
export function useAgent(options: UseStreamOptions) {
  const electronAPI = getElectronAPI();

  const providerId = computed(() => toValue(options.providerId));

  // 获取服务商信息
  async function resolveProvider(): AsyncResult<AICreateOptions, { message: string }> {
    if (!providerId.value) {
      return [{ message: '服务商 ID 不能为空' }];
    }

    const provider = await providerStorage.getProvider(providerId.value);

    if (!provider?.id) {
      return [{ message: '服务商不存在' }];
    }

    if (!options.ignoreEnabled && !provider.isEnabled) {
      return [{ message: '服务商未启用' }];
    }

    const { id, name, apiKey, baseUrl, type } = provider;

    return [undefined, { providerId: id, providerName: name, apiKey, baseUrl, providerType: type }];
  }

  const onInvoke = async (payload: AIRequestOptions): AsyncResult<{ text: string }, { message: string }> => {
    const [error, provider] = await resolveProvider();

    if (error) return [error];

    return asyncTo(electronAPI.aiInvoke(provider, payload));
  };

  return { agent: { invoke: onInvoke } };
}
