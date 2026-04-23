/* eslint-disable class-methods-use-this */
import type {
  Native,
  OpenFileOptions,
  SaveFileOptions,
  File,
  FileChangeEvent,
  ReadFileResult,
  ReadWorkspaceFileOptions,
  ReadWorkspaceFileResult
} from './types';
import type { PlatformRecentFile } from 'types/electron-api';

export class WebNative implements Native {
  async readFile(): Promise<ReadFileResult> {
    throw new Error('Web platform does not support reading files by path');
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async readWorkspaceFile(_options: ReadWorkspaceFileOptions): Promise<ReadWorkspaceFileResult> {
    const error = new Error('Web platform does not support reading files by path') as Error & { code: 'UNSUPPORTED_PROVIDER' };
    error.code = 'UNSUPPORTED_PROVIDER';
    throw error;
  }

  async openFile(options?: OpenFileOptions) {
    return new Promise<File>((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      const filters = options?.filters || [{ name: 'Markdown', extensions: ['md', 'markdown'] }];
      input.accept = filters.map((filter) => filter.extensions.map((extension) => `.${extension}`).join(',')).join(',');
      input.onchange = async (event) => {
        const file = (event.target as HTMLInputElement).files?.[0];
        if (!file) {
          resolve({ path: null, content: '', name: '', ext: '' });
          return;
        }

        const content = await file.text();
        resolve({ path: file.name, content, name: file.name.split('.').shift() || '', ext: file.name.split('.').pop() || '' });
      };
      input.click();
    });
  }

  async saveFile(content: string, path?: string, options?: SaveFileOptions): Promise<string | null> {
    const filename = path || options?.defaultPath || 'untitled.md';

    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);

    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();

    URL.revokeObjectURL(url);
    return filename;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async writeFile(_path: string, _content: string): Promise<void> {
    // this.syncCurrentFile(path, content);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async renameFile(_oldPath: string, _newPath: string): Promise<void> {
    throw new Error('Web platform does not support renaming files by path');
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async trashFile(_path: string): Promise<void> {
    throw new Error('Web platform does not support deleting files by path');
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async showItemInFolder(_path: string): Promise<void> {
    throw new Error('Web platform does not support revealing files by path');
  }

  async getRelativePath(filePath: string): Promise<string> {
    return filePath;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async watchFile(_path: string): Promise<void> {
    // web 端不支持文件监听
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async unwatchFile(_path: string): Promise<void> {
    // web 端不支持文件监听
  }

  async unwatchAll(): Promise<void> {
    // web 端不支持文件监听
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onFileChanged(_callback: (data: FileChangeEvent) => void): () => void {
    return () => {
      // web 端不需要清理
    };
  }

  async setWindowTitle(title: string): Promise<void> {
    document.title = title;
  }

  async openExternal(url: string): Promise<void> {
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onMenuAction(_callback: (action: string) => void): () => void {
    return () => {
      // web 端不需要清理
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async syncPlatformRecentFiles(_files: PlatformRecentFile[]): Promise<void> {
    // Linux / Web 环境不支持系统快捷入口时安全跳过。
  }
}
