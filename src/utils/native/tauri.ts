/* eslint-disable class-methods-use-this */
import type { Native, OpenFileOptions, SaveFileOptions, AutoSaveResult } from './types';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open, save } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';

export class TauriNative implements Native {
  async openFile(options?: OpenFileOptions) {
    const filters = options?.filters || [{ name: 'Markdown', extensions: ['md', 'markdown'] }];
    const path = await open({ filters });

    if (!path) return { path: null, content: '', name: '', ext: '' };

    const content = await readTextFile(path);

    const fileName = path.split(/[/\\]/).pop() ?? '';
    const [, name, ext] = /^(.+?)(?:\.([^.]+))?$/.exec(fileName) || ['', '', ''];

    return { path, content, name, ext };
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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async autoSave(path: string, content: string, _name: string, _ext: string): Promise<AutoSaveResult> {
    try {
      await writeTextFile(path, content);
      return { success: true, path };
    } catch (error) {
      return {
        success: false,
        path,
        error: error instanceof Error ? error.message : 'Auto save failed'
      };
    }
  }

  async setWindowTitle(title: string) {
    console.log('🚀 ~ TauriNative ~ setWindowTitle ~ title:', title);
    const appWindow = getCurrentWindow();

    await appWindow.setTitle(title);
  }
}
