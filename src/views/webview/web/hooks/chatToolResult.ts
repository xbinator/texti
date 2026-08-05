/**
 * @file chatToolResult.ts
 * @description WebView 页面 Chat 工具结果校验与模型可见字段清洗。
 */
import type { WebviewOperateResult, WebviewPageSnapshot } from '../types';
import type { AIToolExecutionError } from 'types/ai';
import { isToolExecutionErrorCode } from '../../../../../shared/ai/toolExecutionErrors';
import { SUPPORTED_WEBPAGE_ACTION_TYPES, WEBPAGE_OPERATION_LIMITS } from './chatToolInput';

/** 网页操作结果说明最大长度。 */
const WEBVIEW_RESULT_MESSAGE_LIMIT = 2_500;

/** 网页操作目标标签最大长度。 */
const WEBVIEW_TARGET_LABEL_LIMIT = 300;

/** 网页操作目标标签名最大长度。 */
const WEBVIEW_TARGET_TAG_LIMIT = 100;

/** 网页操作错误消息最大长度。 */
const WEBVIEW_ERROR_MESSAGE_LIMIT = 1_000;

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
 * 判断页面 handler 是否返回完整网页快照。
 * @param value - 页面 handler 返回值
 * @returns 是否满足模型读取所需的快照结构
 */
export function isWebpageSnapshot(value: unknown): value is WebviewPageSnapshot {
  return (
    isRecord(value) &&
    typeof value.url === 'string' &&
    typeof value.title === 'string' &&
    typeof value.summary === 'string' &&
    typeof value.header === 'string' &&
    typeof value.content === 'string' &&
    typeof value.footer === 'string' &&
    typeof value.text === 'string' &&
    typeof value.selectedText === 'string' &&
    Array.isArray(value.headings) &&
    Array.isArray(value.links) &&
    isFiniteNumber(value.capturedAt) &&
    isRecord(value.truncated) &&
    typeof value.snapshotId === 'string' &&
    value.snapshotId.trim().length > 0 &&
    value.snapshotId.length <= WEBPAGE_OPERATION_LIMITS.snapshotId &&
    (value.viewport === undefined || isRecord(value.viewport)) &&
    (value.selectedElement === undefined || isRecord(value.selectedElement))
  );
}

/**
 * 判断值是否为 WebView 操作结果动作名称。
 * @param value - 待判断值
 * @returns 是否为已知动作名称
 */
function isResultAction(value: unknown): value is WebviewOperateResult['action'] {
  return typeof value === 'string' && SUPPORTED_WEBPAGE_ACTION_TYPES.some((action): boolean => action === value);
}

/**
 * 判断值是否为网页操作目标。
 * @param value - 待判断值
 * @returns 是否为完整目标摘要
 */
function isOperateTarget(value: unknown): value is NonNullable<WebviewOperateResult['target']> {
  return isRecord(value) && isElementIndex(value.index) && typeof value.label === 'string' && typeof value.tagName === 'string';
}

/**
 * 判断值是否为网页滚动操作结果。
 * @param value - 待判断值
 * @returns 是否为完整滚动结果
 */
function isOperateScroll(value: unknown): value is NonNullable<WebviewOperateResult['scroll']> {
  if (!isRecord(value) || !isRecord(value.before) || !isRecord(value.after)) return false;
  return (
    (value.targetType === 'window' || value.targetType === 'element') &&
    isFiniteNumber(value.before.x) &&
    isFiniteNumber(value.before.y) &&
    isFiniteNumber(value.after.x) &&
    isFiniteNumber(value.after.y) &&
    typeof value.changed === 'boolean'
  );
}

/**
 * 判断页面 handler 是否返回完整网页操作结果。
 * @param value - 页面 handler 返回值
 * @returns 是否满足 WebviewOperateResult
 */
export function isWebpageResult(value: unknown): value is WebviewOperateResult {
  return (
    isRecord(value) &&
    typeof value.ok === 'boolean' &&
    isResultAction(value.action) &&
    (value.target === null || isOperateTarget(value.target)) &&
    typeof value.message === 'string' &&
    (value.scroll === undefined || isOperateScroll(value.scroll)) &&
    typeof value.navigationStarted === 'boolean' &&
    typeof value.pageChanged === 'boolean' &&
    typeof value.shouldReadAgain === 'boolean'
  );
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
    code: isToolExecutionErrorCode(source.code) ? source.code : 'EXECUTION_FAILED',
    message: sanitizeResultText(source.message, WEBVIEW_ERROR_MESSAGE_LIMIT) ?? '网页操作失败'
  };
}
