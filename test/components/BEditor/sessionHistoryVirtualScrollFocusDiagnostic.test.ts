// @vitest-environment jsdom
/**
 * @file sessionHistoryVirtualScrollFocusDiagnostic.test.ts
 * @description 使用真实设计文档内容定位富文本编辑器在挂载和聚焦阶段的非预期回写。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { VueWrapper } from '@vue/test-utils';
import type { ComponentPublicInstance, Ref } from 'vue';
import { ref } from 'vue';
import { Editor } from '@tiptap/core';
import { mount } from '@vue/test-utils';
import { describe, expect, test, vi } from 'vitest';
import PaneRichEditor from '@/components/BEditor/components/PaneRichEditor.vue';
import { useExtensions } from '@/components/BEditor/hooks/useExtensions';

vi.mock('vue-router', () => ({
  useRouter: () => ({
    push: vi.fn()
  })
}));

if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = (): DOMRectList => [] as unknown as DOMRectList;
}

if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = (): DOMRect => new DOMRect();
}

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
 * 读取用户报告会触发问题的真实文档内容。
 * @returns 文档原始 Markdown 文本
 */
function readFixtureMarkdown(): string {
  return readFileSync(resolve(process.cwd(), 'docs/superpowers/specs/2026-04-26-sessionhistory-virtual-scroll-design.md'), 'utf8');
}

/**
 * 创建带有当前 BEditor 扩展集的 Markdown 编辑器。
 * @returns 可用于导入导出 Markdown 的编辑器实例
 */
function createMarkdownEditor(): Editor {
  const editorInstanceId: Ref<string> = ref('sessionhistory-diagnostic');
  const { editorExtensions } = useExtensions(editorInstanceId);

  return new Editor({
    extensions: editorExtensions,
    content: '',
    contentType: 'markdown'
  });
}

/**
 * 让真实文档经过一次富文本导入与导出流程。
 * @param markdown - 原始 Markdown 文本
 * @returns 导出后的 Markdown 文本
 */
function roundTripMarkdown(markdown: string): string {
  const editor = createMarkdownEditor();

  editor.commands.setContent(markdown, {
    contentType: 'markdown'
  });

  const exportedMarkdown = editor.getMarkdown();
  editor.destroy();

  return exportedMarkdown;
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
      editorId: 'sessionhistory-diagnostic',
      fileName: '2026-04-26-sessionhistory-virtual-scroll-design.md',
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

describe('session history virtual scroll focus diagnostic', () => {
  test('keeps the reported markdown file stable through rich-editor round trip', () => {
    const markdown = readFixtureMarkdown();
    const roundTrippedMarkdown = roundTripMarkdown(markdown);

    expect(roundTrippedMarkdown).toBe(markdown);
  });

  test('does not emit update:value for the reported markdown file on mount or focus', async () => {
    const markdown = readFixtureMarkdown();
    const wrapper = mountPaneRichEditor(markdown);

    await flushEditorWork();
    expect(wrapper.emitted('update:value') ?? []).toHaveLength(0);

    wrapper.vm.focusEditor();
    await flushEditorWork();

    expect(wrapper.emitted('update:value') ?? []).toHaveLength(0);
    wrapper.unmount();
  });
});
