import type { ElectronAIRequestPayload } from 'types/electron-api';
import { ref, onUnmounted, type Ref } from 'vue';
import { getElectronAPI } from '@/shared/platform/electron-api';

export interface UseElectronStreamResult {
  content: Ref<string>;
  isStreaming: Ref<boolean>;
  error: Ref<string | null>;
  startStream: (payload: ElectronAIRequestPayload) => Promise<void>;
  abortStream: () => Promise<void>;
  reset: () => void;
}

export function useElectronStream(): UseElectronStreamResult {
  const content = ref<string>('');
  const isStreaming = ref<boolean>(false);
  const error = ref<string | null>(null);

  let cleanupFns: Array<() => void> = [];

  const cleanupListeners = () => {
    cleanupFns.forEach((cleanup) => cleanup());
    cleanupFns = [];
  };

  const reset = () => {
    content.value = '';
    isStreaming.value = false;
    error.value = null;
    cleanupListeners();
  };

  const startStream = async (payload: ElectronAIRequestPayload) => {
    const api = getElectronAPI();

    reset();
    isStreaming.value = true;

    const onChunkCleanup = api.onAiChunk((chunk: string) => {
      content.value += chunk;
    });

    const onCompleteCleanup = api.onAiComplete(() => {
      isStreaming.value = false;
      cleanupListeners();
    });

    const onErrorCleanup = api.onAiError((err: string) => {
      error.value = err;
      isStreaming.value = false;
      cleanupListeners();
    });

    cleanupFns = [onChunkCleanup, onCompleteCleanup, onErrorCleanup];

    try {
      await api.aiStream(payload);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      error.value = errorMessage;
      isStreaming.value = false;
      cleanupListeners();
    }
  };

  const abortStream = async () => {
    try {
      await Promise.resolve();
    } catch (err: unknown) {
      // 忽略中断时的错误
    } finally {
      isStreaming.value = false;
      cleanupListeners();
    }
  };

  onUnmounted(() => {
    cleanupListeners();
  });

  return {
    content,
    isStreaming,
    error,
    startStream,
    abortStream,
    reset
  };
}
