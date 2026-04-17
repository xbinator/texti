import { getElectronAPI, hasElectronAPI } from '../../platform/electron-api';

export function isDatabaseAvailable(): boolean {
  return hasElectronAPI();
}

export async function dbSelect<T>(sql: string, params?: unknown[]): Promise<T[]> {
  if (!isDatabaseAvailable()) return [];
  return getElectronAPI().dbSelect<T>(sql, params);
}

export async function dbExecute(sql: string, params?: unknown[]): Promise<{ changes: number; lastInsertRowid: number }> {
  if (!isDatabaseAvailable()) return { changes: 0, lastInsertRowid: 0 };
  return getElectronAPI().dbExecute(sql, params);
}
