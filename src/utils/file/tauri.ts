/* eslint-disable class-methods-use-this */
import type { FileAPI, OpenFileOptions, SaveFileOptions } from './types';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open, save } from '@tauri-apps/plugin-dialog';
import { writeTextFile, readTextFile } from '@tauri-apps/plugin-fs';

export class TauriFileAPI implements FileAPI {
  async openFile(options?: OpenFileOptions) {
    const filters = options?.filters || [{ name: 'Markdown', extensions: ['md', 'markdown'] }];
    const file = await open({ filters });

    return file;
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

  async readFile(path: string): Promise<string> {
    return readTextFile(path);
  }

  async writeFile(path: string, content: string): Promise<void> {
    await writeTextFile(path, content);
  }

  async setWindowTitle(title: string) {
    const appWindow = getCurrentWindow();

    await appWindow.setTitle(title);
  }
}
