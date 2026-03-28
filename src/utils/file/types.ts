export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface OpenFileOptions {
  filters?: FileFilter[];
}

export interface SaveFileOptions {
  filters?: FileFilter[];
  defaultPath?: string;
}

export interface FileAPI {
  openFile(options?: OpenFileOptions): Promise<string | null>;
  saveFile(content: string, path?: string, options?: SaveFileOptions): Promise<string | null>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  setWindowTitle(title: string): Promise<void>;
}
