/**
 * @file useDraftInput.ts
 * @description 草稿输入状态管理 hook
 */
import type { Message } from '../utils/types';
import type { ChatMessageFileReference } from 'types/chat';
import { ref } from 'vue';

/**
 * 草稿输入 Hook 的依赖项
 */
interface DraftInputOptions {
  /** 聚焦输入框 */
  focusInput: () => void;
}

/**
 * 草稿输入状态管理 hook
 * @param options - 依赖项配置
 * @returns 草稿输入状态和操作方法
 */
export function useDraftInput(options: DraftInputOptions) {
  /** 聊天输入框内容 */
  const inputValue = ref('');
  /** 草稿文件引用列表 */
  const draftReferences = ref<ChatMessageFileReference[]>([]);

  /**
   * 清空当前草稿输入和文件引用，不影响对话内容
   */
  function clear(): void {
    inputValue.value = '';
    draftReferences.value = [];
    options.focusInput();
  }

  /**
   * 设置草稿内容（用于编辑消息）
   * @param content - 消息内容
   * @param references - 文件引用列表
   */
  function setContent(content: string, references?: ChatMessageFileReference[]): void {
    inputValue.value = content;
    draftReferences.value = references ? [...references] : [];
  }

  /**
   * 设置草稿文件引用
   * @param references - 文件引用列表
   */
  function setReferences(references: ChatMessageFileReference[]): void {
    draftReferences.value = references;
  }

  /**
   * 从消息恢复草稿（用于编辑消息）
   * @param message - 要编辑的消息
   */
  function restoreFromMessage(message: Message): void {
    inputValue.value = message.content;
    draftReferences.value = [...(message.references ?? [])];
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
   * 检查输入内容是否为空
   * @returns 输入内容是否为空
   */
  function isEmpty(): boolean {
    return inputValue.value.trim().length === 0;
  }

  return {
    inputValue,
    draftReferences,
    clear,
    setContent,
    setReferences,
    restoreFromMessage,
    getActiveReferences,
    isEmpty
  };
}
