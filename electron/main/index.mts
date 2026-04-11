import { app, BrowserWindow } from 'electron';
import { registerAllIpcHandlers, initDatabase, closeDatabase, initStore, migrateFromTauri } from './modules/index.mjs';
import { createWindow } from './window.mjs';

function handleActivate(): void {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
}

function handleWindowAllClosed(): void {
  closeDatabase();
  if (process.platform !== 'darwin') {
    app.quit();
  }
}

async function bootstrap(): Promise<void> {
  await initStore();
  migrateFromTauri();
  await initDatabase();
  registerAllIpcHandlers();
  createWindow();

  app.on('activate', handleActivate);
}

app.whenReady().then(bootstrap);
app.on('window-all-closed', handleWindowAllClosed);
