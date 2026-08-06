/**
 * @file useRuntimeEnvironment.ts
 * @description 构建 ChatRuntime 本轮用户级环境上下文。
 */
import type { RuntimeToolDiscoveryBinding } from './useRuntimeTools';
import type { ChatRuntimeEnvironmentContext, ChatRuntimeEnvironmentMetadata, ChatRuntimePageEnvironmentContext } from 'types/chat-runtime';
import { normalizeEnvironmentContext } from '@/hooks/useChat/tool/environment';

/** 环境时间字段类型。 */
type DatePartType = 'year' | 'month' | 'day' | 'hour' | 'minute' | 'second';

/**
 * 解析当前操作系统名称。
 * @returns 当前操作系统可读名称
 */
function resolveOperatingSystem(): string {
  const platform = typeof navigator === 'undefined' ? '' : navigator.platform;
  if (/Mac|iPod|iPhone|iPad/u.test(platform)) return 'macOS';
  if (/Win/u.test(platform)) return 'Windows';
  if (/Linux/u.test(platform)) return 'Linux';
  return platform || 'unknown';
}

/**
 * 解析当前 IANA 时区。
 * @returns 当前时区名称
 */
function resolveTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/**
 * 从 Intl 分段结果中读取指定字段。
 * @param parts - Intl 日期时间分段
 * @param type - 目标字段类型
 * @param fallback - 字段缺失时的兜底值
 * @returns 字段值
 */
function findDatePart(parts: Intl.DateTimeFormatPart[], type: DatePartType, fallback: string): string {
  return parts.find((part): boolean => part.type === type)?.value ?? fallback;
}

/**
 * 按时区格式化本地日期。
 * @param date - 当前时间
 * @param timezone - IANA 时区
 * @returns YYYY-MM-DD 日期
 */
function formatLocalDate(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const year = findDatePart(parts, 'year', '0000');
  const month = findDatePart(parts, 'month', '01');
  const day = findDatePart(parts, 'day', '01');
  return `${year}-${month}-${day}`;
}

/**
 * 按时区格式化本地具体时间。
 * @param date - 当前时间
 * @param timezone - IANA 时区
 * @returns YYYY-MM-DD HH:mm:ss 时间
 */
function formatLocalTime(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const year = findDatePart(parts, 'year', '0000');
  const month = findDatePart(parts, 'month', '01');
  const day = findDatePart(parts, 'day', '01');
  const hour = findDatePart(parts, 'hour', '00');
  const minute = findDatePart(parts, 'minute', '00');
  const second = findDatePart(parts, 'second', '00');
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

/**
 * 创建当前环境元信息。
 * @param workspaceRoot - 当前工作区根目录
 * @returns 环境元信息
 */
function createMetadata(workspaceRoot: string | null): ChatRuntimeEnvironmentMetadata {
  const timezone = resolveTimezone();
  const now = new Date();
  return {
    operatingSystem: resolveOperatingSystem(),
    timezone,
    currentDate: formatLocalDate(now, timezone),
    currentTime: formatLocalTime(now, timezone),
    ...(workspaceRoot ? { workspaceRoot } : {})
  };
}

/**
 * 复制并过滤页面环境片段。
 * @param context - 页面注册的环境片段
 * @returns 仅保留页面允许注册字段的环境片段
 */
function clonePageContext(context: ChatRuntimePageEnvironmentContext | undefined): ChatRuntimePageEnvironmentContext {
  return normalizeEnvironmentContext(context) ?? {};
}

/**
 * Runtime 环境上下文 hook 返回值。
 */
interface UseRuntimeEnvironmentReturn {
  /** 解析本轮 Runtime 环境上下文。 */
  resolveRuntimeEnvironmentContext: (
    binding: RuntimeToolDiscoveryBinding | undefined,
    workspaceRoot: string | null,
    targetMessageId: string | undefined
  ) => ChatRuntimeEnvironmentContext | undefined;
}

/**
 * 创建 Runtime 环境上下文解析能力。
 * @returns Runtime 环境上下文解析能力
 */
export function useRuntimeEnvironment(): UseRuntimeEnvironmentReturn {
  /**
   * 解析本轮 Runtime 环境上下文。
   * @param binding - Runtime 预检时冻结的页面资源信息
   * @param workspaceRoot - Runtime 预检时冻结的工作区
   * @param targetMessageId - 接收上下文的用户消息 ID
   * @returns 当前环境上下文
   */
  function resolveRuntimeEnvironmentContext(
    binding: RuntimeToolDiscoveryBinding | undefined,
    workspaceRoot: string | null,
    targetMessageId: string | undefined
  ): ChatRuntimeEnvironmentContext | undefined {
    if (!targetMessageId) return undefined;
    const pageContext = clonePageContext(binding?.pageEnvironment);
    return {
      ...pageContext,
      targetMessageId,
      metadata: createMetadata(workspaceRoot)
    };
  }

  return { resolveRuntimeEnvironmentContext };
}
