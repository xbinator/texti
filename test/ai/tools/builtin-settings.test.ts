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
    const confirm = vi.fn(async () => ({ approved: true }));
    const tools = createBuiltinSettingsTools({ confirm });
    const settingStore = useSettingStore();

    const result = await tools.updateSettings.execute({ key: 'theme', value: 'dark' }, createToolContext());

    expect(result.status).toBe('success');
    expect(settingStore.theme).toBe('dark');
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'update_settings',
        riskLevel: 'write',
        allowRemember: true,
        beforeText: 'theme: system',
        afterText: 'theme: dark'
      })
    );
  });

  it('adds custom input config to settings confirmation so users can override the suggested value', async () => {
    const confirm = vi.fn(async () => ({ approved: false }));
    const tools = createBuiltinSettingsTools({ confirm });

    await tools.updateSettings.execute({ key: 'theme', value: 'dark' }, createToolContext());

    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        customInput: {
          enabled: true,
          placeholder: '输入新的设置值...',
          triggerLabel: '改成别的'
        }
      })
    );
  });

  it('keeps current settings when confirmation is rejected', async () => {
    const confirm = vi.fn(async () => ({ approved: false }));
    const tools = createBuiltinSettingsTools({ confirm });
    const settingStore = useSettingStore();

    settingStore.setShowOutline(true);
    const result = await tools.updateSettings.execute({ key: 'showOutline', value: false }, createToolContext());

    expect(result.status).toBe('cancelled');
    expect(settingStore.showOutline).toBe(true);
  });

  it('rejects invalid theme values before confirmation', async () => {
    const confirm = vi.fn(async () => ({ approved: true }));
    const tools = createBuiltinSettingsTools({ confirm });

    const result = await tools.updateSettings.execute({ key: 'theme', value: 'blue' }, createToolContext());

    expect(result.status).toBe('failure');
    expect(result.error?.code).toBe('INVALID_INPUT');
    expect(confirm).not.toHaveBeenCalled();
  });

  it('rejects updates in readonly mode without confirmation', async () => {
    const confirm = vi.fn(async () => ({ approved: true }));
    const tools = createBuiltinSettingsTools({ confirm });
    const settingStore = useSettingStore();

    settingStore.setToolPermissionMode('readonly');
    const result = await tools.updateSettings.execute({ key: 'theme', value: 'dark' }, createToolContext());

    expect(result.status).toBe('failure');
    expect(result.error?.code).toBe('PERMISSION_DENIED');
    expect(settingStore.theme).toBe('system');
    expect(confirm).not.toHaveBeenCalled();
  });

  it('auto-approves safe settings updates in autoSafe mode', async () => {
    const confirm = vi.fn(async () => ({ approved: true }));
    const tools = createBuiltinSettingsTools({ confirm });
    const settingStore = useSettingStore();

    settingStore.setToolPermissionMode('autoSafe');
    const result = await tools.updateSettings.execute({ key: 'theme', value: 'dark' }, createToolContext());

    expect(result.status).toBe('success');
    expect(settingStore.theme).toBe('dark');
    expect(confirm).not.toHaveBeenCalled();
  });

  it('skips confirmation after a session grant', async () => {
    const confirm = vi.fn(async () => ({ approved: true }));
    const tools = createBuiltinSettingsTools({ confirm });
    const settingStore = useSettingStore();

    settingStore.grantToolPermission('update_settings', 'session');
    const result = await tools.updateSettings.execute({ key: 'showOutline', value: false }, createToolContext());

    expect(result.status).toBe('success');
    expect(settingStore.showOutline).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('stores a grant only after the operation succeeds', async () => {
    const confirm = vi.fn(async () => ({ approved: true, grantScope: 'always' as const }));
    const tools = createBuiltinSettingsTools({ confirm });
    const settingStore = useSettingStore();

    const result = await tools.updateSettings.execute({ key: 'showOutline', value: false }, createToolContext());

    expect(result.status).toBe('success');
    expect(settingStore.alwaysToolPermissionGrants.update_settings).toBe(true);
  });

  it('updates editor page width after confirmation', async () => {
    const confirm = vi.fn(async () => ({ approved: true }));
    const tools = createBuiltinSettingsTools({ confirm });
    const settingStore = useSettingStore();

    const result = await tools.updateSettings.execute({ key: 'editorPageWidth', value: 'wide' }, createToolContext());

    expect(result.status).toBe('success');
    expect(settingStore.editorPageWidth).toBe('wide');
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        beforeText: 'editorPageWidth: default',
        afterText: 'editorPageWidth: wide'
      })
    );
  });

  it('rejects invalid editor page width values before confirmation', async () => {
    const confirm = vi.fn(async () => ({ approved: true }));
    const tools = createBuiltinSettingsTools({ confirm });

    const result = await tools.updateSettings.execute({ key: 'editorPageWidth', value: 'ultra' }, createToolContext());

    expect(result.status).toBe('failure');
    expect(result.error?.code).toBe('INVALID_INPUT');
    expect(confirm).not.toHaveBeenCalled();
  });

  it('returns editor page width from get_settings', async () => {
    const tools = createBuiltinSettingsTools({ confirm: vi.fn(async () => ({ approved: true })) });
    const settingStore = useSettingStore();

    settingStore.setEditorPageWidth('full');

    const result = await tools.getSettings.execute({ keys: 'editorPageWidth' }, createToolContext());

    expect(result.status).toBe('success');
    expect(result.data?.settings.editorPageWidth).toBe('full');
  });
});
