/**
 * @file useOpenFile.ts
 * @description 收口最近文件相关的打开与新建路由逻辑。
 */

import { useRouter } from 'vue-router';
import { customAlphabet } from 'nanoid';
import { native } from '@/shared/platform';
import type { StoredFile } from '@/shared/storage/files/types';
import { useFilesStore } from '@/stores/files';

const createFileId = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz_', 8);

/**
 * 提供统一的文件打开与新建行为。
 * @returns 文件打开相关操作
 */
export function useOpenFile(): {
  openFile: (file: StoredFile) => Promise<StoredFile>;
  openFileById: (id: string) => Promise<StoredFile | null>;
  openNativeFile: () => Promise<StoredFile | null>;
  createNewFile: () => Promise<StoredFile>;
} {
  const router = useRouter();
  const filesStore = useFilesStore();

  /**
   * 打开一个已存在的最近文件。
   * @param file - 文件记录
   * @returns 更新 openedAt 后的文件记录
   */
  async function openFile(file: StoredFile): Promise<StoredFile> {
    const openedFile = await filesStore.openExistingFile(file.id);

    // 已存在于本地存储的文件应优先恢复草稿，避免重新打开时被磁盘旧内容覆盖。
    await router.push({ name: 'editor', params: { id: openedFile.id } });
    return openedFile;
  }

  /**
   * 通过文件 ID 打开最近文件。
   * @param id - 文件 ID
   * @returns 更新后的文件记录；未命中时返回 null
   */
  async function openFileById(id: string): Promise<StoredFile | null> {
    const file = await filesStore.getFileById(id);
    if (!file) return null;

    return openFile(file);
  }

  /**
   * 通过原生文件选择器打开文件。
   * @returns 打开的文件记录；用户取消时返回 null
   */
  async function openNativeFile(): Promise<StoredFile | null> {
    const file = await native.openFile();
    if (!file.path) return null;

    const openedFile = await filesStore.openOrCreateByPath(file.path);
    if (!openedFile) return null;

    await router.push({ name: 'editor', params: { id: openedFile.id } });
    return openedFile;
  }

  /**
   * 创建一个新的未保存文件并打开。
   * @returns 创建后的文件记录
   */
  async function createNewFile(): Promise<StoredFile> {
    const createdFile = await filesStore.createAndOpen({
      id: createFileId(),
      path: null,
      name: 'Untitled',
      ext: 'md',
      content: '',
      savedContent: ''
    });

    await router.push({ name: 'editor', params: { id: createdFile.id } });
    return createdFile;
  }

  return { openFile, openFileById, openNativeFile, createNewFile };
}
