/**
 * @file use-file-mention-scroll.test.ts
 * @description 验证文件提及菜单区分键盘导航和鼠标悬停的滚动状态。
 */
import type { EditorView } from '@codemirror/view';
import { computed, shallowRef, type ComputedRef, type Ref, type ShallowRef } from 'vue';
import { EditorState } from '@codemirror/state';
import { describe, expect, it, vi } from 'vitest';
import { useFileMention, type UseFileMentionReturn } from '@/components/BSmart/hooks/useFileMention';
import type { FileMentionOption } from '@/components/BSmart/types';

/**
 * 带滚动标记的文件提及 Hook 返回值。
 */
type UseFileMentionReturnWithScroll = UseFileMentionReturn & {
  /** 当前活动项是否需要因键盘导航滚动到可视区 */
  mentionShouldScrollActive: Ref<boolean>;
};

/**
 * 创建测试文件提及选项。
 * @param index - 文件序号
 * @returns 文件提及选项
 */
function createFileMention(index: number): FileMentionOption {
  return {
    id: `file-${index}`,
    name: `file-${index}.ts`,
    path: `src/file-${index}.ts`,
    ext: 'ts'
  };
}

/**
 * 创建文件提及 Hook 测试实例。
 * @returns 文件提及 Hook 返回值
 */
function createFileMentionHook(
  files: readonly FileMentionOption[] = [createFileMention(0), createFileMention(1), createFileMention(2)]
): UseFileMentionReturnWithScroll {
  const view: ShallowRef<EditorView | null> = shallowRef(null);
  const fileMentions: ComputedRef<readonly FileMentionOption[]> = computed((): readonly FileMentionOption[] => files);
  const emit = vi.fn<(_event: 'file-mention-select', _file: FileMentionOption) => void>();

  return useFileMention(view, fileMentions, emit) as UseFileMentionReturnWithScroll;
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

describe('useFileMention active item scrolling source', (): void => {
  it('marks active item scrolling only for keyboard navigation', (): void => {
    const fileMention = createFileMentionHook();

    fileMention.mentionVisible.value = true;
    fileMention.handleMentionArrowDown();

    expect(fileMention.mentionActiveIndex.value).toBe(1);
    expect(fileMention.mentionShouldScrollActive.value).toBe(true);

    fileMention.handleMentionActiveIndexChange(2);

    expect(fileMention.mentionActiveIndex.value).toBe(2);
    expect(fileMention.mentionShouldScrollActive.value).toBe(false);
  });

  it('continues keyboard navigation from the mouse-highlighted item after state sync', (): void => {
    const fileMention = createFileMentionHook();
    const state = createEditorState('@');

    fileMention.syncMentionState(state, {} as EditorView);
    fileMention.handleMentionActiveIndexChange(2);
    fileMention.syncMentionState(state, {} as EditorView);
    fileMention.handleMentionArrowDown();

    expect(fileMention.mentionActiveIndex.value).toBe(0);
    expect(fileMention.mentionShouldScrollActive.value).toBe(true);
  });

  it('keeps keyboard scroll intent across identical state sync', (): void => {
    const fileMention = createFileMentionHook();
    const state = createEditorState('@');

    fileMention.syncMentionState(state, {} as EditorView);
    fileMention.handleMentionArrowDown();
    fileMention.syncMentionState(state, {} as EditorView);

    expect(fileMention.mentionActiveIndex.value).toBe(1);
    expect(fileMention.mentionShouldScrollActive.value).toBe(true);
  });

  it('limits the default file mention result count', (): void => {
    const fileMention = createFileMentionHook(Array.from({ length: 150 }, (_value: unknown, index: number): FileMentionOption => createFileMention(index)));

    fileMention.syncMentionState(createEditorState('@'), {} as EditorView);

    expect(fileMention.filteredFileMentions.value).toHaveLength(100);
    expect(fileMention.filteredFileMentions.value.at(-1)?.name).toBe('file-99.ts');
  });

  it('filters before applying the default file mention result limit', (): void => {
    const files = [
      ...Array.from({ length: 150 }, (_value: unknown, index: number): FileMentionOption => createFileMention(index)),
      {
        id: 'needle',
        name: 'needle-file.ts',
        path: 'src/deep/needle-file.ts',
        ext: 'ts'
      }
    ];
    const fileMention = createFileMentionHook(files);

    fileMention.syncMentionState(createEditorState('@needle'), {} as EditorView);

    expect(fileMention.filteredFileMentions.value).toHaveLength(1);
    expect(fileMention.filteredFileMentions.value[0]?.name).toBe('needle-file.ts');
  });
});
