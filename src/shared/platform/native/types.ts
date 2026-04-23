import type { ElectronDialogFilter, ElectronOpenFileOptions, ElectronSaveFileOptions, PlatformRecentFile } from 'types/electron-api';

export type FileFilter = ElectronDialogFilter;

export type OpenFileOptions = ElectronOpenFileOptions;

export type SaveFileOptions = ElectronSaveFileOptions;

export interface File {
  path: string | null;
  content: string;
  name: string;
  ext: string;
}

export interface ReadFileResult {
  content: string;
  name: string;
  ext: string;
}

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

export interface FileChangeEvent {
  type: 'change' | 'unlink';
  filePath: string;
  content?: string;
}

export interface Native {
  readFile(path: string): Promise<ReadFileResult>;

  readWorkspaceFile(options: ReadWorkspaceFileOptions): Promise<ReadWorkspaceFileResult>;

  openFile(options?: OpenFileOptions): Promise<File>;

  saveFile(content: string, path?: string, options?: SaveFileOptions): Promise<string | null>;

  writeFile(path: string, content: string): Promise<void>;

  renameFile(oldPath: string, newPath: string): Promise<void>;

  trashFile(path: string): Promise<void>;

  showItemInFolder(path: string): Promise<void>;

  getRelativePath(path: string): Promise<string>;

  watchFile(path: string): Promise<void>;

  unwatchFile(path: string): Promise<void>;

  unwatchAll(): Promise<void>;

  onFileChanged(callback: (data: FileChangeEvent) => void): () => void;

  setWindowTitle(title: string): Promise<void>;

  openExternal(url: string): Promise<void>;

  onMenuAction?(callback: (action: string) => void): () => void;

  updateMenuItem?(id: string, properties: { checked?: boolean }): void;

  syncPlatformRecentFiles?(files: PlatformRecentFile[]): Promise<void>;
}
