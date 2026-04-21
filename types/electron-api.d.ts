import type {
  AICreateOptions,
  AIRequestOptions,
  AIServiceError,
  AIInvokeResult,
  AIStreamFinishChunk,
  AIStreamToolCallChunk
} from './ai';

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

export interface ElectronReadFileResult {
  content: string;
  fileName: string;
  ext: string;
}

export interface DbExecuteResult {
  changes: number;
  lastInsertRowid: number;
}

export interface FileChangeEvent {
  type: 'change' | 'unlink';
  filePath: string;
  content?: string;
}

export interface ElectronAPI {
  readFile: (filePath: string) => Promise<ElectronReadFileResult>;

  // 文件对话框操作
  openFile: (options?: ElectronOpenFileOptions) => Promise<ElectronFileResult>;

  saveFile: (content: string, filePath?: string, options?: ElectronSaveFileOptions) => Promise<string | null>;

  writeFile: (filePath: string, content: string) => Promise<void>;
  renameFile: (oldPath: string, newPath: string) => Promise<void>;
  trashFile: (filePath: string) => Promise<void>;
  showItemInFolder: (filePath: string) => Promise<void>;

  watchFile: (filePath: string) => Promise<void>;
  unwatchFile: () => Promise<void>;
  onFileChanged: (callback: (data: FileChangeEvent) => void) => () => void;

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
  aiInvoke: (createOptions: AICreateOptions, request: AIRequestOptions) => Promise<AsyncResult<AIInvokeResult, AIServiceError>>;
  aiStream: (createOptions: AICreateOptions, request: AIRequestOptions) => Promise<void>;
  aiStreamAbort: (requestId: string) => Promise<void>;

  // AI 流式事件监听
  onAiStreamText: (callback: (text: string) => void) => () => void;
  onAiStreamThinking: (callback: (thinking: string) => void) => () => void;
  onAiStreamComplete: (callback: () => void) => () => void;
  onAiStreamError: (callback: (error: AIServiceError) => void) => () => void;
  onAiStreamFinish: (callback: (payload: AIStreamFinishChunk) => void) => () => void;
  onAiStreamToolCall: (callback: (payload: AIStreamToolCallChunk) => void) => () => void;

  // 日志操作
  logger: {
    debug: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };

  // 菜单操作
  onMenuAction: (callback: (action: string) => void) => () => void;
  updateMenuItem: (id: string, properties: { checked?: boolean }) => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
