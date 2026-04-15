import type { EditorFile } from '../types';
import type { Ref } from 'vue';
import { computed, nextTick, onUnmounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { customAlphabet } from 'nanoid';
import { native } from '@/shared/platform';
import { recentFilesStorage } from '@/shared/storage';
import { useTabsStore } from '@/stores/tabs';
import { Modal } from '@/utils/modal';
import { useAutoSave } from './useAutoSave';
import { useFileWatcher } from './useFileWatcher';

type ViewMode = 'rich' | 'source';

const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz_', 8);

function createEmptyFile(id: string): EditorFile {
  return { id, name: '', content: '', ext: 'md', path: null };
}

function parseFileName(filePath: string): { name: string; ext: string } {
  const fileName = filePath.split(/[/\\]/).pop() ?? '';
  const [, name = '', ext = ''] = /^(.+?)(?:\.([^.]+))?$/.exec(fileName) ?? [];
  return { name, ext };
}

export function useSession(fileId: Ref<string>) {
  const route = useRoute();
  const router = useRouter();

  const tabsStore = useTabsStore();
  const { switchWatchedFile, clearWatchedFile } = useFileWatcher();

  const fileState = ref<EditorFile>(createEmptyFile(''));
  const viewState = reactive<{ mode: ViewMode; showOutline: boolean }>({ mode: 'rich', showOutline: true });

  const { pause, resume } = useAutoSave(fileState);

  const currentTitle = computed(() => fileState.value.name || '未命名文件');

  let loadVersion = 0;

  function updateTab() {
    if (!fileId.value) return;

    tabsStore.addTab({ id: fileId.value, path: route.fullPath, title: currentTitle.value });
  }

  function getDefaultSavePath(): string {
    const name = fileState.value.name || '未命名';
    const ext = fileState.value.ext || 'md';
    return `${name}.${ext}`;
  }

  async function ensureStoredFile(): Promise<void> {
    const stored = await recentFilesStorage.getRecentFile(fileState.value.id);
    if (stored) return;

    await recentFilesStorage.addRecentFile({ ...fileState.value });
  }

  async function persistCurrentFile(): Promise<void> {
    const current = { ...fileState.value };
    const stored = await recentFilesStorage.getRecentFile(current.id);

    if (stored) {
      await recentFilesStorage.updateRecentFile(current.id, current);
    } else {
      await recentFilesStorage.addRecentFile(current);
    }
  }

  async function finalizeSave(savedPath: string): Promise<void> {
    const { name, ext } = parseFileName(savedPath);

    fileState.value.path = savedPath;
    fileState.value.name = name || fileState.value.name;
    fileState.value.ext = ext || fileState.value.ext || 'md';

    await persistCurrentFile();
    await switchWatchedFile(savedPath);
  }

  async function onSave(): Promise<void> {
    await ensureStoredFile();

    if (fileState.value.path) {
      await native.writeFile(fileState.value.path, fileState.value.content);
      await persistCurrentFile();
      return;
    }

    const savedPath = await native.saveFile(fileState.value.content, undefined, { defaultPath: getDefaultSavePath() });

    if (!savedPath) return;

    await finalizeSave(savedPath);
  }

  async function onSaveAs(): Promise<void> {
    await ensureStoredFile();

    const savedPath = await native.saveFile(fileState.value.content, undefined, { defaultPath: getDefaultSavePath() });

    if (!savedPath) return;

    await finalizeSave(savedPath);
  }

  async function onRename(): Promise<void> {
    await ensureStoredFile();

    const [cancelled, newName] = await Modal.input('重命名', { defaultValue: fileState.value.name, placeholder: '请输入文件名' });

    const normalizedName = String(newName || '').trim();

    if (cancelled || !normalizedName || normalizedName === fileState.value.name) {
      return;
    }

    fileState.value.name = normalizedName;
    await persistCurrentFile();
  }

  async function onDuplicate(): Promise<void> {
    const nextId = nanoid();
    const nextName = fileState.value.name ? `${fileState.value.name}-副本` : '';

    await recentFilesStorage.addRecentFile({ ...fileState.value, id: nextId, name: nextName, path: null });

    await router.push({ name: 'editor', params: { id: nextId } });
  }

  async function loadFileState(): Promise<void> {
    const currentVersion = ++loadVersion;
    pause();
    const currentFileId = fileId.value;
    const stored = await recentFilesStorage.getRecentFile(currentFileId);

    if (currentVersion !== loadVersion) return;

    fileState.value = stored ? { ...stored } : createEmptyFile(currentFileId);

    if (currentVersion !== loadVersion) return;

    await switchWatchedFile(fileState.value.path);

    if (currentVersion !== loadVersion) return;

    await nextTick();

    if (currentVersion !== loadVersion) return;

    resume();
  }

  watch(fileId, () => loadFileState(), { immediate: true });

  watch([fileId, () => route.fullPath, () => fileState.value.name], updateTab, { immediate: true });

  async function dispose(): Promise<void> {
    await clearWatchedFile();
  }

  onUnmounted(() => {
    dispose();
  });

  const actions = { onSave, onSaveAs, onRename, onDuplicate };

  return {
    fileState,
    viewState,
    currentTitle,
    actions,
    loadFileState,
    dispose
  };
}
