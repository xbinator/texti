/**
 * @file useFileReference.ts
 * @description 文件引用管理 hook
 */
import type { FileReferenceChip } from '../types';
import type { ChatMessageFileReference } from 'types/chat';
import { nextTick, onMounted, onUnmounted, ref } from 'vue';
import { nanoid } from 'nanoid';
import { editorToolContextRegistry } from '@/ai/tools/editor-context';
import { onChatFileReferenceInsert, type ChatFileReferenceInsertPayload } from '@/shared/chat/fileReference';
import { useSettingStore } from '@/stores/setting';

/**
 * 文件引用 Hook 的依赖项
 */
interface FileReferenceOptions {
  /** 插入文本到光标位置 */
  insertTextAtCursor: (text: string) => void;
  /** 保存光标位置 */
  saveCursorPosition: () => void;
  /** 聚焦输入框 */
  focusInput: () => void;
}

/**
 * 文件引用管理 hook
 * @param options - 依赖项配置
 * @returns 文件引用状态和操作方法
 */
export function useFileReference(options: FileReferenceOptions) {
  const settingStore = useSettingStore();

  /** 草稿文件引用列表 */
  const draftReferences = ref<ChatMessageFileReference[]>([]);
  /** 文件引用插入事件取消注册函数 */
  let unregisterFileReferenceInsert: (() => void) | null = null;

  /**
   * 文件粘贴/拖拽回调，将文件列表转换为 file-ref token
   * 无选区时 startLine/endLine 均为 0
   * @param files - 粘贴或拖拽的文件列表
   * @returns 生成的 token 字符串
   */
  function onPasteFiles(files: File[]): string {
    return Array.from(files)
      .map((file) => `{{file-ref:${encodeURIComponent(file.name)}|${file.name}|0|0}} `)
      .join('');
  }

  /**
   * 将 startLine/endLine 转换为 ChatMessageFileReference.line 字符串格式
   * @param startLine - 起始行号
   * @param endLine - 结束行号
   * @returns 格式化的行号字符串，如 "10" 或 "10-20"
   */
  function formatLineRange(startLine: number, endLine: number): string {
    if (startLine <= 0) {
      return '';
    }

    return startLine === endLine ? String(startLine) : `${startLine}-${endLine}`;
  }

  /**
   * 处理聊天中插入文件引用
   * 将文件引用添加到草稿列表并插入 token 到输入框
   * @param reference - 文件引用信息
   */
  function insertReference(reference: FileReferenceChip): void {
    const token = `{{file-ref:${reference.referenceId}|${reference.fileName}|${reference.startLine}|${reference.endLine}}} `;
    draftReferences.value = [
      ...draftReferences.value.filter((item) => item.id !== reference.referenceId),
      {
        id: reference.referenceId,
        token,
        documentId: reference.documentId,
        fileName: reference.fileName,
        line: formatLineRange(reference.startLine, reference.endLine),
        path: reference.filePath,
        snapshotId: ''
      }
    ];
    options.insertTextAtCursor(token);
  }

  /**
   * 处理文件引用插入事件
   * 从编辑器上下文获取文档信息，构建完整的文件引用并插入
   * @param reference - 文件引用插入载荷
   */
  async function handleFileReferenceInsert(reference: ChatFileReferenceInsertPayload): Promise<void> {
    const toolContext = editorToolContextRegistry.getCurrentContext();
    const enrichedReference: FileReferenceChip = {
      referenceId: nanoid(),
      documentId: toolContext?.document.id || reference.filePath || reference.fileName,
      filePath: reference.filePath ?? toolContext?.document.path ?? null,
      fileName: reference.fileName,
      startLine: reference.startLine,
      endLine: reference.endLine
    };

    // 先锁定聊天输入框最近一次有效插入位置，再处理侧边栏聚焦与引用插入
    options.saveCursorPosition();
    settingStore.setSidebarVisible(true);

    await nextTick();
    insertReference(enrichedReference);
    options.focusInput();
  }

  /**
   * 获取内容中活跃的草稿文件引用
   * @param content - 输入内容
   * @returns 活跃的引用列表，无则返回 undefined
   */
  function getActiveReferences(content: string): ChatMessageFileReference[] | undefined {
    const references = draftReferences.value.filter((reference) => content.includes(reference.token));

    return references.length ? references : undefined;
  }

  /**
   * 清空草稿文件引用
   */
  function clearReferences(): void {
    draftReferences.value = [];
  }

  /**
   * 设置草稿文件引用（用于编辑消息时恢复）
   * @param references - 文件引用列表
   */
  function setReferences(references: ChatMessageFileReference[] | undefined): void {
    draftReferences.value = references ? [...references] : [];
  }

  /** 注册文件引用插入事件监听 */
  onMounted(() => {
    unregisterFileReferenceInsert = onChatFileReferenceInsert((reference) => {
      handleFileReferenceInsert(reference);
    });
  });

  /** 取消注册文件引用插入事件监听 */
  onUnmounted(() => {
    unregisterFileReferenceInsert?.();
    unregisterFileReferenceInsert = null;
  });

  return {
    draftReferences,
    onPasteFiles,
    insertReference,
    getActiveReferences,
    clearReferences,
    setReferences
  };
}
