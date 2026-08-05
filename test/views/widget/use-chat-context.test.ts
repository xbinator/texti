/**
 * @file use-chat-context.test.ts
 * @description Widget 编辑页 Chat 上下文绑定测试。
 * @vitest-environment jsdom
 */
/* eslint-disable vue/one-component-per-file */
import type { ChatRuntimeBridgeRequestEvent } from 'types/chat-runtime';
import type { Ref, VNode } from 'vue';
import { computed, defineComponent, h, nextTick, ref } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import type { WidgetData } from '@/components/BWidget/types';
import { createDefaultWidgetData } from '@/components/BWidget/utils/widgetData';
import { toolContextRegistry } from '@/hooks/useChat/lib/registry';
import { useActiveToolContext } from '@/hooks/useChat/useToolContext';
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
      useChatContext({
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

/**
 * 创建 Widget provider 测试 Bridge 请求。
 * @param kind - Bridge kind
 * @returns Bridge 请求
 */
function createEvent(kind: string): ChatRuntimeBridgeRequestEvent {
  return {
    runtimeId: 'runtime-a',
    sessionId: 'session-a',
    turnId: 'turn-a',
    clientId: 'bchat',
    agentId: 'primary',
    rootRuntimeId: 'runtime-a',
    requestId: `request-${kind}`,
    kind
  };
}

describe('useChatContext', (): void => {
  afterEach((): void => toolContextRegistry.clear());

  it('registers the active Widget editor and reads latest in-memory WidgetData JSON', async (): Promise<void> => {
    const harness = createHarness();
    const tools = useActiveToolContext();
    const binding = { providerId: 'widget', resourceId: 'widget-context-test-a' };

    expect(tools.getActiveBinding()).toEqual(binding);
    expect(tools.getBoundTools(binding).map((tool) => tool.definition.name)).toEqual(['read_current_widget']);

    harness.data.value.description = 'Updated Weather board';
    harness.title.value = 'weather-custom';
    await nextTick();

    await expect(tools.dispatchBridge(binding, createEvent('widget-snapshot'))).resolves.toEqual({
      handled: true,
      data: expect.objectContaining({
        title: 'weather-custom',
        path: '/home/user/.tibis/widgets/aether-weather/widget.json',
        content: expect.stringContaining('"description": "Updated Weather board"')
      })
    });

    harness.isActive.value = false;
    await nextTick();

    expect(tools.getActiveBinding()).toBeUndefined();
    expect(tools.getBoundTools(binding)).toHaveLength(1);

    harness.wrapper.unmount();
    expect(tools.getBoundTools(binding)).toEqual([]);
  });
});
