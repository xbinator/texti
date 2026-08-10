/**
 * @file useRuntimeSettings.ts
 * @description ChatRuntime 可修改应用设置的读取和应用 hook。
 */
import type {
  BChatRuntimeApplySettingInput,
  BChatRuntimeApplySettingResult,
  BChatRuntimeSettingKey,
  BChatRuntimeSettingsSnapshot
} from '../utils/runtimeBridge';
import type { EditorPageWidth, EditorViewMode } from '@/stores/editor/preferences';
import { useEditorPreferencesStore } from '@/stores/editor/preferences';
import type { ThemeMode } from '@/stores/ui/setting';
import { useSettingStore } from '@/stores/ui/setting';
import { getPresetList } from '@/theme/core/registry';

/**
 * Runtime 设置 hook 返回值。
 */
interface UseRuntimeSettingsReturn {
  /** 获取应用设置快照。 */
  getSettingsSnapshot: () => BChatRuntimeSettingsSnapshot;
  /** 应用 ChatRuntime 设置修改。 */
  applyRuntimeSetting: (input: BChatRuntimeApplySettingInput) => BChatRuntimeApplySettingResult;
}

/**
 * 判断值是否为主题模式。
 * @param value - 待判断值
 * @returns 是否为主题模式
 */
function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'dark' || value === 'light' || value === 'system';
}

/**
 * 判断值是否为编辑器页宽模式。
 * @param value - 待判断值
 * @returns 是否为编辑器页宽模式
 */
function isEditorPageWidth(value: unknown): value is EditorPageWidth {
  return value === 'default' || value === 'wide' || value === 'full';
}

/**
 * 判断值是否为主题预设 ID。
 * @param value - 待判断值
 * @returns 是否为主题预设 ID
 */
function isThemePresetId(value: unknown): value is string {
  if (typeof value !== 'string') return false;

  return getPresetList().some((preset) => preset.id === value);
}

/**
 * 管理 ChatRuntime 暴露给模型的可读写应用设置。
 * @returns Runtime 设置读写方法
 */
export function useRuntimeSettings(): UseRuntimeSettingsReturn {
  const settingStore = useSettingStore();
  const editorPreferencesStore = useEditorPreferencesStore();

  /**
   * 读取当前设置值。
   * @param key - 设置键
   * @returns 当前设置值
   */
  function getRuntimeSettingValue(key: BChatRuntimeSettingKey): string | boolean | number {
    if (key === 'theme') return settingStore.theme;
    if (key === 'themePreset') return settingStore.themePreset;
    if (key === 'sourceMode') return editorPreferencesStore.viewMode === 'source';
    if (key === 'editorPageWidth') return editorPreferencesStore.pageWidth;

    return '';
  }

  /**
   * 获取应用设置快照。
   * @returns 当前可暴露给 ChatRuntime 的设置快照
   */
  function getSettingsSnapshot(): BChatRuntimeSettingsSnapshot {
    return {
      settings: {
        theme: settingStore.theme,
        themePreset: settingStore.themePreset,
        sourceMode: editorPreferencesStore.viewMode === 'source',
        editorPageWidth: editorPreferencesStore.pageWidth
      },
      themePresetOptions: getPresetList()
    };
  }

  /**
   * 应用 ChatRuntime 设置修改。
   * @param input - 设置修改输入
   * @returns 设置修改结果
   */
  function applyRuntimeSetting(input: BChatRuntimeApplySettingInput): BChatRuntimeApplySettingResult {
    const previousValue = getRuntimeSettingValue(input.key);

    if (input.key === 'theme' && isThemeMode(input.value)) {
      settingStore.setTheme(input.value);
    } else if (input.key === 'themePreset' && isThemePresetId(input.value)) {
      settingStore.setThemePreset(input.value);
    } else if (input.key === 'sourceMode' && typeof input.value === 'boolean') {
      const viewMode: EditorViewMode = input.value ? 'source' : 'rich';
      editorPreferencesStore.setViewMode(viewMode);
    } else if (input.key === 'editorPageWidth' && isEditorPageWidth(input.value)) {
      editorPreferencesStore.setPageWidth(input.value);
    } else {
      throw new Error(`设置值无效：${input.key}`);
    }

    return {
      applied: true,
      key: input.key,
      previousValue,
      currentValue: getRuntimeSettingValue(input.key)
    };
  }

  return {
    getSettingsSnapshot,
    applyRuntimeSetting
  };
}
