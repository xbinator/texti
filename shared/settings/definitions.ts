/**
 * @file definitions.ts
 * @description ChatRuntime 设置键和自然语言说明的共享定义。
 */

/** 获取设置工具名称。 */
export const GET_SETTINGS_TOOL_NAME = 'get_settings';

/** 修改设置工具名称。 */
export const UPDATE_SETTINGS_TOOL_NAME = 'update_settings';

/** 支持读取或修改的设置键。 */
export const SUPPORTED_SETTING_KEYS = ['theme', 'themePreset', 'sourceMode', 'editorPageWidth'] as const;

/** 支持设置键类型。 */
export type SupportedSettingKey = (typeof SUPPORTED_SETTING_KEYS)[number];

/**
 * 设置项说明片段。
 */
export interface SettingDescriptionParts {
  /** 设置项语义摘要。 */
  summary: string;
  /** 设置值域说明。 */
  value: string;
}

/** 每个设置键的语义和取值说明。 */
export const SETTING_DETAIL_DESCRIPTIONS: Record<SupportedSettingKey, SettingDescriptionParts> = {
  theme: {
    summary: '明暗主题外观',
    value: '取值 dark=深色、light=浅色、system=跟随系统'
  },
  themePreset: {
    summary: '主题预设（整套界面色彩氛围）',
    value: '为主题预设 ID，实际可用 ID、名称和描述以 get_settings 返回的 themePresetOptions 为准'
  },
  sourceMode: {
    summary: '源码模式',
    value: '取值 true=源码模式、false=富文本模式'
  },
  editorPageWidth: {
    summary: '编辑器页宽',
    value: '取值 default=默认宽度、wide=宽屏、full=全宽'
  }
};

/**
 * 格式化设置项摘要说明。
 * @returns 用于工具总描述的设置项摘要
 */
export function formatSettingSummaryDescription(): string {
  return SUPPORTED_SETTING_KEYS.map((key: SupportedSettingKey): string => `${key} ${SETTING_DETAIL_DESCRIPTIONS[key].summary}`).join('、');
}

/**
 * 格式化设置项值域说明。
 * @returns 用于更新工具 value 参数的值域说明
 */
export function formatSettingValueDescription(): string {
  return SUPPORTED_SETTING_KEYS.map((key: SupportedSettingKey): string => `${key} ${SETTING_DETAIL_DESCRIPTIONS[key].value}`).join('；');
}
