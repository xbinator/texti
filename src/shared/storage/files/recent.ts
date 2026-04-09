import type { StoredFile } from './types';
import localforage from 'localforage';
import { getElectronAPI, hasElectronAPI } from '../../platform/electron-api';

localforage.config({ name: 'Texti', storeName: 'files', description: 'Texti 笔记应用文件存储' });

const RECENT_FILES_KEY = 'recent_files';

const CURRENT_FILE_ID_KEY = 'current_file_id';

const MAX_RECENT_FILES = 100;

let electronLocalMigrationPromise: Promise<void> | null = null;

async function getElectronStoreValue<T>(key: string): Promise<T | null> {
  const value = await getElectronAPI().storeGet(key);
  return (value as T | null) ?? null;
}

async function setElectronStoreValue(key: string, value: unknown): Promise<void> {
  await getElectronAPI().storeSet(key, value);
}

async function deleteElectronStoreValue(key: string): Promise<void> {
  await getElectronAPI().storeDelete(key);
}

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

    const storeCurrentId = await getElectronStoreValue<string>(CURRENT_FILE_ID_KEY);
    const localCurrentId = await localforage.getItem<string>(CURRENT_FILE_ID_KEY);
    if (!storeCurrentId && localCurrentId) {
      await setElectronStoreValue(CURRENT_FILE_ID_KEY, localCurrentId);
    }
  })();

  await electronLocalMigrationPromise;
}

export const recentFilesStorage = {
  async addRecentFile(file: StoredFile): Promise<void> {
    const files = await this.getAllRecentFiles();

    const filtered = files.filter((item) => item.id !== file.id);

    filtered.unshift({ ...file });

    const nextFiles = filtered.slice(0, MAX_RECENT_FILES);
    if (hasElectronAPI()) {
      await setElectronStoreValue(RECENT_FILES_KEY, nextFiles);
      return;
    }

    await localforage.setItem(RECENT_FILES_KEY, nextFiles);
  },

  async getAllRecentFiles(): Promise<StoredFile[]> {
    if (hasElectronAPI()) {
      await ensureElectronLocalMigration();
      return (await getElectronStoreValue<StoredFile[]>(RECENT_FILES_KEY)) || [];
    }

    const files = await localforage.getItem<StoredFile[]>(RECENT_FILES_KEY);
    return files || [];
  },

  async getRecentFile(id: string): Promise<StoredFile | null> {
    const files = await this.getAllRecentFiles();
    return files.find((file) => file.id === id) || null;
  },

  async updateRecentFile(id: string, file: StoredFile): Promise<void> {
    const files = await this.getAllRecentFiles();
    const index = files.findIndex((item) => item.id === id);
    if (index !== -1) {
      files[index] = { ...file };

      if (hasElectronAPI()) {
        await setElectronStoreValue(RECENT_FILES_KEY, files);
        return;
      }

      await localforage.setItem(RECENT_FILES_KEY, files);
    }
  },

  async removeRecentFile(...ids: string[]): Promise<void> {
    const files = await this.getAllRecentFiles();
    const filtered = files.filter((file) => !ids.includes(file.id));
    if (hasElectronAPI()) {
      await setElectronStoreValue(RECENT_FILES_KEY, filtered);
      return;
    }

    await localforage.setItem(RECENT_FILES_KEY, filtered);
  },

  async clearRecentFiles(): Promise<void> {
    if (hasElectronAPI()) {
      await setElectronStoreValue(RECENT_FILES_KEY, []);
      return;
    }

    await localforage.setItem(RECENT_FILES_KEY, []);
  },

  async setCurrentFile(id: string): Promise<void> {
    if (hasElectronAPI()) {
      await setElectronStoreValue(CURRENT_FILE_ID_KEY, id);
      return;
    }

    await localforage.setItem(CURRENT_FILE_ID_KEY, id);
  },

  async getCurrentFileId(): Promise<string | null> {
    if (hasElectronAPI()) {
      await ensureElectronLocalMigration();
      return getElectronStoreValue<string>(CURRENT_FILE_ID_KEY);
    }

    return localforage.getItem<string>(CURRENT_FILE_ID_KEY);
  },

  async clearCurrentFile(): Promise<void> {
    if (hasElectronAPI()) {
      await deleteElectronStoreValue(CURRENT_FILE_ID_KEY);
      return;
    }

    await localforage.removeItem(CURRENT_FILE_ID_KEY);
  },

  async clear(): Promise<void> {
    if (hasElectronAPI()) {
      await Promise.all([setElectronStoreValue(RECENT_FILES_KEY, []), deleteElectronStoreValue(CURRENT_FILE_ID_KEY)]);
      return;
    }

    await localforage.clear();
  }
};

export type { StoredFile };
