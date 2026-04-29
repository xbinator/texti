/**
 * @file files.ts
 * @description 管理最近文件列表，并提供统一的打开文件 usecase。
 */

import { defineStore } from 'pinia';
import { customAlphabet } from 'nanoid';
import { native } from '@/shared/platform';
import type { StoredFile } from '@/shared/storage';
import { recentFilesStorage } from '@/shared/storage';

/**
 * files store 的状态定义。
 */
export interface FilesState {
  /** 最近文件列表，始终来自 storage 派生排序结果。 */
  recentFiles: StoredFile[] | null;
}

/**
 * 打开文件来源标记。
 */
export type OpenSource = 'welcome' | 'search' | 'menu' | 'platform-recent' | 'native-open' | 'drop' | 'new';

const createFileId = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz_', 8);
const inflightPaths = new Set<string>();
let writeQueue: Promise<void> = Promise.resolve();

/**
 * 串行化 store 写入动作，避免多个入口并发覆盖 recent 状态。
 * @param fn - 具体写入逻辑
 * @returns 写入结果
 */
function enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(fn);
  writeQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

export const useFilesStore = defineStore('files', {
  state: (): FilesState => ({
    recentFiles: null
  }),

  actions: {
    /**
     * 从存储层刷新最近文件列表。
     * @returns 派生排序后的最近文件列表
     */
    async refreshRecentFiles(): Promise<StoredFile[]> {
      const files = await recentFilesStorage.getAllRecentFiles();
      this.recentFiles = files;
      return files;
    },

    /**
     * 确保 store 已经加载最近文件列表。
     */
    async ensureLoaded(): Promise<void> {
      if (this.recentFiles !== null) return;

      await this.refreshRecentFiles();
      await this.syncPlatformRecentFiles();
    },

    /**
     * 按 ID 获取最近文件记录。
     * @param id - 文件 ID
     * @returns 命中的文件记录
     */
    async getFileById(id: string): Promise<StoredFile | undefined> {
      await this.ensureLoaded();

      return this.recentFiles?.find((file) => file.id === id);
    },

    /**
     * 按路径获取最近文件记录。
     * @param path - 磁盘路径
     * @returns 命中的文件记录
     */
    async getFileByPath(path: string): Promise<StoredFile | undefined> {
      await this.ensureLoaded();

      return this.recentFiles?.find((file) => file.path === path);
    },

    /**
     * 添加最近文件，并从 storage 刷新派生顺序。
     * @param file - 需要写入的文件记录
     * @returns 写入后的文件记录
     */
    async addFile(file: StoredFile): Promise<StoredFile> {
      await recentFilesStorage.addRecentFile(file);
      const files = await this.refreshRecentFiles();
      await this.syncPlatformRecentFiles();

      return files.find((item) => item.id === file.id) ?? file;
    },

    /**
     * 更新最近文件记录，并从 storage 刷新派生顺序。
     * @param id - 文件 ID
     * @param updates - 需要更新的字段
     * @returns 更新后的文件记录
     */
    async updateFile(id: string, updates: Partial<StoredFile>): Promise<StoredFile> {
      const nextFile = await recentFilesStorage.updateRecentFile(id, updates);
      await this.refreshRecentFiles();
      await this.syncPlatformRecentFiles();
      return nextFile;
    },

    /**
     * 打开已存在的最近文件，并刷新 openedAt 派生顺序。
     * @param id - 文件 ID
     * @param _source - 打开来源
     * @returns 被打开的文件记录
     */
    async openExistingFile(id: string, _source: OpenSource): Promise<StoredFile> {
      await this.ensureLoaded();
      await enqueueWrite(async () => {
        await recentFilesStorage.touchRecentFile(id);
      });

      const files = await this.refreshRecentFiles();
      await this.syncPlatformRecentFiles();

      const openedFile = files.find((file) => file.id === id);
      if (!openedFile) throw new Error('File not found');

      return openedFile;
    },

    /**
     * 按磁盘路径打开文件；若不存在于最近文件，则读取磁盘并创建记录。
     * @param path - 磁盘路径
     * @param source - 打开来源
     * @returns 被打开或创建的文件记录
     */
    async openOrCreateByPath(path: string, source: OpenSource): Promise<StoredFile | null> {
      if (inflightPaths.has(path)) return null;

      inflightPaths.add(path);

      try {
        await this.ensureLoaded();

        const existingFile = await this.getFileByPath(path);
        if (existingFile) {
          return this.openExistingFile(existingFile.id, source);
        }

        const file = await native.readFile(path);
        const now = Date.now();
        const createdFile: StoredFile = {
          id: createFileId(),
          path,
          content: file.content,
          savedContent: file.content,
          name: file.name,
          ext: file.ext,
          createdAt: now,
          openedAt: now,
          savedAt: now
        };

        await enqueueWrite(async () => {
          await recentFilesStorage.addRecentFile(createdFile);
        });

        const files = await this.refreshRecentFiles();
        await this.syncPlatformRecentFiles();

        return files.find((item) => item.id === createdFile.id) ?? createdFile;
      } finally {
        inflightPaths.delete(path);
      }
    },

    /**
     * 创建一个新文件记录并视为已打开。
     * @param file - 新文件记录
     * @param _source - 打开来源
     * @returns 创建后的文件记录
     */
    async createAndOpen(file: StoredFile, _source: OpenSource): Promise<StoredFile> {
      const now = Date.now();
      const createdFile: StoredFile = {
        ...file,
        createdAt: file.createdAt ?? now,
        openedAt: file.openedAt ?? now
      };

      await enqueueWrite(async () => {
        await recentFilesStorage.addRecentFile(createdFile);
      });

      const files = await this.refreshRecentFiles();
      await this.syncPlatformRecentFiles();

      return files.find((item) => item.id === createdFile.id) ?? createdFile;
    },

    /**
     * 删除一个或多个最近文件记录。
     * @param ids - 需要删除的文件 ID 列表
     */
    async removeFile(...ids: string[]): Promise<void> {
      await recentFilesStorage.removeRecentFile(...ids);
      await this.refreshRecentFiles();
      await this.syncPlatformRecentFiles();
    },

    /**
     * 清空最近文件列表。
     */
    async clearFiles(): Promise<void> {
      await recentFilesStorage.clearRecentFiles();
      this.recentFiles = [];
      await this.syncPlatformRecentFiles();
    },

    /**
     * 将最近文件摘要同步给主进程系统快捷入口，避免正文内容进入系统菜单模型。
     */
    async syncPlatformRecentFiles(): Promise<void> {
      if (!native.syncPlatformRecentFiles || this.recentFiles === null) return;

      await native.syncPlatformRecentFiles(
        this.recentFiles.map((file) => ({
          id: file.id,
          name: file.name,
          path: file.path
        }))
      );
    }
  }
});
