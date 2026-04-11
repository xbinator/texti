import { ref } from 'vue';
import type { AITextRequestInput } from '@/shared/platform/ai';
import { buildElectronAIRequestPayload } from '@/shared/platform/ai';
import { getElectronAPI } from '@/shared/platform/electron-api';

export interface StreamErrorState {
  message: string;
  code?: string;
}

export interface UseStreamOptions {
  /** 错误回调 */
  onError?: (error: StreamErrorState) => void;
  /** 流式数据回调 */
  onChunk?: (chunk: string) => void;
  /** 完成回调 */
  onComplete?: (text: string) => void;
}

/** 流式文本生成输入参数 */
export type StreamTextInput = AITextRequestInput;

/**
 * AI 流式文本生成 Hook
 * 提供流式文本生成能力，支持实时获取生成内容
 */
export function useStream(options: UseStreamOptions = {}) {
  const isLoading = ref(false);
  const error = ref<StreamErrorState | null>(null);

  function normalizeStreamError(err: unknown): StreamErrorState {
    return {
      message: err instanceof Error ? err.message : String(err),
      code: typeof err === 'object' && err !== null && 'code' in err && typeof err.code === 'string' ? err.code : undefined
    };
  }

  /**
   * 流式生成文本
   * @param input - 流式生成输入参数
   * @returns 生成的文本内容，失败返回 null
   */
  async function streamText(input: StreamTextInput): Promise<string | null> {
    isLoading.value = true;
    error.value = null;

    try {
      const api = getElectronAPI();
      const payload = await buildElectronAIRequestPayload(input);
      const text = await new Promise<string>((resolve, reject) => {
        let accumulatedText = '';
        let cleanup = (): void => undefined;

        const cleanupChunk = api.onAiChunk((chunk: string) => {
          accumulatedText += chunk;
          options.onChunk?.(chunk);
        });

        const cleanupComplete = api.onAiComplete(() => {
          cleanup();
          resolve(accumulatedText);
        });

        const cleanupError = api.onAiError((message: string) => {
          cleanup();
          reject(new Error(message));
        });

        cleanup = (): void => {
          cleanupChunk();
          cleanupComplete();
          cleanupError();
        };

        api.aiStream(payload).catch((streamError: unknown) => {
          cleanup();
          reject(streamError);
        });
      });

      options.onComplete?.(text);
      return text;
    } catch (err: unknown) {
      const normalizedError = normalizeStreamError(err);
      error.value = normalizedError;
      options.onError?.(normalizedError);
      return null;
    } finally {
      isLoading.value = false;
    }
  }

  return {
    isLoading,
    error,
    streamText
  };
}
