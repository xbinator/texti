/* eslint-disable class-methods-use-this */
import type { Native, OpenFileOptions, SaveFileOptions, FileChangeEvent, ReadFileResult } from './types';
import { getElectronAPI } from '../electron-api';

export class ElectronNative implements Native {
  async readFile(filePath: string): Promise<ReadFileResult> {
    const result = await getElectronAPI().readFile(filePath);
    return { content: result.content, name: result.fileName, ext: result.ext };
  }

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

  async renameFile(oldPath: string, newPath: string): Promise<void> {
    await getElectronAPI().renameFile(oldPath, newPath);
  }

  async watchFile(filePath: string): Promise<void> {
    await getElectronAPI().watchFile(filePath);
  }

  async unwatchFile(): Promise<void> {
    await getElectronAPI().unwatchFile();
  }

  onFileChanged(callback: (data: FileChangeEvent) => void): () => void {
    return getElectronAPI().onFileChanged(callback);
  }

  async setWindowTitle(title: string): Promise<void> {
    await getElectronAPI().setWindowTitle(title);
  }

  async openExternal(url: string): Promise<void> {
    await getElectronAPI().openExternal(url);
  }

  updateMenuItem(id: string, properties: { checked?: boolean }): void {
    getElectronAPI().updateMenuItem(id, properties);
  }

  onMenuAction(callback: (action: string) => void): () => void {
    return getElectronAPI().onMenuAction(callback);
  }
}
