import { promises as fs } from 'fs';
import * as path from 'path';
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { initDatabase, closeDatabase, dbExecute, dbSelect } from './database';
import { migrateFromTauri } from './migration';
import { initStore, getStore } from './store';

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Texti',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

  if (isDev) {
    mainWindow.loadURL('http://localhost:1420');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function setupIpcHandlers(): void {
  ipcMain.handle('dialog:openFile', async (_event, options?: { filters?: Array<{ name: string; extensions: string[] }> }) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: options?.filters || [{ name: 'Markdown', extensions: ['md', 'markdown'] }]
    });

    if (result.canceled || !result.filePaths.length) {
      return { canceled: true, filePath: null, content: '' };
    }

    const filePath = result.filePaths[0];
    const content = await fs.readFile(filePath, 'utf-8');
    const fileName = path.basename(filePath);
    const ext = path.extname(filePath).slice(1);

    return { canceled: false, filePath, content, fileName, ext };
  });

  ipcMain.handle(
    'dialog:saveFile',
    async (_event, content: string, filePath?: string, options?: { filters?: Array<{ name: string; extensions: string[] }>; defaultPath?: string }) => {
      if (filePath) {
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

      await fs.writeFile(result.filePath, content, 'utf-8');
      return result.filePath;
    }
  );

  ipcMain.handle('fs:writeFile', async (_event, filePath: string, content: string) => {
    await fs.writeFile(filePath, content, 'utf-8');
  });

  ipcMain.handle('window:setTitle', async (_event, title: string) => {
    const win = BrowserWindow.getFocusedWindow();
    if (win) {
      win.setTitle(title);
    }
  });

  ipcMain.handle('db:execute', async (_event, sql: string, params?: unknown[]) => {
    return dbExecute(sql, params);
  });

  ipcMain.handle('db:select', async (_event, sql: string, params?: unknown[]) => {
    return dbSelect(sql, params);
  });

  ipcMain.handle('store:get', async (_event, key: string) => {
    return getStore().get(key);
  });

  ipcMain.handle('store:set', async (_event, key: string, value: unknown) => {
    getStore().set(key, value);
  });

  ipcMain.handle('store:delete', async (_event, key: string) => {
    getStore().delete(key);
  });

  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    await shell.openExternal(url);
  });
}

app.whenReady().then(async () => {
  await initStore();
  migrateFromTauri();
  await initDatabase();
  setupIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  closeDatabase();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
