/**
 * @file index.ts
 * @description 应用设置相关 ChatRuntime 工具定义。
 */
import type { ToolRegistryEntry } from '../types.js';
import {
  GET_SETTINGS_TOOL_NAME,
  SUPPORTED_SETTING_KEYS,
  UPDATE_SETTINGS_TOOL_NAME,
  formatSettingSummaryDescription,
  formatSettingValueDescription
} from '../../../settings/definitions.js';

export { GET_SETTINGS_TOOL_NAME, UPDATE_SETTINGS_TOOL_NAME } from '../../../settings/definitions.js';

/** 设置项摘要说明，用于工具总描述。 */
const SETTING_SUMMARY_DESCRIPTION = formatSettingSummaryDescription();

/** 设置值域说明，用于 update_settings 的 value 参数。 */
const SETTING_VALUE_DESCRIPTION = formatSettingValueDescription();

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
