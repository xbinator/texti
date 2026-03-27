export interface FileAPI {
  openFile(options?: { filters?: Array<{ name: string; extensions: string[] }> }): Promise<string | null>;
  saveFile(content: string, path?: string, options?: { filters?: Array<{ name: string; extensions: string[] }>; defaultPath?: string }): Promise<string | null>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  setWindowTitle(title: string): Promise<void>;
}
