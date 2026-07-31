import type {
  ElectronDialogFilter,
  ElectronExportPdfOptions,
  ElectronFilePathStatus,
  ElectronOpenFileOptions,
  ElectronSaveFileOptions,
  ElectronShellCommandOutputChunk,
  ElectronShellCommandRunRequest,
  ElectronShellCommandRunResult,
  ElectronShellAutoDefaultCapability,
  ElectronShellRunEventEnvelope,
  ElectronShellCommandSafetyReport,
  ElectronShellCommandSafetyRequest,
  RecentFileShortcutInput
} from 'types/electron-api';
import type { WebViewProtocolScreenshotRequest } from 'types/webview';

export type FileFilter = ElectronDialogFilter;

export type OpenFileOptions = ElectronOpenFileOptions;

export type SaveFileOptions = ElectronSaveFileOptions;

/** PDF 导出参数。 */
export type ExportPdfOptions = ElectronExportPdfOptions;

export interface File {
  path: string | null;
  content: string;
  name: string;
  ext: string;
}

/**
 * 被编辑器追踪中的文件状态：在原生 File 基础上补充唯一 ID。
 */
export interface FileState extends File {
  /** 文件唯一 ID */
  id: string;
}

export interface ReadFileResult {
  content: string;
  name: string;
  ext: string;
}

export type FilePathStatus = ElectronFilePathStatus;

/**
 * 工作区文件读取参数。
 */
export interface ReadWorkspaceFileOptions {
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
 * 工作区文件读取结果。
 */
export interface ReadWorkspaceFileResult {
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
 * 工作区目录读取参数。
 */
export interface ReadWorkspaceDirectoryOptions {
  /** 目录路径，支持相对工作区路径或绝对路径 */
  directoryPath: string;
  /** 工作区根目录，缺省时仅允许读取绝对路径 */
  workspaceRoot?: string;
}

/**
 * 工作区目录子项。
 */
export interface ReadWorkspaceDirectoryEntry {
  /** 子项名称。 */
  name: string;
  /** 子项绝对路径。 */
  path: string;
  /** 子项类型。 */
  type: 'file' | 'directory';
}

/**
 * 工作区目录读取结果。
 */
export interface ReadWorkspaceDirectoryResult {
  /** 规范化后的真实目录路径 */
  path: string;
  /** 当前目录下的直接子项 */
  entries: ReadWorkspaceDirectoryEntry[];
}

export interface FileChangeEvent {
  type: 'change' | 'unlink' | 'add';
  filePath: string;
  content?: string;
}

/**
 * Tibis 工作区根目录信息。
 */
export interface TibisWorkspaceRoot {
  /** 绝对根目录路径，作为安全边界。 */
  rootPath: string;
  /** 本次请求是否创建了目录。 */
  created: boolean;
}

export interface Native {
  /** 在 Electron 主进程获取目标目录跨窗口安装锁。 */
  acquireDirectoryInstallLock(path: string): Promise<string>;

  /** 确保目录存在。 */
  ensureDir(path: string): Promise<void>;

  readFile(path: string): Promise<ReadFileResult>;

  /** 获取拖拽文件对应的本地磁盘路径，Web 平台不可用时返回 null。 */
  getPathForFile(file: globalThis.File): string | null;

  getPathStatus(path: string): Promise<FilePathStatus>;

  readWorkspaceFile(options: ReadWorkspaceFileOptions): Promise<ReadWorkspaceFileResult>;

  readWorkspaceDirectory(options: ReadWorkspaceDirectoryOptions): Promise<ReadWorkspaceDirectoryResult>;

  /** 打开原生目录选择框；取消或平台不支持时返回 null。 */
  selectDirectory(): Promise<string | null>;

  openFile(options?: OpenFileOptions): Promise<File>;

  saveFile(content: string, path?: string, options?: SaveFileOptions): Promise<string | null>;

  saveBinaryFile(content: ArrayBuffer, path?: string, options?: SaveFileOptions): Promise<string | null>;

  /** 将 PNG 图片二进制内容复制到系统剪贴板。 */
  copyImageToClipboard(content: ArrayBuffer): Promise<void>;

  /** 通过 Electron 主进程协议截图 WebView 页面区域，不支持时返回 null。 */
  captureWebviewScreenshot(request: WebViewProtocolScreenshotRequest): Promise<ArrayBuffer | null>;

  exportPdf(options: ExportPdfOptions): Promise<string | null>;

  writeFile(path: string, content: string): Promise<void>;

  /** 仅在目标路径不存在时原子创建文本文件。 */
  createFile(path: string, content: string): Promise<void>;

  renameFile(oldPath: string, newPath: string): Promise<void>;

  /** 释放目标目录跨窗口安装锁。 */
  releaseDirectoryInstallLock(token: string): Promise<void>;

  trashFile(path: string): Promise<void>;

  showItemInFolder(path: string): Promise<void>;

  getRelativePath(path: string): Promise<string>;

  getCwd(): Promise<string>;

  getHomeDir(): Promise<string>;

  watchFile(path: string): Promise<void>;

  unwatchFile(path: string): Promise<void>;

  unwatchAll(): Promise<void>;

  onFileChanged(callback: (data: FileChangeEvent) => void): () => void;

  watchDirectory(dirPath: string, globPattern?: string): Promise<void>;

  unwatchDirectory(dirPath: string, globPattern?: string): Promise<void>;

  onSkillChanged(callback: (data: { type: string; filePath: string; content?: string }) => void): () => void;

  setWindowTitle(title: string): Promise<void>;

  openExternal(url: string): Promise<void>;

  /** 当前平台是否支持 Shell 命令执行。Web 平台返回 false。 */
  supportsShellCommand(): boolean;

  /** 获取 Tibis 工作区根目录，不可用时返回 null。 */
  getTibisWorkspaceRoot(): Promise<TibisWorkspaceRoot | null>;

  analyzeShellCommand(request: ElectronShellCommandSafetyRequest): Promise<ElectronShellCommandSafetyReport>;

  /** 同步读取当前构建的 Shell auto-default capability。 */
  getShellAutoDefaultCapability(): ElectronShellAutoDefaultCapability;

  runShellCommand(request: ElectronShellCommandRunRequest): Promise<ElectronShellCommandRunResult>;

  cancelShellCommand(commandId: string): Promise<boolean>;

  onShellCommandOutput(callback: (chunk: ElectronShellCommandOutputChunk) => void): () => void;

  onShellRunEvent(callback: (event: ElectronShellRunEventEnvelope) => void): () => void;

  onMenuAction?(callback: (action: string) => void): () => void;

  updateMenuItem?(id: string, properties: { checked?: boolean }): void;

  syncRecentFiles?(files: RecentFileShortcutInput[]): Promise<void>;
}
