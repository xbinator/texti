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
 * 更新编辑器正文并等待 CodeMirror 状态同步。
 * @param wrapper - 编辑器包装器
 * @param value - 目标正文
 */
async function setEditorValue(wrapper: VueWrapper<PromptEditorInstance>, value: string): Promise<void> {
  await wrapper.setProps({ value });
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

    await setEditorValue(wrapper, '/');

    expect(wrapper.find('[data-testid="slash-command-menu"]').exists()).toBe(true);

    await setEditorValue(wrapper, 'hello /');

    expect(wrapper.find('[data-testid="slash-command-menu"]').exists()).toBe(false);
  });

  test('keeps slash as plain text when no commands are provided', async () => {
    const wrapper = mountPromptEditor({
      slashCommands: []
    });

    await setEditorValue(wrapper, '/');

    expect(wrapper.vm.getText()).toBe('/');
    expect(wrapper.find('[data-testid="slash-command-menu"]').exists()).toBe(false);
  });
});
