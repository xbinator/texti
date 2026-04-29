// @vitest-environment jsdom
/**
 * @file PaneRichEditorFocusRegression.test.ts
 * @description 验证富文本编辑器在未输入内容时不会仅因挂载或聚焦而回写 `update:value`。
 */
import type { VueWrapper } from '@vue/test-utils';
import type { ComponentPublicInstance } from 'vue';
import { mount } from '@vue/test-utils';
import { describe, expect, test, vi } from 'vitest';
import PaneRichEditor from '@/components/BEditor/components/PaneRichEditor.vue';

vi.mock('vue-router', () => ({
  useRouter: () => ({
    push: vi.fn()
  })
}));

/**
 * 富文本面板公开的最小实例接口。
 */
interface PaneRichEditorVm extends ComponentPublicInstance {
  /**
   * 让富文本编辑器获得焦点。
   */
  focusEditor: () => void;
}

/**
 * 等待编辑器挂载与异步副作用稳定。
 * @returns 下一轮微任务完成后的 Promise
 */
async function flushEditorWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

/**
 * 挂载富文本编辑器面板。
 * @param value - 初始 Markdown 内容
 * @returns 挂载后的组件包装器
 */
function mountPaneRichEditor(value: string): VueWrapper<PaneRichEditorVm> {
  return mount(PaneRichEditor, {
    attachTo: document.body,
    props: {
      value,
      outlineContent: '',
      editorId: 'focus-regression',
      fileName: 'focus-regression.md',
      editable: true
    },
    global: {
      stubs: {
        CurrentBlockMenu: true,
        FrontMatterCard: true,
        SelectionAIInput: true,
        SelectionToolbar: true
      }
    }
  }) as VueWrapper<PaneRichEditorVm>;
}

describe('PaneRichEditor focus regression', () => {
  test('does not emit update:value on mount or focus without user text edits', async () => {
    const wrapper = mountPaneRichEditor('<!-- comment -->');

    await flushEditorWork();
    expect(wrapper.emitted('update:value') ?? []).toHaveLength(0);

    wrapper.vm.focusEditor();
    await flushEditorWork();

    expect(wrapper.emitted('update:value') ?? []).toHaveLength(0);
    wrapper.unmount();
  });
});
