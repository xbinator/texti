/* @vitest-environment jsdom */
/**
 * @file SlashCommandSelect.test.ts
 * @description SlashCommandSelect 容器定位回归测试。
 */
import { nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { describe, expect, test } from 'vitest';
import SlashCommandSelect from '@/components/BPromptEditor/components/SlashCommandSelect.vue';
import { chatSlashCommands } from '@/components/BChatSidebar/utils/slashCommands';

describe('SlashCommandSelect', () => {
  test('renders as an absolute menu that fills the editor container width', async () => {
    const wrapper = mount(SlashCommandSelect, {
      props: {
        visible: true,
        commands: chatSlashCommands,
        activeIndex: 0
      }
    });

    await nextTick();

    const style = wrapper.get('[data-testid="slash-command-menu"]').attributes('style');

    expect(style).toContain('position: absolute;');
    expect(style).toContain('bottom: calc(100% + 8px);');
    expect(style).toContain('left: 0px;');
    expect(style).toContain('width: 100%;');
  });
});
