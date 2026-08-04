/**
 * @file setting.test.ts
 * @description 应用设置持久化输入归一化测试。
 * @vitest-environment jsdom
 */
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { local } from '@/shared/storage/base';
import { useSettingStore } from '@/stores/ui/setting';

describe('setting store persistence', (): void => {
  beforeEach((): void => {
    localStorage.clear();
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
});
