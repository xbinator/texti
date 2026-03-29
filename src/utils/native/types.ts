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
