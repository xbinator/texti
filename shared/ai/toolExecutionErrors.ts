/**
 * @file toolExecutionErrors.ts
 * @description 跨 Renderer 与主进程共享的稳定 AI 工具错误码校验。
 */
import type { AIToolExecutionError } from 'types/ai';

/** 允许跨执行边界保留的完整工具错误码集合。 */
const TOOL_EXECUTION_ERROR_CODES: ReadonlySet<AIToolExecutionError['code']> = new Set([
  'TOOL_NOT_FOUND',
  'INVALID_INPUT',
  'NO_ACTIVE_DOCUMENT',
  'NO_SELECTION',
  'NO_CURSOR',
  'PERMISSION_DENIED',
  'USER_CANCELLED',
  'EDITOR_UNAVAILABLE',
  'STALE_CONTEXT',
  'STALE_SNAPSHOT',
  'PAGE_LOADING',
  'ELEMENT_NOT_FOUND',
  'ACTION_NOT_SUPPORTED',
  'OPTION_AMBIGUOUS',
  'SCROLL_TARGET_NOT_FOUND',
  'BRIDGE_TIMEOUT',
  'TOOL_TIMEOUT',
  'TOOL_UNRESPONSIVE',
  'EXTERNAL_WAIT_TIMEOUT',
  'RUNTIME_INTERRUPTED',
  'INTERACTION_TIMEOUT',
  'INTERACTION_LIMIT_EXCEEDED',
  'UNSUPPORTED_INTERACTION',
  'PROCESS_CLEANUP_FAILED',
  'UNSUPPORTED_PROVIDER',
  'CONFIRMATION_DISMISSED',
  'protocol_error',
  'EXECUTION_FAILED'
]);

/**
 * 判断未知值是否为稳定工具错误码。
 * @param value - 原始错误码
 * @returns 是否属于共享工具错误联合
 */
export function isToolExecutionErrorCode(value: unknown): value is AIToolExecutionError['code'] {
  return typeof value === 'string' && TOOL_EXECUTION_ERROR_CODES.has(value as AIToolExecutionError['code']);
}

/**
 * 从未知异常中读取稳定工具错误码。
 * @param error - 原始异常
 * @returns 稳定错误码；不存在或读取失败时返回 undefined
 */
export function readToolExecutionErrorCode(error: unknown): AIToolExecutionError['code'] | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  try {
    const { code } = error as Record<string, unknown>;
    return isToolExecutionErrorCode(code) ? code : undefined;
  } catch {
    return undefined;
  }
}
