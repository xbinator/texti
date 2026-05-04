/**
 * @file error-collector.mts
 * @description Preload 层错误收集辅助函数，负责格式化日志消息并过滤浏览器噪音错误。
 */

/**
 * Preload 错误附加上下文。
 */
export interface PreloadErrorContext {
  /** 错误来源文件名。 */
  source?: string;
  /** 错误行号。 */
  lineno?: number;
  /** 错误列号。 */
  colno?: number;
  /** 错误来源类型。 */
  type?: string;
}

/**
 * 需要忽略的浏览器错误关键字。
 */
const IGNORED_ERROR_MESSAGE_PATTERNS = ['ResizeObserver'] as const;

/**
 * 判断当前错误是否属于应忽略的浏览器噪音。
 * @param error - 待检查错误。
 * @returns 是否应忽略该错误。
 */
export function shouldIgnorePreloadError(error: Error): boolean {
  return IGNORED_ERROR_MESSAGE_PATTERNS.some((pattern) => error.message.includes(pattern));
}

/**
 * 生成错误标题行，避免默认 Error 类型出现重复前缀。
 * @param error - 待格式化错误。
 * @returns 标题行文本。
 */
function formatErrorHeadline(error: Error): string {
  if (error.name === 'Error') {
    return `Error: ${error.message}`;
  }

  return `${error.name}: ${error.message}`;
}

/**
 * 格式化 Preload 层错误日志消息。
 * @param error - 待格式化错误。
 * @param context - 附加上下文。
 * @returns 完整错误日志消息。
 */
export function formatPreloadErrorMessage(error: Error, context?: PreloadErrorContext): string {
  const parts = [formatErrorHeadline(error), `Stack: ${error.stack || 'N/A'}`];

  if (context && Object.keys(context).length > 0) {
    parts.push(`Context: ${JSON.stringify(context)}`);
  }

  return parts.join('\n');
}
