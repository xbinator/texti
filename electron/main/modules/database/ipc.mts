import type { DbExecuteResult } from '../../types';
import { ipcMain } from 'electron';
import { dbExecute, dbSelect } from './service.mjs';

export function registerDatabaseHandlers(): void {
  ipcMain.handle('db:execute', async (_event, sql: string, params?: unknown[]): Promise<DbExecuteResult> => {
    return dbExecute(sql, params);
  });

  ipcMain.handle('db:select', async (_event, sql: string, params?: unknown[]) => {
    return dbSelect(sql, params);
  });
}
