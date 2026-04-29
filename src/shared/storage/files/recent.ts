/**
 * @file recent.ts
 * @description 提供最近文件存储的读写、排序派生与时间字段归一化能力。
 */

import type { StoredFile } from './types';
import localforage from 'localforage';
import { getElectronAPI, hasElectronAPI } from '../../platform/electron-api';

localforage.config({ name: 'Tibis', storeName: 'files', description: 'Tibis 笔记应用文件存储' });

const RECENT_FILES_KEY = 'recent_files';
const MAX_RECENT_FILES = 100;

let electronLocalMigrationPromise: Promise<void> | null = null;
let writeQueue: Promise<void> = Promise.resolve();

/**
 * 将单个文件记录归一化到当前存储模型。
 * @param file - 原始文件记录
 * @returns 归一化后的文件记录
 */
function normalizeStoredFile(file: StoredFile): StoredFile {
  // 已保存内容已存在时，直接保留现有记录。
  if (file.savedContent !== undefined) return { ...file };

  // 未保存文件需要把当前内容视为初始基线，避免首次进入存储后丢失 baseline。
  if (file.path === null) return { ...file, savedContent: file.content };

  return { ...file };
}

/**
 * 批量归一化存储记录，并标记是否产生了需要回写的变化。
 * @param files - 原始文件数组
 * @returns 归一化结果和是否变更的标记
 */
function normalizeStoredFiles(files: StoredFile[]): { files: StoredFile[]; changed: boolean } {
  let changed = false;

  const normalizedFiles = files.map((file) => {
    const normalizedFile = normalizeStoredFile(file);

    if (normalizedFile.savedContent !== file.savedContent) {
      changed = true;
    }

    return normalizedFile;
  });

  return {
    files: normalizedFiles,
    changed
  };
}

/**
 * 将可选时间字段归一化为可排序数字。
 * @param value - 原始时间字段值
 * @returns 可用于排序的毫秒值，缺失时为 0
 */
function normalizeTime(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * 依据 openedAt、modifiedAt、createdAt 派生最近文件顺序。
 * @param files - 输入文件数组
 * @returns 按规则降序排列后的新数组
 */
function sortRecentFiles(files: StoredFile[]): StoredFile[] {
  return files
    .map((file, index) => ({
      file,
      index,
      openedAt: normalizeTime(file.openedAt),
      modifiedAt: normalizeTime(file.modifiedAt),
      createdAt: normalizeTime(file.createdAt)
    }))
    .sort((a, b) => {
      return b.openedAt - a.openedAt || b.modifiedAt - a.modifiedAt || b.createdAt - a.createdAt || a.index - b.index;
    })
    .map((item) => item.file);
}

/**
 * 从 Electron store 读取指定键值。
 * @param key - 存储键
 * @returns 读取到的值
 */
async function getElectronStoreValue<T>(key: string): Promise<T | null> {
  const value = await getElectronAPI().storeGet(key);
  return (value as T | null) ?? null;
}

/**
 * 将值写入 Electron store。
 * @param key - 存储键
 * @param value - 需要写入的值
 */
async function setElectronStoreValue(key: string, value: unknown): Promise<void> {
  await getElectronAPI().storeSet(key, value);
}

/**
 * 确保 Electron 端完成一次性本地存储迁移。
 */
async function ensureElectronLocalMigration(): Promise<void> {
  if (!hasElectronAPI()) return;

  electronLocalMigrationPromise ??= (async () => {
    const [storeFiles, localFiles] = await Promise.all([
      getElectronStoreValue<StoredFile[]>(RECENT_FILES_KEY),
      localforage.getItem<StoredFile[]>(RECENT_FILES_KEY)
    ]);

    if ((!storeFiles || storeFiles.length === 0) && localFiles?.length) {
      await setElectronStoreValue(RECENT_FILES_KEY, localFiles.slice(0, MAX_RECENT_FILES));
    }
  })();

  await electronLocalMigrationPromise;
}

/**
 * 读取原始最近文件数组，并执行必要的模型归一化。
 * @returns 归一化后的原始存储数组
 */
async function readRecentFiles(): Promise<StoredFile[]> {
  if (hasElectronAPI()) {
    await ensureElectronLocalMigration();
    const storedFiles = (await getElectronStoreValue<StoredFile[]>(RECENT_FILES_KEY)) || [];
    const { files, changed } = normalizeStoredFiles(storedFiles);

    if (changed) {
      await setElectronStoreValue(RECENT_FILES_KEY, files);
    }

    return files;
  }

  const storedFiles = (await localforage.getItem<StoredFile[]>(RECENT_FILES_KEY)) || [];
  const { files, changed } = normalizeStoredFiles(storedFiles);

  if (changed) {
    await localforage.setItem(RECENT_FILES_KEY, files);
  }

  return files;
}

/**
 * 将最近文件数组写回底层存储。
 * @param files - 需要持久化的文件数组
 */
async function writeRecentFiles(files: StoredFile[]): Promise<void> {
  const nextFiles = files.slice(0, MAX_RECENT_FILES);

  if (hasElectronAPI()) {
    await setElectronStoreValue(RECENT_FILES_KEY, nextFiles);
    return;
  }

  await localforage.setItem(RECENT_FILES_KEY, nextFiles);
}

/**
 * 串行化读改写过程，避免多个打开或保存操作互相覆盖。
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

export const recentFilesStorage = {
  /**
   * 添加或覆盖最近文件记录。
   * @param file - 需要写入的文件记录
   */
  async addRecentFile(file: StoredFile): Promise<void> {
    await enqueueWrite(async () => {
      const files = await readRecentFiles();
      const now = Date.now();
      const normalizedFile = normalizeStoredFile({
        ...file,
        createdAt: file.createdAt ?? now,
        openedAt: file.openedAt ?? now
      });

      const filtered = files.filter((item) => item.id !== normalizedFile.id);

      // 写入层仍把最近操作文件前置，以减少下次读取时的重排成本。
      filtered.unshift(normalizedFile);

      await writeRecentFiles(filtered);
    });
  },

  /**
   * 获取按最近打开时间派生排序后的文件列表。
   * @returns 排序后的最近文件数组
   */
  async getAllRecentFiles(): Promise<StoredFile[]> {
    const files = await readRecentFiles();
    return sortRecentFiles(files);
  },

  /**
   * 读取单个最近文件记录。
   * @param id - 文件 ID
   * @returns 命中的文件记录，不存在时返回 null
   */
  async getRecentFile(id: string): Promise<StoredFile | null> {
    const files = await this.getAllRecentFiles();
    return files.find((file) => file.id === id) || null;
  },

  /**
   * 更新指定文件的部分字段，并保护 openedAt 只被有效值覆盖。
   * @param id - 文件 ID
   * @param updates - 需要更新的字段
   * @returns 更新后的文件记录
   */
  async updateRecentFile(id: string, updates: Partial<StoredFile>): Promise<StoredFile> {
    return enqueueWrite(async () => {
      const files = await readRecentFiles();
      const index = files.findIndex((item) => item.id === id);

      if (index === -1) {
        throw new Error('File not found');
      }

      const openedAt =
        typeof updates.openedAt === 'number' && Number.isFinite(updates.openedAt) && updates.openedAt > 0 ? updates.openedAt : files[index].openedAt;

      const nextFile = normalizeStoredFile({
        ...files[index],
        ...updates,
        openedAt
      });

      files[index] = nextFile;
      await writeRecentFiles(files);

      return nextFile;
    });
  },

  /**
   * 更新指定文件的 openedAt，并把它前置到原始存储数组。
   * @param id - 文件 ID
   * @returns 更新后的文件记录
   */
  async touchRecentFile(id: string): Promise<StoredFile> {
    return enqueueWrite(async () => {
      const files = await readRecentFiles();
      const index = files.findIndex((item) => item.id === id);

      if (index === -1) {
        throw new Error('File not found');
      }

      const touchedFile = {
        ...files[index],
        openedAt: Date.now()
      };

      files[index] = touchedFile;

      // 显式打开后把该文件移到原始数组头部，后续读侧再统一执行派生排序。
      const [item] = files.splice(index, 1);
      files.unshift(item);

      await writeRecentFiles(files);
      return touchedFile;
    });
  },

  /**
   * 从最近文件中移除一个或多个记录。
   * @param ids - 需要移除的文件 ID 列表
   */
  async removeRecentFile(...ids: string[]): Promise<void> {
    await enqueueWrite(async () => {
      const files = await readRecentFiles();
      const filtered = files.filter((file) => !ids.includes(file.id));
      await writeRecentFiles(filtered);
    });
  },

  /**
   * 清空最近文件集合。
   */
  async clearRecentFiles(): Promise<void> {
    await writeRecentFiles([]);
  },

  /**
   * 清空底层文件存储。
   */
  async clear(): Promise<void> {
    if (hasElectronAPI()) {
      await setElectronStoreValue(RECENT_FILES_KEY, []);
      return;
    }

    await localforage.clear();
  }
};

export type { StoredFile };
