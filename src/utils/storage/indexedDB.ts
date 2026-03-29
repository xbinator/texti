import localforage from 'localforage';

localforage.config({
  name: 'Vault',
  storeName: 'files',
  description: 'Vault 笔记应用文件存储'
});

export interface StoredFile {
  path: string;
  content: string;
  name: string;
  ext: string;
  updatedAt: number;
}

const FILES_KEY = 'files';
const CURRENT_FILE_KEY = 'current_file';

export const indexedDBStorage = {
  async saveFile(file: StoredFile): Promise<void> {
    const files = await this.getAllFiles();
    const index = files.findIndex((f) => f.path === file.path);

    if (index >= 0) {
      files[index] = { ...file, updatedAt: Date.now() };
    } else {
      files.push({ ...file, updatedAt: Date.now() });
    }

    await localforage.setItem(FILES_KEY, files);
  },

  async getFile(path: string): Promise<StoredFile | null> {
    const files = await this.getAllFiles();
    return files.find((f) => f.path === path) || null;
  },

  async getAllFiles(): Promise<StoredFile[]> {
    const files = await localforage.getItem<StoredFile[]>(FILES_KEY);
    return files || [];
  },

  async deleteFile(path: string): Promise<void> {
    const files = await this.getAllFiles();
    const filtered = files.filter((f) => f.path !== path);
    await localforage.setItem(FILES_KEY, filtered);
  },

  async setCurrentFile(path: string | null): Promise<void> {
    await localforage.setItem(CURRENT_FILE_KEY, path);
  },

  async getCurrentFilePath(): Promise<string | null> {
    return localforage.getItem<string>(CURRENT_FILE_KEY);
  },

  async clear(): Promise<void> {
    await localforage.clear();
  }
};
