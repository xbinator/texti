import type { AICreateOptions, AIRequestOptions } from './ai';

/**
 * Electron API 类型定义
 * 为 window.electronAPI 提供类型支持
 */

export interface ElectronDialogFilter {
  name: string;
  extensions: string[];
}

export interface ElectronOpenFileOptions {
  filters?: ElectronDialogFilter[];
}

export interface ElectronSaveFileOptions {
  filters?: ElectronDialogFilter[];
  defaultPath?: string;
}

export interface ElectronFileResult {
  canceled: boolean;
  filePath: string | null;
  content: string;
  fileName: string;
  ext: string;
}

export interface DbExecuteResult {
  changes: number;
  lastInsertRowid: number;
}

export interface AIGenerateResult {
  text: string;
}

export interface ElectronAIRequestPayload {
  createOptions: AICreateOptions;
  request: AIRequestOptions;
}

export interface ElectronAPI {
  // 文件对话框操作
  openFile: (options?: ElectronOpenFileOptions) => Promise<ElectronFileResult>;

  saveFile: (content: string, filePath?: string, options?: ElectronSaveFileOptions) => Promise<string | null>;

  writeFile: (filePath: string, content: string) => Promise<void>;

  // 窗口控制操作
  setWindowTitle: (title: string) => Promise<void>;
  windowMinimize: () => Promise<void>;
  windowMaximize: () => Promise<void>;
  windowClose: () => Promise<void>;
  windowIsMaximized: () => Promise<boolean>;
  windowIsFullScreen: () => Promise<boolean>;

  // 数据库操作
  dbExecute: (sql: string, params?: unknown[]) => Promise<DbExecuteResult>;
  dbSelect: <T = unknown>(sql: string, params?: unknown[]) => Promise<T[]>;

  // 安全存储操作
  storeGet: <T = unknown>(key: string) => Promise<T | undefined>;
  storeSet: (key: string, value: unknown) => Promise<void>;
  storeDelete: (key: string) => Promise<void>;

  // 系统操作
  openExternal: (url: string) => Promise<void>;

  // AI 服务操作
  aiGenerate: (payload: ElectronAIRequestPayload) => Promise<AIGenerateResult>;
  aiStream: (payload: ElectronAIRequestPayload) => Promise<void>;

  // AI 事件监听
  onAiChunk: (callback: (chunk: string) => void) => () => void;
  onAiComplete: (callback: () => void) => () => void;
  onAiError: (callback: (error: string) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
