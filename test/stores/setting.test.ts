/**
 * @file setting.test.ts
 * @description 验证设置 store 的聊天侧边栏会话持久化行为。
 */
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const SETTINGS_STORAGE_KEY = 'app_settings';
const storage = new Map<string, string>();

vi.stubGlobal('localStorage', {
  getItem(key: string): string | null {
    return storage.get(key) ?? null;
  },
  setItem(key: string, value: string): void {
    storage.set(key, value);
  },
  removeItem(key: string): void {
    storage.delete(key);
  },
  clear(): void {
    storage.clear();
  }
});

describe('useSettingStore', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    setActivePinia(createPinia());
  });

  it('persists the active chat sidebar session id into app settings', async () => {
    const { useSettingStore } = await import('@/stores/setting');
    const settingStore = useSettingStore();

    settingStore.setChatSidebarActiveSessionId('session-42');

    expect(settingStore.chatSidebarActiveSessionId).toBe('session-42');
    expect(localStorage.getItem(SETTINGS_STORAGE_KEY)).toContain('"chatSidebarActiveSessionId":"session-42"');
  });

  it('restores the active chat sidebar session id from persisted app settings', async () => {
    const { local } = await import('@/shared/storage/base');

    local.setItem(SETTINGS_STORAGE_KEY, {
        chatSidebarActiveSessionId: 'session-restore',
        providerSidebarCollapsed: false,
        settingsSidebarCollapsed: false,
        theme: 'system',
        showOutline: true,
        sourceMode: false,
        sidebarVisible: false,
        sidebarWidth: 340
      });

    const { useSettingStore } = await import('@/stores/setting');
    const settingStore = useSettingStore();

    expect(settingStore.chatSidebarActiveSessionId).toBe('session-restore');
  });
});
