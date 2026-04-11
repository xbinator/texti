/**
 * Electron API 类型定义
 * 为 window.electronAPI 提供类型支持
 */

export interface AIRequest {
  providerId: string;
  modelId: string;
  prompt: string;
  system?: string;
  temperature?: number;
}

export interface AIGenerateResult {
  text: string;
}

export interface ElectronAPI {
  // 文件对话框操作
  openFile: (options?: { filters?: Array<{ name: string; extensions: string[] }> }) => Promise<{
    canceled: boolean;
    filePath: string | null;
    content: string;
    fileName: string;
    ext: string;
  }>;

  saveFile: (
    content: string,
    filePath?: string,
    options?: { filters?: Array<{ name: string; extensions: string[] }>; defaultPath?: string }
  ) => Promise<string | null>;

  writeFile: (filePath: string, content: string) => Promise<void>;

  // 窗口控制操作
  setWindowTitle: (title: string) => Promise<void>;
  windowMinimize: () => Promise<void>;
  windowMaximize: () => Promise<void>;
  windowClose: () => Promise<void>;
  windowIsMaximized: () => Promise<boolean>;

  // 数据库操作
  dbExecute: (sql: string, params?: unknown[]) => Promise<{ changes: number; lastInsertRowid: number }>;
  dbSelect: <T = unknown>(sql: string, params?: unknown[]) => Promise<T[]>;

  // 安全存储操作
  storeGet: <T = unknown>(key: string) => Promise<T | undefined>;
  storeSet: (key: string, value: unknown) => Promise<void>;
  storeDelete: (key: string) => Promise<void>;

  // 系统操作
  openExternal: (url: string) => Promise<void>;

  // AI 服务操作
  aiConfigure: (providerId: string) => Promise<boolean>;
  aiRemoveProvider: (providerId: string) => Promise<void>;
  aiGenerate: (request: AIRequest) => Promise<AIGenerateResult>;
  aiStream: (request: AIRequest) => Promise<void>;
  aiAbort: () => Promise<void>;

  // AI 事件监听
  onAiChunk: (callback: (chunk: string) => void) => () => void;
  onAiComplete: (callback: () => void) => () => void;
  onAiError: (callback: (error: string) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
