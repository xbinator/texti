import { defineStore } from 'pinia';
import type { StoredFile } from '@/shared/storage';
import { recentFilesStorage } from '@/shared/storage';

export interface FilesState {
  recentFiles: StoredFile[] | null;
  isLoading: boolean;
}

export const useFilesStore = defineStore('files', {
  state: (): FilesState => ({
    recentFiles: null,
    isLoading: false
  }),

  actions: {
    async ensureLoaded(): Promise<void> {
      if (this.recentFiles !== null) return;

      await this.initialize();
    },

    async getFileById(id: string): Promise<StoredFile | undefined> {
      await this.ensureLoaded();

      return this.recentFiles?.find((file) => file.id === id);
    },

    async getFileByPath(path: string): Promise<StoredFile | undefined> {
      await this.ensureLoaded();

      return this.recentFiles?.find((file) => file.path === path);
    },

    async initialize(): Promise<void> {
      this.isLoading = true;
      try {
        this.recentFiles = await recentFilesStorage.getAllRecentFiles();
      } finally {
        this.isLoading = false;
      }
    },

    async addFile(file: StoredFile): Promise<void> {
      await recentFilesStorage.addRecentFile(file);
      if (this.recentFiles === null) {
        this.recentFiles = [file];
        return;
      }
      const index = this.recentFiles.findIndex((f) => f.id === file.id);

      if (index === -1) {
        this.recentFiles.unshift(file);
      } else {
        this.recentFiles[index] = file;
      }
    },

    async updateFile(id: string, file: StoredFile): Promise<void> {
      await recentFilesStorage.updateRecentFile(id, file);
      if (this.recentFiles === null) return;
      const index = this.recentFiles.findIndex((f) => f.id === id);
      if (index !== -1) {
        this.recentFiles[index] = file;
      }
    },

    async removeFile(...ids: string[]): Promise<void> {
      await recentFilesStorage.removeRecentFile(...ids);
      if (this.recentFiles === null) return;
      this.recentFiles = this.recentFiles.filter((file) => !ids.includes(file.id));
    },

    async clearFiles(): Promise<void> {
      await recentFilesStorage.clearRecentFiles();
      this.recentFiles = [];
    }
  }
});
