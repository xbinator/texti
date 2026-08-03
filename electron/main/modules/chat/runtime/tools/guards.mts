/**
 * @file guards.mts
 * @description ChatRuntime 主进程工具 bridge payload 类型守卫。
 */
import type {
  RuntimeDocumentSelection,
  RuntimeDocumentSnapshot,
  RuntimeFileContentSnapshot,
  RuntimeOpenResourceResult,
  RuntimeOpenResourceType,
  RuntimeOpenDraftResult,
  RuntimeSettingKey,
  RuntimeSettingsSnapshot,
  RuntimeSettingValue,
  RuntimeWebpageOperateScrollResult,
  RuntimeWebpageOperateTarget,
  RuntimeWebpageOperateResult,
  RuntimeUpdateSettingsResult,
  RuntimeWebpageSnapshot
} from './types.mjs';
import { SUPPORTED_SETTING_KEYS, SUPPORTED_WEBPAGE_ACTION_TYPES, WEBPAGE_OPERATION_LIMITS } from './constants.mjs';

/**
 * 判断值是否为对象记录。
 * @param value - 待判断值
 * @returns 是否为对象记录
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * 判断 bridge payload 字段是否为文档选区。
 * @param value - bridge payload 字段
 * @returns 是否为文档选区
 */
function isRuntimeDocumentSelection(value: unknown): value is RuntimeDocumentSelection {
  return isRecord(value) && typeof value.from === 'number' && typeof value.to === 'number' && typeof value.text === 'string';
}

/**
 * 判断 bridge payload 是否为文档快照。
 * @param value - bridge payload
 * @returns 是否为文档快照
 */
export function isRuntimeDocumentSnapshot(value: unknown): value is RuntimeDocumentSnapshot {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    (typeof value.path === 'string' || value.path === null) &&
    (value.locator === undefined || typeof value.locator === 'string') &&
    typeof value.content === 'string' &&
    (value.selection === undefined || value.selection === null || isRuntimeDocumentSelection(value.selection))
  );
}

/**
 * 判断 bridge payload 是否为网页快照。
 * @param value - bridge payload
 * @returns 是否为网页快照
 */
export function isRuntimeWebpageSnapshot(value: unknown): value is RuntimeWebpageSnapshot {
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
    typeof value.capturedAt === 'number' &&
    isRecord(value.truncated) &&
    typeof value.snapshotId === 'string' &&
    value.snapshotId.trim().length > 0 &&
    value.snapshotId.length <= WEBPAGE_OPERATION_LIMITS.snapshotId &&
    (value.viewport === undefined || isRecord(value.viewport)) &&
    (value.selectedElement === undefined || isRecord(value.selectedElement))
  );
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
 * 判断值是否为网页操作目标。
 * @param value - 待判断值
 * @returns 是否为完整目标摘要
 */
function isWebpageOperateTarget(value: unknown): value is RuntimeWebpageOperateTarget {
  return (
    isRecord(value) &&
    isFiniteNumber(value.index) &&
    Number.isSafeInteger(value.index) &&
    value.index >= 0 &&
    typeof value.label === 'string' &&
    typeof value.tagName === 'string'
  );
}

/**
 * 判断值是否为网页滚动操作结果。
 * @param value - 待判断值
 * @returns 是否为网页滚动操作结果
 */
function isRuntimeWebpageOperateScrollResult(value: unknown): value is RuntimeWebpageOperateScrollResult {
  if (!isRecord(value) || !isRecord(value.before) || !isRecord(value.after)) {
    return false;
  }

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
 * 判断 bridge payload 是否为网页操作结果。
 * @param value - bridge payload
 * @returns 是否为网页操作结果
 */
export function isRuntimeWebpageOperateResult(value: unknown): value is RuntimeWebpageOperateResult {
  return (
    isRecord(value) &&
    typeof value.ok === 'boolean' &&
    SUPPORTED_WEBPAGE_ACTION_TYPES.some((action): boolean => action === value.action) &&
    (value.target === null || isWebpageOperateTarget(value.target)) &&
    typeof value.message === 'string' &&
    (value.scroll === undefined || isRuntimeWebpageOperateScrollResult(value.scroll)) &&
    typeof value.navigationStarted === 'boolean' &&
    typeof value.pageChanged === 'boolean' &&
    typeof value.shouldReadAgain === 'boolean'
  );
}

/**
 * 判断 bridge payload 是否为文件内容快照。
 * @param value - bridge payload
 * @returns 是否为文件内容快照
 */
export function isRuntimeFileContentSnapshot(value: unknown): value is RuntimeFileContentSnapshot {
  return (
    isRecord(value) &&
    (value.artifactId === undefined || typeof value.artifactId === 'string') &&
    typeof value.path === 'string' &&
    typeof value.content === 'string'
  );
}

/**
 * 判断值是否为 Runtime 设置键。
 * @param value - 待判断值
 * @returns 是否为设置键
 */
export function isRuntimeSettingKey(value: unknown): value is RuntimeSettingKey {
  return typeof value === 'string' && SUPPORTED_SETTING_KEYS.includes(value as RuntimeSettingKey);
}

/**
 * 判断值是否为 Runtime 设置值。
 * @param value - 待判断值
 * @returns 是否为设置值
 */
export function isRuntimeSettingValue(value: unknown): value is RuntimeSettingValue {
  return typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number';
}

/**
 * 判断 bridge payload 是否为设置快照。
 * @param value - bridge payload
 * @returns 是否为设置快照
 */
export function isRuntimeSettingsSnapshot(value: unknown): value is RuntimeSettingsSnapshot {
  if (!isRecord(value) || !isRecord(value.settings)) return false;

  return Object.entries(value.settings).every(([key, settingValue]) => isRuntimeSettingKey(key) && isRuntimeSettingValue(settingValue));
}

/**
 * 判断值是否为打开资源类型。
 * @param value - 待判断值
 * @returns 是否为打开资源类型
 */
export function isRuntimeOpenResourceType(value: unknown): value is RuntimeOpenResourceType {
  return value === 'file' || value === 'webview' || value === 'external';
}

/**
 * 判断 bridge payload 是否为打开资源结果。
 * @param value - bridge payload
 * @returns 是否为打开资源结果
 */
export function isRuntimeOpenResourceResult(value: unknown): value is RuntimeOpenResourceResult {
  return (
    isRecord(value) &&
    typeof value.path === 'string' &&
    isRuntimeOpenResourceType(value.resourceType) &&
    typeof value.opened === 'boolean' &&
    (value.fileId === undefined || typeof value.fileId === 'string')
  );
}

/**
 * 判断 bridge payload 是否为设置修改结果。
 * @param value - bridge payload
 * @returns 是否为设置修改结果
 */
export function isRuntimeUpdateSettingsResult(value: unknown): value is RuntimeUpdateSettingsResult {
  return (
    isRecord(value) &&
    value.applied === true &&
    isRuntimeSettingKey(value.key) &&
    isRuntimeSettingValue(value.previousValue) &&
    isRuntimeSettingValue(value.currentValue)
  );
}

/**
 * 判断 bridge payload 是否为草稿创建结果。
 * @param value - bridge payload
 * @returns 是否为草稿创建结果
 */
export function isRuntimeOpenDraftResult(value: unknown): value is RuntimeOpenDraftResult {
  return (
    isRecord(value) &&
    isRecord(value.file) &&
    value.file.type === 'file' &&
    typeof value.file.id === 'string' &&
    (typeof value.file.path === 'string' || value.file.path === null) &&
    typeof value.file.name === 'string' &&
    typeof value.file.ext === 'string' &&
    typeof value.file.content === 'string' &&
    typeof value.unsavedPath === 'string'
  );
}
