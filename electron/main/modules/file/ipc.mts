import { ipcMain } from 'electron';

export function registerFileHandlers(): void {
  ipcMain.handle('fs:writeFile', async (_event, filePath: string, content: string) => {
    const { promises: fs } = await import('node:fs');
    await fs.writeFile(filePath, content, 'utf-8');
  });
}
