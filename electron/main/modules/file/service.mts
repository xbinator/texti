import fs from 'node:fs/promises';
import chokidar from 'chokidar';
import { BrowserWindow } from 'electron';

class FileWatchService {
  private watcher: ReturnType<typeof chokidar.watch> | null = null;

  private currentFilePath: string | null = null;

  async watch(filePath: string) {
    if (this.currentFilePath === filePath) return;

    await this.unwatch();
    this.currentFilePath = filePath;

    this.watcher = chokidar.watch(filePath, {
      persistent: true,
      awaitWriteFinish: {
        // 等待文件写入完成
        stabilityThreshold: 100,
        // 轮询间隔
        pollInterval: 100
      }
    });

    this.watcher.on('change', async (path) => {
      try {
        const content = await fs.readFile(path, 'utf-8');
        BrowserWindow.getAllWindows().forEach((win) => {
          win.webContents.send('file:changed', { type: 'change', filePath: path, content });
        });
      } catch (error) {
        console.error('FileWatchService read error:', error);
      }
    });

    this.watcher.on('unlink', (path) => {
      BrowserWindow.getAllWindows().forEach((win) => {
        win.webContents.send('file:changed', { type: 'unlink', filePath: path });
      });
    });
  }

  async unwatch() {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
    this.currentFilePath = null;
  }
}

export const fileWatchService = new FileWatchService();
