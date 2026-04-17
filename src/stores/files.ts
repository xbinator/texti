import { defineStore } from 'pinia';
import type { StoredFile } from '@/shared/storage';
import { recentFilesStorage } from '@/shared/storage';

export interface FilesState {
  recentFiles: StoredFile[] | null;
}

export const useFilesStore = defineStore('files', {
  state: (): FilesState => ({
    recentFiles: null
  }),

  actions: {
    async ensureLoaded() {
      if (this.recentFiles !== null) return;

      this.recentFiles = await recentFilesStorage.getAllRecentFiles();
    },

    async getFileById(id: string) {
      await this.ensureLoaded();

      return this.recentFiles?.find((file) => file.id === id);
    },

    async getFileByPath(path: string) {
      await this.ensureLoaded();

      return this.recentFiles?.find((file) => file.path === path);
    },

    async addFile(file: StoredFile) {
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

    async updateFile(id: string, file: StoredFile) {
      await recentFilesStorage.updateRecentFile(id, file);
      if (this.recentFiles === null) return;
      const index = this.recentFiles.findIndex((f) => f.id === id);
      if (index !== -1) {
        this.recentFiles[index] = file;
      }
    },

    async removeFile(...ids: string[]) {
      await recentFilesStorage.removeRecentFile(...ids);
      if (this.recentFiles === null) return;
      this.recentFiles = this.recentFiles.filter((file) => !ids.includes(file.id));
    },

    async clearFiles() {
      await recentFilesStorage.clearRecentFiles();
      this.recentFiles = [];
    }
  }
});
