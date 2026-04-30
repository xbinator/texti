import { inspect } from 'util';
import { ipcMain, shell } from 'electron';
import log from 'electron-log/main.js';
import { getLogDir, writeLog, readLogs, getLogFiles } from './service.mjs';
import { type LogEntryInput, type LogQueryOptions } from './types.mjs';

function formatArgs(args: unknown[]): unknown[] {
  return args.map((arg) => (typeof arg === 'object' && arg !== null ? inspect(arg, { depth: null, breakLength: Infinity }) : arg));
}

export function registerLoggerHandlers(): void {
  ipcMain.on('logger:debug', (_event, ...args: unknown[]) => {
    log.debug(...formatArgs(args));
  });

  ipcMain.on('logger:info', (_event, ...args: unknown[]) => {
    log.info(...formatArgs(args));
  });

  ipcMain.on('logger:warn', (_event, ...args: unknown[]) => {
    log.warn(...formatArgs(args));
  });

  ipcMain.on('logger:error', (_event, ...args: unknown[]) => {
    log.error(...formatArgs(args));
  });
}

/**
 * 注册文件日志相关的 IPC handler
 */
export function registerLogFileHandlers(): void {
  /** 写入日志（来自渲染进程或 preload） */
  ipcMain.handle('logger:write', (_event, entry: LogEntryInput) => {
    writeLog(entry);
  });

  /** 读取日志（供设置页日志查看器使用） */
  ipcMain.handle('logger:getLogs', (_event, options: LogQueryOptions) => {
    return readLogs(options);
  });

  /** 获取日志文件列表 */
  ipcMain.handle('logger:getFiles', () => {
    return getLogFiles();
  });

  /** 在系统文件管理器中打开日志目录 */
  ipcMain.handle('logger:openFolder', () => {
    shell.openPath(getLogDir());
  });
}
