/**
 * @file useSession.ts
 * @description 将编辑器文件类型能力适配到公共文件控制器，并保留页面专属动作。
 */
import type { EditorFile } from '../types';
import type { ComputedRef, Ref } from 'vue';
import { computed, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { message } from 'ant-design-vue';
import { customAlphabet } from 'nanoid';
import { useClipboard } from '@/hooks/useClipboard';
import { useFileController } from '@/hooks/useFileController';
import type {
  FileConflictDecision,
  FileControllerErrorContext,
  FileControllerSnapshot,
  FileDeleteContext,
  FileLoadCandidates,
  FileLoadContext,
  FileParseContext,
  FileParseResult,
  FileRecordContext,
  FileRenameContext,
  FileRenameResult,
  FileRestoreContext,
  FileSaveAsContext,
  FileSerializeContext,
  FileWriteContext
} from '@/hooks/useFileController/types';
import { resolveRouteTabInfo } from '@/router/cache';
import { native } from '@/shared/platform';
import type { FileState, ReadFileResult } from '@/shared/platform/native/types';
import { createDocumentDescription, createDocumentTitle, createRecentKey, createRecentUrl, type StoredDocumentRecord, type StoredFile } from '@/shared/storage';
import { useRecentStore } from '@/stores/workspace/recent';
import { useTabsStore } from '@/stores/workspace/tabs';
import { asyncTo } from '@/utils/asyncTo';
import { restoreMissingFile } from '@/utils/file/restore';
import { resolveFileTitle } from '@/utils/file/title';
import { Modal } from '@/utils/modal';
import { getDefaultSavePath, parseFileName, replaceFileName } from '../utils/filePath';

/**
 * 编辑器视图模式。
 */
type ViewMode = 'rich' | 'source';

/**
 * 编辑器页面文件动作。
 */
export interface EditorSessionActions {
  /** 编辑器失焦保存。 */
  onEditorBlur: () => Promise<void>;
  /** 保存当前文件。 */
  onSave: () => Promise<void>;
  /** 另存为。 */
  onSaveAs: () => Promise<void>;
  /** 重命名。 */
  onRename: () => Promise<void>;
  /** 删除当前文件。 */
  onDelete: () => Promise<void>;
  /** 在文件管理器中显示。 */
  onShowInFolder: () => Promise<void>;
  /** 复制绝对路径。 */
  onCopyPath: () => Promise<void>;
  /** 复制相对路径。 */
  onCopyRelativePath: () => Promise<void>;
  /** 复制当前文档。 */
  onDuplicate: () => Promise<void>;
}

/**
 * 编辑器页面会话返回值。
 */
export interface EditorSessionResult {
  /** 当前文件状态。 */
  fileState: Ref<EditorFile>;
  /** 当前文件是否仍在初始或重载流程中。 */
  isLoading: Ref<boolean>;
  /** 编辑器视图状态。 */
  viewState: { mode: ViewMode };
  /** 当前标签标题。 */
  currentTitle: ComputedRef<string>;
  /** 编辑器文件动作。 */
  actions: EditorSessionActions;
  /** 重新加载当前文件。 */
  loadFileState: () => Promise<void>;
  /** 释放公共文件会话。 */
  dispose: () => Promise<void>;
}

const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz_', 8);

/**
 * 判断最近文件记录是否为普通编辑器文件。
 * @param record - 最近文件记录
 * @returns 是否为普通文件记录
 */
function isStoredFileRecord(record: StoredDocumentRecord | undefined): record is StoredFile {
  return record?.type === 'file';
}

/**
 * 将最近文件记录转换为控制器文件状态。
 * @param record - 普通最近文件记录
 * @returns 控制器文件状态
 */
function onCreateStoredState(record: StoredFile): FileState {
  return { id: record.id, path: record.path, name: record.name, ext: record.ext, content: record.content };
}

/**
 * 将磁盘读取结果转换为控制器文件状态。
 * @param fileId - 当前文件 ID
 * @param filePath - 当前磁盘路径
 * @param diskFile - 磁盘读取结果
 * @returns 控制器文件状态
 */
function onCreateDiskState(fileId: string, filePath: string, diskFile: ReadFileResult): FileState {
  const { name, ext } = parseFileName(filePath);

  return { id: fileId, path: filePath, name: name || diskFile.name, ext: ext || diskFile.ext || 'md', content: diskFile.content };
}

/**
 * 创建编辑器页面文件会话。
 * @param fileId - 当前响应式文件 ID
 * @returns 编辑器文件状态与页面动作
 */
export function useSession(fileId: Ref<string>): EditorSessionResult {
  const route = useRoute();
  const router = useRouter();
  const recentStore = useRecentStore();
  const tabsStore = useTabsStore();
  const { clipboard } = useClipboard();
  const sessionPath = ref<string>(route.fullPath);
  const sessionCacheKey = ref<string>(resolveRouteTabInfo(route).cacheKey);
  const viewState = reactive<{ mode: ViewMode }>({ mode: 'rich' });

  /**
   * 创建默认的未落盘编辑器文件。
   * @param context - 默认会话上下文
   * @returns 默认文件快照
   */
  function onCreateFile(context: { fileId: string }): FileControllerSnapshot<string> {
    const nextFile: FileState = { id: context.fileId, name: 'Untitled', content: '', ext: 'md', path: null };

    return { fileState: nextFile, data: nextFile.content, savedContent: nextFile.content };
  }

  /**
   * 加载普通编辑器文件的草稿与磁盘候选内容。
   * @param context - 当前加载上下文
   * @returns 草稿与磁盘候选内容
   */
  async function onLoadFile(context: FileLoadContext): Promise<FileLoadCandidates> {
    // 1. 读取最近文件记录（含未保存草稿与最近已知 path）
    const [readRecordError, record] = await asyncTo(recentStore.getFileById(context.fileId));
    if (readRecordError) {
      return { draft: null, disk: null, error: readRecordError };
    }

    // 2. 记录指向 Widget 时重定向到 Widget 页面，并 abort 当前加载避免重复渲染
    if (record?.type === 'widget') {
      const [redirectError] = await asyncTo(router.push({ name: 'widget', params: { id: context.fileId } }));
      return { draft: null, disk: null, error: redirectError ?? null, aborted: !redirectError };
    }

    // 3. 不是合法的文件记录（不存在 / 类型不匹配），返回空结果交由上层处理
    if (!isStoredFileRecord(record)) {
      return { draft: null, disk: null, error: null };
    }

    // 4. 用最近记录构造草稿（fileState + savedContent）
    const draft = { fileState: onCreateStoredState(record), savedContent: record.savedContent ?? null };

    // 5. 记录里没有 path，表示文件从未落盘，仅返回草稿
    if (!record.path) {
      return { draft, disk: null, error: null };
    }

    // 6. 读取磁盘文件；失败时回查 path status，区分"不存在"与"读取失败"
    const [readDiskError, diskFile] = await asyncTo(native.readFile(record.path));
    if (readDiskError) {
      const [statusError, status] = await asyncTo(native.getPathStatus(record.path));
      if (statusError) {
        return { draft, disk: null, error: statusError };
      }
      if (!status.exists) {
        // 文件已被删除 / 移走，标记 missing 以走恢复流程
        return { draft, disk: null, error: null, missing: true };
      }
      // 文件存在但读不出来（权限 / IO 错误）
      return { draft, disk: null, error: readDiskError };
    }

    return {
      draft,
      disk: { fileState: onCreateDiskState(context.fileId, record.path, diskFile) },
      error: null,
      missing: false
    };
  }

  /**
   * 解析普通文本内容。编辑器文件无需解析，直接返回原始文本。
   * @param context - 文件解析上下文
   * @returns 成功返回 `[undefined, content]`
   */
  function onParseContent(context: FileParseContext): FileParseResult<string> {
    return [undefined, context.content];
  }

  /**
   * 序列化普通文本内容。
   * @param context - 文件序列化上下文
   * @returns 原始文本内容
   */
  function onSerializeData(context: FileSerializeContext<string>): string {
    return context.data;
  }

  /**
   * 构建普通编辑器最近文件记录。
   * @param context - 当前控制器记录上下文
   * @returns 普通最近文件记录
   */
  function onBuildRecord(context: FileRecordContext<string>): StoredFile {
    return {
      ...context.fileState,
      type: 'file',
      url: createRecentUrl('file', context.fileState.id),
      title: createDocumentTitle(context.fileState.name, context.fileState.ext),
      description: createDocumentDescription(context.fileState.path),
      savedContent: context.savedContent,
      modifiedAt: context.modifiedAt
    };
  }

  /**
   * 写入普通编辑器文件快照。
   * @param context - 精确写盘上下文
   */
  async function onWriteFile(context: FileWriteContext): Promise<void> {
    await native.writeFile(context.path, context.content);
  }

  /**
   * 打开系统保存对话框并写入精确内容快照。
   * @param context - 另存为上下文
   * @returns 最终保存路径；取消时返回 null
   */
  async function onSaveAsFile(context: FileSaveAsContext): Promise<string | null> {
    const defaultPath = context.suggestedPath || context.fileState.path || getDefaultSavePath(context.fileState);
    return native.saveFile(context.content, undefined, { defaultPath });
  }

  /**
   * 执行编辑器重命名交互与磁盘操作。
   * @param context - 当前文件重命名上下文
   * @returns 最新文件元信息；取消时返回 null
   */
  async function onRenameFile(context: FileRenameContext): Promise<FileRenameResult | null> {
    const [cancelled, newName] = await Modal.input('重命名', { defaultValue: context.fileState.name, placeholder: '请输入文件名', autofocus: true });
    const normalizedName = String(newName || '').trim();
    if (cancelled || !normalizedName || normalizedName === context.fileState.name) {
      return null;
    }

    const nextPath = context.fileState.path ? replaceFileName(context.fileState.path, normalizedName, context.fileState.ext) : null;
    if (context.fileState.path && nextPath) {
      await native.renameFile(context.fileState.path, nextPath);
    }

    return { name: normalizedName, ext: context.fileState.ext, path: nextPath };
  }

  /**
   * 询问用户如何处理编辑器草稿与磁盘冲突。
   * @returns `true` 表示保留本地草稿，`false` 表示使用磁盘内容
   */
  async function onResolveConflict(): Promise<FileConflictDecision> {
    const [, confirmed] = await Modal.confirm('发现内容冲突', '当前文件有未保存草稿，同时磁盘内容也已变化。是否使用磁盘中的最新内容？', {
      confirmText: '使用磁盘内容',
      cancelText: '保留本地草稿'
    });
    return confirmed;
  }

  /**
   * 通过独占创建与覆盖确认安全恢复丢失文件。
   * @param context - 当前丢失文件状态
   * @returns 是否完成原路径恢复
   */
  async function onRestoreFile(context: FileRestoreContext): Promise<boolean> {
    return restoreMissingFile(context.fileState, { title: '文件已存在', message: '原文件路径已重新出现同名文件。是否覆盖它？' });
  }

  /**
   * 确认是否删除当前编辑器文件。
   * @param context - 删除前文件状态
   * @returns 是否继续删除
   */
  async function onConfirmDelete(context: FileDeleteContext): Promise<boolean> {
    const title = resolveFileTitle(context.fileState);
    const confirmMessage = context.fileState.path ? `确定要删除文件 "${title}" 吗？` : `确定要删除未保存文档 "${title}" 吗？`;
    const [, confirmed] = await Modal.delete(confirmMessage);
    return confirmed;
  }

  /**
   * 将已确认删除的磁盘文件移入废纸篓。
   * @param context - 删除前文件状态
   */
  async function onDeleteDiskFile(context: FileDeleteContext): Promise<void> {
    if (!context.fileState.path) return;
    await native.trashFile(context.fileState.path);
  }

  /**
   * 完成删除后的标签和路由收尾。
   */
  async function onDeleted(): Promise<void> {
    await router.push('/welcome');
    tabsStore.removeTab(fileId.value);
  }

  /**
   * 向用户显示控制器持久化错误。
   * @param context - 错误来源与错误对象
   */
  function onReportFileError(context: FileControllerErrorContext): void {
    const labels: Record<FileControllerErrorContext['source'], string> = {
      draft: '草稿保存失败',
      save: '文件保存失败',
      saveAs: '另存为失败',
      rename: '重命名失败',
      restore: '文件恢复失败',
      delete: '文件删除失败',
      watch: '文件监听失败'
    };
    message.error(`${labels[context.source]}：${context.error.message}`);
  }

  const controller = useFileController<string>({
    fileId,
    events: {
      onCreate: onCreateFile,
      onLoad: onLoadFile,
      onParse: onParseContent,
      onSerialize: onSerializeData,
      onBuildRecord,
      onWriteFile,
      onSaveAs: onSaveAsFile,
      onRename: onRenameFile,
      onResolveConflict,
      onRestoreFile,
      onConfirmDelete,
      onDeleteFile: onDeleteDiskFile,
      onDeleted,
      onError: onReportFileError
    }
  });
  const fileState = controller.fileState as Ref<EditorFile>;
  const currentTitle = computed<string>((): string => resolveFileTitle(fileState.value));

  // BEditor 直接修改 fileState.content；这里把变化桥接到控制器的泛型 data，统一触发序列化与保存策略。
  watch(
    () => fileState.value.content,
    (content: string): void => {
      if (controller.data.value !== content) {
        controller.data.value = content;
      }
    }
  );

  /**
   * 同步当前文件标题和路由缓存元信息到标签。
   */
  function onUpdateTab(): void {
    if (!fileId.value) return;
    tabsStore.addTab({
      id: fileId.value,
      path: sessionPath.value,
      title: currentTitle.value,
      cacheKey: sessionCacheKey.value,
      recentKey: createRecentKey({ type: 'file', id: fileId.value })
    });
  }

  watch([fileId, () => fileState.value.name, () => fileState.value.ext], onUpdateTab, { immediate: true });

  /**
   * 复制当前文档为新的未落盘记录。
   */
  async function onDuplicate(): Promise<void> {
    const nextId = nanoid();
    const nextName = fileState.value.name ? `${fileState.value.name}-副本` : '';
    const [addError] = await asyncTo(
      recentStore.addFile({
        ...fileState.value,
        type: 'file' as const,
        id: nextId,
        url: createRecentUrl('file', nextId),
        title: createDocumentTitle(nextName, fileState.value.ext),
        description: createDocumentDescription(null),
        name: nextName,
        path: null,
        savedContent: fileState.value.content
      })
    );
    if (addError) return;
    await asyncTo(router.push({ name: 'editor', params: { id: nextId } }));
  }

  /**
   * 在系统文件管理器中显示当前文件。
   */
  async function onShowInFolder(): Promise<void> {
    if (!fileState.value.path) return;
    await asyncTo(native.showItemInFolder(fileState.value.path));
  }

  /**
   * 复制当前文件绝对路径。
   */
  async function onCopyPath(): Promise<void> {
    if (!fileState.value.path) return;
    await asyncTo(clipboard(fileState.value.path, { successMessage: '已复制路径', trim: false }));
  }

  /**
   * 复制当前文件相对路径。
   */
  async function onCopyRelativePath(): Promise<void> {
    if (!fileState.value.path) return;
    const [pathError, relativePath] = await asyncTo(native.getRelativePath(fileState.value.path));
    if (pathError) return;
    await asyncTo(clipboard(relativePath || fileState.value.path, { successMessage: '已复制相对路径', trim: false }));
  }

  /**
   * 重新加载当前编辑器文件。
   */
  async function loadFileState(): Promise<void> {
    await controller.actions.onReload();
  }

  /**
   * 释放当前编辑器文件会话。
   */
  async function dispose(): Promise<void> {
    await controller.actions.onDispose();
  }

  asyncTo(loadFileState());

  return {
    fileState,
    isLoading: controller.isLoading,
    viewState,
    currentTitle,
    actions: {
      onEditorBlur: controller.actions.onBlur,
      onSave: controller.actions.onSave,
      onSaveAs: controller.actions.onSaveAs,
      onRename: controller.actions.onRename,
      onDelete: controller.actions.onDelete,
      onShowInFolder,
      onCopyPath,
      onCopyRelativePath,
      onDuplicate
    },
    loadFileState,
    dispose
  };
}
