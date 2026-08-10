/**
 * @file use-runtime-settings.test.ts
 * @description 验证 ChatRuntime 设置快照包含运行时注册的主题预设。
 * @vitest-environment jsdom
 */
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { useRuntimeSettings } from '@/components/BChat/hooks/useRuntimeSettings';
import { registerCustomTheme } from '@/theme';

describe('useRuntimeSettings', (): void => {
  beforeEach((): void => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  it('exposes custom themes from the runtime preset registry', (): void => {
    registerCustomTheme({
      schemaVersion: 1,
      id: 'custom-solarized',
      label: 'Solarized',
      description: 'Solarized custom palette',
      light: {},
      dark: {}
    });

    const snapshot = useRuntimeSettings().getSettingsSnapshot();

    expect(snapshot.themePresetOptions).toContainEqual({ id: 'default', label: '默认「Graphite」', description: '白/浅灰/黑灰' });
    expect(snapshot.themePresetOptions).toContainEqual({
      id: 'custom-solarized',
      label: 'Solarized',
      description: 'Solarized custom palette'
    });
  });
});
