import { ipcMain } from 'electron';
import { getStore } from './service.mjs';

export function registerStoreHandlers(): void {
  ipcMain.handle('store:get', async (_event, key: string) => {
    return getStore().get(key);
  });

  ipcMain.handle('store:set', async (_event, key: string, value: unknown) => {
    getStore().set(key, value);
  });

  ipcMain.handle('store:delete', async (_event, key: string) => {
    getStore().delete(key);
  });
}
