import { ipcMain } from 'electron';
import log from 'electron-log/main.js';

export function registerLoggerHandlers(): void {
  ipcMain.on('logger:debug', (_event, ...args: unknown[]) => {
    log.debug(...args);
  });

  ipcMain.on('logger:info', (_event, ...args: unknown[]) => {
    log.info(...args);
  });

  ipcMain.on('logger:warn', (_event, ...args: unknown[]) => {
    log.warn(...args);
  });

  ipcMain.on('logger:error', (_event, ...args: unknown[]) => {
    log.error(...args);
  });
}
