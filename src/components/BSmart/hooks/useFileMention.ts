/**
 * @file useFileMention.ts
 * @description 文件提及 Hook，管理 @文件 的状态、过滤和选择逻辑
 */
import type { FileMentionOption } from '../types';
import type { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { computed, ref, type Ref, type ComputedRef, type ShallowRef } from 'vue';
import { buildFileReferenceToken } from '@/utils/file/reference';
import { filterAndSortFiles } from '../utils/fileScoring';

/** 默认文件提及候选展示数量。 */
const DEFAULT_FILE_MENTION_LIMIT = 100;

/**
 * useFileMention 返回类型
 */
export interface UseFileMentionReturn {
  /** 是否显示文件提及菜单 */
  mentionVisible: Ref<boolean>;
  /** 当前高亮索引 */
  mentionActiveIndex: Ref<number>;
  /** 当前活动项是否需要滚动到可视区 */
  mentionShouldScrollActive: Ref<boolean>;
  /** 过滤后的文件列表 */
  filteredFileMentions: ComputedRef<FileMentionOption[]>;
  /** 当前活动范围 */
  mentionRange: Ref<{ from: number; to: number } | null>;

  /** 从编辑器状态同步菜单状态 */
  syncMentionState: (state: EditorState, editorView: EditorView | null) => void;
  /** 关闭菜单 */
  closeMentionMenu: (suppressSync?: boolean) => void;
  /** 处理选择 */
  handleFileMentionSelect: (file: FileMentionOption) => void;
  /** 处理索引变化 */
  handleMentionActiveIndexChange: (index: number) => void;
  /** 键盘导航 - 上 */
  handleMentionArrowUp: () => boolean;
  /** 键盘导航 - 下 */
  handleMentionArrowDown: () => boolean;
  /** 键盘确认 */
  handleMentionEnter: () => boolean;
}

/**
 * 检查字符是否为单词字符
 */
function isWordChar(char: string): boolean {
  return /[a-zA-Z0-9_]/.test(char);
}

/**
 * 判断 @ 是否位于 {{...}} token 内部。
 * @param text - 当前行从行首到光标前的文本
 * @param atIndex - @ 在 text 中的位置
 * @returns 位于 token 内部时返回 true
 */
function isInsideVariableToken(text: string, atIndex: number): boolean {
  const tokenOpenIndex = text.lastIndexOf('{{', atIndex);
  if (tokenOpenIndex === -1) {
    return false;
  }

  const tokenCloseIndex = text.lastIndexOf('}}', atIndex);
  return tokenOpenIndex > tokenCloseIndex;
}

/**
 * 文件提及 Hook
 * @param view - EditorView 引用
 * @param fileMentions - 文件提及列表
 * @param emit - 事件发射函数
 */
export function useFileMention(
  view: ShallowRef<EditorView | null>,
  fileMentions: ComputedRef<readonly FileMentionOption[]>,
  emit: (event: 'file-mention-select', file: FileMentionOption) => void
): UseFileMentionReturn {
  // 状态
  const mentionVisible = ref(false);
  const mentionActiveIndex = ref(0);
  const mentionShouldScrollActive = ref(false);
  const mentionQuery = ref('');
  const mentionRange = ref<{ from: number; to: number } | null>(null);
  const suppressMentionSync = ref(false);

  // 过滤后的文件列表
  const filteredFileMentions = computed<FileMentionOption[]>(() => {
    return filterAndSortFiles(fileMentions.value, mentionQuery.value).slice(0, DEFAULT_FILE_MENTION_LIMIT);
  });

  /**
   * 获取光标位置处的当前文件提及上下文
   */
  function getFileMentionContext(state: EditorState): { from: number; to: number; query: string } | null {
    if (fileMentions.value.length === 0) {
      return null;
    }

    const selection = state.selection.main;
    if (!selection.empty) {
      return null;
    }

    const pos = selection.head;
    const line = state.doc.lineAt(pos);
    const text = state.sliceDoc(line.from, pos);

    // 找最后一个 @
    const atIndex = text.lastIndexOf('@');
    if (atIndex === -1) {
      return null;
    }

    if (isInsideVariableToken(text, atIndex)) {
      return null;
    }

    // 检查 @ 前面是否是单词字符（避免在代码中间触发）
    if (atIndex > 0 && isWordChar(text[atIndex - 1])) {
      return null;
    }

    const query = text.slice(atIndex + 1);

    // 如果 query 包含空格或换行，不触发
    if (/\s/.test(query)) {
      return null;
    }

    return {
      from: line.from + atIndex,
      to: pos,
      query
    };
  }

  /**
   * 判断新旧文件提及上下文是否一致。
   * @param context - 新读取到的文件提及上下文
   * @returns 上下文未变化时返回 true
   */
  function isSameMentionContext(context: { from: number; to: number; query: string }): boolean {
    return mentionRange.value?.from === context.from && mentionRange.value.to === context.to && mentionQuery.value === context.query;
  }

  /**
   * 将高亮索引限制在当前候选范围内。
   */
  function clampMentionIndex(): void {
    const maxIndex = filteredFileMentions.value.length - 1;
    mentionActiveIndex.value = Math.max(0, Math.min(mentionActiveIndex.value, maxIndex));
  }

  /**
   * 关闭文件提及菜单
   */
  function closeMentionMenu(suppressSync = false): void {
    if (suppressSync) {
      suppressMentionSync.value = true;
    }
    mentionVisible.value = false;
    mentionShouldScrollActive.value = false;
    mentionQuery.value = '';
    mentionRange.value = null;
  }

  /**
   * 从编辑器内容同步文件提及菜单状态
   */
  function syncMentionState(state: EditorState, editorView: EditorView | null): void {
    if (!editorView) {
      closeMentionMenu();
      return;
    }

    if (suppressMentionSync.value) {
      suppressMentionSync.value = false;
      closeMentionMenu();
      return;
    }

    const context = getFileMentionContext(state);
    if (!context) {
      closeMentionMenu();
      return;
    }

    const keepActiveIndex = isSameMentionContext(context);
    mentionVisible.value = true;
    mentionQuery.value = context.query;
    mentionRange.value = { from: context.from, to: context.to };

    if (keepActiveIndex) {
      clampMentionIndex();
      return;
    }

    mentionShouldScrollActive.value = false;
    mentionActiveIndex.value = 0;
  }

  /**
   * 更新高亮文件提及索引，并记录是否需要滚动到可视区。
   * @param index - 新的高亮索引
   * @param shouldScrollActive - 是否需要滚动当前活动项
   */
  function updateMentionActiveIndex(index: number, shouldScrollActive: boolean): void {
    mentionShouldScrollActive.value = shouldScrollActive;
    mentionActiveIndex.value = index;
  }

  /**
   * 更新高亮文件提及的索引
   */
  function handleMentionActiveIndexChange(index: number): void {
    updateMentionActiveIndex(index, false);
  }

  /**
   * 应用选中的文件提及并清除活动提及文本
   */
  function handleFileMentionSelect(file: FileMentionOption): void {
    if (!view.value || !mentionRange.value) return;

    const { from, to } = mentionRange.value;
    // 使用文件路径构建 token，无路径时使用 unsaved:// 格式
    const path = file.path ?? `unsaved://${file.id}/${file.name}`;
    const insertText = `${buildFileReferenceToken(path)} `;
    view.value.dispatch({
      changes: { from, to, insert: insertText },
      selection: { anchor: from + insertText.length }
    });

    emit('file-mention-select', file);
    closeMentionMenu();
    view.value.focus();
  }

  /**
   * 选择当前高亮的文件提及
   */
  function handleMentionEnter(): boolean {
    const file = filteredFileMentions.value[mentionActiveIndex.value];
    if (!file) {
      return false;
    }

    handleFileMentionSelect(file);
    return true;
  }

  /**
   * 向上移动文件提及高亮
   */
  function handleMentionArrowUp(): boolean {
    const list = filteredFileMentions.value;
    if (!mentionVisible.value) return false;
    if (list.length === 0) return true;

    const newIndex = (mentionActiveIndex.value - 1 + list.length) % list.length;
    updateMentionActiveIndex(newIndex, true);
    return true;
  }

  /**
   * 向下移动文件提及高亮
   */
  function handleMentionArrowDown(): boolean {
    const list = filteredFileMentions.value;
    if (!mentionVisible.value) return false;
    if (list.length === 0) return true;

    const newIndex = (mentionActiveIndex.value + 1) % list.length;
    updateMentionActiveIndex(newIndex, true);
    return true;
  }

  return {
    mentionVisible,
    mentionActiveIndex,
    mentionShouldScrollActive,
    filteredFileMentions,
    mentionRange,
    syncMentionState,
    closeMentionMenu,
    handleFileMentionSelect,
    handleMentionActiveIndexChange,
    handleMentionArrowUp,
    handleMentionArrowDown,
    handleMentionEnter
  };
}
