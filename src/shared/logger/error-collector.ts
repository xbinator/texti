/**
 * @file error-collector.ts
 * @description 渲染进程全局错误收集器，将各类运行时错误统一上报到日志系统
 */

import type { LogScope } from './types';
import { logger } from './index';

// 简单配置常量
const ENABLED = true;
const WINDOW_MS = 10000;
const MAX_REPORTS = 10;
const DEDUP_MS = 5 * 60 * 1000;
const MAX_DEDUP_ENTRIES = 100;

// 简单状态变量
let reportCount = 0;
let windowResetTime = Date.now();
const recentHashes = new Map<string, number>();

/**
 * 规范化错误消息用于去重
 * @param message - 原始错误消息
 * @returns 规范化后的消息
 */
function normalizeMessage(message: string): string {
  return message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<UUID>')
    .replace(/\b[0-9a-f]{8,}\b/gi, '<HASH>')
    .replace(/\d{4,}/g, '<NUM>');
}

/**
 * 计算错误哈希用于去重
 * @param error - 错误对象
 * @returns 哈希字符串
 */
function hashError(error: Error): string {
  return normalizeMessage(error.message).slice(0, 100);
}

/**
 * 清理过期的去重缓存，超出限制时直接清空一半
 */
function cleanupDedupCache(): void {
  const now = Date.now();
  const expiredBefore = now - DEDUP_MS;

  // 删除过期条目
  for (const [hash, timestamp] of recentHashes) {
    if (timestamp < expiredBefore) {
      recentHashes.delete(hash);
    }
  }

  // 超出限制时直接清空一半
  if (recentHashes.size > MAX_DEDUP_ENTRIES) {
    const entries = Array.from(recentHashes.entries());
    const half = Math.floor(entries.length / 2);
    for (let i = 0; i < half; i++) {
      recentHashes.delete(entries[i][0]);
    }
  }
}

/**
 * 检查是否需要限流
 * @returns 是否允许上报
 */
function shouldReport(): boolean {
  const now = Date.now();

  if (now - windowResetTime > WINDOW_MS) {
    reportCount = 0;
    windowResetTime = now;
  }

  return reportCount < MAX_REPORTS;
}

/**
 * 检查是否重复错误
 * @param hash - 错误哈希
 * @returns 是否重复
 */
function isDuplicate(hash: string): boolean {
  cleanupDedupCache();

  const now = Date.now();
  const lastReported = recentHashes.get(hash);

  if (lastReported && now - lastReported < DEDUP_MS) {
    return true;
  }

  recentHashes.set(hash, now);
  return false;
}

/**
 * 截断堆栈信息
 * @param stack - 原始堆栈
 * @param maxLines - 最大行数
 * @returns 截断后的堆栈
 */
function truncateStack(stack: string | undefined, maxLines: number): string {
  if (!stack) return 'N/A';
  const lines = stack.split('\n');
  if (lines.length <= maxLines) return stack;
  return `${lines.slice(0, maxLines).join('\n')}\n...`;
}

/**
 * 格式化错误为日志消息
 * @param error - 错误对象
 * @param context - 附加上下文
 * @returns 格式化后的消息
 */
function formatErrorMessage(error: Error, context?: Record<string, unknown>): string {
  const parts = [`Error: ${error.name}: ${error.message}`, `Stack: ${truncateStack(error.stack, 50)}`];

  if (context && Object.keys(context).length > 0) {
    parts.push(`Context: ${JSON.stringify(context)}`);
  }

  return parts.join('\n');
}

/**
 * 上报错误到日志系统
 */
async function reportError(error: Error, context: Record<string, unknown> | undefined, scope: LogScope): Promise<void> {
  if (!ENABLED) return;
  if (!shouldReport()) return;

  const hash = hashError(error);
  if (isDuplicate(hash)) return;

  reportCount++;

  const message = formatErrorMessage(error, context);
  await logger.error(`[${scope}] ${message}`);
}

/**
 * 初始化全局错误收集
 */
export function initErrorCollector(): void {
  window.onerror = (message, source, lineno, colno, error) => {
    const errorObj = error || new Error(String(message));
    reportError(
      errorObj,
      {
        source: source ? source.replace(/.*\//, '') : 'N/A',
        lineno,
        colno,
        type: 'window.onerror'
      },
      'renderer'
    );
    return false;
  };

  window.onunhandledrejection = (event) => {
    const error = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
    reportError(error, { type: 'unhandledrejection' }, 'renderer');
  };
}

/**
 * 主动上报错误
 * @param error - 错误或错误消息
 * @param context - 上下文
 */
export function captureError(error: Error | string, context?: Record<string, unknown>): void {
  const errorObj = error instanceof Error ? error : new Error(error);
  reportError(errorObj, context, 'renderer');
}
