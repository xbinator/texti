/**
 * @file service.mts
 * @description 管理 macOS Dock 菜单和 Windows 任务栏 Jump List 快捷入口。
 */
import { app, Menu, type JumpListCategory, type MenuItemConstructorOptions } from 'electron';
import { buildRecentFileShortcuts, buildShortcutActions, parseShortcutActionArg, type RecentFileShortcutInput } from './model.mjs';

const RECENT_FILE_LIMIT = 8;

let recentFiles: RecentFileShortcutInput[] = [];
let actionSender: ((action: string) => void) | null = null;

/**
 * 注册系统快捷入口点击后的动作发送器。
 * @param sender - 向渲染进程发送动作的函数
 */
export function setPlatformShortcutActionSender(sender: (action: string) => void): void {
  actionSender = sender;
}

/**
 * 更新最近文件列表并刷新系统快捷入口。
 * @param files - 最近文件摘要
 */
export function updatePlatformShortcuts(files: RecentFileShortcutInput[]): void {
  recentFiles = files;
  refreshPlatformShortcuts();
}

/**
 * 从命令行参数读取系统快捷入口动作。
 * @param argv - 命令行参数数组
 * @returns 支持的动作，不存在时返回 null
 */
export function getShortcutActionFromArgv(argv: string[]): string | null {
  return parseShortcutActionArg(argv);
}

/**
 * 发送系统快捷入口动作。
 * @param action - 需要转发到渲染进程的动作
 */
export function sendPlatformShortcutAction(action: string): void {
  actionSender?.(action);
}

/**
 * 刷新当前平台支持的快捷入口。
 */
export function refreshPlatformShortcuts(): void {
  const recentShortcuts = buildRecentFileShortcuts(recentFiles, RECENT_FILE_LIMIT);

  if (process.platform === 'darwin' && app.dock) {
    setupDockMenu(recentShortcuts);
    return;
  }

  if (process.platform === 'win32') {
    setupWindowsJumpList(recentShortcuts);
  }

  // Linux: no-op. 部分桌面环境可通过 .desktop Actions 支持快捷入口，后续如需再扩展。
}

/**
 * 设置 macOS Dock 右键菜单。
 * @param recentShortcuts - 最近文件快捷入口
 */
function setupDockMenu(recentShortcuts: ReturnType<typeof buildRecentFileShortcuts>): void {
  const dock = app.dock;
  if (!dock) return;

  const template: MenuItemConstructorOptions[] = [
    { label: '新建', click: () => sendPlatformShortcutAction('file:new') },
    { label: '打开最近的文件', click: () => sendPlatformShortcutAction('file:recent') }
  ];

  if (recentShortcuts.length > 0) {
    template.push({ type: 'separator' });
    template.push(
      ...recentShortcuts.map((file) => ({
        label: file.title,
        sublabel: file.subtitle,
        click: (): void => sendPlatformShortcutAction(file.action)
      }))
    );
  }

  dock.setMenu(Menu.buildFromTemplate(template));
}

/**
 * 设置 Windows 任务栏 Jump List。
 * @param recentShortcuts - 最近文件快捷入口
 */
function setupWindowsJumpList(recentShortcuts: ReturnType<typeof buildRecentFileShortcuts>): void {
  const actions = buildShortcutActions([]);
  const taskItems = actions.map((action) => ({
    type: 'task' as const,
    title: action.title,
    description: action.subtitle,
    program: process.execPath,
    args: `--action=${action.action}`,
    iconPath: process.execPath,
    iconIndex: 0
  }));

  const categories: JumpListCategory[] = [{ type: 'tasks', items: taskItems }];

  if (recentShortcuts.length > 0) {
    categories.push({
      type: 'custom',
      name: '最近文件',
      items: recentShortcuts.map((file) => ({
        type: 'task' as const,
        title: file.title,
        description: file.subtitle,
        program: process.execPath,
        args: `--action=${file.action}`,
        iconPath: process.execPath,
        iconIndex: 0
      }))
    });
  }

  app.setJumpList(categories);
}
