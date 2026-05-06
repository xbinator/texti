/* @vitest-environment jsdom */
/**
 * @file sourceSelectionAssistant.test.ts
 * @description Source 选区适配器事件绑定测试。
 */

import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createSourceSelectionAssistantAdapter } from '@/components/BEditor/adapters/sourceSelectionAssistant';
import type { SelectionAssistantContext } from '@/components/BEditor/adapters/selectionAssistant';

/**
 * 创建测试用 Source adapter。
 * @returns 测试所需的 view、adapter 与清理函数
 */
function createAdapterHarness(): {
  view: EditorView;
  overlayRoot: HTMLDivElement;
  cleanup: () => void;
} {
  const parent = document.createElement('div');
  const overlayRoot = document.createElement('div');
  document.body.appendChild(parent);
  document.body.appendChild(overlayRoot);

  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: 'hello world'
    })
  });

  return {
    view,
    overlayRoot,
    cleanup(): void {
      view.destroy();
      parent.remove();
      overlayRoot.remove();
    }
  };
}

describe('sourceSelectionAssistant', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('emits selection changes during pointer drag instead of waiting for mouseup only', () => {
    const { view, overlayRoot, cleanup } = createAdapterHarness();
    const context: SelectionAssistantContext = {
      editorState: {
        id: 'editor-1',
        name: 'demo.md',
        content: 'hello world',
        ext: 'md',
        path: null
      },
      overlayRoot
    };
    const adapter = createSourceSelectionAssistantAdapter(view, context, () => true);
    const onSelectionChange = vi.fn();
    const onPointerSelectionEnd = vi.fn();

    const unbind = adapter.bindSelectionEvents({
      onSelectionChange,
      onFocus: (): void => {},
      onBlur: (): void => {},
      onPointerSelectionEnd
    });

    view.dom.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, buttons: 1 }));
    document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, buttons: 1 }));
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, buttons: 0 }));

    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    expect(onPointerSelectionEnd).toHaveBeenCalledTimes(1);

    unbind();
    cleanup();
  });
});
