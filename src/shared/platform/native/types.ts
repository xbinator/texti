import type { ElectronDialogFilter, ElectronOpenFileOptions, ElectronSaveFileOptions } from 'types/electron-api';

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

  watchFile(path: string): Promise<void>;

  unwatchFile(): Promise<void>;

  onFileChanged(callback: (data: FileChangeEvent) => void): () => void;

  setWindowTitle(title: string): Promise<void>;

  openExternal(url: string): Promise<void>;

  onMenuAction?(callback: (action: string) => void): () => void;

  updateMenuItem?(id: string, properties: { checked?: boolean }): void;
}
