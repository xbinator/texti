/* eslint-disable class-methods-use-this */
import type { Native, OpenFileOptions, SaveFileOptions } from './types';
import { getElectronAPI } from '../electron-api';

export class ElectronNative implements Native {
  async openFile(options?: OpenFileOptions) {
    const filters = options?.filters || [{ name: 'Markdown', extensions: ['md', 'markdown'] }];
    const result = await getElectronAPI().openFile({ filters });

    if (result.canceled || !result.filePath) {
      return { id: '', path: null, content: '', name: '', ext: '' };
    }

    const fileName = result.fileName || '';
    const [, name, ext] = /^(.+?)(?:\.([^.]+))?$/.exec(fileName) || ['', '', ''];

    return { id: '', path: result.filePath, content: result.content, name, ext };
  }

  async saveFile(content: string, path?: string, options?: SaveFileOptions) {
    const filters = options?.filters || [{ name: 'Markdown', extensions: ['md'] }];
    const defaultPath = options?.defaultPath || 'untitled.md';

    return getElectronAPI().saveFile(content, path, { filters, defaultPath });
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    await getElectronAPI().writeFile(filePath, content);
  }

  async setWindowTitle(title: string): Promise<void> {
    await getElectronAPI().setWindowTitle(title);
  }
}
