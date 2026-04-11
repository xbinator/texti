import type { DbExecuteResult } from 'types/electron-api';
import { ipcMain } from 'electron';
import { dbExecute, dbSelect } from './service.mjs';

export function registerDatabaseHandlers(): void {
  ipcMain.handle('db:execute', async (_event, sql: string, params?: unknown[]): Promise<DbExecuteResult> => {
    const result = dbExecute(sql, params);

    return {
      changes: result.changes,
      lastInsertRowid: Number(result.lastInsertRowid)
    };
  });

  ipcMain.handle('db:select', async (_event, sql: string, params?: unknown[]) => {
    return dbSelect(sql, params);
  });
}
