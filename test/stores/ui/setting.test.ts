/**
 * @file setting.test.ts
 * @description 应用设置持久化输入归一化测试。
 * @vitest-environment jsdom
 */
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { local } from '@/shared/storage/base';
import { useSettingStore } from '@/stores/ui/setting';

/** 系统主题监听注册 mock。 */
const addThemeListener = vi.fn<(_type: string, _listener: (event: MediaQueryListEvent) => void) => void>();
/** 系统主题监听移除 mock。 */
const removeThemeListener = vi.fn<(_type: string, _listener: (event: MediaQueryListEvent) => void) => void>();

describe('setting store persistence', (): void => {
  beforeEach((): void => {
    localStorage.clear();
    document.documentElement.style.fontSize = '';
    document.documentElement.style.removeProperty('--font-sans');
    addThemeListener.mockReset();
    removeThemeListener.mockReset();
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn().mockReturnValue({
        matches: false,
        addEventListener: addThemeListener,
        removeEventListener: removeThemeListener
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

  it('normalizes an invalid persisted default font style', (): void => {
    local.setItem('app_settings', { defaultFontStyle: 'unknown' });

    expect(useSettingStore().defaultFontStyle).toBe('theme');
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

  it('normalizes legacy default font style values', (): void => {
    local.setItem('app_settings', { defaultFontStyle: 'serif' });

    expect(useSettingStore().defaultFontStyle).toBe('songti');
  });

  it('restores persisted default font style during init', (): void => {
    local.setItem('app_settings', { defaultFontStyle: 'songti' });
    const settingStore = useSettingStore();

    settingStore.init();

    expect(document.documentElement.style.getPropertyValue('--font-sans')).toContain('Songti SC');
  });

  it('applies default font style changes only to the sans font variable', (): void => {
    const settingStore = useSettingStore();

    settingStore.setDefaultFontStyle('heiti');

    expect(settingStore.defaultFontStyle).toBe('heiti');
    expect(document.documentElement.style.getPropertyValue('--font-sans')).toContain('Heiti SC');
    expect(document.documentElement.style.getPropertyValue('--font-mono')).toBe('');
    expect(local.getItem<{ defaultFontStyle?: string }>('app_settings')?.defaultFontStyle).toBe('heiti');

    settingStore.setDefaultFontStyle('theme');

    expect(document.documentElement.style.getPropertyValue('--font-sans')).toBe('');
  });

  it('keeps one system-theme listener across repeated initialization and disposes it', (): void => {
    const settingStore = useSettingStore();

    settingStore.initTheme();
    const firstListener = addThemeListener.mock.calls[0]?.[1];
    settingStore.initTheme();
    const secondListener = addThemeListener.mock.calls[1]?.[1];

    expect(removeThemeListener).toHaveBeenCalledWith('change', firstListener);
    settingStore.disposeTheme();
    expect(removeThemeListener).toHaveBeenCalledWith('change', secondListener);
    expect(removeThemeListener).toHaveBeenCalledTimes(2);
  });
});
