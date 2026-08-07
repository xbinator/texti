/**
 * @file setting.test.ts
 * @description 应用设置持久化输入归一化测试。
 * @vitest-environment jsdom
 */
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { local } from '@/shared/storage/base';
import { useSettingStore } from '@/stores/ui/setting';

describe('setting store persistence', (): void => {
  beforeEach((): void => {
    localStorage.clear();
    document.documentElement.style.fontSize = '';
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      })
    });
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      writable: true,
      value: {
        setWindowTitle: vi.fn().mockResolvedValue(undefined),
        updateMenuItem: vi.fn()
      }
    });
    setActivePinia(createPinia());
  });

  it('normalizes an invalid persisted chat sidebar session id', (): void => {
    local.setItem('app_settings', { chatSidebarActiveSessionId: 42 });

    expect(useSettingStore().chatSidebarActiveSessionId).toBeNull();
  });

  it('trims a valid persisted chat sidebar session id', (): void => {
    local.setItem('app_settings', { chatSidebarActiveSessionId: ' session-a ' });

    expect(useSettingStore().chatSidebarActiveSessionId).toBe('session-a');
  });

  it('normalizes the previous Graphite preset id to the new default preset id', (): void => {
    local.setItem('app_settings', { themePreset: 'graphite' });

    expect(useSettingStore().themePreset).toBe('default');
  });

  it('normalizes an invalid persisted root font size', (): void => {
    local.setItem('app_settings', { rootFontSize: 100 });

    expect(useSettingStore().rootFontSize).toBe(14);
  });

  it('applies root font size changes to the document element', (): void => {
    const settingStore = useSettingStore();

    settingStore.setRootFontSize(16);

    expect(settingStore.rootFontSize).toBe(16);
    expect(document.documentElement.style.fontSize).toBe('16px');
    expect(local.getItem<{ rootFontSize?: number }>('app_settings')?.rootFontSize).toBe(16);
  });

  it('restores persisted root font size during init', (): void => {
    local.setItem('app_settings', { rootFontSize: 15 });
    const settingStore = useSettingStore();

    settingStore.init();

    expect(document.documentElement.style.fontSize).toBe('15px');
  });
});
