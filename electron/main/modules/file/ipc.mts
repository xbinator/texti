import * as fs from 'node:fs';
import * as path from 'node:path';
import { ipcMain } from 'electron';
import { fileWatchService } from './service.mjs';

export function registerFileHandlers(): void {
  ipcMain.handle('fs:readFile', async (_event, filePath: string) => {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    const fileName = path.basename(filePath);
    const ext = path.extname(filePath).slice(1);
    return { content, fileName, ext };
  });

  ipcMain.handle('fs:writeFile', async (_event, filePath: string, content: string) => {
    await fs.promises.writeFile(filePath, content, 'utf-8');
  });

  ipcMain.handle('fs:renameFile', async (_event, oldPath: string, newPath: string) => {
    await fs.promises.rename(oldPath, newPath);
  });

  ipcMain.handle('fs:watchFile', async (_event, filePath: string) => {
    await fileWatchService.watch(filePath);
  });

  ipcMain.handle('fs:unwatchFile', async () => {
    await fileWatchService.unwatch();
  });
}
