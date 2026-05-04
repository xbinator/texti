/**
 * @file settings.ts
 * @description 内置应用设置修改工具实现。
 */
import type { AIToolConfirmationAdapter, AIToolConfirmationRequest } from '../confirmation';
import type { AIToolExecutor } from 'types/ai';
import type { EditorPageWidth, ThemeMode } from '@/stores/setting';
import { useSettingStore } from '@/stores/setting';
import { executeWithPermission } from '../permission';
import { createToolFailureResult } from '../results';

/** 设置修改工具名称。 */
export const UPDATE_SETTINGS_TOOL_NAME = 'update_settings';

/** 设置获取工具名称。 */
export const GET_SETTINGS_TOOL_NAME = 'get_settings';

/** 支持通过 AI 修改的设置键。 */
const SUPPORTED_SETTING_KEYS = ['theme', 'showOutline', 'sourceMode', 'editorPageWidth'] as const;

/** 支持通过 AI 修改的设置键类型。 */
type SupportedSettingKey = (typeof SUPPORTED_SETTING_KEYS)[number];

/** 布尔设置键列表。 */
const BOOLEAN_SETTING_KEYS = ['showOutline', 'sourceMode'] as const;

/** 布尔设置键类型。 */
type BooleanSettingKey = (typeof BOOLEAN_SETTING_KEYS)[number];

/**
 * 设置修改工具输入参数。
 */
export interface UpdateSettingsInput {
  /** 要修改的设置键。 */
  key: SupportedSettingKey;
  /** 设置值，不同 key 对应不同类型。 */
  value: unknown;
}

/**
 * 设置修改工具应用结果。
 */
export interface UpdateSettingsResult {
  /** 是否已应用。 */
  applied: true;
  /** 已修改的设置键。 */
  key: SupportedSettingKey;
  /** 修改前的设置值。 */
  previousValue: string | boolean | number;
  /** 修改后的设置值。 */
  currentValue: string | boolean | number;
}

/**
 * 设置获取工具输入参数。
 */
export interface GetSettingsInput {
  /** 要获取的设置键，支持单个或数组，不传则返回所有设置。 */
  keys?: SupportedSettingKey | SupportedSettingKey[];
}

/**
 * 设置获取工具结果。
 */
export interface GetSettingsResult {
  /** 获取到的设置键值对。 */
  settings: Partial<Record<SupportedSettingKey, string | boolean | number>>;
}

/**
 * 内置设置工具集合。
 */
export interface BuiltinSettingsTools {
  /** 修改应用设置工具。 */
  updateSettings: AIToolExecutor<UpdateSettingsInput, UpdateSettingsResult>;
  /** 获取应用设置工具。 */
  getSettings: AIToolExecutor<GetSettingsInput, GetSettingsResult>;
}

/**
 * 判断设置键是否受支持。
 * @param key - 待检查设置键
 * @returns 是否为受支持设置键
 */
function isSupportedSettingKey(key: unknown): key is SupportedSettingKey {
  return typeof key === 'string' && SUPPORTED_SETTING_KEYS.includes(key as SupportedSettingKey);
}

/**
 * 判断设置键是否为布尔设置。
 * @param key - 待检查设置键
 * @returns 是否为布尔设置键
 */
function isBooleanSettingKey(key: SupportedSettingKey): key is BooleanSettingKey {
  return BOOLEAN_SETTING_KEYS.includes(key as BooleanSettingKey);
}

/**
 * 判断值是否为主题模式。
 * @param value - 待检查值
 * @returns 是否为主题模式
 */
function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'dark' || value === 'light' || value === 'system';
}

/**
 * 判断值是否为编辑器页宽模式。
 * @param value - 待检查值
 * @returns 是否为编辑器页宽模式
 */
function isEditorPageWidth(value: unknown): value is EditorPageWidth {
  return value === 'default' || value === 'wide' || value === 'full';
}

/**
 * 验证设置值。
 * @param input - 工具输入
 * @returns 验证后的输入或错误消息
 */
function validateSettingsInput(input: UpdateSettingsInput): UpdateSettingsInput | string {
  if (!isSupportedSettingKey(input.key)) {
    return '不支持修改该设置项。';
  }

  if (input.key === 'theme') {
    return isThemeMode(input.value) ? input : 'theme 只能设置为 dark、light 或 system。';
  }

  if (input.key === 'editorPageWidth') {
    return isEditorPageWidth(input.value) ? input : 'editorPageWidth 只能设置为 default、wide 或 full。';
  }

  if (isBooleanSettingKey(input.key)) {
    return typeof input.value === 'boolean' ? input : `${input.key} 必须设置为布尔值。`;
  }

  return '不支持修改该设置项。';
}

/**
 * 读取当前设置值。
 * @param key - 设置键
 * @returns 当前设置值
 */
function getCurrentSettingValue(key: SupportedSettingKey): string | boolean | number {
  const settingStore = useSettingStore();

  return settingStore[key];
}

/**
 * 应用设置修改。
 * @param input - 已验证的工具输入
 */
function applySettingValue(input: UpdateSettingsInput): void {
  const settingStore = useSettingStore();

  if (input.key === 'theme' && isThemeMode(input.value)) {
    settingStore.setTheme(input.value);
    return;
  }

  if (input.key === 'showOutline' && typeof input.value === 'boolean') {
    settingStore.setShowOutline(input.value);
    return;
  }

  if (input.key === 'sourceMode' && typeof input.value === 'boolean') {
    settingStore.setSourceMode(input.value);
    return;
  }

  if (input.key === 'editorPageWidth' && isEditorPageWidth(input.value)) {
    settingStore.setEditorPageWidth(input.value);
  }
}

/**
 * 创建内置设置修改工具。
 * @param adapter - 确认适配器
 * @returns 设置工具执行器对象
 */
export function createBuiltinSettingsTools(adapter: AIToolConfirmationAdapter): BuiltinSettingsTools {
  return {
    updateSettings: {
      definition: {
        name: UPDATE_SETTINGS_TOOL_NAME,
        description: '修改应用设置。可根据自然语言请求设置主题、大纲、源码模式和编辑器页宽。',
        source: 'builtin',
        riskLevel: 'write',
        permissionCategory: 'settings',
        safeAutoApprove: true,
        requiresActiveDocument: false,
        parameters: {
          type: 'object',
          properties: {
            key: {
              type: 'string',
              enum: SUPPORTED_SETTING_KEYS,
              description: '要修改的设置键。'
            },
            value: {
              type: ['string', 'boolean'],
              description: '设置值：theme 使用 dark/light/system；editorPageWidth 使用 default/wide/full；布尔设置使用 true/false。'
            }
          },
          required: ['key', 'value'],
          additionalProperties: false
        }
      },
      async execute(input: UpdateSettingsInput) {
        const validatedInput = validateSettingsInput(input);
        if (typeof validatedInput === 'string') {
          return createToolFailureResult(UPDATE_SETTINGS_TOOL_NAME, 'INVALID_INPUT', validatedInput);
        }

        const previousValue = getCurrentSettingValue(validatedInput.key);
        const request: AIToolConfirmationRequest = {
          toolName: UPDATE_SETTINGS_TOOL_NAME,
          title: 'AI 想要修改应用设置',
          description: `AI 请求修改设置项 ${validatedInput.key}。`,
          riskLevel: 'write',
          allowRemember: true,
          rememberScopes: ['session', 'always'],
          customInput: {
            enabled: true,
            placeholder: '输入新的设置值...',
            triggerLabel: '改成别的'
          },
          beforeText: `${validatedInput.key}: ${String(previousValue)}`,
          afterText: `${validatedInput.key}: ${String(validatedInput.value)}`
        };

        return executeWithPermission({
          definition: this.definition,
          adapter,
          request,
          operation: () => {
            applySettingValue(validatedInput);

            return {
              applied: true,
              key: validatedInput.key,
              previousValue,
              currentValue: getCurrentSettingValue(validatedInput.key)
            };
          }
        });
      }
    },
    getSettings: {
      definition: {
        name: GET_SETTINGS_TOOL_NAME,
        description: '获取应用设置。可获取主题、大纲、源码模式和编辑器页宽等设置项的当前值。支持传入单个 key、key 数组或不传（返回所有设置）。',
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
      },
      async execute(input: GetSettingsInput) {
        const settings: Partial<Record<SupportedSettingKey, string | boolean | number>> = {};

        let targetKeys: SupportedSettingKey[];
        if (input.keys === undefined) {
          targetKeys = [...SUPPORTED_SETTING_KEYS];
        } else if (Array.isArray(input.keys)) {
          targetKeys = input.keys.filter(isSupportedSettingKey);
        } else if (isSupportedSettingKey(input.keys)) {
          targetKeys = [input.keys];
        } else {
          return createToolFailureResult(GET_SETTINGS_TOOL_NAME, 'INVALID_INPUT', '不支持的设置键。');
        }

        for (const key of targetKeys) {
          settings[key] = getCurrentSettingValue(key);
        }

        return {
          toolName: GET_SETTINGS_TOOL_NAME,
          status: 'success',
          data: { settings }
        };
      }
    }
  };
}
