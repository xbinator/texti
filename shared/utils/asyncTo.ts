/**
 * @file asyncTo.ts
 * @description 为主进程与渲染进程提供不依赖运行环境的 Promise 错误归一化能力。
 */

/** 未提供有效错误消息时使用的兜底文案。 */
const DEFAULT_ERROR_MESSAGE = '未知错误';

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
    // getter 抛错时使用兜底文案。
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
    return [normalizeError(error)];
  }
}
