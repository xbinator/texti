/**
 * @file index.ts
 * @description 主题模块统一导出。先导入预设文件触发 registerPreset，再导出 API。
 */
import './presets/default';
import './presets/graphite';
import './presets/shonen';
import './presets/manga-ink';
import './presets/overworld';

export type { ThemeTokens } from './types/tokens';
export type { CustomThemeConfig } from './types/custom';
export { defaultLight as light, defaultDark as dark } from './presets/default';
export { toCssVars, toAntdToken, toMonacoColors } from './core/derive';
export { applyCssVars, validateTokens } from './core/apply';
export { registerPreset, registerCustomTheme, getPresetList, getResolvedTokens } from './core/registry';
export { createThemeTokens } from './core/factory';
export { resolveRuntimeThemeColors } from './core/runtime';
export type { BasePalette, ThemeTokenOverrides } from './core/factory';
export type { RuntimeThemeColors } from './core/runtime';
export type { ThemePreset } from './core/registry';
