/**
 * @file useFileReference.ts
 * @description 文件引用管理 hook
 */
import type { FileReferenceChip } from '../types';
import { nextTick, onMounted, onUnmounted } from 'vue';
import type { ChatFileReferenceInsertPayload } from '@/shared/chat/fileReference';
import { onChatFileReferenceInsert } from '@/shared/chat/fileReference';
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
      .map((file) => `{{#[](${file.name})}}`)
      .join('');
  }

  /**
   * 处理聊天中插入文件引用
   * 将文件引用 token 插入到输入框
   * @param reference - 文件引用信息
   */
  function insertReference(reference: FileReferenceChip) {
    const { id, fileName, filePath, startLine, endLine, renderStartLine, renderEndLine } = reference;

    const token = `{{#${filePath || `unsaved://${id}/${fileName}`} ${startLine}-${endLine}|${renderStartLine}-${renderEndLine}}} `;

    options.insertTextAtCursor(token);
  }

  /**
   * 处理文件引用插入事件
   * 从编辑器上下文获取文档信息，构建完整的文件引用并插入
   * @param reference - 文件引用插入载荷
   */
  async function handleFileReferenceInsert(reference: ChatFileReferenceInsertPayload): Promise<void> {
    const { startLine, endLine, id, ext, filePath, fileName, renderStartLine, renderEndLine } = reference;

    // 先锁定聊天输入框最近一次有效插入位置，再处理侧边栏聚焦与引用插入
    options.saveCursorPosition();
    settingStore.setSidebarVisible(true);

    await nextTick();
    insertReference({ id, filePath, fileName: `${fileName}.${ext}`, startLine, endLine, renderStartLine, renderEndLine });
    options.focusInput();
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
    onPasteFiles,
    insertReference
  };
}
