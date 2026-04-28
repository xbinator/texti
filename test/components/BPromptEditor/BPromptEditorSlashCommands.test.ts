/**
 * @file BPromptEditorSlashCommands.test.ts
 * @description BPromptEditor 斜杠触发回归测试，覆盖行首打开菜单与无命令纯文本输入。
 */
/* @vitest-environment jsdom */

import { nextTick } from 'vue';
import { beforeEach, describe, expect, test } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import BPromptEditor from '@/components/BPromptEditor/index.vue';
import { chatSlashCommands } from '@/components/BChatSidebar/utils/slashCommands';
import type { SlashCommandOption } from '@/components/BPromptEditor/types';

/**
 * BPromptEditor 挂载实例类型。
 */
type PromptEditorInstance = InstanceType<typeof BPromptEditor>;

/**
 * 斜杠命令挂载参数。
 */
interface PromptEditorMountOptions {
  /** 初始正文内容。 */
  value?: string;
  /** 斜杠命令元数据。 */
  slashCommands?: readonly SlashCommandOption[];
  /** 是否按 Enter 提交。 */
  submitOnEnter?: boolean;
}

/**
 * 挂载 Prompt 编辑器并保留一个稳定的变量选择器替身。
 * @param options - 挂载参数
 * @returns 编辑器包装器
 */
function mountPromptEditor(options: PromptEditorMountOptions = {}): VueWrapper<PromptEditorInstance> {
  return mount(BPromptEditor, {
    props: {
      value: options.value ?? '',
      slashCommands: options.slashCommands,
      submitOnEnter: options.submitOnEnter
    },
    global: {
      stubs: {
        VariableSelect: true
      }
    }
  }) as VueWrapper<PromptEditorInstance>;
}

/**
 * 使用编辑器自身的插入 API 模拟输入并等待 CodeMirror 状态同步。
 * @param wrapper - 编辑器包装器
 * @param value - 要插入的文本
 */
async function insertEditorText(wrapper: VueWrapper<PromptEditorInstance>, value: string): Promise<void> {
  wrapper.vm.insertTextAtCursor(value);
  await nextTick();
  await nextTick();
}

describe('BPromptEditor slash commands', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('opens the slash menu only at line start', async () => {
    const wrapper = mountPromptEditor({
      slashCommands: chatSlashCommands
    });

    await insertEditorText(wrapper, 'hello\n');
    await insertEditorText(wrapper, '/');

    expect(wrapper.find('[data-testid="slash-command-menu"]').exists()).toBe(true);

    const nonLineStartWrapper = mountPromptEditor({
      slashCommands: chatSlashCommands
    });

    await insertEditorText(nonLineStartWrapper, 'hello ');
    await insertEditorText(nonLineStartWrapper, '/');

    expect(nonLineStartWrapper.find('[data-testid="slash-command-menu"]').exists()).toBe(false);
  });

  test('filters slash commands by trigger prefix', async () => {
    const wrapper = mountPromptEditor({
      slashCommands: chatSlashCommands
    });

    await insertEditorText(wrapper, '/us');

    expect(wrapper.find('[data-testid="slash-command-menu"]').exists()).toBe(true);
    expect(wrapper.findAll('[data-testid="slash-command-item"]')).toHaveLength(1);
    expect(wrapper.text()).toContain('Usage');
    expect(wrapper.text()).not.toContain('Model');
    expect(wrapper.text()).not.toContain('New Chat');
    expect(wrapper.text()).not.toContain('Clear Draft');
  });

  test('emits the selected slash command and removes the active slash text', async () => {
    const wrapper = mountPromptEditor({
      slashCommands: chatSlashCommands
    });

    await insertEditorText(wrapper, '/us');

    await wrapper.find('[data-testid="slash-command-item"]').trigger('click');

    expect(wrapper.emitted('slash-command')).toEqual([[chatSlashCommands[1]]]);
    expect(wrapper.vm.getText()).toBe('');
  });

  test('keeps slash text plain and still submits the draft when no commands are provided', async () => {
    const wrapper = mountPromptEditor({
      slashCommands: [],
      submitOnEnter: true
    });

    await insertEditorText(wrapper, '/us');
    await wrapper.get('.cm-content').trigger('keydown', { key: 'Enter' });

    expect(wrapper.vm.getText()).toBe('/us');
    expect(wrapper.emitted('submit')).toBeDefined();
    expect(wrapper.emitted('slash-command')).toBeUndefined();
    expect(wrapper.find('[data-testid="slash-command-menu"]').exists()).toBe(false);
  });
});
