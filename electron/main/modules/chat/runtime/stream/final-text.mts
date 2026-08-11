/**
 * @file final-text.mts
 * @description 强制最终回答阶段的内部工具协议泄漏防护。
 */

/** 内部工具协议的稳定起始标记。 */
const TOOL_PROTOCOL_PATTERN = /<(?:tool_calls?|tool_sep|arg_key|arg_value)(?=:|>)/u;

/** 需要跨 Provider chunk 保留的协议标记主体。 */
const TOOL_PROTOCOL_MARKERS = ['<tool_calls', '<tool_call', '<tool_sep', '<arg_key', '<arg_value'] as const;

/** 协议泄漏被拦截后向用户展示的稳定说明。 */
const TOOL_PROTOCOL_BLOCKED_TEXT = '工具循环因重复调用已停止，模型未能生成有效的最终回答。';

/** 强制最终回答的有界流式协议过滤器。 */
export interface FinalTextFilter {
  /** 输入一个 Provider 文本片段并返回可立即展示的安全前缀。 */
  push: (text: string) => string;
  /** 结束时返回剩余安全尾文本。 */
  finish: () => string;
  /** 是否已经识别协议泄漏。 */
  blocked: () => boolean;
}

/**
 * 查找需要保留到下一 chunk 的最长协议标记前缀。
 * @param text - 尚未确认安全的尾部文本
 * @returns 需要保留的 UTF-16 字符数
 */
function getRetainedTailLength(text: string): number {
  const maximumLength = Math.min(
    text.length,
    TOOL_PROTOCOL_MARKERS.reduce((maximum: number, marker: string): number => Math.max(maximum, marker.length), 0)
  );
  for (let length = maximumLength; length > 0; length -= 1) {
    const suffix = text.slice(-length);
    if (TOOL_PROTOCOL_MARKERS.some((marker: string): boolean => marker.startsWith(suffix))) return length;
  }
  return 0;
}

/**
 * 创建只保留协议标记最长前缀的强制回答过滤器。
 * @returns 常量级尾缓冲过滤器
 */
export function createFinalTextFilter(): FinalTextFilter {
  let retainedTail = '';
  let protocolBlocked = false;
  let emittedVisibleText = false;

  return {
    push(text: string): string {
      if (protocolBlocked || !text) return '';
      const candidate = `${retainedTail}${text}`;
      const protocolMatch = TOOL_PROTOCOL_PATTERN.exec(candidate);
      if (protocolMatch?.index !== undefined) {
        protocolBlocked = true;
        retainedTail = '';
        const safePrefix = candidate.slice(0, protocolMatch.index).trimEnd();
        const separator = emittedVisibleText || safePrefix ? '\n\n' : '';
        return `${safePrefix}${separator}${TOOL_PROTOCOL_BLOCKED_TEXT}`;
      }

      const retainedLength = getRetainedTailLength(candidate);
      retainedTail = retainedLength > 0 ? candidate.slice(-retainedLength) : '';
      const safeText = retainedLength > 0 ? candidate.slice(0, -retainedLength) : candidate;
      emittedVisibleText = emittedVisibleText || safeText.trim().length > 0;
      return safeText;
    },
    finish(): string {
      if (protocolBlocked) return '';
      if (TOOL_PROTOCOL_MARKERS.some((marker: string): boolean => marker === retainedTail)) {
        protocolBlocked = true;
        retainedTail = '';
        return `${emittedVisibleText ? '\n\n' : ''}${TOOL_PROTOCOL_BLOCKED_TEXT}`;
      }
      const safeTail = retainedTail;
      retainedTail = '';
      emittedVisibleText = emittedVisibleText || safeTail.trim().length > 0;
      return safeTail;
    },
    blocked(): boolean {
      return protocolBlocked;
    }
  };
}

/**
 * 清理强制最终回答中的内部工具协议文本。
 * @param text - 强制最终调用产生的完整文本
 * @returns 不含内部工具协议的用户可见文本
 */
export function sanitizeFinalText(text: string): string {
  const filter = createFinalTextFilter();
  return `${filter.push(text)}${filter.finish()}`;
}
