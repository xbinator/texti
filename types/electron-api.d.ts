import type { AICreateOptions, AIRequestOptions, AIServiceError, AIInvokeResult, AIStreamFinishChunk, AIStreamToolCallChunk } from './ai';

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

/**
 * Electron 工作区文件读取参数。
 */
export interface ElectronReadWorkspaceFileOptions {
  /** 文件路径，支持相对工作区路径或绝对路径 */
  filePath: string;
  /** 工作区根目录，缺省时仅允许读取绝对路径 */
  workspaceRoot?: string;
  /** 起始行号，默认 1 */
  offset?: number;
  /** 读取行数，默认 200，最大 1000 */
  limit?: number;
}

/**
 * Electron 工作区文件读取结果。
 */
export interface ElectronReadWorkspaceFileResult {
  /** 规范化后的真实文件路径 */
  path: string;
  /** 截取后的文本内容 */
  content: string;
  /** 文件总行数 */
  totalLines: number;
  /** 实际读取行数 */
  readLines: number;
  /** 是否还有后续内容 */
  hasMore: boolean;
  /** 下一次滚动读取的起始行号，没有后续内容时为 null */
  nextOffset: number | null;
}

/**
 * Electron 工作区目录读取参数。
 */
export interface ElectronReadWorkspaceDirectoryOptions {
  /** 目录路径，支持相对工作区路径或绝对路径 */
  directoryPath: string;
  /** 工作区根目录，缺省时仅允许读取绝对路径 */
  workspaceRoot?: string;
}

/**
 * Electron 工作区目录子项。
 */
export interface ElectronReadWorkspaceDirectoryEntry {
  /** 子项名称。 */
  name: string;
  /** 子项绝对路径。 */
  path: string;
  /** 子项类型。 */
  type: 'file' | 'directory';
}

/**
 * Electron 工作区目录读取结果。
 */
export interface ElectronReadWorkspaceDirectoryResult {
  /** 规范化后的真实目录路径 */
  path: string;
  /** 当前目录下的直接子项 */
  entries: ElectronReadWorkspaceDirectoryEntry[];
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

export interface WebViewState {
  url: string; // 当前加载的 URL
  title: string; // 页面标题
  isLoading: boolean; // 是否正在加载
  canGoBack: boolean; // 是否可以后退
  canGoForward: boolean; // 是否可以前进
  loadProgress: number; // 加载进度 0-1
}

export interface WebViewAPI {
  create: (tabId: string, url: string) => Promise<void>; // 创建 WebContentsView
  destroy: (tabId: string) => Promise<void>; // 销毁 WebContentsView
  navigate: (tabId: string, url: string) => Promise<void>; // 导航到 URL
  goBack: (tabId: string) => Promise<void>; // 后退
  goForward: (tabId: string) => Promise<void>; // 前进
  reload: (tabId: string) => Promise<void>; // 刷新
  stop: (tabId: string) => Promise<void>; // 停止加载
  setBounds: (tabId: string, bounds: { x: number; y: number; width: number; height: number }) => Promise<void>; // 设置边界
  show: (tabId: string) => Promise<void>; // 显示
  hide: (tabId: string) => Promise<void>; // 隐藏
  onStateChanged: (callback: (tabId: string, state: WebViewState) => void) => () => void; // 加载状态变化
  onTitleUpdated: (callback: (tabId: string, title: string) => void) => () => void; // 标题更新
  onNavigationStateChanged: (callback: (tabId: string, canGoBack: boolean, canGoForward: boolean) => void) => () => void; // 导航状态变化
  onOpenInNewTab: (callback: (url: string) => void) => () => void; // 在新标签页打开
}

export interface PlatformRecentFile {
  id: string;
  name: string;
  path: string | null;
}

/**
 * 图片压缩请求参数
 */
export interface ElectronImageCompressRequest {
  /** 原始图片二进制数据 */
  buffer: ArrayBuffer;
  /** 图片 MIME 类型 */
  mimeType: string;
}

/**
 * 图片压缩结果
 */
export interface ElectronImageCompressResult {
  /** 压缩后的二进制数据 */
  buffer: ArrayBuffer;
  /** 是否实际执行了压缩 */
  compressed: boolean;
}

export interface ElectronAPI {
  readFile: (filePath: string) => Promise<ElectronReadFileResult>;
  readWorkspaceFile: (options: ElectronReadWorkspaceFileOptions) => Promise<ElectronReadWorkspaceFileResult>;
  readWorkspaceDirectory: (options: ElectronReadWorkspaceDirectoryOptions) => Promise<ElectronReadWorkspaceDirectoryResult>;

  // 文件对话框操作
  openFile: (options?: ElectronOpenFileOptions) => Promise<ElectronFileResult>;

  saveFile: (content: string, filePath?: string, options?: ElectronSaveFileOptions) => Promise<string | null>;

  writeFile: (filePath: string, content: string) => Promise<void>;
  renameFile: (oldPath: string, newPath: string) => Promise<void>;
  trashFile: (filePath: string) => Promise<void>;
  showItemInFolder: (filePath: string) => Promise<void>;
  getRelativePath: (filePath: string) => Promise<string>;

  watchFile: (filePath: string) => Promise<void>;
  unwatchFile: (filePath: string) => Promise<void>;
  unwatchAll: () => Promise<void>;
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

  // 控制台日志（保留原有，与文件日志分离）
  consoleLogger: {
    debug: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };

  // Logger — 文件日志收集
  logger: {
    /** 写入 ERROR 级别日志文件 */
    error: (message: string) => Promise<void>;
    /** 写入 WARN 级别日志文件 */
    warn: (message: string) => Promise<void>;
    /** 写入 INFO 级别日志文件 */
    info: (message: string) => Promise<void>;
    /** 读取日志文件内容 */
    getLogs: (options: {
      level?: 'ERROR' | 'WARN' | 'INFO';
      scope?: 'main' | 'renderer' | 'preload';
      keyword?: string;
      date?: string;
      limit?: number;
      offset?: number;
    }) => Promise<
      {
        level: 'ERROR' | 'WARN' | 'INFO';
        message: string;
        scope: 'main' | 'renderer' | 'preload';
        timestamp: string;
      }[]
    >;
    /** 获取日志文件列表 */
    getLogFiles: () => Promise<
      {
        name: string;
        size: number;
        createdAt: string;
      }[]
    >;
    /** 在系统文件管理器中打开日志文件夹 */
    openLogFolder: () => Promise<void>;
  };

  // 菜单操作
  onMenuAction: (callback: (action: string) => void) => () => void;
  updateMenuItem: (id: string, properties: { checked?: boolean }) => void;
  syncPlatformRecentFiles: (files: PlatformRecentFile[]) => Promise<void>;

  // WebView 操作
  webview: WebViewAPI;

  // ==================== 图片压缩 ====================

  /**
   * 压缩图片，使用 sharp 在后台进行压缩。
   * @param buffer - 原始图片二进制数据
   * @param mimeType - 图片 MIME 类型
   * @returns 压缩结果（压缩后 ArrayBuffer + 是否实际压缩）
   */
  compressImage: (buffer: ArrayBuffer, mimeType: string) => Promise<ElectronImageCompressResult>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
