import type { AIRequest } from '../../types/electron-api';
import { ref, onUnmounted } from 'vue';

export interface UseElectronStreamOptions {
  /** 错误回调 */
  onError?: (error: string) => void;
  /** 流式数据回调 */
  onChunk?: (chunk: string) => void;
  /** 完成回调 */
  onComplete?: (text: string) => void;
}

/**
 * Electron AI 流式文本生成 Hook
 * 通过 IPC 与主进程通信，实现安全的 AI 调用
 */
export function useElectronStream(options: UseElectronStreamOptions = {}) {
  const isLoading = ref(false);
  const error = ref<string | null>(null);
  const text = ref('');

  let cleanupChunk: (() => void) | null = null;
  let cleanupComplete: (() => void) | null = null;
  let cleanupError: (() => void) | null = null;

  const cleanup = (): void => {
    cleanupChunk?.();
    cleanupComplete?.();
    cleanupError?.();
    cleanupChunk = null;
    cleanupComplete = null;
    cleanupError = null;
  };

  onUnmounted(() => {
    cleanup();
  });

  /**
   * 配置 AI Provider
   * @param providerId 服务商 ID
   * @returns 是否配置成功
   */
  async function configure(providerId: string): Promise<boolean> {
    return window.electronAPI.aiConfigure(providerId);
  }

  /**
   * 非流式文本生成
   * @param request AI 请求参数
   * @returns 生成的文本
   */
  async function generate(request: AIRequest): Promise<string | null> {
    isLoading.value = true;
    error.value = null;

    try {
      const result = await window.electronAPI.aiGenerate(request);
      return result.text;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      error.value = errorMessage;
      options.onError?.(errorMessage);
      return null;
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * 流式文本生成
   * @param request AI 请求参数
   * @returns 生成的文本
   */
  async function stream(request: AIRequest): Promise<string | null> {
    isLoading.value = true;
    error.value = null;
    text.value = '';

    cleanup();

    cleanupChunk = window.electronAPI.onAiChunk((chunk) => {
      text.value += chunk;
      options.onChunk?.(chunk);
    });

    cleanupComplete = window.electronAPI.onAiComplete(() => {
      isLoading.value = false;
      options.onComplete?.(text.value);
    });

    cleanupError = window.electronAPI.onAiError((err) => {
      error.value = err;
      isLoading.value = false;
      options.onError?.(err);
    });

    try {
      await window.electronAPI.aiStream(request);
      return text.value;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      error.value = errorMessage;
      isLoading.value = false;
      options.onError?.(errorMessage);
      return null;
    }
  }

  /**
   * 中止流式生成
   */
  async function abort(): Promise<void> {
    await window.electronAPI.aiAbort();
    cleanup();
    isLoading.value = false;
  }

  return {
    isLoading,
    error,
    text,
    configure,
    generate,
    stream,
    abort
  };
}
