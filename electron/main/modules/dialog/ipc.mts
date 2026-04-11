import * as path from 'node:path';
import type { ElectronFileResult, ElectronOpenFileOptions, ElectronSaveFileOptions } from 'types/electron-api';
import { dialog, ipcMain } from 'electron';

export function registerDialogHandlers(): void {
  ipcMain.handle('dialog:openFile', async (_event, options?: ElectronOpenFileOptions) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: options?.filters || [{ name: 'Markdown', extensions: ['md', 'markdown'] }]
    });

    if (result.canceled || !result.filePaths.length) {
      return { canceled: true, filePath: null, content: '', fileName: '', ext: '' } satisfies ElectronFileResult;
    }

    const { promises: fs } = await import('node:fs');
    const filePath = result.filePaths[0];
    const content = await fs.readFile(filePath, 'utf-8');
    const fileName = path.basename(filePath);
    const ext = path.extname(filePath).slice(1);

    return { canceled: false, filePath, content, fileName, ext } satisfies ElectronFileResult;
  });

  ipcMain.handle('dialog:saveFile', async (_event, content: string, filePath?: string, options?: ElectronSaveFileOptions) => {
    if (filePath) {
      const { promises: fs } = await import('node:fs');
      await fs.writeFile(filePath, content, 'utf-8');
      return filePath;
    }

    const result = await dialog.showSaveDialog({
      filters: options?.filters || [{ name: 'Markdown', extensions: ['md'] }],
      defaultPath: options?.defaultPath || 'untitled.md'
    });

    if (result.canceled || !result.filePath) {
      return null;
    }

    const { promises: fs } = await import('node:fs');
    await fs.writeFile(result.filePath, content, 'utf-8');
    return result.filePath;
  });
}
