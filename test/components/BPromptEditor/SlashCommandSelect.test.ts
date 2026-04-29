/* @vitest-environment jsdom */
/**
 * @file SlashCommandSelect.test.ts
 * @description SlashCommandSelect viewport placement regression tests.
 */
import { nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import SlashCommandSelect from '@/components/BPromptEditor/components/SlashCommandSelect.vue';
import { chatSlashCommands } from '@/components/BChatSidebar/utils/slashCommands';

describe('SlashCommandSelect', () => {
  const originalInnerHeight = window.innerHeight;
  const originalInnerWidth = window.innerWidth;

  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function clientHeightGetter(this: HTMLElement): number {
      return this.classList.contains('slash-command-menu') ? 260 : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function clientWidthGetter(this: HTMLElement): number {
      return this.classList.contains('slash-command-menu') ? 320 : 0;
    });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 300 });
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalInnerHeight });
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth });
  });

  test('clamps into the larger viewport space when the menu fits neither fully above nor below', async () => {
    const wrapper = mount(SlashCommandSelect, {
      attachTo: document.body,
      props: {
        visible: true,
        commands: chatSlashCommands,
        activeIndex: 0,
        position: {
          top: 220,
          left: 16,
          bottom: 240
        }
      }
    });

    await nextTick();
    await nextTick();

    const style = wrapper.get('[data-testid="slash-command-menu"]').attributes('style');

    expect(style).toContain('top: 8px;');
    expect(style).toContain('max-height: 212px;');
  });
});
