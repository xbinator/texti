import localforage from 'localforage';

localforage.config({ name: 'Texti', storeName: 'files', description: 'Texti 笔记应用文件存储' });

export interface StoredFile {
  path: string;
  content: string;
  name: string;
  ext: string;
}

const RECENT_FILES_KEY = 'recent_files';

const CURRENT_FILE_KEY = 'current_file';

const MAX_RECENT_FILES = 100;

export const indexedDBStorage = {
  async addRecentFile(file: StoredFile): Promise<void> {
    const files = await this.getAllRecentFiles();

    const filtered = files.filter((f) => f.path !== file.path);

    filtered.unshift({ ...file });

    await localforage.setItem(RECENT_FILES_KEY, filtered.slice(0, MAX_RECENT_FILES));
  },

  async getAllRecentFiles(): Promise<StoredFile[]> {
    const files = await localforage.getItem<StoredFile[]>(RECENT_FILES_KEY);
    return files || [];
  },

  async getRecentFile(path: string): Promise<StoredFile | null> {
    const files = await this.getAllRecentFiles();
    return files.find((f) => f.path === path) || null;
  },

  async updateRecentFile(file: StoredFile): Promise<void> {
    const files = await this.getAllRecentFiles();
    const index = files.findIndex((f) => f.path === file.path);
    if (index !== -1) {
      files[index] = { ...file };
      await localforage.setItem(RECENT_FILES_KEY, files);
    }
  },

  async removeRecentFile(path: string): Promise<void> {
    const files = await this.getAllRecentFiles();
    const filtered = files.filter((f) => f.path !== path);
    await localforage.setItem(RECENT_FILES_KEY, filtered);
  },

  async clearRecentFiles(): Promise<void> {
    await localforage.setItem(RECENT_FILES_KEY, []);
  },

  async setCurrentFile(path: string): Promise<void> {
    await localforage.setItem(CURRENT_FILE_KEY, path);
  },

  async getCurrentFile(): Promise<string | null> {
    return localforage.getItem<string>(CURRENT_FILE_KEY);
  },

  async clearCurrentFile(): Promise<void> {
    await localforage.removeItem(CURRENT_FILE_KEY);
  },

  async clear(): Promise<void> {
    await localforage.clear();
  }
};
