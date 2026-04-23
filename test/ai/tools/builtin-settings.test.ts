/**
 * @file builtin-settings.test.ts
 * @description 内置设置修改工具测试。
 */
import type { AIToolContext } from 'types/ai';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBuiltinSettingsTools } from '@/ai/tools/builtin/settings';
import { useSettingStore } from '@/stores/setting';

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

vi.stubGlobal('document', {
  documentElement: {
    setAttribute: vi.fn(),
    removeAttribute: vi.fn()
  }
});

/**
 * 创建工具执行上下文。
 * @returns 测试用工具上下文
 */
function createToolContext(): AIToolContext {
  return {
    document: {
      id: 'doc-1',
      title: 'Doc',
      path: null,
      getContent: () => ''
    },
    editor: {
      getSelection: () => null,
      insertAtCursor: async () => undefined,
      replaceSelection: async () => undefined,
      replaceDocument: async () => undefined
    }
  };
}

describe('built-in settings tools', () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  it('updates theme after confirmation', async () => {
    const confirm = vi.fn(async () => true);
    const tools = createBuiltinSettingsTools({ confirm });
    const settingStore = useSettingStore();

    const result = await tools.updateSettings.execute({ key: 'theme', value: 'dark' }, createToolContext());

    expect(result.status).toBe('success');
    expect(settingStore.theme).toBe('dark');
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'update_settings',
        permission: 'write',
        beforeText: 'theme: system',
        afterText: 'theme: dark'
      })
    );
  });

  it('keeps current settings when confirmation is rejected', async () => {
    const confirm = vi.fn(async () => false);
    const tools = createBuiltinSettingsTools({ confirm });
    const settingStore = useSettingStore();

    settingStore.setShowOutline(true);
    const result = await tools.updateSettings.execute({ key: 'showOutline', value: false }, createToolContext());

    expect(result.status).toBe('cancelled');
    expect(settingStore.showOutline).toBe(true);
  });

  it('rejects invalid theme values before confirmation', async () => {
    const confirm = vi.fn(async () => true);
    const tools = createBuiltinSettingsTools({ confirm });

    const result = await tools.updateSettings.execute({ key: 'theme', value: 'blue' }, createToolContext());

    expect(result.status).toBe('failure');
    expect(result.error?.code).toBe('INVALID_INPUT');
    expect(confirm).not.toHaveBeenCalled();
  });
});
