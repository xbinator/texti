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

export interface FileChangeEvent {
  type: 'change' | 'unlink';
  filePath: string;
  content?: string;
}

export interface Native {
  readFile(path: string): Promise<ReadFileResult>;

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
