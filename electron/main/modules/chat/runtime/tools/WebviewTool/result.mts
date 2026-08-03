/**
 * @file result.mts
 * @description WebView 页面操作结果的共享发送侧清理。
 */
import type { AIToolExecutionError } from 'types/ai';
import { SUPPORTED_WEBPAGE_ACTION_TYPES, WEBPAGE_OPERATION_LIMITS } from '../constants.mjs';

/** 网页操作结果说明最大长度。 */
const WEBVIEW_RESULT_MESSAGE_LIMIT = 2_500;

/** 网页操作目标标签最大长度。 */
const WEBVIEW_TARGET_LABEL_LIMIT = 300;

/** 网页操作目标标签名最大长度。 */
const WEBVIEW_TARGET_TAG_LIMIT = 100;

/** 网页操作错误消息最大长度。 */
const WEBVIEW_ERROR_MESSAGE_LIMIT = 1_000;

/** 可公开给模型的网页操作错误码。 */
const SUPPORTED_WEBPAGE_ERROR_CODES = [
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
  'INTERACTION_TIMEOUT',
  'INTERACTION_LIMIT_EXCEEDED',
  'UNSUPPORTED_INTERACTION',
  'PROCESS_CLEANUP_FAILED',
  'UNSUPPORTED_PROVIDER',
  'CONFIRMATION_DISMISSED',
  'protocol_error',
  'EXECUTION_FAILED'
] as const satisfies readonly AIToolExecutionError['code'][];

/** 模型可见文本中的 WebView snapshot 令牌。 */
const WEBVIEW_TEXT_SNAPSHOT_PATTERN = /webview-snapshot-[A-Za-z0-9_-]+/gu;

/** 模型可见文本中的 WebView 元素句柄。 */
const WEBVIEW_TEXT_HANDLE_PATTERN = /\*?\[\d+\]/gu;

/** 模型可见文本中的普通 HTML 标签。 */
const WEBVIEW_TEXT_HTML_PATTERN = /<\/?[A-Za-z][^>\n]*>/gu;

/** 模型可见文本中的 HTML 编码标签。 */
const WEBVIEW_TEXT_ENCODED_HTML_PATTERN = /&lt;\/?[A-Za-z][^&\n]*&gt;/giu;

/**
 * 判断值是否为对象记录。
 * @param value - 待判断值
 * @returns 是否为对象记录
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 判断值是否为有限数字。
 * @param value - 待判断值
 * @returns 是否为有限数字
 */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * 判断值是否为有效网页元素句柄。
 * @param value - 待判断值
 * @returns 是否为范围内安全整数
 */
function isElementIndex(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isSafeInteger(value) && value >= 0 && value <= WEBPAGE_OPERATION_LIMITS.elementIndex;
}

/**
 * 判断值是否为受支持的网页操作错误码。
 * @param value - 待判断值
 * @returns 是否为已知错误码
 */
function isWebpageErrorCode(value: unknown): value is AIToolExecutionError['code'] {
  return typeof value === 'string' && SUPPORTED_WEBPAGE_ERROR_CODES.some((code): boolean => code === value);
}

/**
 * 判断值是否为 WebView 操作结果动作名称。
 * @param value - 待判断值
 * @returns 是否为已知动作名称
 */
function isResultAction(value: unknown): value is (typeof SUPPORTED_WEBPAGE_ACTION_TYPES)[number] {
  return typeof value === 'string' && SUPPORTED_WEBPAGE_ACTION_TYPES.some((action): boolean => action === value);
}

/**
 * 清理模型可见结果文本中的瞬时网页引用。
 * @param value - 原始文本
 * @param maxLength - 最大保留字符数
 * @returns 清理后的非空文本，不可用时返回 undefined
 */
function sanitizeResultText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;

  const sanitized = value
    .replace(WEBVIEW_TEXT_SNAPSHOT_PATTERN, '')
    .replace(WEBVIEW_TEXT_HANDLE_PATTERN, '')
    .replace(WEBVIEW_TEXT_HTML_PATTERN, '')
    .replace(WEBVIEW_TEXT_ENCODED_HTML_PATTERN, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, maxLength);

  return sanitized || undefined;
}

/**
 * 清理错误消息中的瞬时网页引用。
 * @param value - 原始错误消息
 * @returns 受长度约束且不含 DOM、句柄与快照 ID 的消息
 */
function sanitizeErrorMessage(value: unknown): string {
  return sanitizeResultText(value, WEBVIEW_ERROR_MESSAGE_LIMIT) ?? '网页操作失败';
}

/**
 * 创建网页操作目标摘要。
 * @param value - 原始目标记录
 * @returns 白名单目标、null 或 undefined
 */
function sanitizeOperateTarget(value: unknown): Record<string, unknown> | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  const label = sanitizeResultText(value.label, WEBVIEW_TARGET_LABEL_LIMIT);
  const tagName = sanitizeResultText(value.tagName, WEBVIEW_TARGET_TAG_LIMIT);

  return {
    ...(isElementIndex(value.index) ? { index: value.index } : {}),
    ...(label ? { label } : {}),
    ...(tagName ? { tagName } : {})
  };
}

/**
 * 创建网页操作滚动位置摘要。
 * @param value - 原始滚动位置
 * @returns 白名单坐标
 */
function sanitizeScrollPosition(value: unknown): Record<string, unknown> {
  const source = isRecord(value) ? value : {};

  return {
    ...(isFiniteNumber(source.x) ? { x: source.x } : {}),
    ...(isFiniteNumber(source.y) ? { y: source.y } : {})
  };
}

/**
 * 创建网页操作滚动结果摘要。
 * @param value - 原始滚动结果
 * @returns 白名单滚动结果
 */
function sanitizeOperateScroll(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;

  return {
    ...(value.targetType === 'window' || value.targetType === 'element' ? { targetType: value.targetType } : {}),
    before: sanitizeScrollPosition(value.before),
    after: sanitizeScrollPosition(value.after),
    ...(typeof value.changed === 'boolean' ? { changed: value.changed } : {})
  };
}

/**
 * 清理网页操作成功结果中的未知和超长字段。
 * @param value - 原始操作结果数据
 * @returns 只包含已知字段的结果数据
 */
export function sanitizeWebpageResult(value: unknown): Record<string, unknown> {
  const source = isRecord(value) ? value : {};
  const target = sanitizeOperateTarget(source.target);
  const scroll = sanitizeOperateScroll(source.scroll);
  const message = sanitizeResultText(source.message, WEBVIEW_RESULT_MESSAGE_LIMIT);

  return {
    ...(typeof source.ok === 'boolean' ? { ok: source.ok } : {}),
    ...(isResultAction(source.action) ? { action: source.action } : {}),
    ...(target !== undefined ? { target } : {}),
    ...(message ? { message } : {}),
    ...(scroll ? { scroll } : {}),
    ...(typeof source.navigationStarted === 'boolean' ? { navigationStarted: source.navigationStarted } : {}),
    ...(typeof source.pageChanged === 'boolean' ? { pageChanged: source.pageChanged } : {}),
    ...(typeof source.shouldReadAgain === 'boolean' ? { shouldReadAgain: source.shouldReadAgain } : {})
  };
}

/**
 * 清理网页操作错误中的 DOM、快照和任意结构化细节。
 * @param value - 原始工具错误
 * @returns 只包含稳定错误码与安全消息的工具错误
 */
export function sanitizeWebpageError(value: unknown): AIToolExecutionError {
  const source = isRecord(value) ? value : {};

  return {
    code: isWebpageErrorCode(source.code) ? source.code : 'EXECUTION_FAILED',
    message: sanitizeErrorMessage(source.message)
  };
}
