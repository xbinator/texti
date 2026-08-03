/**
 * @file menu.test.ts
 * @description 验证 Electron 系统菜单模板包含帮助菜单更新检查入口。
 */
import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { buildAppMenuTemplate } from '../../../../../electron/main/modules/ui/menu.mts';

vi.mock('electron', () => ({
  app: { name: 'Tibis' },
  BrowserWindow: {
    getFocusedWindow: vi.fn(),
    getAllWindows: vi.fn(() => [])
  },
  Menu: {
    buildFromTemplate: vi.fn((template: unknown) => template),
    setApplicationMenu: vi.fn()
  }
}));

vi.mock('../../../../../electron/main/window.mjs', () => ({
  getWindow: vi.fn()
}));

/**
 * 按顶层菜单名称提取子菜单配置。
 * @param template - Electron 菜单模板
 * @param label - 顶层菜单名称
 * @returns 匹配到的子菜单配置
 */
function getSubmenu(template: MenuItemConstructorOptions[], label: string): MenuItemConstructorOptions[] {
  const menu = template.find((item: MenuItemConstructorOptions): boolean => item.label === label);

  return Array.isArray(menu?.submenu) ? menu.submenu : [];
}

/**
 * 判断菜单项是否为指定文本。
 * @param item - Electron 菜单项配置
 * @param label - 需要匹配的菜单文本
 * @returns 是否匹配指定菜单文本
 */
function isMenuLabel(item: MenuItemConstructorOptions, label: string): boolean {
  return item.label === label;
}

/**
 * 递归收集菜单模板中的 accelerator。
 * @param items - Electron 菜单模板
 * @returns 菜单模板中声明的快捷键
 */
function collectAccelerators(items: MenuItemConstructorOptions[]): string[] {
  const accelerators: string[] = [];

  for (const item of items) {
    if (typeof item.accelerator === 'string') {
      accelerators.push(item.accelerator);
    }

    if (Array.isArray(item.submenu)) {
      accelerators.push(...collectAccelerators(item.submenu));
    }
  }

  return accelerators;
}

describe('buildAppMenuTemplate', () => {
  it('adds check update action to the help menu', (): void => {
    const template = buildAppMenuTemplate(false, 'Tibis');
    const submenu = getSubmenu(template, '帮助');
    const checkUpdateItem = submenu.find((item: MenuItemConstructorOptions): boolean => isMenuLabel(item, '检查更新'));

    expect(checkUpdateItem).toMatchObject({
      label: '检查更新'
    });
  });

  it('hides reload actions when the reload menu is disabled', (): void => {
    const template = buildAppMenuTemplate(false, 'Tibis');
    const submenu = getSubmenu(template, '视图');

    expect(submenu.find((item: MenuItemConstructorOptions): boolean => isMenuLabel(item, '重新加载'))).toBeUndefined();
    expect(submenu.find((item: MenuItemConstructorOptions): boolean => isMenuLabel(item, '强制重新加载'))).toBeUndefined();
  });

  it('keeps reload actions without reload accelerators when the reload menu is enabled', (): void => {
    const template = buildAppMenuTemplate(false, 'Tibis', { enableReloadMenu: true });
    const submenu = getSubmenu(template, '视图');
    const reloadItem = submenu.find((item: MenuItemConstructorOptions): boolean => isMenuLabel(item, '重新加载'));
    const forceReloadItem = submenu.find((item: MenuItemConstructorOptions): boolean => isMenuLabel(item, '强制重新加载'));

    expect(reloadItem).toMatchObject({
      label: '重新加载'
    });
    expect(reloadItem?.accelerator).toBeUndefined();
    expect(forceReloadItem).toMatchObject({
      label: '强制重新加载'
    });
    expect(forceReloadItem?.accelerator).toBeUndefined();
  });

  it('does not bind Ctrl R accelerators to any menu item', (): void => {
    const template = buildAppMenuTemplate(false, 'Tibis', { enableReloadMenu: true });
    const accelerators = collectAccelerators(template);

    expect(accelerators).not.toContain('CmdOrCtrl+R');
    expect(accelerators).not.toContain('CmdOrCtrl+Shift+R');
  });
});
