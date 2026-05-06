/**
 * @file useCompression.ts
 * @description 会话压缩管理 hook，提供手动压缩和摘要查看功能。
 */
import type { ConversationSummaryRecord } from '../utils/compression/types';
import type { Message } from '../utils/types';
import { ref } from 'vue';
import { chatSummariesStorage } from '@/shared/storage/chat-summaries';
import { createCompressionCoordinator } from '../utils/compression/coordinator';

/**
 * 压缩管理 Hook 的依赖项
 */
interface CompressionOptions {
  /** 获取会话 ID */
  getSessionId: () => string | undefined;
  /** 获取消息列表 */
  getMessages: () => Message[];
}

/**
 * 压缩管理 hook
 * @param options - 依赖项配置
 * @returns 压缩状态和操作方法
 */
export function useCompression(options: CompressionOptions) {
  const { getSessionId, getMessages } = options;

  /** 压缩状态 */
  const compressing = ref(false);
  /** 当前摘要 */
  const currentSummary = ref<ConversationSummaryRecord | undefined>();
  /** 压缩错误 */
  const error = ref<string | undefined>();

  /** 压缩协调器 */
  const coordinator = createCompressionCoordinator(chatSummariesStorage);

  /**
   * 加载当前会话的摘要
   */
  async function loadSummary(): Promise<void> {
    const sessionId = getSessionId();
    if (!sessionId) {
      currentSummary.value = undefined;
      return;
    }

    try {
      currentSummary.value = await chatSummariesStorage.getValidSummary(sessionId);
    } catch (err) {
      console.error('[useCompression] Failed to load summary:', err);
      currentSummary.value = undefined;
    }
  }

  /**
   * 手动触发压缩
   * @returns 是否压缩成功
   */
  async function compress(): Promise<boolean> {
    const sessionId = getSessionId();
    if (!sessionId) {
      error.value = '没有活跃的会话';
      return false;
    }

    compressing.value = true;
    error.value = undefined;

    try {
      const messages = getMessages();
      if (messages.length === 0) {
        error.value = '没有可压缩的消息';
        return false;
      }

      const result = await coordinator.compressSessionManually({
        sessionId,
        messages
      });

      if (result) {
        // 重新加载摘要
        await loadSummary();
        return true;
      }

      error.value = '没有可压缩的消息';
      return false;
    } catch (err) {
      error.value = err instanceof Error ? err.message : '压缩失败';
      return false;
    } finally {
      compressing.value = false;
    }
  }

  /**
   * 清除错误
   */
  function clearError(): void {
    error.value = undefined;
  }

  return {
    compressing,
    currentSummary,
    error,
    compress,
    loadSummary,
    clearError
  };
}
