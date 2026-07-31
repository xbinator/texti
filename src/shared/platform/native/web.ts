/* eslint-disable class-methods-use-this */
import type {
  FilePathStatus,
  OpenFileOptions,
  SaveFileOptions,
  File,
  ReadWorkspaceFileOptions,
  ReadWorkspaceFileResult,
  ReadWorkspaceDirectoryOptions,
  ReadWorkspaceDirectoryResult
} from './types';
import type { WebViewProtocolScreenshotRequest } from 'types/webview';
import { OPEN_FILE_FILTER } from '@/constants/extensions';

export class WebNative {
  /**
   * Web 平台无法读取浏览器 File 对象的本地磁盘路径。
   * @returns 固定返回 null
   */
  getPathForFile(): string | null {
    return null;
  }

  async getPathStatus(): Promise<FilePathStatus> {
    return {
      exists: false,
      isFile: false,
      isDirectory: false
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async readWorkspaceFile(_options: ReadWorkspaceFileOptions): Promise<ReadWorkspaceFileResult> {
    const error = new Error('Web platform does not support reading files by path') as Error & { code: 'UNSUPPORTED_PROVIDER' };
    error.code = 'UNSUPPORTED_PROVIDER';
    throw error;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async readWorkspaceDirectory(_options: ReadWorkspaceDirectoryOptions): Promise<ReadWorkspaceDirectoryResult> {
    const error = new Error('Web platform does not support reading directories by path') as Error & { code: 'UNSUPPORTED_PROVIDER' };
    error.code = 'UNSUPPORTED_PROVIDER';
    throw error;
  }

  /**
   * Web 平台不能访问用户目录，固定返回空选择结果。
   * @returns 固定返回 null
   */
  async selectDirectory(): Promise<string | null> {
    return null;
  }

  async openFile(options?: OpenFileOptions) {
    return new Promise<File>((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      const filters = options?.filters || [OPEN_FILE_FILTER];
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

  async saveBinaryFile(content: ArrayBuffer, path?: string, options?: SaveFileOptions): Promise<string | null> {
    const filename = path || options?.defaultPath || 'untitled.bin';
    const blob = new Blob([content], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);

    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();

    URL.revokeObjectURL(url);
    return filename;
  }

  async copyImageToClipboard(content: ArrayBuffer): Promise<void> {
    if (typeof ClipboardItem === 'undefined' || typeof navigator.clipboard?.write !== 'function') {
      throw new Error('当前环境暂不支持复制图片到剪贴板');
    }

    const blob = new Blob([content], { type: 'image/png' });
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  }

  /**
   * Web 平台没有 Electron WebContents，返回 null 让业务层走原有截图兜底。
   * @param _request - 协议截图请求
   * @returns 固定返回 null
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async captureWebviewScreenshot(_request: WebViewProtocolScreenshotRequest): Promise<ArrayBuffer | null> {
    return null;
  }
}
