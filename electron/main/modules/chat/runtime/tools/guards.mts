/**
 * @file guards.mts
 * @description ChatRuntime 主进程工具 bridge payload 类型守卫。
 */
import type {
  RuntimeFileContentSnapshot,
  RuntimeOpenResourceResult,
  RuntimeOpenResourceType,
  RuntimeOpenDraftResult,
  RuntimeSettingKey,
  RuntimeSettingsSnapshot,
  RuntimeSettingValue,
  RuntimeThemePresetOption,
  RuntimeUpdateSettingsResult
} from './types.mjs';
import { SUPPORTED_SETTING_KEYS } from '../../../../../../shared/settings/definitions.js';

/**
 * 判断值是否为对象记录。
 * @param value - 待判断值
 * @returns 是否为对象记录
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
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
 * 判断值是否为 Runtime 主题预设选项。
 * @param value - 待判断值
 * @returns 是否为主题预设选项
 */
function isRuntimeThemePresetOption(value: unknown): value is RuntimeThemePresetOption {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    Boolean(value.id.trim()) &&
    typeof value.label === 'string' &&
    Boolean(value.label.trim()) &&
    typeof value.description === 'string' &&
    Boolean(value.description.trim())
  );
}

/**
 * 判断 bridge payload 是否为设置快照。
 * @param value - bridge payload
 * @returns 是否为设置快照
 */
export function isRuntimeSettingsSnapshot(value: unknown): value is RuntimeSettingsSnapshot {
  if (!isRecord(value) || !isRecord(value.settings) || !Array.isArray(value.themePresetOptions)) return false;

  return (
    Object.entries(value.settings).every(([key, settingValue]) => isRuntimeSettingKey(key) && isRuntimeSettingValue(settingValue)) &&
    value.themePresetOptions.every(isRuntimeThemePresetOption)
  );
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
