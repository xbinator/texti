import type { EditorFile } from '../types';
import type { Ref } from 'vue';
import { computed, nextTick, onUnmounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { customAlphabet } from 'nanoid';
import { native } from '@/shared/platform';
import type { FileChangeEvent } from '@/shared/platform/native/types';
import { useFilesStore } from '@/stores/files';
import { useTabsStore } from '@/stores/tabs';
import { Modal } from '@/utils/modal';
import { useAutoSave } from './useAutoSave';
import { useFileWatcher } from './useFileWatcher';

type ViewMode = 'rich' | 'source';

const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz_', 8);

function parseFileName(filePath: string): { name: string; ext: string } {
  const fileName = filePath.split(/[/\\]/).pop() ?? '';
  const [, name = '', ext = ''] = /^(.+?)(?:\.([^.]+))?$/.exec(fileName) ?? [];
  return { name, ext };
}

export function useSession(fileId: Ref<string>) {
  const route = useRoute();
  const router = useRouter();

  const tabsStore = useTabsStore();
  const filesStore = useFilesStore();
  const { switchWatchedFile, clearWatchedFile, setOnFileChanged, setIsDirty, finishReload } = useFileWatcher();

  const fileState = ref<EditorFile>({ id: '', name: '', content: '', ext: 'md', path: null });
  const viewState = reactive<{ mode: ViewMode; showOutline: boolean }>({ mode: 'rich', showOutline: true });

  const { pause, resume } = useAutoSave(fileState);

  const currentTitle = computed(() => fileState.value.name || '未命名');

  const savedContent = ref<string>('');
  let loadVersion = 0;

  watch(
    () => fileState.value.content,
    (content) => {
      if (content !== savedContent.value) {
        tabsStore.setDirty(fileId.value);
      } else {
        tabsStore.clearDirty(fileId.value);
      }
    }
  );

  setIsDirty(() => tabsStore.isDirty(fileId.value));

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
    const stored = await filesStore.getFileById(fileState.value.id);
    if (stored) return;

    await filesStore.addFile({ ...fileState.value });
  }

  async function persistCurrentFile(): Promise<void> {
    const current = { ...fileState.value };
    const stored = await filesStore.getFileById(current.id);

    if (stored) {
      await filesStore.updateFile(current.id, current);
    } else {
      await filesStore.addFile(current);
    }
  }

  function handleExternalFileChange(event: FileChangeEvent): void {
    if (event.type !== 'change' || event.content === undefined) return;

    pause();
    fileState.value.content = event.content;
    savedContent.value = event.content;
    tabsStore.clearDirty(fileId.value);
    persistCurrentFile();
    finishReload();
    resume();
  }

  setOnFileChanged(handleExternalFileChange);

  async function finalizeSave(savedPath: string): Promise<void> {
    const { name, ext } = parseFileName(savedPath);

    fileState.value.path = savedPath;
    fileState.value.name = name || fileState.value.name;
    fileState.value.ext = ext || fileState.value.ext || 'md';
    savedContent.value = fileState.value.content;
    tabsStore.clearDirty(fileId.value);

    await persistCurrentFile();
    await switchWatchedFile(savedPath);
  }

  async function onSave(): Promise<void> {
    await ensureStoredFile();

    if (fileState.value.path) {
      await native.writeFile(fileState.value.path, fileState.value.content);
      savedContent.value = fileState.value.content;
      tabsStore.clearDirty(fileId.value);
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

    await filesStore.addFile({ ...fileState.value, id: nextId, name: nextName, path: null });

    await router.push({ name: 'editor', params: { id: nextId } });
  }

  /**
   * 初始化文件状态
   *
   * 如果存储中有文件数据，则使用存储的数据；否则创建空文件并添加到存储中
   *
   * @param stored - 存储中的文件数据
   * @param currentFileId - 当前文件ID
   */
  function initializeFileState(stored: EditorFile | undefined, currentFileId: string): void {
    if (stored) {
      fileState.value = { ...stored };
    } else {
      fileState.value = { id: currentFileId, name: '未命名', content: '', ext: 'md', path: null };

      filesStore.addFile({ ...fileState.value });
    }
    savedContent.value = fileState.value.content;
    tabsStore.clearDirty(currentFileId);
  }

  /**
   * 加载文件状态
   *
   * 该函数负责从存储中加载指定文件的状态，并处理并发加载问题。
   * 使用版本号机制确保只有最新的加载请求会生效，避免旧的加载请求覆盖新的数据。
   *
   * 执行流程：
   * 1. 增加版本号，标记当前加载请求
   * 2. 暂停自动保存，避免在加载过程中触发保存
   * 3. 从存储中获取文件数据
   * 4. 检查版本号，如果版本不匹配则终止（说明有更新的加载请求）
   * 5. 初始化文件状态
   * 6. 切换文件监听器到新文件
   * 7. 等待 Vue 更新周期完成
   * 8. 恢复自动保存
   */
  async function loadFileState(): Promise<void> {
    // 增加版本号，标记当前加载请求
    const currentVersion = ++loadVersion;
    // 暂停自动保存，避免在加载过程中触发保存
    pause();

    // 记录当前文件ID，避免在异步操作过程中文件ID发生变化
    const currentFileId = fileId.value;

    const stored = await filesStore.getFileById(currentFileId);
    // 检查版本号，如果版本不匹配则终止（说明有更新的加载请求）
    if (currentVersion !== loadVersion) return;

    // 初始化文件状态
    initializeFileState(stored, currentFileId);

    // 再次检查版本号
    if (currentVersion !== loadVersion) return;
    // 切换文件监听器到新文件
    await switchWatchedFile(fileState.value.path);

    // 检查版本号
    if (currentVersion !== loadVersion) return;
    // 等待 Vue 更新周期完成
    await nextTick();

    // 最后一次检查版本号
    if (currentVersion !== loadVersion) return;
    // 恢复自动保存
    resume();
  }

  watch(fileId, () => loadFileState(), { immediate: true });

  watch([fileId, () => route.fullPath, () => fileState.value.name], updateTab);

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
