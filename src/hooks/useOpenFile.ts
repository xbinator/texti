/**
 * @file useOpenFile.ts
 * @description 收口最近文件相关的打开与新建路由逻辑。
 */

import { useRouter } from 'vue-router';
import { customAlphabet } from 'nanoid';
import { native } from '@/shared/platform';
import type { StoredFile } from '@/shared/storage/files/types';
import { useFilesStore } from '@/stores/files';
import type { OpenSource } from '@/stores/files';

const createFileId = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz_', 8);

/**
 * 提供统一的文件打开与新建行为。
 * @returns 文件打开相关操作
 */
export function useOpenFile(): {
  openFile: (file: StoredFile, source?: OpenSource) => Promise<StoredFile>;
  openFileById: (id: string, source?: OpenSource) => Promise<StoredFile | null>;
  openNativeFile: (source?: OpenSource) => Promise<StoredFile | null>;
  createNewFile: (source?: OpenSource) => Promise<StoredFile>;
} {
  const router = useRouter();
  const filesStore = useFilesStore();

  /**
   * 打开一个已存在的最近文件。
   * @param file - 文件记录
   * @param source - 打开来源
   * @returns 更新 openedAt 后的文件记录
   */
  async function openFile(file: StoredFile, source: OpenSource = 'search'): Promise<StoredFile> {
    const openedFile = await filesStore.openExistingFile(file.id, source);

    // 已存在于本地存储的文件应优先恢复草稿，避免重新打开时被磁盘旧内容覆盖。
    await router.push({ name: 'editor', params: { id: openedFile.id } });
    return openedFile;
  }

  /**
   * 通过文件 ID 打开最近文件。
   * @param id - 文件 ID
   * @param source - 打开来源
   * @returns 更新后的文件记录；未命中时返回 null
   */
  async function openFileById(id: string, source: OpenSource = 'platform-recent'): Promise<StoredFile | null> {
    const file = await filesStore.getFileById(id);
    if (!file) return null;

    return openFile(file, source);
  }

  /**
   * 通过原生文件选择器打开文件。
   * @param source - 打开来源
   * @returns 打开的文件记录；用户取消时返回 null
   */
  async function openNativeFile(source: OpenSource = 'native-open'): Promise<StoredFile | null> {
    const file = await native.openFile();
    if (!file.path) return null;

    const openedFile = await filesStore.openOrCreateByPath(file.path, source);
    if (!openedFile) return null;

    await router.push({ name: 'editor', params: { id: openedFile.id } });
    return openedFile;
  }

  /**
   * 创建一个新的未保存文件并打开。
   * @param source - 创建来源
   * @returns 创建后的文件记录
   */
  async function createNewFile(source: OpenSource = 'new'): Promise<StoredFile> {
    const createdFile = await filesStore.createAndOpen(
      {
        id: createFileId(),
        path: null,
        name: '未命名',
        ext: 'md',
        content: '',
        savedContent: ''
      },
      source
    );

    await router.push({ name: 'editor', params: { id: createdFile.id } });
    return createdFile;
  }

  return { openFile, openFileById, openNativeFile, createNewFile };
}
