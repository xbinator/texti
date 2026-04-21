/**
 * @file editorFileWatch.ts
 * @description 管理编辑器全局文件监听路径映射和文件丢失事件分发。
 */

import { defineStore } from 'pinia';
import { native } from '@/shared/platform';
import type { FileChangeEvent } from '@/shared/platform/native/types';
import { useTabsStore } from '@/stores/tabs';

/**
 * 编辑器全局文件监听状态。
 */
export interface EditorFileWatchState {
  /** 文件路径到引用该路径的编辑器文件 ID 集合 */
  pathToFileIds: Map<string, Set<string>>;
  /** 编辑器文件 ID 到当前监听路径的映射 */
  fileIdToPath: Map<string, string>;
  /** native 文件事件取消订阅函数 */
  unsubscribe: (() => void) | null;
}

/**
 * 全局文件监听 Store，负责把 native 文件事件路由到对应标签状态。
 */
export const useEditorFileWatchStore = defineStore('editorFileWatch', {
  state: (): EditorFileWatchState => ({
    pathToFileIds: new Map<string, Set<string>>(),
    fileIdToPath: new Map<string, string>(),
    unsubscribe: null
  }),

  actions: {
    /**
     * 确保 native 文件事件只订阅一次。
     */
    ensureSubscribed(): void {
      if (this.unsubscribe) return;

      this.unsubscribe = native.onFileChanged((event: FileChangeEvent) => {
        this.handleFileChanged(event);
      });
    },

    /**
     * 注册指定编辑器文件对应的磁盘路径。
     * @param fileId - 编辑器文件 ID
     * @param filePath - 需要监听的磁盘路径
     */
    async register(fileId: string, filePath: string): Promise<void> {
      this.ensureSubscribed();

      const previousPath = this.fileIdToPath.get(fileId);
      if (previousPath && previousPath !== filePath) {
        await this.updatePath(fileId, filePath);
        return;
      }

      let fileIds = this.pathToFileIds.get(filePath);
      if (!fileIds) {
        await native.watchFile(filePath);
        fileIds = new Set<string>();
        this.pathToFileIds.set(filePath, fileIds);
      }

      fileIds.add(fileId);
      this.fileIdToPath.set(fileId, filePath);
    },

    /**
     * 取消指定编辑器文件的路径引用；仅最后一个引用离开时才停止 native watcher。
     * @param fileId - 编辑器文件 ID
     */
    async unregister(fileId: string): Promise<void> {
      const previousPath = this.fileIdToPath.get(fileId);
      if (!previousPath) return;

      const fileIds = this.pathToFileIds.get(previousPath);
      fileIds?.delete(fileId);
      this.fileIdToPath.delete(fileId);

      if (fileIds && fileIds.size === 0) {
        this.pathToFileIds.delete(previousPath);
        await native.unwatchFile(previousPath);
      }
    },

    /**
     * 更新编辑器文件监听路径，先确保新路径监听成功再释放旧路径。
     * @param fileId - 编辑器文件 ID
     * @param nextPath - 新的磁盘路径
     */
    async updatePath(fileId: string, nextPath: string): Promise<void> {
      this.ensureSubscribed();

      const previousPath = this.fileIdToPath.get(fileId);
      if (previousPath === nextPath) return;

      let nextFileIds = this.pathToFileIds.get(nextPath);
      if (!nextFileIds) {
        await native.watchFile(nextPath);
        nextFileIds = new Set<string>();
        this.pathToFileIds.set(nextPath, nextFileIds);
      }

      if (previousPath) {
        const previousFileIds = this.pathToFileIds.get(previousPath);
        previousFileIds?.delete(fileId);

        if (previousFileIds && previousFileIds.size === 0) {
          this.pathToFileIds.delete(previousPath);

          try {
            await native.unwatchFile(previousPath);
          } catch (error: unknown) {
            console.error('Failed to unwatch previous file path:', error);
          }
        }
      }

      nextFileIds.add(fileId);
      this.fileIdToPath.set(fileId, nextPath);
    },

    /**
     * 处理 native 文件事件；阶段一只响应 unlink，change 显式忽略。
     * @param event - native 文件变化事件
     */
    handleFileChanged(event: FileChangeEvent): void {
      if (event.type === 'change') {
        return;
      }

      this.markPathMissing(event.filePath);
    },

    /**
     * 把同一路径下的所有标签标记为文件已丢失。
     * @param filePath - 已从原路径消失的文件路径
     */
    markPathMissing(filePath: string): void {
      const fileIds = this.pathToFileIds.get(filePath);
      if (!fileIds) return;

      const tabsStore = useTabsStore();
      fileIds.forEach((fileId: string) => {
        tabsStore.markMissing(fileId);
      });
    },

    /**
     * 释放全局 watcher 订阅和 native 监听资源。
     */
    async dispose(): Promise<void> {
      if (this.unsubscribe) {
        this.unsubscribe();
        this.unsubscribe = null;
      }

      this.pathToFileIds.clear();
      this.fileIdToPath.clear();
      await native.unwatchAll();
    }
  }
});
