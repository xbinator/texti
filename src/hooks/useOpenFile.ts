import { useRouter } from 'vue-router';
import { native } from '@/shared/platform';
import type { StoredFile } from '@/shared/storage/files/types';
import { useFilesStore } from '@/stores/files';

export function useOpenFile() {
  const router = useRouter();
  const filesStore = useFilesStore();

  async function openFile(file: StoredFile): Promise<void> {
    if (file.path) {
      const result = await native.readFile(file.path);
      await filesStore.updateFile(file.id, { ...file, content: result.content });
    }
    router.push({ name: 'editor', params: { id: file.id } });
  }

  async function openFileById(id: string): Promise<void> {
    const file = await filesStore.getFileById(id);
    if (!file) return;
    await openFile(file);
  }

  return { openFile, openFileById };
}
