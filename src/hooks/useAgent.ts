/* eslint-disable no-use-before-define */
import type { AIServiceError, AIRequestOptions, AICreateOptions, AIStreamFinishChunk } from 'types/ai';
import { computed, toValue, ref, type MaybeRefOrGetter } from 'vue';
import { getElectronAPI } from '@/shared/platform/electron-api';
import { providerStorage } from '@/shared/storage';

export interface UseStreamOptions {
  /** 服务商 ID */
  providerId?: MaybeRefOrGetter<string | undefined>;
  /** 是否忽略服务商启用状态 */
  ignoreEnabled?: boolean;
  /** 错误回调 */
  onError?: (error: AIServiceError) => void;
  /** 流式数据回调 */
  onChunk?: (content: string) => void;
  /** 完成回调 */
  onComplete?: () => void;
  /** 流式完成回调（包含 usage 信息） */
  onFinish?: (chunk: AIStreamFinishChunk) => void;
}

/**
 * AI 流式文本生成 Hook
 * 提供流式文本生成能力，支持实时获取生成内容
 */
export function useAgent(options: UseStreamOptions) {
  const electronAPI = getElectronAPI();

  const providerId = computed(() => toValue(options.providerId));

  // 获取服务商信息
  async function resolveProvider(payload: AIRequestOptions): AsyncResult<AICreateOptions, { message: string }> {
    const _providerId = payload.providerId || providerId.value;

    if (!_providerId) return [{ message: '服务商 ID 不能为空' }];

    const provider = await providerStorage.getProvider(_providerId);
    if (!provider?.id) return [{ message: '服务商不存在' }];

    if (!options.ignoreEnabled && !provider.isEnabled) {
      return [{ message: '服务商未启用' }];
    }

    const { id, name, apiKey, baseUrl, type } = provider;

    return [undefined, { providerId: id, providerName: name, apiKey, baseUrl, providerType: type }];
  }

  const currentRequestId = ref<string | null>(null);

  const onInvoke = async (payload: AIRequestOptions): AsyncResult<{ text: string }, { message: string }> => {
    const [error, provider] = await resolveProvider(payload);

    if (error) return [error];

    return electronAPI.aiInvoke(provider, payload);
  };

  const onStream = async (payload: AIRequestOptions): Promise<void> => {
    const [error, provider] = await resolveProvider(payload);

    if (error) {
      options.onError?.(error as AIServiceError);
      return;
    }

    const requestId = crypto.randomUUID();
    currentRequestId.value = requestId;

    const cleanupChunk = electronAPI.onAiStreamChunk((content) => {
      options.onChunk?.(content);
    });

    const cleanupFinish = electronAPI.onAiStreamFinish((finishChunk) => {
      options.onFinish?.(finishChunk);
    });

    const cleanupComplete = electronAPI.onAiStreamComplete(() => {
      options.onComplete?.();

      cleanupAll();
    });

    const cleanupError = electronAPI.onAiStreamError((err) => {
      options.onError?.(err);
      options.onComplete?.();

      cleanupAll();
    });

    function cleanupAll() {
      cleanupChunk();
      cleanupFinish();
      cleanupComplete();
      cleanupError();
      // 只有当前请求 ID 与当前请求 ID 一致时才重置为 null
      currentRequestId.value === requestId && (currentRequestId.value = null);
    }

    try {
      await electronAPI.aiStream(provider, { ...payload, requestId });
    } catch (err) {
      options.onError?.({ message: String((err as Error | AIServiceError)?.message || '未知错误') } as AIServiceError);
      options.onComplete?.();

      cleanupAll();
    }
  };

  const onAbort = () => {
    if (!currentRequestId.value) return;

    electronAPI.aiStreamAbort(currentRequestId.value);
    currentRequestId.value = null;
    options.onComplete?.();
  };

  return { agent: { invoke: onInvoke, stream: onStream, abort: onAbort } };
}
