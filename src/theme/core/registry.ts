/**
 * @file core/registry.ts
 * @description 主题预设注册表，提供注册、查询和 fallback 功能。
 */
import type { CustomThemeConfig } from '../types/custom';
import type { ThemeTokens } from '../types/tokens';
import { createThemeTokensFromBase } from './factory';

/**
 * 主题预设——注册到注册表的基本单元。
 */
export interface ThemePreset {
  /** 预设 ID，如 'default'、'classic' */
  id: string;
  /** 显示名称，如 '默认「Graphite」'、'Classic' */
  label: string;
  /** 亮色 Token */
  light: ThemeTokens;
  /** 暗色 Token */
  dark: ThemeTokens;
}

/** 预设注册表内部存储 */
const presetMap = new Map<string, ThemePreset>();

/** 注册顺序记录，用于 getPresetList 保持注册顺序 */
const presetOrder: string[] = [];

/**
 * 注册一个主题预设。如果 id 已存在则覆盖。
 * @param preset - 要注册的主题预设
 */
export function registerPreset(preset: ThemePreset): void {
  if (!presetMap.has(preset.id)) {
    presetOrder.push(preset.id);
  }
  presetMap.set(preset.id, preset);
}

/**
 * 获取所有已注册预设的元信息列表。
 * default 始终排首位，其余按注册顺序排列。
 * @returns 预设元信息数组
 */
export function getPresetList(): Array<{ id: string; label: string }> {
  const defaultItem = presetMap.get('default');
  const rest = presetOrder
    .filter((id) => id !== 'default')
    .map((id) => {
      const p = presetMap.get(id);
      return { id: p!.id, label: p!.label };
    });

  if (defaultItem) {
    return [{ id: defaultItem.id, label: defaultItem.label }, ...rest];
  }

  return rest;
}

/**
 * 获取指定预设和模式下的 ThemeTokens。
 * 如果 presetId 不存在，fallback 到 'default'。
 * @param presetId - 预设 ID
 * @param mode - 明暗模式
 * @returns 解析后的 ThemeTokens
 */
export function getResolvedTokens(presetId: string, mode: 'light' | 'dark'): ThemeTokens {
  const preset = presetMap.get(presetId) ?? presetMap.get('default');

  if (!preset) {
    throw new Error(
      `[theme-registry] No preset registered (requested: '${presetId}', fallback: 'default'). ` +
        'Make sure at least the "default" preset is registered before calling getResolvedTokens.'
    );
  }

  return mode === 'light' ? preset.light : preset.dark;
}

/**
 * 注册用户自定义主题配置。
 * @param config - 自定义主题配置
 */
export function registerCustomTheme(config: CustomThemeConfig): void {
  if (config.schemaVersion !== 1) {
    throw new Error(`[theme-registry] Unsupported custom theme schema version: ${config.schemaVersion}`);
  }

  const defaultLight = getResolvedTokens('default', 'light');
  const defaultDark = getResolvedTokens('default', 'dark');

  registerPreset({
    id: config.id,
    label: config.label,
    light: createThemeTokensFromBase(defaultLight, config.light),
    dark: createThemeTokensFromBase(defaultDark, config.dark)
  });
}
