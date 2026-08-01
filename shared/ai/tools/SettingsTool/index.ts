/**
 * @file index.ts
 * @description 应用设置相关 ChatRuntime 工具定义。
 */
import type { ToolRegistryEntry } from '../types.js';

/** 支持读取或修改的设置键。 */
const SUPPORTED_SETTING_KEYS = ['theme', 'themePreset', 'sourceMode', 'editorPageWidth'] as const;

/** 支持设置键类型。 */
type SupportedSettingKey = (typeof SUPPORTED_SETTING_KEYS)[number];

/**
 * 设置项说明片段。
 */
interface SettingDescriptionParts {
  /** 设置项语义摘要。 */
  summary: string;
  /** 设置值域说明。 */
  value: string;
}

/** 每个设置键的语义和取值说明。 */
const SETTING_DETAIL_DESCRIPTIONS: Record<SupportedSettingKey, SettingDescriptionParts> = {
  theme: {
    summary: '明暗主题外观',
    value: '取值 dark=深色、light=浅色、system=跟随系统'
  },
  themePreset: {
    summary: '主题预设（整套界面色彩氛围）',
    value: '为整套界面色彩预设 ID，取值 default=暖米白/棕色、graphite=白/浅灰/黑灰、shonen=暖白/朱红/金黄/红黑、overworld=纸面/钴蓝天空/墨线像素边/苔藓绿'
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

/** 设置项摘要说明，用于工具总描述。 */
const SETTING_SUMMARY_DESCRIPTION = SUPPORTED_SETTING_KEYS.map((key: SupportedSettingKey): string => `${key} ${SETTING_DETAIL_DESCRIPTIONS[key].summary}`).join(
  '、'
);

/** 设置值域说明，用于 update_settings 的 value 参数。 */
const SETTING_VALUE_DESCRIPTION = SUPPORTED_SETTING_KEYS.map((key: SupportedSettingKey): string => `${key} ${SETTING_DETAIL_DESCRIPTIONS[key].value}`).join(
  '；'
);

/** 获取设置工具名称。 */
export const GET_SETTINGS_TOOL_NAME = 'get_settings';

/** 修改设置工具名称。 */
export const UPDATE_SETTINGS_TOOL_NAME = 'update_settings';

/** 获取设置工具 registry 条目。 */
export const getSettingsToolRegistryEntry = {
  runtime: 'main',
  group: 'settings',
  exposure: 'default-readonly',
  executionClass: 'direct',
  effect: {
    effect: 'pure_read',
    resourceScopeResolver: 'application-settings',
    reversible: true
  },
  definition: {
    name: GET_SETTINGS_TOOL_NAME,
    description: `获取应用设置。可获取 ${SETTING_SUMMARY_DESCRIPTION} 的当前值。支持传入单个 key、key 数组或不传（返回全部支持的设置）。`,
    source: 'builtin',
    riskLevel: 'read',
    permissionCategory: 'settings',
    safeAutoApprove: true,
    requiresActiveDocument: false,
    parameters: {
      type: 'object',
      properties: {
        keys: {
          oneOf: [
            { type: 'string', enum: SUPPORTED_SETTING_KEYS },
            { type: 'array', items: { type: 'string', enum: SUPPORTED_SETTING_KEYS } }
          ],
          description: '要获取的设置键，支持单个字符串或数组，不传则返回所有设置。'
        }
      },
      additionalProperties: false
    }
  }
} satisfies ToolRegistryEntry;

/** 修改设置工具 registry 条目。 */
export const updateSettingsToolRegistryEntry = {
  runtime: 'main',
  group: 'settings',
  exposure: 'default-writable',
  executionClass: 'direct',
  effect: {
    effect: 'immediate_side_effect',
    resourceScopeResolver: 'application-settings',
    reversible: false
  },
  definition: {
    name: UPDATE_SETTINGS_TOOL_NAME,
    description: '修改应用设置。可根据自然语言请求设置明暗主题外观、主题预设对应的色彩氛围、源码模式和编辑器页宽。',
    source: 'builtin',
    riskLevel: 'write',
    permissionCategory: 'settings',
    safeAutoApprove: true,
    requiresActiveDocument: false,
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', enum: SUPPORTED_SETTING_KEYS, description: '要修改的设置键。' },
        value: {
          type: ['string', 'boolean'],
          description: `设置值按 key 匹配：${SETTING_VALUE_DESCRIPTION}。`
        }
      },
      required: ['key', 'value'],
      additionalProperties: false
    }
  }
} satisfies ToolRegistryEntry;
