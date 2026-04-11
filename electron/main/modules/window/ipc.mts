import { ipcMain } from 'electron';
import { getFocusedWindow } from '../../window.mjs';

export function registerWindowHandlers(): void {
  ipcMain.handle('window:setTitle', async (_event, title: string) => {
    const win = getFocusedWindow();
    if (win) {
      win.setTitle(title);
    }
  });

  ipcMain.handle('window:minimize', async () => {
    const win = getFocusedWindow();
    if (win) {
      win.minimize();
    }
  });

  ipcMain.handle('window:maximize', async () => {
    const win = getFocusedWindow();
    if (win) {
      if (win.isMaximized()) {
        win.unmaximize();
      } else {
        win.maximize();
      }
    }
  });

  ipcMain.handle('window:close', async () => {
    const win = getFocusedWindow();
    if (win) {
      win.close();
    }
  });

  ipcMain.handle('window:isMaximized', async () => {
    const win = getFocusedWindow();
    return win ? win.isMaximized() : false;
  });

  ipcMain.handle('window:isFullScreen', async () => {
    const win = getFocusedWindow();
    return win ? win.isFullScreen() : false;
  });
}
