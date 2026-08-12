/**
 * @file source-select-all.test.ts
 * @description BEditor Source 模式逐级全选快捷键测试。
 * @vitest-environment jsdom
 */
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { handleSourceSelectAllCommand } from '@/components/BEditor/extensions/sourceSelectAll';

/**
 * 创建 Source 全选测试编辑器。
 * @param doc - 初始源码文档
 * @returns CodeMirror editor view
 */
function createView(doc: string): EditorView {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  return new EditorView({
    parent,
    state: EditorState.create({ doc })
  });
}

/**
 * 获取当前主选区范围与文本。
 * @param view - 当前 CodeMirror 视图
 * @returns 当前主选区快照
 */
function getSelectionSnapshot(view: EditorView): { from: number; to: number; text: string } {
  const selection = view.state.selection.main;

  return {
    from: selection.from,
    to: selection.to,
    text: view.state.sliceDoc(selection.from, selection.to)
  };
}

describe('handleSourceSelectAllCommand', (): void => {
  it('selects the current physical line from an empty cursor selection', (): void => {
    const view = createView(['第一行', '第二行内容', '第三行'].join('\n'));
    const secondLine = view.state.doc.line(2);
    view.dispatch({ selection: EditorSelection.cursor(secondLine.from + 2) });

    const handled = handleSourceSelectAllCommand(view);

    expect(handled).toBe(true);
    expect(getSelectionSnapshot(view)).toEqual({
      from: secondLine.from,
      to: secondLine.to,
      text: '第二行内容'
    });
    view.destroy();
  });

  it('expands a wrapped single physical line selection to the line and then the full document', (): void => {
    const view = createView(['1. 第一项', '2. 很长的一行源码内容会在界面视觉折行但没有真实换行 interface.ts default.ts', '3. 第三项'].join('\n'));
    const secondLine = view.state.doc.line(2);
    view.dispatch({
      selection: EditorSelection.range(secondLine.to - 'interface.ts default.ts'.length, secondLine.to)
    });

    handleSourceSelectAllCommand(view);
    expect(getSelectionSnapshot(view)).toEqual({
      from: secondLine.from,
      to: secondLine.to,
      text: secondLine.text
    });

    handleSourceSelectAllCommand(view);
    expect(getSelectionSnapshot(view)).toEqual({
      from: 0,
      to: view.state.doc.length,
      text: view.state.doc.toString()
    });
    view.destroy();
  });

  it('promotes cross-physical-line selections directly to the full document', (): void => {
    const view = createView(['第一行', '第二行内容', '第三行'].join('\n'));
    const firstLine = view.state.doc.line(1);
    const secondLine = view.state.doc.line(2);
    view.dispatch({
      selection: EditorSelection.range(firstLine.from + 1, secondLine.from + 2)
    });

    const handled = handleSourceSelectAllCommand(view);

    expect(handled).toBe(true);
    expect(getSelectionSnapshot(view)).toEqual({
      from: 0,
      to: view.state.doc.length,
      text: view.state.doc.toString()
    });
    view.destroy();
  });

  it('promotes selections that include only the next physical line break directly to the full document', (): void => {
    const view = createView(['第一行', '第二行内容', '第三行'].join('\n'));
    const firstLine = view.state.doc.line(1);
    const secondLine = view.state.doc.line(2);
    view.dispatch({
      selection: EditorSelection.range(firstLine.from, secondLine.from)
    });

    const handled = handleSourceSelectAllCommand(view);

    expect(handled).toBe(true);
    expect(getSelectionSnapshot(view)).toEqual({
      from: 0,
      to: view.state.doc.length,
      text: view.state.doc.toString()
    });
    view.destroy();
  });
});
