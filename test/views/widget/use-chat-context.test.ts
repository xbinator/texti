/**
 * @file use-chat-context.test.ts
 * @description Widget 编辑页 Chat 上下文绑定测试。
 * @vitest-environment jsdom
 */
/* eslint-disable vue/one-component-per-file */
import type { Ref, VNode } from 'vue';
import { computed, defineComponent, h, nextTick, ref } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toolContextRegistry } from '@/hooks/useChat/context/registry';
import { useActiveChatContext } from '@/hooks/useChat/useContextRegistry';
import type { FileState } from '@/shared/platform/native/types';
import { useChatContext } from '@/views/widget/hooks/useChatContext';

/**
 * Widget 上下文测试宿主。
 */
interface WidgetContextHarness {
  /** Vue 测试 wrapper。 */
  wrapper: VueWrapper;
  /** Widget 文件会话 ID。 */
  fileId: Ref<string>;
  /** 页面活跃状态。 */
  isActive: Ref<boolean>;
  /** Widget 标题。 */
  title: Ref<string>;
  /** Widget 文件状态。 */
  fileState: Ref<FileState>;
}

/**
 * 创建 Widget 工具上下文测试宿主。
 * @returns Widget 上下文测试宿主
 */
function createHarness(): WidgetContextHarness {
  const fileId = ref<string>('widget-context-test-a');
  const isActive = ref<boolean>(true);
  const title = ref<string>('aether-weather');
  const currentTitle = computed<string>((): string => title.value);
  const fileState = ref<FileState>({
    id: fileId.value,
    name: 'widget',
    ext: 'json',
    path: '/home/user/.tibis/widgets/aether-weather/widget.json',
    content: '{}'
  });
  const Host = defineComponent({
    setup(): () => VNode {
      useChatContext({
        fileId,
        isActive,
        currentTitle,
        fileState
      });

      return (): VNode => h('div');
    }
  });

  return {
    wrapper: mount(Host),
    fileId,
    isActive,
    title,
    fileState
  };
}

describe('useChatContext', (): void => {
  beforeEach((): void => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  afterEach((): void => toolContextRegistry.clear());

  it('registers the active Widget editor as file environment without exposing a Widget read tool', async (): Promise<void> => {
    const harness = createHarness();
    const tools = useActiveChatContext();
    const binding = { providerId: 'widget', resourceId: 'widget-context-test-a' };

    expect(tools.getActiveBinding()).toEqual(binding);
    harness.title.value = 'weather-custom';
    await nextTick();

    expect(tools.getBoundTools(binding, { confirmation: { confirm: vi.fn(async (): Promise<boolean> => true) } })).toEqual([]);
    expect(tools.getPresentation(binding, 'read_current_widget')).toBeUndefined();
    expect(tools.getRendererTools(binding)).toEqual([]);
    expect(tools.getEnvironmentContext(binding)).toEqual({
      sections: [{ tag: 'current_file', lines: ['Path: /home/user/.tibis/widgets/aether-weather/widget.json'] }]
    });

    harness.isActive.value = false;
    await nextTick();

    expect(tools.getActiveBinding()).toBeUndefined();
    expect(tools.getBoundTools(binding, { confirmation: { confirm: async (): Promise<boolean> => true } })).toHaveLength(0);

    harness.wrapper.unmount();
    expect(tools.getBoundTools(binding, { confirmation: { confirm: async (): Promise<boolean> => true } })).toEqual([]);
  });
});
