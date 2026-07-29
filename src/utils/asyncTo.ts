/**
 * @file asyncTo.ts
 * @description 将 Promise 结果转换为错误优先元组，并统一未知异常结构。
 */
import { logger } from './logger.js';

/** 未提供有效错误消息时使用的兜底文案。 */
const DEFAULT_ERROR_MESSAGE = '未知错误';

/** 异步错误日志标签，便于在日志面板中按来源过滤。 */
const ASYNC_ERROR_LOG_LABEL = 'asyncTo';

/**
 * 安全读取未知异常的消息文本，避免 getter 或 Proxy 再次抛错。
 * @param error - 原始异常值
 * @returns 非空错误消息
 */
function safeGetMessage(error: unknown): string {
  if (typeof error === 'string' && error.trim()) return error.trim();
  if (typeof error !== 'object' || error === null) return DEFAULT_ERROR_MESSAGE;

  try {
    const { message } = error as Record<string, unknown>;
    if (typeof message === 'string' && message.trim()) return message.trim();
  } catch {
    // getter 抛错时使用兜底文案
  }

  return DEFAULT_ERROR_MESSAGE;
}

/**
 * 将任意异常归一化为 Error。
 * @param error - 原始异常值
 * @returns 统一错误对象
 */
export function normalizeError(error: unknown): Error {
  return new Error(safeGetMessage(error), { cause: error });
}

/**
 * 将 Promise 结果转换为错误优先元组。
 * @param promise - 待执行的 Promise
 * @returns 失败时返回 Error，成功时返回结果
 */
export async function asyncTo<T>(promise: Promise<T>): Promise<[Error] | [undefined, T]> {
  try {
    return [undefined, await promise];
  } catch (error: unknown) {
    const normalized = normalizeError(error);
    // 日志记录本身不得再次抛出异常（例如 cause 为已吊销的 Proxy 时，
    // console.error 在格式化 cause 时会调用 getPrototypeOf 而失败），
    // 否则会覆盖归一化结果，违背本函数“永不 reject”的契约。
    try {
      logger.error(ASYNC_ERROR_LOG_LABEL, normalized);
    } catch {
      // 忽略日志输出过程中的异常，确保归一化结果始终可返回。
    }
    return [normalized];
  }
}
