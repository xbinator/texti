/**
 * @file useChatComposer.ts
 * @description 聚合 BChat 输入编辑器、附件、文件引用与模型选择能力。
 */
import type { InteractionAPI } from '../components/InteractionContainer/types';
import type { ComputedRef, Ref } from 'vue';
import { computed, onMounted } from 'vue';
import type BSmartEditor from '@/components/BSmart/Editor.vue';
import type { BSmartEditorExpose, FileMentionOption } from '@/components/BSmart/types';
import { useFileDrop } from '@/hooks/useFileDrop';
import type { OpenFileOptions } from '@/hooks/useNavigate';
import type { StoredDocumentRecord } from '@/shared/storage';
import { useRecentStore } from '@/stores/workspace/recent';
import type { FileReferenceNavigationTarget } from '@/utils/file/reference';
import { createChatChipResolver } from '../utils/chipResolver';
import { useChatInput } from './useChatInput';
import { useFileReference } from './useFileReference';
import { useImageUpload } from './useImageUpload';
import { useModelSelection } from './useModelSelection';
import { useWorkspaceMentions } from './useWorkspaceMentions';

/**
 * 输入编辑器组件实例与对外公开方法。
 */
type EditorInstance = InstanceType<typeof BSmartEditor> & BSmartEditorExpose;

/**
 * 最近文件路径权重索引。
 */
type RecentPathRankMap = Map<string, number>;

/**
 * Chat Composer hook 依赖项。
 */
interface UseChatComposerOptions {
  /** 当前活动会话 ID；空值表示草稿。 */
  activeSessionId: Readonly<Ref<string | null>>;
  /** 当前 Runtime 应使用的工作区根目录。 */
  workspaceRoot: Readonly<Ref<string | null>>;
  /** 手动选择的会话工作区；undefined 表示使用默认工作区。 */
  workspaceOverride: Readonly<Ref<string | undefined>>;
  /** 文件拖拽容器引用 */
  containerRef: Ref<HTMLElement | null>;
  /** 交互容器 API */
  interactionAPI: InteractionAPI;
  /** 在编辑器中打开文件 */
  openFile: (options: OpenFileOptions) => Promise<void>;
  /** 打开 Skill 独立详情页 */
  openSkill: (skillName: string) => void;
  /** 输入编辑器组件引用 */
  promptEditorRef: Ref<EditorInstance | undefined>;
}

/**
 * Chat Composer hook 返回值。
 */
interface UseChatComposerReturn {
  /** 聚焦输入编辑器 */
  focusInput: (options?: { moveToEnd?: boolean }) => void;
  /** 草稿输入状态与操作 */
  input: ReturnType<typeof useChatInput>;
  /** 模型选择状态与操作 */
  model: ReturnType<typeof useModelSelection>;
  /** 图片上传能力 */
  imageUpload: ReturnType<typeof useImageUpload>;
  /** 文件引用能力 */
  fileReference: ReturnType<typeof useFileReference>;
  /** 当前是否允许提交 */
  canSubmit: ComputedRef<boolean>;
  /** 拖拽是否进入输入区域 */
  isContainerDragActive: Ref<boolean>;
  /** 文件提及候选项 */
  fileMentionOptions: ComputedRef<FileMentionOption[]>;
  /** 文件与 Skill 引用 chip resolver */
  promptChipResolver: ReturnType<typeof createChatChipResolver>;
  /** 处理文件提及选择 */
  handleFileMentionSelect: (file: FileMentionOption) => void;
}

/**
 * 规范化文件路径，便于跨平台比较最近文件和工作区候选。
 * @param filePath - 原始路径
 * @returns POSIX 风格路径
 */
function normalizeComparablePath(filePath: string): string {
  return filePath.replace(/\\/gu, '/').replace(/\/+/gu, '/').replace(/\/$/u, '');
}

/**
 * 拼接工作区根目录和相对路径。
 * @param workspaceRoot - 工作区根目录
 * @param relativePath - 工作区相对路径
 * @returns 可比较的绝对路径
 */
function resolveWorkspaceFilePath(workspaceRoot: string, relativePath: string): string {
  const normalizedRoot = normalizeComparablePath(workspaceRoot);
  const normalizedRelativePath = normalizeComparablePath(relativePath).replace(/^\.\//u, '');
  if (!normalizedRelativePath || normalizedRelativePath === '.') return normalizedRoot;
  return `${normalizedRoot}/${normalizedRelativePath}`;
}

/**
 * 建立最近文件路径权重索引。
 * @param files - 最近文件记录
 * @returns 路径到最近打开时间的映射
 */
function createRecentPathRanks(files: readonly StoredDocumentRecord[] | null): RecentPathRankMap {
  const ranks: RecentPathRankMap = new Map<string, number>();
  for (const file of files ?? []) {
    if (!file.path) continue;
    const normalizedPath = normalizeComparablePath(file.path);
    const currentRank = ranks.get(normalizedPath) ?? 0;
    ranks.set(normalizedPath, Math.max(currentRank, file.openedAt ?? 0));
  }
  return ranks;
}

/**
 * 按最近使用权重和稳定路径顺序排序工作区候选。
 * @param files - 工作区文件候选
 * @param workspaceRoot - 当前工作区根目录
 * @param recentRanks - 最近文件路径权重
 * @returns 排序后的文件候选
 */
function sortWorkspaceMentions(files: readonly FileMentionOption[], workspaceRoot: string | null, recentRanks: RecentPathRankMap): FileMentionOption[] {
  if (!workspaceRoot) return [...files];

  return files
    .map((file: FileMentionOption, index: number): { file: FileMentionOption; index: number; rank: number } => {
      const absolutePath = file.path ? resolveWorkspaceFilePath(workspaceRoot, file.path) : '';
      return {
        file,
        index,
        rank: recentRanks.get(absolutePath) ?? 0
      };
    })
    .sort((first, second): number => {
      if (first.rank !== second.rank) return second.rank - first.rank;
      return first.index - second.index;
    })
    .map((item): FileMentionOption => item.file);
}

/**
 * 聚合聊天输入区域所需能力。
 * @param options - Toast 与文件导航依赖
 * @returns 输入区域状态和事件 API
 */
export function useChatComposer(options: UseChatComposerOptions): UseChatComposerReturn {
  const recentStore = useRecentStore();

  /** 聚焦输入编辑器。 */
  function focusInput(focusOptions?: { moveToEnd?: boolean }): void {
    options.promptEditorRef.value?.focus(focusOptions);
  }

  /** 保存输入编辑器光标位置。 */
  function saveCursorPosition(): void {
    options.promptEditorRef.value?.saveCursorPosition();
  }

  /**
   * 在当前光标处插入输入文本。
   * @param text - 插入文本
   */
  function insertTextAtCursor(text: string): void {
    options.promptEditorRef.value?.insertTextAtCursor(text);
  }

  /** 打开输入框内的文件引用。 */
  function handleOpenPromptFileReference(target: FileReferenceNavigationTarget): void {
    options.openFile({
      filePath: target.filePath,
      fileId: target.fileId,
      fileName: target.fileName,
      range: {
        startLine: target.startLine,
        endLine: target.endLine
      }
    });
  }

  const promptChipResolver = createChatChipResolver(handleOpenPromptFileReference, options.openSkill);
  const input = useChatInput({ focusInput });
  const model = useModelSelection(options.activeSessionId);
  const imageUpload = useImageUpload({ supportsVision: model.supportsVision, inputEvents: input, interactionAPI: options.interactionAPI });
  const workspaceMentionEnabled = computed<boolean>((): boolean => options.workspaceOverride.value !== undefined);
  const workspaceMentions = useWorkspaceMentions({
    workspaceRoot: options.workspaceRoot,
    enabled: workspaceMentionEnabled
  });
  const fileReference = useFileReference({
    insertTextAtCursor,
    saveCursorPosition,
    focusInput
  });
  const canSubmit = computed<boolean>((): boolean => !input.isEmpty() || input.hasImages());

  /** 将拖入文件分发到图片附件或文本文件引用。 */
  async function handleInputDropFiles(files: File[]): Promise<void> {
    const imageFiles = files.filter((file: File): boolean => file.type.startsWith('image/'));
    const otherFiles = files.filter((file: File): boolean => !file.type.startsWith('image/'));

    if (imageFiles.length > 0) {
      await imageUpload.appendImages(imageFiles);
    }
    if (otherFiles.length > 0) {
      const tokenText = fileReference.onPasteFiles(otherFiles);
      if (tokenText) {
        insertTextAtCursor(tokenText);
      }
    }
  }

  const { isDragging: isContainerDragActive } = useFileDrop({ targetRef: options.containerRef, onDropFiles: handleInputDropFiles });
  const recentPathRanks = computed<RecentPathRankMap>((): RecentPathRankMap => createRecentPathRanks(recentStore.recentFiles));
  const recentFileMentionOptions = computed<FileMentionOption[]>(() =>
    (recentStore.recentFiles ?? [])
      .filter((file): boolean => file.ext.toLowerCase() === 'md')
      .map((file): FileMentionOption => ({ id: file.id, name: file.name, path: file.path, ext: file.ext }))
  );
  const fileMentionOptions = computed<FileMentionOption[]>((): FileMentionOption[] => {
    if (workspaceMentionEnabled.value) {
      return sortWorkspaceMentions(workspaceMentions.fileMentions.value, options.workspaceRoot.value, recentPathRanks.value);
    }
    return recentFileMentionOptions.value;
  });

  /** 记录文件提及选择，实际 token 已由编辑器写入草稿。 */
  function handleFileMentionSelect(file: FileMentionOption): void {
    console.log('File mention selected:', file.name);
  }

  onMounted(async (): Promise<void> => {
    await model.loadSelectedModel();
    await recentStore.ensureLoaded();
  });

  return {
    focusInput,
    input,
    model,
    imageUpload,
    fileReference,
    canSubmit,
    isContainerDragActive,
    fileMentionOptions,
    promptChipResolver,
    handleFileMentionSelect
  };
}
