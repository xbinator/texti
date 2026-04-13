import { ipcMain } from 'electron';
import { fileWatchService } from './service.mjs';

export function registerFileHandlers(): void {
  ipcMain.handle('fs:writeFile', async (_event, filePath: string, content: string) => {
    const { promises: fs } = await import('node:fs');
    await fs.writeFile(filePath, content, 'utf-8');
  });

  ipcMain.handle('fs:watchFile', async (_event, filePath: string) => {
    await fileWatchService.watch(filePath);
  });

  ipcMain.handle('fs:unwatchFile', async () => {
    await fileWatchService.unwatch();
  });
}
