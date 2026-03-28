/* eslint-disable class-methods-use-this */
import type { FileAPI, OpenFileOptions, SaveFileOptions } from './types';

export class WebFileAPI implements FileAPI {
  async openFile(options?: OpenFileOptions): Promise<string | null> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      const filters = options?.filters || [{ name: 'Markdown', extensions: ['md', 'markdown'] }];
      input.accept = filters.map((f) => f.extensions.map((e) => `.${e}`).join(',')).join(',');
      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
          const content = await file.text();
          sessionStorage.setItem('web-editor-path', file.name);
          sessionStorage.setItem('web-editor-content', content);
          resolve(file.name);
        } else {
          resolve(null);
        }
      };
      input.click();
    });
  }

  async saveFile(content: string, path?: string, options?: SaveFileOptions): Promise<string | null> {
    const filename = path || options?.defaultPath || sessionStorage.getItem('web-editor-path') || 'untitled.md';
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();

    URL.revokeObjectURL(url);
    return filename;
  }

  async readFile(): Promise<string> {
    const content = sessionStorage.getItem('web-editor-content') || '';

    return content;
  }

  async writeFile(path: string, content: string): Promise<void> {
    sessionStorage.setItem('web-editor-path', path);
    sessionStorage.setItem('web-editor-content', content);
  }

  async setWindowTitle(title: string): Promise<void> {
    document.title = title;
  }
}
