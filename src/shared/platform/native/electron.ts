/* eslint-disable class-methods-use-this */
import type {
  Native,
  ExportPdfOptions,
  FilePathStatus,
  OpenFileOptions,
  SaveFileOptions,
  FileChangeEvent,
  ReadFileResult,
  ReadWorkspaceFileOptions,
  ReadWorkspaceFileResult,
  ReadWorkspaceDirectoryOptions,
  ReadWorkspaceDirectoryResult,
  TibisWorkspaceRoot
} from './types';
import type { RecentFileShortcutInput } from 'types/electron-api';
import type { WebViewProtocolScreenshotRequest } from 'types/webview';
import { OPEN_FILE_FILTER, SAVE_FILE_FILTER } from '@/constants/extensions';
import { getElectronAPI } from '../electron-api';

export class ElectronNative implements Native {
  /**
   * 获取跨窗口目录安装锁。
   * @param targetPath - 安装目标目录
   * @returns 锁令牌
   */
  async acquireDirectoryInstallLock(targetPath: string): Promise<string> {
    return getElectronAPI().acquireDirectoryInstallLock(targetPath);
  }

  /**
   * 确保目录存在。
   * @param dirPath - 目录路径
   */
  async ensureDir(dirPath: string): Promise<void> {
    await getElectronAPI().ensureDir(dirPath);
  }

  async readFile(filePath: string): Promise<ReadFileResult> {
    const result = await getElectronAPI().readFile(filePath);
    return { content: result.content, name: result.fileName, ext: result.ext };
  }

  /**
   * 通过 Electron webUtils 获取拖拽文件的本地磁盘路径。
   * @param file - 拖拽得到的浏览器 File 对象
   * @returns 本地磁盘路径；无法获取时返回 null
   */
  getPathForFile(file: globalThis.File): string | null {
    return getElectronAPI().getPathForFile(file) || null;
  }

  async getPathStatus(filePath: string): Promise<FilePathStatus> {
    const { getPathStatus } = getElectronAPI();

    if (!getPathStatus) {
      return {
        exists: false,
        isFile: false,
        isDirectory: false
      };
    }

    return getPathStatus(filePath);
  }

  async readWorkspaceFile(options: ReadWorkspaceFileOptions): Promise<ReadWorkspaceFileResult> {
    return getElectronAPI().readWorkspaceFile(options);
  }

  async readWorkspaceDirectory(options: ReadWorkspaceDirectoryOptions): Promise<ReadWorkspaceDirectoryResult> {
    return getElectronAPI().readWorkspaceDirectory(options);
  }

  /**
   * 打开原生目录选择框。
   * @returns 规范化后的目录路径；取消时返回 null
   */
  async selectDirectory(): Promise<string | null> {
    return getElectronAPI().openDirectory();
  }

  async openFile(options?: OpenFileOptions) {
    const filters = options?.filters || [OPEN_FILE_FILTER];
    const result = await getElectronAPI().openFile({ filters });

    if (result.canceled || !result.filePath) {
      return { id: '', path: null, content: '', name: '', ext: '' };
    }

    const fileName = result.fileName || '';
    const [, name, ext] = /^(.+?)(?:\.([^.]+))?$/.exec(fileName) || ['', '', ''];

    return { id: '', path: result.filePath, content: result.content, name, ext };
  }

  async saveFile(content: string, path?: string, options?: SaveFileOptions) {
    const filters = options?.filters || [SAVE_FILE_FILTER];
    const defaultPath = options?.defaultPath || 'untitled.md';

    return getElectronAPI().saveFile(content, path, { filters, defaultPath });
  }

  async saveBinaryFile(content: ArrayBuffer, path?: string, options?: SaveFileOptions): Promise<string | null> {
    const filters = options?.filters || [SAVE_FILE_FILTER];
    const defaultPath = options?.defaultPath || 'untitled.bin';

    return getElectronAPI().saveBinaryFile(content, path, { filters, defaultPath });
  }

  async copyImageToClipboard(content: ArrayBuffer): Promise<void> {
    await getElectronAPI().copyImageToClipboard(content);
  }

  async captureWebviewScreenshot(request: WebViewProtocolScreenshotRequest): Promise<ArrayBuffer | null> {
    return getElectronAPI().webview.captureProtocolScreenshot(request);
  }

  async exportPdf(options: ExportPdfOptions): Promise<string | null> {
    return getElectronAPI().exportPdf(options);
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    await getElectronAPI().writeFile(filePath, content);
  }

  /**
   * 仅在目标路径不存在时原子创建文本文件。
   * @param filePath - 目标文件路径
   * @param content - 文件文本内容
   */
  async createFile(filePath: string, content: string): Promise<void> {
    await getElectronAPI().createFile(filePath, content);
  }

  async renameFile(oldPath: string, newPath: string): Promise<void> {
    await getElectronAPI().renameFile(oldPath, newPath);
  }

  /**
   * 释放跨窗口目录安装锁。
   * @param token - 锁令牌
   */
  async releaseDirectoryInstallLock(token: string): Promise<void> {
    await getElectronAPI().releaseDirectoryInstallLock(token);
  }

  async trashFile(filePath: string): Promise<void> {
    await getElectronAPI().trashFile(filePath);
  }

  async showItemInFolder(filePath: string): Promise<void> {
    await getElectronAPI().showItemInFolder(filePath);
  }

  async getRelativePath(filePath: string): Promise<string> {
    return getElectronAPI().getRelativePath(filePath);
  }

  async getCwd(): Promise<string> {
    return getElectronAPI().getCwd();
  }

  async getHomeDir(): Promise<string> {
    return getElectronAPI().getHomeDir();
  }

  async watchFile(filePath: string): Promise<void> {
    await getElectronAPI().watchFile(filePath);
  }

  async unwatchFile(filePath: string): Promise<void> {
    await getElectronAPI().unwatchFile(filePath);
  }

  async unwatchAll(): Promise<void> {
    await getElectronAPI().unwatchAll();
  }

  onFileChanged(callback: (data: FileChangeEvent) => void): () => void {
    return getElectronAPI().onFileChanged(callback);
  }

  async watchDirectory(dirPath: string, globPattern?: string): Promise<void> {
    await getElectronAPI().watchDirectory(dirPath, globPattern);
  }

  async unwatchDirectory(dirPath: string, globPattern?: string): Promise<void> {
    await getElectronAPI().unwatchDirectory(dirPath, globPattern);
  }

  onSkillChanged(callback: (data: { type: string; filePath: string; content?: string }) => void): () => void {
    return getElectronAPI().onSkillChanged(callback);
  }

  async setWindowTitle(title: string): Promise<void> {
    await getElectronAPI().setWindowTitle(title);
  }

  async openExternal(url: string): Promise<void> {
    if (!url) return;

    await getElectronAPI().openExternal(url);
  }

  supportsShellCommand(): boolean {
    return true;
  }

  async getTibisWorkspaceRoot(): Promise<TibisWorkspaceRoot | null> {
    return getElectronAPI().getTibisWorkspaceRoot();
  }

  async analyzeShellCommand(request: Parameters<Native['analyzeShellCommand']>[0]): ReturnType<Native['analyzeShellCommand']> {
    return getElectronAPI().analyzeShellCommand(request);
  }

  /**
   * 同步读取当前 Electron 构建的 Shell auto-default capability。
   * @returns 版本化能力结果
   */
  getShellAutoDefaultCapability(): ReturnType<Native['getShellAutoDefaultCapability']> {
    return getElectronAPI().getShellAutoDefaultCapability();
  }

  async runShellCommand(request: Parameters<Native['runShellCommand']>[0]): ReturnType<Native['runShellCommand']> {
    return getElectronAPI().runShellCommand(request);
  }

  async cancelShellCommand(commandId: string): Promise<boolean> {
    return getElectronAPI().cancelShellCommand(commandId);
  }

  onShellCommandOutput(callback: Parameters<Native['onShellCommandOutput']>[0]): () => void {
    return getElectronAPI().onShellCommandOutput(callback);
  }

  /**
   * 监听 Shell PTY 有序运行事件。
   * @param callback - 运行事件回调
   * @returns 取消监听函数
   */
  onShellRunEvent(callback: Parameters<Native['onShellRunEvent']>[0]): () => void {
    return getElectronAPI().onShellRunEvent(callback);
  }

  updateMenuItem(id: string, properties: { checked?: boolean }): void {
    getElectronAPI().updateMenuItem(id, properties);
  }

  onMenuAction(callback: (action: string) => void): () => void {
    return getElectronAPI().onMenuAction(callback);
  }

  async syncRecentFiles(files: RecentFileShortcutInput[]): Promise<void> {
    await getElectronAPI().syncRecentFiles(files);
  }
}
