/**
 * @file settings.ts
 * @description 内置应用设置修改工具实现。
 */
import type { AIToolConfirmationAdapter, AIToolConfirmationRequest } from '../confirmation';
import type { AIToolExecutor } from 'types/ai';
import type { ThemeMode } from '@/stores/setting';
import { useSettingStore } from '@/stores/setting';
import { createToolCancelledResult, createToolFailureResult, createToolSuccessResult } from '../results';

/** 设置修改工具名称。 */
const UPDATE_SETTINGS_TOOL_NAME = 'update_settings';

/** 支持通过 AI 修改的设置键。 */
const SUPPORTED_SETTING_KEYS = [
  'theme',
  'showOutline',
  'sourceMode',
  'sidebarVisible',
  'sidebarWidth',
  'settingsSidebarCollapsed',
  'providerSidebarCollapsed'
] as const;

/** 支持通过 AI 修改的设置键类型。 */
type SupportedSettingKey = (typeof SUPPORTED_SETTING_KEYS)[number];

/** 布尔设置键列表。 */
const BOOLEAN_SETTING_KEYS = ['showOutline', 'sourceMode', 'sidebarVisible', 'settingsSidebarCollapsed', 'providerSidebarCollapsed'] as const;

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
 * 内置设置工具集合。
 */
export interface BuiltinSettingsTools {
  /** 修改应用设置工具。 */
  updateSettings: AIToolExecutor<UpdateSettingsInput, UpdateSettingsResult>;
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

  if (input.key === 'sidebarWidth') {
    return typeof input.value === 'number' && Number.isFinite(input.value) && input.value >= 240 && input.value <= 500
      ? input
      : 'sidebarWidth 必须是 240 到 500 之间的数字。';
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

  if (input.key === 'sidebarWidth' && typeof input.value === 'number') {
    settingStore.setSidebarWidth(input.value);
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

  if (input.key === 'sidebarVisible' && typeof input.value === 'boolean') {
    settingStore.setSidebarVisible(input.value);
    return;
  }

  if (input.key === 'settingsSidebarCollapsed' && typeof input.value === 'boolean') {
    settingStore.setSettingsSidebarCollapsed(input.value);
    return;
  }

  if (input.key === 'providerSidebarCollapsed' && typeof input.value === 'boolean') {
    settingStore.setProviderSidebarCollapsed(input.value);
  }
}

/**
 * 请求用户确认或返回取消结果。
 * @param adapter - 确认适配器
 * @param request - 确认请求
 * @returns null 表示已确认，否则返回取消结果
 */
async function confirmOrCancel(adapter: AIToolConfirmationAdapter, request: AIToolConfirmationRequest) {
  const confirmed = await adapter.confirm(request);

  return confirmed ? null : createToolCancelledResult(UPDATE_SETTINGS_TOOL_NAME);
}

/**
 * 执行已确认的设置修改，并同步确认生命周期状态。
 * @param adapter - 确认适配器
 * @param request - 确认请求
 * @param operation - 实际设置修改操作
 * @returns 工具执行结果
 */
async function executeConfirmedSettingsUpdate(adapter: AIToolConfirmationAdapter, request: AIToolConfirmationRequest, operation: () => UpdateSettingsResult) {
  await adapter.onExecutionStart?.(request);

  try {
    const result = operation();
    await adapter.onExecutionComplete?.(request, { status: 'success' });
    return createToolSuccessResult(UPDATE_SETTINGS_TOOL_NAME, result);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '设置修改失败';
    await adapter.onExecutionComplete?.(request, { status: 'failure', errorMessage });
    return createToolFailureResult(UPDATE_SETTINGS_TOOL_NAME, 'EXECUTION_FAILED', errorMessage);
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
        description: '修改应用设置。可根据自然语言请求设置主题、大纲、源码模式、聊天侧边栏和侧边栏折叠状态。',
        source: 'builtin',
        permission: 'write',
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
              type: ['string', 'boolean', 'number'],
              description: '设置值：theme 使用 dark/light/system；布尔设置使用 true/false；sidebarWidth 使用 240 到 500 的数字。'
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
          permission: 'write',
          beforeText: `${validatedInput.key}: ${String(previousValue)}`,
          afterText: `${validatedInput.key}: ${String(validatedInput.value)}`
        };
        const cancelled = await confirmOrCancel(adapter, request);
        if (cancelled) {
          return cancelled;
        }

        return executeConfirmedSettingsUpdate(adapter, request, () => {
          applySettingValue(validatedInput);

          return {
            applied: true,
            key: validatedInput.key,
            previousValue,
            currentValue: getCurrentSettingValue(validatedInput.key)
          };
        });
      }
    }
  };
}
