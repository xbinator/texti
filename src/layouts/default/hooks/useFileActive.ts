/* eslint-disable no-restricted-syntax */
import type { EditorFile } from '../types';
import type { Ref } from 'vue';
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { customAlphabet } from 'nanoid';
import type { ToolbarOptions } from '@/components/BToolbar/types';
import { native } from '@/shared/platform';
import { isElectron, isWeb } from '@/shared/platform/env';
import { recentFilesStorage, type StoredFile } from '@/shared/storage';
import { useSettingStore } from '@/stores/setting';
import { useTabsStore } from '@/stores/tabs';
import { Modal } from '@/utils/modal';
import { EditorShortcuts } from '../constants/shortcuts';

interface UseFileActiveOptions {
  pause: () => void;
  resume: () => void;
  setOriginalContent: (content: string) => void;
  visible: { recentSearch: boolean };
}

const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz_', 6);

export function getRecentFileLabel(file: Pick<EditorFile, 'name' | 'content'>): string {
  const content = file.content.replace(/^\s*---[\s\S]*?---\s*\n?/, '');
  const title = /^#{1,6}\s+(.+)/m.exec(content)?.[1]?.trim();
  return `${file.name || '未命名文件'}${title ? `【${title}】` : ''}`;
}

/** 构造一个带 nanoid 的空白新文件 */
function createEmptyFile(overrides: Partial<EditorFile> = {}): EditorFile {
  return { path: '', name: '', ext: 'md', content: '', id: nanoid(6), ...overrides };
}

/** 从文件路径中解析文件名和扩展名 */
function parseFileName(filePath: string): { name: string; ext: string } {
  const fileName = filePath.split(/[/\\]/).pop() ?? '';
  const [, name = '', ext = ''] = /^(.+?)(?:\.([^.]+))?$/.exec(fileName) ?? [];
  return { name, ext };
}

export function useFileActive(fileState: Ref<EditorFile>, options: UseFileActiveOptions) {
  const settingStore = useSettingStore();
  const route = useRoute();
  const router = useRouter();
  const tabsStore = useTabsStore();

  const canSave = computed(() => Boolean(fileState.value.path));
  const recentFiles = ref<EditorFile[]>([]);
  const savedRecentFiles = computed<EditorFile[]>(() => recentFiles.value.filter((f) => Boolean(f.path)));

  // ------------------------------------------------------------------ //
  // 基础 storage 操作
  // ------------------------------------------------------------------ //

  async function loadRecentFiles(): Promise<void> {
    recentFiles.value = await recentFilesStorage.getAllRecentFiles();
  }

  async function removeUnsavedFiles(preserveIds: string[] = []): Promise<void> {
    const ids = recentFiles.value.filter((f) => !f.path && !preserveIds.includes(f.id)).map((f) => f.id);
    if (ids.length) await recentFilesStorage.removeRecentFile(...ids);
  }

  // ------------------------------------------------------------------ //
  // 文件状态切换
  // ------------------------------------------------------------------ //

  /** 切换当前激活文件，同步 watcher / storage / 窗口标题，并注册到多标签页 */
  function setFileState(file: EditorFile): void {
    options.pause();
    file.path ? native.watchFile(file.path) : native.unwatchFile();
    fileState.value = file;

    if (file.id) {
      const editorPath = `/editor/${file.id}`;
      recentFilesStorage.setCurrentFile(file.id);
      // 用户打开/切换文件时，同步注册到多标签页
      tabsStore.addTab({ id: file.id, path: editorPath, title: file.name || '未命名文件', meta: { fileId: file.id } });
      // 路由参数与当前文件不一致时才跳转，防止循环
      if (route.params.id !== file.id) {
        router.push(editorPath);
      }
    }

    settingStore.setWindowTitle(`${file.name || '未命名'}.${file.ext || 'md'}`);
    nextTick(() => options.resume());
  }

  /** 更新 storage 并切换文件状态 */
  async function applyFileUpdate(id: string, updated: EditorFile): Promise<void> {
    await recentFilesStorage.updateRecentFile(id, updated as StoredFile);
    setFileState(updated);
  }

  // ------------------------------------------------------------------ //
  // 常用交互流程（confirm → switch）
  // ------------------------------------------------------------------ //

  /** 检查未保存变更，需用户确认才继续 */
  async function confirmUnsavedChanges(): Promise<boolean> {
    if (fileState.value.path || !fileState.value.content.trim()) return true;
    const [cancelled] = await Modal.confirm('提示', '当前文件未保存，是否放弃当前修改？');
    return !cancelled;
  }

  /**
   * 切换至指定文件的完整流程：
   * 确认未保存 → 清理临时文件 → 切换 → 刷新列表
   */
  async function switchToFile(file: EditorFile, { preserveIds = [] }: { preserveIds?: string[] } = {}): Promise<void> {
    if (!(await confirmUnsavedChanges())) return;
    await removeUnsavedFiles(preserveIds);
    setFileState(file);
    await loadRecentFiles();
  }

  /**
   * 注册新文件到 storage 并切换，不弹确认框（用于内部新建流程）
   */
  async function registerAndSwitch(file: EditorFile, opts?: Parameters<typeof switchToFile>[1]): Promise<void> {
    await recentFilesStorage.addRecentFile(file as StoredFile);
    await switchToFile(file, opts);
  }

  // ------------------------------------------------------------------ //
  // 保存相关
  // ------------------------------------------------------------------ //

  async function electronSaveAs(): Promise<void> {
    const { id, name, ext, content } = fileState.value;
    const defaultPath = `${name || '未命名'}.${ext || 'md'}`;
    const savedPath = await native.saveFile(content, undefined, { defaultPath });
    if (!savedPath) return;

    const { name: savedName, ext: savedExt } = parseFileName(savedPath);
    await applyFileUpdate(id, { ...fileState.value, path: savedPath, name: savedName, ext: savedExt });
  }

  // ------------------------------------------------------------------ //
  // 启动 & 恢复
  // ------------------------------------------------------------------ //

  async function restoreCurrentFile(): Promise<void> {
    const currentId = await recentFilesStorage.getCurrentFileId();
    if (currentId) {
      const stored = await recentFilesStorage.getRecentFile(currentId);
      if (stored) setFileState(stored);
    }

    if (!fileState.value.id) {
      const nextFile = createEmptyFile();
      await recentFilesStorage.addRecentFile(nextFile as StoredFile);
      setFileState(nextFile);
    }

    await loadRecentFiles();
  }

  async function activateLatestOrNew(): Promise<void> {
    const files = await recentFilesStorage.getAllRecentFiles();
    if (files[0]) {
      setFileState(files[0]);
    } else {
      const nextFile = createEmptyFile();
      await recentFilesStorage.addRecentFile(nextFile as StoredFile);
      setFileState(nextFile);
    }
    await loadRecentFiles();
  }

  // ------------------------------------------------------------------ //
  // 文件监听
  // ------------------------------------------------------------------ //

  let cleanupFileWatcher: (() => void) | null = null;

  onMounted(() => {
    cleanupFileWatcher = native.onFileChanged(async ({ type, filePath, content }) => {
      if (fileState.value.path !== filePath) return;

      if (type === 'change' && content !== undefined && fileState.value.content !== content) {
        const [cancelled] = await Modal.confirm('外部修改', '当前文件在外部已被修改，是否重新加载新内容？（未保存的更改将丢失）');
        if (!cancelled) {
          options.pause();
          fileState.value.content = content;
          options.setOriginalContent(content);
          recentFilesStorage.updateRecentFile(fileState.value.id, fileState.value as StoredFile);
          nextTick(() => options.resume());
        }
        return;
      }

      if (type === 'unlink') {
        await Modal.alert('文件已删除', '当前打开的文件已在外部被删除。编辑器将保留当前内容并标记为未保存状态，您可以将其另存为新文件。');
        options.pause();
        native.unwatchFile();

        const newId = nanoid(6);
        fileState.value = { ...fileState.value, id: newId, path: '' };
        options.setOriginalContent('');
        await recentFilesStorage.addRecentFile(fileState.value as StoredFile);
        recentFilesStorage.setCurrentFile(newId);
        settingStore.setWindowTitle(`${fileState.value.name || '未命名'}.${fileState.value.ext || 'md'}`);
        nextTick(() => options.resume());
      }
    });
  });

  onUnmounted(() => {
    cleanupFileWatcher?.();
    native.unwatchFile();
  });

  // ------------------------------------------------------------------ //
  // 对外操作
  // ------------------------------------------------------------------ //

  async function openRecentFile(id: string): Promise<void> {
    const stored = await recentFilesStorage.getRecentFile(id);
    if (!stored) return;
    await switchToFile(stored, { preserveIds: [id] });
  }

  // ------------------------------------------------------------------ //
  // 工具栏菜单 handlers（独立声明，让 computed 保持简洁）
  // ------------------------------------------------------------------ //

  async function handleNew(): Promise<void> {
    await registerAndSwitch(createEmptyFile());
  }

  async function handleOpen(): Promise<void> {
    const file = await native.openFile();
    if (!file.path) return;
    await registerAndSwitch({ ...file, id: nanoid(6) });
  }

  async function handleDuplicate(): Promise<void> {
    const { path, name, ext, content } = fileState.value;
    await registerAndSwitch(createEmptyFile({ path, name: name ? `${name}-副本` : '', ext: ext || 'md', content }));
  }

  async function handleSave(): Promise<void> {
    const { id, path, name = '未命名', ext = 'md', content } = fileState.value;

    if (isElectron()) {
      if (path) await native.writeFile(path, content);
      else await electronSaveAs();
      options.setOriginalContent(content);
    } else if (isWeb()) {
      const resolvedPath = path || `${name}.${ext}`;
      fileState.value = { ...fileState.value, name, ext, path: resolvedPath };
      await applyFileUpdate(id, { ...fileState.value });
      await loadRecentFiles();
      options.setOriginalContent(content);
    }
  }

  async function handleSaveAs(): Promise<void> {
    const { name, ext, content } = fileState.value;
    if (isElectron()) {
      await electronSaveAs();
    } else if (isWeb()) {
      await native.saveFile(content, undefined, { defaultPath: `${name || '未命名'}.${ext || 'md'}` });
    }
  }

  async function handleRename(): Promise<void> {
    const { id, name = '' } = fileState.value;
    const [cancel, newName] = await Modal.input('重命名', { defaultValue: name, placeholder: '请输入' });
    if (cancel || newName === name) return;
    await applyFileUpdate(id, { ...fileState.value, name: newName });
    await loadRecentFiles();
  }

  async function handleClearContent(): Promise<void> {
    const [, confirmed] = await Modal.delete('将清空当前文件内容，是否继续？', { title: '清空内容' });
    if (!confirmed) return;
    await applyFileUpdate(fileState.value.id, { ...fileState.value, content: '' });
    await loadRecentFiles();
  }

  async function handleRemoveCurrent(): Promise<void> {
    const [, confirmed] = await Modal.delete('此操作仅移除最近打开记录，不会删除磁盘上的文件，是否继续？');
    if (!confirmed) return;

    const { id } = fileState.value;
    await recentFilesStorage.removeRecentFile(id);
    const currentId = await recentFilesStorage.getCurrentFileId();
    if (currentId === id) await recentFilesStorage.clearCurrentFile();
    await activateLatestOrNew();
  }

  async function handleClearRecent(): Promise<void> {
    const [, confirmed] = await Modal.delete('此操作将删除所有最近打开的文件记录，是否继续？', { title: '清除最近打开记录' });
    if (!confirmed) return;
    await recentFilesStorage.clearRecentFiles();
    await loadRecentFiles();
  }

  // ------------------------------------------------------------------ //
  // 工具栏配置（纯声明，不含业务逻辑）
  // ------------------------------------------------------------------ //

  const toolbarFileOptions = computed<ToolbarOptions>(() => [
    { value: 'new', label: '新建', shortcut: EditorShortcuts.FILE_NEW, onClick: handleNew },
    { type: 'divider' },
    {
      value: 'open',
      label: '打开',
      shortcut: EditorShortcuts.FILE_OPEN,
      onClick: handleOpen
    },
    {
      value: 'recent',
      label: '打开最近的文件',
      disabled: !savedRecentFiles.value.length,
      children: [
        ...savedRecentFiles.value.slice(0, 10).map((file) => ({
          value: file.id,
          label: getRecentFileLabel(file),
          active: file.id === fileState.value.id,
          onClick: () => openRecentFile(file.id)
        })),
        ...(savedRecentFiles.value.length > 10
          ? [
              { type: 'divider' as const },
              {
                value: 'more',
                label: '更多',
                shortcut: EditorShortcuts.FILE_RECENT_MORE,
                enableShortcut: false,
                onClick: () => {
                  options.visible.recentSearch = true;
                }
              }
            ]
          : []),
        { type: 'divider' as const },
        { value: 'clear-recent', label: '清除最近打开记录', onClick: handleClearRecent }
      ]
    },
    { type: 'divider' },
    { value: 'duplicate', label: '复制为新文件', shortcut: EditorShortcuts.FILE_DUPLICATE, onClick: handleDuplicate },
    { value: 'save', label: '保存', shortcut: EditorShortcuts.FILE_SAVE, onClick: handleSave },
    { value: 'saveAs', label: '另存为', shortcut: EditorShortcuts.FILE_SAVE_AS, disabled: !canSave.value, onClick: handleSaveAs },
    { type: 'divider' },
    { value: 'rename', label: '重命名', shortcut: EditorShortcuts.FILE_RENAME, disabled: !fileState.value.path, onClick: handleRename },
    { type: 'divider' },
    { value: 'clear-content', label: '清空内容', onClick: handleClearContent },
    { value: 'remove-current', label: '从最近记录移除当前', onClick: handleRemoveCurrent }
  ]);

  /** 通过文件 ID 加载文件，供路由 watch 调用 */
  async function loadFileById(id: string | undefined): Promise<void> {
    if (route.name !== 'Editor' && !route.path.startsWith('/editor')) {
      return;
    }

    if (!id) {
      // 无 id（/editor 无参数）：恢复最近文件或新建
      await restoreCurrentFile();
      return;
    }
    if (id === fileState.value.id) return;
    const stored = await recentFilesStorage.getRecentFile(id);
    if (stored) {
      await switchToFile(stored, { preserveIds: [id] });
    } else {
      // 找不到记录时新建
      const nextFile = createEmptyFile();
      await recentFilesStorage.addRecentFile(nextFile as StoredFile);
      setFileState(nextFile);
      await loadRecentFiles();
    }
  }

  return { toolbarFileOptions, loadRecentFiles, savedRecentFiles, openRecentFile, loadFileById };
}
