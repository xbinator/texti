/**
 * @file hash.ts
 * @description 字符串哈希工具函数
 */

/**
 * 计算字符串的稳定短哈希（base36）。
 * 输出空间 2^32（uint32），用于少量 tab 场景（<100）时碰撞概率可忽略。
 * 如需更高唯一性，可改用 FNV-1a 或拼接 fullPath 前缀。
 * @param value - 原始字符串
 * @returns base36 哈希值（如 "abc123"）
 */
export function hashString(value: string): string {
  let hash = 0;

  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }

  return hash.toString(36);
}
