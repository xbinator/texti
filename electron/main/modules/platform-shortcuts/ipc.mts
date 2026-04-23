/**
 * @file ipc.mts
 * @description 注册系统快捷入口最近文件同步 IPC。
 */
import { ipcMain } from 'electron';
import { updatePlatformShortcuts } from './service.mjs';
import type { RecentFileShortcutInput } from './model.mjs';

/**
 * 注册系统快捷入口 IPC 处理器。
 */
export function registerPlatformShortcutHandlers(): void {
  ipcMain.handle('platform-shortcuts:sync-recent-files', async (_event, files: RecentFileShortcutInput[]) => {
    updatePlatformShortcuts(files);
  });
}
