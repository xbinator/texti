/**
 * @file service.mts
 * @description 提供主进程文件变化监听服务，并向所有窗口广播文件事件。
 */

import fs from 'node:fs/promises';
import chokidar from 'chokidar';
import { BrowserWindow } from 'electron';

/**
 * chokidar 文件监听器实例类型。
 */
type FileWatcher = ReturnType<typeof chokidar.watch>;

/**
 * 主进程文件监听服务，支持多个路径同时监听。
 */
class FileWatchService {
  /** 按文件路径保存已创建的 watcher。 */
  private readonly watchers = new Map<string, FileWatcher>();

  /**
   * 注册指定路径的文件监听；重复注册同一路径时保持幂等。
   * @param filePath - 需要监听的文件路径
   */
  async watch(filePath: string): Promise<void> {
    if (this.watchers.has(filePath)) return;

    const watcher = chokidar.watch(filePath, {
      persistent: true,
      awaitWriteFinish: {
        // 等待文件写入完成
        stabilityThreshold: 100,
        // 轮询间隔
        pollInterval: 100
      }
    });

    watcher.on('change', async (changedPath: string) => {
      try {
        const content = await fs.readFile(changedPath, 'utf-8');
        BrowserWindow.getAllWindows().forEach((win) => {
          win.webContents.send('file:changed', { type: 'change', filePath: changedPath, content });
        });
      } catch (error: unknown) {
        console.error('FileWatchService read error:', error);
      }
    });

    watcher.on('unlink', (removedPath: string) => {
      BrowserWindow.getAllWindows().forEach((win) => {
        win.webContents.send('file:changed', { type: 'unlink', filePath: removedPath });
      });
    });

    this.watchers.set(filePath, watcher);
  }

  /**
   * 停止监听指定路径。
   * @param filePath - 需要停止监听的文件路径
   */
  async unwatch(filePath: string): Promise<void> {
    const watcher = this.watchers.get(filePath);
    if (!watcher) return;

    this.watchers.delete(filePath);
    await watcher.close();
  }

  /**
   * 停止所有文件监听，用于应用退出或 watcher store dispose。
   */
  async unwatchAll(): Promise<void> {
    const watchers = Array.from(this.watchers.values());
    this.watchers.clear();
    await Promise.all(watchers.map((watcher) => watcher.close()));
  }
}

export const fileWatchService = new FileWatchService();
