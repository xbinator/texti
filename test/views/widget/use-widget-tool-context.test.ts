/**
 * @file use-widget-tool-context.test.ts
 * @description Widget 编辑页工具上下文绑定测试。
 * @vitest-environment jsdom
 */
import type { Ref, VNode } from 'vue';
import { computed, defineComponent, h, nextTick, ref } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { widgetToolContextRegistry } from '@/ai/tools/context/widget';
import type { WidgetData } from '@/components/BWidget/types';
import { createDefaultWidgetData } from '@/components/BWidget/utils/widgetData';
import type { FileState } from '@/shared/platform/native/types';
import { useWidgetToolContext } from '@/views/widget/hooks/useWidgetToolContext';

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
  /** WidgetData。 */
  data: Ref<WidgetData>;
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
  const data = ref<WidgetData>({
    ...createDefaultWidgetData('aether-weather'),
    description: 'Weather board'
  });

  const Host = defineComponent({
    setup(): () => VNode {
      useWidgetToolContext({
        fileId,
        isActive,
        currentTitle,
        fileState,
        data
      });

      return (): VNode => h('div');
    }
  });

  return {
    wrapper: mount(Host),
    fileId,
    isActive,
    title,
    fileState,
    data
  };
}

describe('useWidgetToolContext', (): void => {
  it('registers the active Widget editor and reads latest in-memory WidgetData JSON', async (): Promise<void> => {
    const harness = createHarness();

    expect(widgetToolContextRegistry.getCurrentId()).toBe('widget-context-test-a');
    expect(widgetToolContextRegistry.getCurrentContext()?.widget.title).toBe('aether-weather');

    harness.data.value.description = 'Updated Weather board';
    harness.title.value = 'weather-custom';
    await nextTick();

    const context = widgetToolContextRegistry.getContext('widget-context-test-a');
    expect(context?.widget.title).toBe('weather-custom');
    expect(context?.widget.path).toBe('/home/user/.tibis/widgets/aether-weather/widget.json');
    expect(context?.widget.getContent()).toContain('"description": "Updated Weather board"');

    harness.isActive.value = false;
    await nextTick();

    expect(widgetToolContextRegistry.getCurrentContext()).toBeUndefined();
    expect(widgetToolContextRegistry.getContext('widget-context-test-a')).toBe(context);

    harness.wrapper.unmount();
    expect(widgetToolContextRegistry.getContext('widget-context-test-a')).toBeUndefined();
  });
});
