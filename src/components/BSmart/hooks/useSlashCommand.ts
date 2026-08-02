/**
 * @file useSlashCommand.ts
 * @description 斜杠命令 Hook，管理 /命令 的状态、过滤和选择逻辑
 */
import type { SlashCommandOption } from '../types';
import type { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { computed, ref, type Ref, type ComputedRef, type ShallowRef } from 'vue';

/**
 * 光标处活动的斜杠查询范围。
 */
export interface SlashCommandContext {
  /** 查询起始位置。 */
  from: number;
  /** 查询结束位置。 */
  to: number;
  /** 不含 `/` 的查询文本。 */
  query: string;
}

/**
 * 判断候选项是否匹配当前查询。
 * @param command - 候选项
 * @param query - 不含 `/` 的查询文本
 * @returns 是否匹配触发前缀、标题或描述
 */
export function isSlashCommandMatch(command: SlashCommandOption, query: string): boolean {
  const normalizedQuery = query.toLocaleLowerCase();
  if (!normalizedQuery) return true;

  return (
    command.trigger.slice(1).toLocaleLowerCase().startsWith(normalizedQuery) ||
    command.title.toLocaleLowerCase().includes(normalizedQuery) ||
    command.description.toLocaleLowerCase().includes(normalizedQuery)
  );
}

/**
 * 从纯文本和光标位置读取斜杠查询上下文。
 * @param text - 编辑器完整文本
 * @param position - 空选择区的光标位置
 * @param commands - 当前候选项
 * @returns 合法且至少有一项匹配时返回活动范围
 */
export function findSlashCommandContext(text: string, position: number, commands: readonly SlashCommandOption[]): SlashCommandContext | null {
  if (commands.length === 0 || position < 0 || position > text.length) return null;

  const textBeforeCursor = text.slice(0, position);
  const slashIndex = textBeforeCursor.lastIndexOf('/');
  if (slashIndex < 0) return null;

  const boundary = slashIndex > 0 ? textBeforeCursor[slashIndex - 1] : '';
  if (slashIndex > 0 && !/\s/u.test(boundary)) return null;

  const query = textBeforeCursor.slice(slashIndex + 1);
  if (/[\s/]/u.test(query)) return null;
  if (!commands.some((command: SlashCommandOption): boolean => isSlashCommandMatch(command, query))) return null;

  return { from: slashIndex, to: position, query };
}

/**
 * useSlashCommand 返回类型
 */
export interface UseSlashCommandReturn {
  /** 是否显示斜杠命令菜单 */
  slashVisible: Ref<boolean>;
  /** 当前高亮索引 */
  slashActiveIndex: Ref<number>;
  /** 当前活动项是否需要滚动到可视区 */
  slashShouldScrollActive: Ref<boolean>;
  /** 过滤后的命令列表 */
  filteredSlashCommands: ComputedRef<readonly SlashCommandOption[]>;
  /** 当前活动范围 */
  slashRange: Ref<{ from: number; to: number } | null>;

  /** 从编辑器状态同步菜单状态 */
  syncSlashCommandState: (state: EditorState, editorView: EditorView | null) => void;
  /** 关闭菜单 */
  closeSlashCommandMenu: (suppressSync?: boolean) => void;
  /** 处理选择 */
  handleSlashCommandSelect: (command: SlashCommandOption) => void;
  /** 处理索引变化 */
  handleSlashActiveIndexChange: (index: number) => void;
  /** 键盘导航 - 上 */
  handleSlashCommandArrowUp: () => boolean;
  /** 键盘导航 - 下 */
  handleSlashCommandArrowDown: () => boolean;
  /** 键盘确认 */
  handleSlashCommandEnter: () => boolean;
}

/**
 * 斜杠命令 Hook
 * @param view - EditorView 引用
 * @param slashCommands - 斜杠命令列表
 * @param emit - 事件发射函数
 */
export function useSlashCommand(
  view: ShallowRef<EditorView | null>,
  slashCommands: ComputedRef<readonly SlashCommandOption[]>,
  emit: (event: 'slash-command', command: SlashCommandOption) => void
): UseSlashCommandReturn {
  // 状态
  const slashVisible = ref(false);
  const slashActiveIndex = ref(0);
  const slashShouldScrollActive = ref(false);
  const slashQuery = ref('');
  const slashRange = ref<{ from: number; to: number } | null>(null);
  const suppressSlashSync = ref(false);

  // 过滤后的命令列表
  const filteredSlashCommands = computed<readonly SlashCommandOption[]>(() => {
    return slashCommands.value.filter((command: SlashCommandOption): boolean => isSlashCommandMatch(command, slashQuery.value));
  });

  /**
   * 获取光标位置处的当前斜杠命令上下文
   */
  function getSlashCommandContext(state: EditorState): SlashCommandContext | null {
    if (slashCommands.value.length === 0) {
      return null;
    }

    const selection = state.selection.main;
    if (!selection.empty) {
      return null;
    }

    return findSlashCommandContext(state.doc.toString(), selection.head, slashCommands.value);
  }

  /**
   * 判断新旧斜杠命令上下文是否一致。
   * @param context - 新读取到的斜杠命令上下文
   * @returns 上下文未变化时返回 true
   */
  function isSameSlashContext(context: SlashCommandContext): boolean {
    return slashRange.value?.from === context.from && slashRange.value.to === context.to && slashQuery.value === context.query;
  }

  /**
   * 将高亮索引限制在当前命令候选范围内。
   */
  function clampSlashIndex(): void {
    const maxIndex = filteredSlashCommands.value.length - 1;
    slashActiveIndex.value = Math.max(0, Math.min(slashActiveIndex.value, maxIndex));
  }

  /**
   * 关闭斜杠命令菜单
   */
  function closeSlashCommandMenu(suppressSync = false): void {
    if (suppressSync) {
      suppressSlashSync.value = true;
    }
    slashVisible.value = false;
    slashShouldScrollActive.value = false;
    slashQuery.value = '';
    slashRange.value = null;
  }

  /**
   * 从编辑器内容同步斜杠命令菜单状态
   */
  function syncSlashCommandState(state: EditorState, editorView: EditorView | null): void {
    if (!editorView) {
      closeSlashCommandMenu();
      return;
    }

    if (suppressSlashSync.value) {
      suppressSlashSync.value = false;
      closeSlashCommandMenu();
      return;
    }

    const context = getSlashCommandContext(state);
    if (!context) {
      closeSlashCommandMenu();
      return;
    }

    const keepActiveIndex = isSameSlashContext(context);
    slashVisible.value = true;
    slashQuery.value = context.query;
    slashRange.value = { from: context.from, to: context.to };

    if (keepActiveIndex) {
      clampSlashIndex();
      return;
    }

    slashShouldScrollActive.value = false;
    slashActiveIndex.value = 0;
  }

  /**
   * 更新高亮斜杠命令索引，并记录是否需要滚动到可视区。
   * @param index - 新的高亮索引
   * @param shouldScrollActive - 是否需要滚动当前活动项
   */
  function updateSlashActiveIndex(index: number, shouldScrollActive: boolean): void {
    slashShouldScrollActive.value = shouldScrollActive;
    slashActiveIndex.value = index;
  }

  /**
   * 更新高亮斜杠命令的索引
   */
  function handleSlashActiveIndexChange(index: number): void {
    updateSlashActiveIndex(index, false);
  }

  /**
   * 应用选中的斜杠命令并清除活动斜杠文本
   */
  function handleSlashCommandSelect(command: SlashCommandOption): void {
    if (!view.value || !slashRange.value) return;

    const { from, to } = slashRange.value;
    const { selectAction } = command;
    const nextCharacter = view.value.state.sliceDoc(to, Math.min(to + 1, view.value.state.doc.length));
    const suffix = nextCharacter && /\s/u.test(nextCharacter) ? '' : ' ';
    const insert = selectAction.type === 'insert' ? `${selectAction.text}${suffix}` : '';
    view.value.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + insert.length }
    });

    if (selectAction.type === 'emit') emit('slash-command', command);
    closeSlashCommandMenu();
    view.value.focus();
  }

  /**
   * 选择当前高亮的斜杠命令
   */
  function handleSlashCommandEnter(): boolean {
    const command = filteredSlashCommands.value[slashActiveIndex.value];
    if (!command) {
      return false;
    }

    handleSlashCommandSelect(command);
    return true;
  }

  /**
   * 向上移动斜杠命令高亮
   */
  function handleSlashCommandArrowUp(): boolean {
    const list = filteredSlashCommands.value;
    if (!slashVisible.value) return false;
    if (list.length === 0) return true;

    const newIndex = (slashActiveIndex.value - 1 + list.length) % list.length;
    updateSlashActiveIndex(newIndex, true);
    return true;
  }

  /**
   * 向下移动斜杠命令高亮
   */
  function handleSlashCommandArrowDown(): boolean {
    const list = filteredSlashCommands.value;
    if (!slashVisible.value) return false;
    if (list.length === 0) return true;

    const newIndex = (slashActiveIndex.value + 1) % list.length;
    updateSlashActiveIndex(newIndex, true);
    return true;
  }

  return {
    slashVisible,
    slashActiveIndex,
    slashShouldScrollActive,
    filteredSlashCommands,
    slashRange,
    syncSlashCommandState,
    closeSlashCommandMenu,
    handleSlashCommandSelect,
    handleSlashActiveIndexChange,
    handleSlashCommandArrowUp,
    handleSlashCommandArrowDown,
    handleSlashCommandEnter
  };
}
