/**
 * @file ipc.mts
 * @description 工作区 IPC handler 注册，包含根目录、安全读取和文件监听。
 */
import type { IpcMainInvokeEvent } from 'electron';
import { ipcMain } from 'electron';
import { readWorkspaceDirectory, readWorkspaceFile, type ReadWorkspaceDirectoryRequest, type ReadWorkspaceFileRequest } from './read.mjs';
import { ensureTibisWorkspaceRoot } from './root.mjs';
import { fileWatchService } from './watch.mjs';

/** 已注册 watcher 销毁回收的 WebContents ID。 */
const trackedWatchOwners = new Set<number>();

/**
 * 确保 WebContents 销毁时释放其全部 watcher。
 * @param event - IPC 调用事件
 */
function trackWatchOwner(event: IpcMainInvokeEvent): void {
  const ownerId = event.sender.id;
  if (trackedWatchOwners.has(ownerId)) return;

  trackedWatchOwners.add(ownerId);
  event.sender.once('destroyed', (): void => {
    trackedWatchOwners.delete(ownerId);
    fileWatchService.releaseOwner(ownerId).catch((error: unknown): void => console.error('Failed to release file watchers:', error));
  });
}

/**
 * 注册工作区 IPC handlers。
 */
export function registerWorkspaceHandlers(): void {
  // 根目录
  ipcMain.handle('workspace:get-root', async () => {
    try {
      const result = await ensureTibisWorkspaceRoot();
      return result;
    } catch (error) {
      // 目录创建或规范化失败时返回 null，调用方据此判断工作区不可用
      return null;
    }
  });

  // 安全读取
  ipcMain.handle('fs:readWorkspaceTextFile', async (_event, request: ReadWorkspaceFileRequest) => readWorkspaceFile(request));
  ipcMain.handle('fs:readWorkspaceDirectory', async (_event, request: ReadWorkspaceDirectoryRequest) => readWorkspaceDirectory(request));

  // 文件监听
  ipcMain.handle('fs:watchFile', async (event: IpcMainInvokeEvent, filePath: string) => {
    trackWatchOwner(event);
    await fileWatchService.watch(filePath, event.sender.id);
  });

  ipcMain.handle('fs:unwatchFile', async (event: IpcMainInvokeEvent, filePath: string) => {
    await fileWatchService.unwatch(filePath, event.sender.id);
  });

  ipcMain.handle('fs:unwatchAll', async (event: IpcMainInvokeEvent) => {
    await fileWatchService.unwatchAll(event.sender.id);
  });

  ipcMain.handle('fs:watchDirectory', async (event: IpcMainInvokeEvent, dirPath: string, globPattern?: string) => {
    trackWatchOwner(event);
    await fileWatchService.watchDirectory(dirPath, globPattern, event.sender.id);
  });

  ipcMain.handle('fs:unwatchDirectory', async (event: IpcMainInvokeEvent, dirPath: string, globPattern?: string) => {
    await fileWatchService.unwatchDirectory(dirPath, globPattern, event.sender.id);
  });
}
