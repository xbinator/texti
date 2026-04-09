import { ref } from 'vue';
import { aiService } from '@/services/ai';

export interface UseStreamOptions {
  /** 错误回调 */
  onError?: (error: { message: string; code?: string }) => void;
  /** 流式数据回调 */
  onChunk?: (chunk: string) => void;
  /** 完成回调 */
  onComplete?: (text: string) => void;
}

/** 流式文本生成输入参数 */
export type StreamTextInput = Parameters<typeof aiService.streamText>[0];

/**
 * AI 流式文本生成 Hook
 * 提供流式文本生成能力，支持实时获取生成内容
 */
export function useStream(options: UseStreamOptions = {}) {
  const isLoading = ref(false);
  const error = ref<{ message: string; code?: string } | null>(null);

  /**
   * 消费异步流，逐块收集文本
   * 使用 for-await 替代递归，避免深流场景下的调用栈溢出
   * @param stream - 异步可迭代流
   * @returns 完整的文本内容
   */
  async function readStreamText(stream: AsyncIterable<string>): Promise<string> {
    const chunks: string[] = [];
    // eslint-disable-next-line no-restricted-syntax
    for await (const chunk of stream) {
      chunks.push(chunk);
      options.onChunk?.(chunk);
    }

    return chunks.join('');
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
      const [streamError, stream] = await aiService.streamText(input);

      if (streamError) {
        throw streamError;
      }

      const text = await readStreamText(stream.textStream);
      options.onComplete?.(text);
      return text;
    } catch (err) {
      const normalizedError = {
        message: err instanceof Error ? err.message : String(err),
        code: (err as { code?: string }).code
      };
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
    streamText,
    readStreamText
  };
}
