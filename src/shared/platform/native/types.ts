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

export interface Native {
  openFile(options?: OpenFileOptions): Promise<File>;

  saveFile(content: string, path?: string, options?: SaveFileOptions): Promise<string | null>;

  writeFile(path: string, content: string): Promise<void>;

  setWindowTitle(title: string): Promise<void>;
}
