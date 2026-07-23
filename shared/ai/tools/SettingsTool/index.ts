/**
 * @file index.ts
 * @description 应用设置相关 ChatRuntime 工具定义。
 */
import type { ToolRegistryEntry } from '../types.js';

/** 支持读取或修改的设置键。 */
const SUPPORTED_SETTING_KEYS = ['theme', 'themePreset', 'sourceMode', 'editorPageWidth'] as const;

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
    description: '获取应用设置。可获取主题外观、主题色、源码模式和编辑器页宽等设置项的当前值。支持传入单个 key、key 数组或不传（返回所有设置）。',
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
    description: '修改应用设置。可根据自然语言请求设置主题外观、主题色、源码模式和编辑器页宽。',
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
          description:
            '设置值：theme 使用 dark/light/system；themePreset 使用预设 ID（如 default、everforest、tokyonight 等）；editorPageWidth 使用 default/wide/full；布尔设置使用 true/false。'
        }
      },
      required: ['key', 'value'],
      additionalProperties: false
    }
  }
} satisfies ToolRegistryEntry;
