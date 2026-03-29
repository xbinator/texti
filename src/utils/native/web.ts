/* eslint-disable class-methods-use-this */
import type { Native, OpenFileOptions, SaveFileOptions, File } from './types';

export class WebNative implements Native {
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

  async setWindowTitle(title: string): Promise<void> {
    document.title = title;
  }
}
