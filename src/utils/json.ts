/**
 * @file json.ts
 * @description JSON 相关工具函数
 */

/**
 * 安全地解析 JSON 字符串，并返回对应的对象
 * 如果解析失败，则返回默认值
 *
 * @param data - 要解析的 JSON 字符串
 * @param defaultValue - 如果解析失败要返回的默认值
 * @returns 如果解析成功则返回解析后的对象，否则返回默认值
 */
export function safeJsonParse<T = null>(data: string, defaultValue: T = null as T): T {
  try {
    return JSON.parse(data) as T;
  } catch {
    return defaultValue;
  }
}
