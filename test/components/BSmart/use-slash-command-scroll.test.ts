/**
 * @file use-slash-command-scroll.test.ts
 * @description 验证斜杠命令菜单区分键盘导航和鼠标悬停的滚动状态。
 */
import type { EditorView } from '@codemirror/view';
import { computed, shallowRef, type ComputedRef, type Ref, type ShallowRef } from 'vue';
import { EditorState } from '@codemirror/state';
import { describe, expect, it, vi } from 'vitest';
import { useSlashCommand, type UseSlashCommandReturn } from '@/components/BSmart/hooks/useSlashCommand';
import type { SlashCommandOption } from '@/components/BSmart/types';

/**
 * 带滚动标记的斜杠命令 Hook 返回值。
 */
type UseSlashCommandReturnWithScroll = UseSlashCommandReturn & {
  /** 当前活动项是否需要因键盘导航滚动到可视区 */
  slashShouldScrollActive: Ref<boolean>;
};

/**
 * 创建测试斜杠命令选项。
 * @param id - 命令 ID
 * @returns 斜杠命令选项
 */
function createSlashCommand(id: string): SlashCommandOption {
  return {
    id,
    trigger: `/${id}`,
    title: id,
    description: `Run ${id}`,
    selectAction: { type: 'emit' }
  };
}

/**
 * 创建斜杠命令 Hook 测试实例。
 * @returns 斜杠命令 Hook 返回值
 */
function createSlashCommandHook(): UseSlashCommandReturnWithScroll {
  const view: ShallowRef<EditorView | null> = shallowRef(null);
  const slashCommands: ComputedRef<readonly SlashCommandOption[]> = computed((): SlashCommandOption[] => [
    createSlashCommand('model'),
    createSlashCommand('compact'),
    createSlashCommand('new')
  ]);
  const emit = vi.fn<(_event: 'slash-command', _command: SlashCommandOption) => void>();

  return useSlashCommand(view, slashCommands, emit) as UseSlashCommandReturnWithScroll;
}

/**
 * 创建带光标位置的编辑器状态。
 * @param doc - 文档内容
 * @param cursor - 光标位置，默认在文末
 * @returns CodeMirror 编辑器状态
 */
function createEditorState(doc: string, cursor: number = doc.length): EditorState {
  return EditorState.create({
    doc,
    selection: { anchor: cursor }
  });
}

describe('useSlashCommand active item scrolling source', (): void => {
  it('marks active item scrolling only for keyboard navigation', (): void => {
    const slashCommand = createSlashCommandHook();

    slashCommand.slashVisible.value = true;
    slashCommand.handleSlashCommandArrowDown();

    expect(slashCommand.slashActiveIndex.value).toBe(1);
    expect(slashCommand.slashShouldScrollActive.value).toBe(true);

    slashCommand.handleSlashActiveIndexChange(2);

    expect(slashCommand.slashActiveIndex.value).toBe(2);
    expect(slashCommand.slashShouldScrollActive.value).toBe(false);
  });

  it('continues keyboard navigation from the mouse-highlighted item after state sync', (): void => {
    const slashCommand = createSlashCommandHook();
    const state = createEditorState('/');

    slashCommand.syncSlashCommandState(state, {} as EditorView);
    slashCommand.handleSlashActiveIndexChange(2);
    slashCommand.syncSlashCommandState(state, {} as EditorView);
    slashCommand.handleSlashCommandArrowDown();

    expect(slashCommand.slashActiveIndex.value).toBe(0);
    expect(slashCommand.slashShouldScrollActive.value).toBe(true);
  });

  it('keeps keyboard scroll intent across identical state sync', (): void => {
    const slashCommand = createSlashCommandHook();
    const state = createEditorState('/');

    slashCommand.syncSlashCommandState(state, {} as EditorView);
    slashCommand.handleSlashCommandArrowDown();
    slashCommand.syncSlashCommandState(state, {} as EditorView);

    expect(slashCommand.slashActiveIndex.value).toBe(1);
    expect(slashCommand.slashShouldScrollActive.value).toBe(true);
  });
});
