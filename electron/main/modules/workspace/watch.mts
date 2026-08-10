/**
 * @file watch.mts
 * @description 提供主进程文件变化监听服务，支持文件级和目录级监听，并向所有窗口广播事件。
 */

import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import chokidar, { type ChokidarOptions } from 'chokidar';
import { BrowserWindow } from 'electron';

/**
 * unlink → add 防抖窗口时长（毫秒）。
 * Git 回退等操作会快速触发 unlink + add，在此窗口内合并为 change 事件。
 */
const RECREATE_WINDOW_MS = 300;

/**
 * chokidar 文件监听器实例类型。
 */
type FileWatcher = ReturnType<typeof chokidar.watch>;

/**
 * 统一监听路径分隔符，避免 Windows 反斜杠影响匹配。
 * @param filePath - 原始文件路径
 * @returns 使用 / 分隔的路径
 */
function normalizeWatchPath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

/**
 * 获取跨平台文件名。
 * @param filePath - 原始文件路径
 * @returns 文件名
 */
function getWatchPathBasename(filePath: string): string {
  const normalizedPath = normalizeWatchPath(filePath);
  const index = normalizedPath.lastIndexOf('/');
  return index === -1 ? normalizedPath : normalizedPath.slice(index + 1);
}

/**
 * 获取跨平台文件扩展名。
 * @param filePath - 原始文件路径
 * @returns 小写扩展名，包含前导点
 */
function getWatchPathExtname(filePath: string): string {
  const basename = getWatchPathBasename(filePath);
  const index = basename.lastIndexOf('.');
  return index > 0 ? basename.slice(index).toLowerCase() : '';
}

/**
 * 判断路径是否位于安装临时目录或备份目录中。
 * @param filePath - 原始文件路径
 * @returns 位于安装中间目录时返回 true
 */
function isInstallerScratchPath(filePath: string): boolean {
  return normalizeWatchPath(filePath)
    .split('/')
    .some((segment: string): boolean => segment.startsWith('.tmp-') || segment.startsWith('.bak-'));
}

/**
 * 判断路径是否包含被监听根目录下的隐藏路径段。
 * @param filePath - 原始文件路径
 * @param rootDirPath - 被监听根目录路径
 * @returns 包含隐藏路径段时返回 true
 */
function hasHiddenSegmentUnderWatchRoot(filePath: string, rootDirPath: string | undefined): boolean {
  if (!rootDirPath) return false;

  const normalizedPath = normalizeWatchPath(filePath);
  const normalizedRoot = normalizeWatchPath(rootDirPath).replace(/\/+$/u, '');
  if (normalizedPath === normalizedRoot) {
    return false;
  }
  const relativePath = normalizedPath.startsWith(`${normalizedRoot}/`) ? normalizedPath.slice(normalizedRoot.length + 1) : normalizedPath;

  return relativePath.split('/').some((segment: string): boolean => segment.startsWith('.'));
}

/**
 * 判断路径是否为被监听根目录下的直接子项。
 * @param filePath - 原始文件路径
 * @param rootDirPath - 被监听根目录路径
 * @returns 是直接子项时返回 true
 */
function isDirectWatchChild(filePath: string, rootDirPath: string | undefined): boolean {
  const basename = getWatchPathBasename(filePath);
  if (!rootDirPath) {
    return basename.length > 0;
  }

  const normalizedPath = normalizeWatchPath(filePath);
  const normalizedRoot = normalizeWatchPath(rootDirPath).replace(/\/+$/u, '');
  if (!normalizedPath.startsWith(`${normalizedRoot}/`)) {
    return false;
  }

  const relativePath = normalizedPath.slice(normalizedRoot.length + 1);
  return relativePath.length > 0 && !relativePath.includes('/');
}

/**
 * 创建资源根目录 watcher 配置。
 * @returns Chokidar 目录监听配置
 */
export function createDirectoryWatchOptions(): ChokidarOptions {
  return {
    persistent: true,
    ignoreInitial: true,
    depth: 0,
    ignored: ['**/node_modules/**', '**/.git/**', '**/.tmp-*/**', '**/.bak-*/**'],
    awaitWriteFinish: {
      stabilityThreshold: 100,
      pollInterval: 100
    }
  };
}

/**
 * 判断目录监听事件是否匹配请求的目录监听规则。
 * @param filePath - 变更文件路径
 * @param globPattern - 调用方传入的匹配模式；为空时匹配目录内普通文件
 * @param rootDirPath - 被监听根目录路径
 * @returns 是否应该广播目录变更事件
 */
export function isDirectoryWatchMatch(filePath: string, globPattern?: string, rootDirPath?: string): boolean {
  if (isInstallerScratchPath(filePath) || hasHiddenSegmentUnderWatchRoot(filePath, rootDirPath)) {
    return false;
  }

  if (!globPattern) {
    return isDirectWatchChild(filePath, rootDirPath);
  }

  if (globPattern.endsWith('SKILL.md')) {
    return getWatchPathBasename(filePath) === 'SKILL.md';
  }

  if (globPattern.endsWith('*.md')) {
    return getWatchPathExtname(filePath) === '.md';
  }

  return getWatchPathBasename(filePath) === getWatchPathBasename(globPattern);
}

/**
 * 主进程文件监听服务，支持多个路径同时监听。
 */
export class FileWatchService {
  /** 按文件路径保存已创建的 watcher。 */
  private readonly watchers = new Map<string, FileWatcher>();

  /** 按目录路径保存已创建的目录 watcher。 */
  private readonly directoryWatchers = new Map<string, FileWatcher>();

  /** 按文件路径保存当前 owner 集合。 */
  private readonly fileOwners = new Map<string, Set<number>>();

  /** 按目录 watcher key 保存当前 owner 集合。 */
  private readonly directoryOwners = new Map<string, Set<number>>();

  /** unlink 防抖定时器，用于合并 git 回退等场景的 unlink → add 序列。 */
  private readonly pendingUnlinks = new Map<string, NodeJS.Timeout>();

  /**
   * 向所有窗口广播文件变化事件。
   * @param type - 事件类型
   * @param filePath - 文件路径
   * @param content - 文件内容（仅 change 事件携带）
   */
  private notifyWindows(type: 'change' | 'unlink' | 'add', filePath: string, content?: string): void {
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send('file:changed', { type, filePath, content });
    });
  }

  /**
   * 注册指定路径的文件监听；重复注册同一路径时保持幂等。
   * @param filePath - 需要监听的文件路径
   * @param ownerId - 调用方 WebContents ID
   */
  async watch(filePath: string, ownerId: number): Promise<void> {
    const owners = this.fileOwners.get(filePath) ?? new Set<number>();
    owners.add(ownerId);
    this.fileOwners.set(filePath, owners);
    if (this.watchers.has(filePath)) return;

    const watcher = chokidar.watch(filePath, {
      persistent: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 100
      }
    });

    watcher.on('change', async (changedPath: string) => {
      try {
        const content = await fsPromises.readFile(changedPath, 'utf-8');
        this.notifyWindows('change', changedPath, content);
      } catch (error: unknown) {
        console.error('FileWatchService read error:', error);
      }
    });

    watcher.on('unlink', (removedPath: string) => {
      const previousTimer = this.pendingUnlinks.get(removedPath);
      if (previousTimer) clearTimeout(previousTimer);
      const timer = setTimeout(() => {
        this.pendingUnlinks.delete(removedPath);

        if (!fs.existsSync(removedPath)) {
          this.notifyWindows('unlink', removedPath);
        }
      }, RECREATE_WINDOW_MS);

      this.pendingUnlinks.set(removedPath, timer);
    });

    watcher.on('add', async (addedPath: string) => {
      const timer = this.pendingUnlinks.get(addedPath);

      if (timer) {
        clearTimeout(timer);
        this.pendingUnlinks.delete(addedPath);

        try {
          const content = await fsPromises.readFile(addedPath, 'utf-8');
          this.notifyWindows('change', addedPath, content);
        } catch (error: unknown) {
          console.error('FileWatchService read error on add:', error);
        }
        return;
      }

      this.notifyWindows('add', addedPath);
    });

    this.watchers.set(filePath, watcher);
  }

  /**
   * 停止监听指定路径。
   * @param filePath - 需要停止监听的文件路径
   * @param ownerId - 调用方 WebContents ID
   */
  async unwatch(filePath: string, ownerId: number): Promise<void> {
    const owners = this.fileOwners.get(filePath);
    owners?.delete(ownerId);
    if (owners && owners.size > 0) return;
    this.fileOwners.delete(filePath);

    const watcher = this.watchers.get(filePath);
    if (!watcher) return;

    this.watchers.delete(filePath);
    const pendingTimer = this.pendingUnlinks.get(filePath);
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      this.pendingUnlinks.delete(filePath);
    }
    await watcher.close();
  }

  /**
   * 注册指定目录的监听，文件变化时广播 skill:changed 事件。
   * @param dirPath - 需要监听的目录路径
   * @param globPattern - 可选文件匹配模式；为空时匹配目录内普通文件
   * @param ownerId - 调用方 WebContents ID
   */
  async watchDirectory(dirPath: string, globPattern: string | undefined, ownerId: number): Promise<void> {
    const watcherKey = `${dirPath}:${globPattern ?? ''}`;
    const owners = this.directoryOwners.get(watcherKey) ?? new Set<number>();
    owners.add(ownerId);
    this.directoryOwners.set(watcherKey, owners);
    if (this.directoryWatchers.has(watcherKey)) return;

    const watcher = chokidar.watch(dirPath, createDirectoryWatchOptions());

    watcher.on('change', async (changedPath: string) => {
      if (!isDirectoryWatchMatch(changedPath, globPattern, dirPath)) return;
      try {
        const content = await fsPromises.readFile(changedPath, 'utf-8');
        this.notifyWindowsSkill('change', changedPath, content);
      } catch (error: unknown) {
        console.error('DirectoryWatchService read error:', error);
      }
    });

    watcher.on('add', async (addedPath: string) => {
      if (!isDirectoryWatchMatch(addedPath, globPattern, dirPath)) return;
      try {
        const content = await fsPromises.readFile(addedPath, 'utf-8');
        this.notifyWindowsSkill('add', addedPath, content);
      } catch (error: unknown) {
        console.error('DirectoryWatchService read error on add:', error);
      }
    });

    watcher.on('unlink', (removedPath: string) => {
      if (!isDirectoryWatchMatch(removedPath, globPattern, dirPath)) return;
      this.notifyWindowsSkill('unlink', removedPath);
    });

    watcher.on('addDir', (addedDir: string) => {
      if (!isDirectoryWatchMatch(addedDir, globPattern, dirPath)) return;
      this.notifyWindowsSkill('addDir', addedDir);
    });

    watcher.on('unlinkDir', (removedDir: string) => {
      if (!isDirectoryWatchMatch(removedDir, globPattern, dirPath)) return;
      this.notifyWindowsSkill('unlinkDir', removedDir);
    });

    this.directoryWatchers.set(watcherKey, watcher);
  }

  /**
   * 停止监听指定目录。
   * @param dirPath - 需要停止监听的目录路径
   * @param globPattern - 可选文件匹配模式；为空时匹配目录内普通文件
   * @param ownerId - 调用方 WebContents ID
   */
  async unwatchDirectory(dirPath: string, globPattern: string | undefined, ownerId: number): Promise<void> {
    const watcherKey = `${dirPath}:${globPattern ?? ''}`;
    const owners = this.directoryOwners.get(watcherKey);
    owners?.delete(ownerId);
    if (owners && owners.size > 0) return;
    this.directoryOwners.delete(watcherKey);

    const watcher = this.directoryWatchers.get(watcherKey);
    if (!watcher) return;

    this.directoryWatchers.delete(watcherKey);
    await watcher.close();
  }

  /**
   * 向所有窗口广播资源目录变化事件。
   * @param type - 事件类型
   * @param filePath - 文件路径
   * @param content - 文件内容（仅 change/add 事件携带）
   */
  private notifyWindowsSkill(type: 'change' | 'add' | 'unlink' | 'addDir' | 'unlinkDir', filePath: string, content?: string): void {
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send('skill:changed', { type, filePath, content });
    });
  }

  /**
   * 释放指定 WebContents 持有的全部文件与目录 watcher。
   * @param ownerId - 已销毁 WebContents ID
   */
  async releaseOwner(ownerId: number): Promise<void> {
    const filePaths = [...this.fileOwners.entries()]
      .filter(([, owners]: [string, Set<number>]): boolean => owners.has(ownerId))
      .map(([filePath]: [string, Set<number>]): string => filePath);
    const directoryEntries = [...this.directoryOwners.entries()]
      .filter(([, owners]: [string, Set<number>]): boolean => owners.has(ownerId))
      .map(([watcherKey]: [string, Set<number>]): [string, string | undefined] => {
        const separatorIndex = watcherKey.lastIndexOf(':');
        const globPattern = watcherKey.slice(separatorIndex + 1) || undefined;
        return [watcherKey.slice(0, separatorIndex), globPattern];
      });

    await Promise.all([
      ...filePaths.map((filePath: string): Promise<void> => this.unwatch(filePath, ownerId)),
      ...directoryEntries.map(([dirPath, globPattern]: [string, string | undefined]): Promise<void> => this.unwatchDirectory(dirPath, globPattern, ownerId))
    ]);
  }

  /**
   * 停止所有文件监听，用于应用退出或 watcher store dispose。
   */
  async unwatchAll(ownerId?: number): Promise<void> {
    if (ownerId !== undefined) {
      await this.releaseOwner(ownerId);
      return;
    }

    const fileWatchers = Array.from(this.watchers.values());
    const dirWatchers = Array.from(this.directoryWatchers.values());
    this.watchers.clear();
    this.directoryWatchers.clear();
    this.fileOwners.clear();
    this.directoryOwners.clear();
    this.pendingUnlinks.forEach((timer: NodeJS.Timeout): void => clearTimeout(timer));
    this.pendingUnlinks.clear();
    await Promise.all([...fileWatchers, ...dirWatchers].map((w) => w.close()));
  }
}

export const fileWatchService = new FileWatchService();
