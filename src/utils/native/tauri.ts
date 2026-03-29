/* eslint-disable class-methods-use-this */
import type { Native, OpenFileOptions, SaveFileOptions } from './types';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open, save } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';

export class TauriNative implements Native {
  async openFile(options?: OpenFileOptions) {
    const filters = options?.filters || [{ name: 'Markdown', extensions: ['md', 'markdown'] }];
    const path = await open({ filters });

    if (!path) return { id: '', path: null, content: '', name: '', ext: '' };

    const content = await readTextFile(path);

    const fileName = path.split(/[/\\]/).pop() ?? '';
    const [, name, ext] = /^(.+?)(?:\.([^.]+))?$/.exec(fileName) || ['', '', ''];

    return { id: '', path, content, name, ext };
  }

  async saveFile(content: string, path?: string, options?: SaveFileOptions) {
    if (path) {
      await writeTextFile(path, content);
      return path;
    }

    const filters = options?.filters || [{ name: 'Markdown', extensions: ['md'] }];
    const defaultPath = options?.defaultPath || 'untitled.md';
    const file = await save({ filters, defaultPath });

    if (file) {
      await writeTextFile(file, content);
      return file;
    }

    return null;
  }

  async writeFile(path: string, content: string): Promise<void> {
    await writeTextFile(path, content);
  }

  async setWindowTitle(title: string) {
    const appWindow = getCurrentWindow();

    await appWindow.setTitle(title);
  }
}
