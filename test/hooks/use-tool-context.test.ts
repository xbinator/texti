/**
 * @file use-tool-context.test.ts
 * @description 页面工具上下文 Hook 的响应式注册与清理测试。
 * @vitest-environment jsdom
 */
/* eslint-disable vue/one-component-per-file */
import type { AIToolExecutor } from 'types/ai';
import type { Ref, VNode } from 'vue';
import { defineComponent, h, KeepAlive, nextTick, ref } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { toolContextRegistry } from '@/hooks/useChat/lib/registry';
import { useActiveToolContext, useToolContext } from '@/hooks/useChat/useToolContext';

/** Hook 测试宿主。 */
interface HookHarness {
  /** Vue wrapper。 */
  wrapper: VueWrapper;
  /** 资源 ID。 */
  resourceId: Ref<string>;
  /** 可用状态。 */
  available: Ref<boolean>;
  /** 激活状态。 */
  active: Ref<boolean>;
}

/**
 * 创建测试工具。
 * @returns 工具执行器
 */
function createTool(): AIToolExecutor {
  return {
    definition: {
      name: 'read_current_document',
      description: 'read',
      source: 'builtin',
      riskLevel: 'read',
      parameters: { type: 'object', properties: {} }
    },
    execute: async () => ({ toolName: 'read_current_document', status: 'success', data: null })
  };
}

/**
 * 创建 Hook 宿主。
 * @returns Hook 测试宿主
 */
function createHarness(): HookHarness {
  const resourceId = ref<string>('document-a');
  const available = ref<boolean>(false);
  const active = ref<boolean>(true);
  const Host = defineComponent({
    setup(): () => VNode {
      useToolContext({
        providerId: 'editor',
        resourceId,
        available,
        active,
        getTools: () => [createTool()],
        hiddenToolNames: [],
        bridgeHandlers: {}
      });
      return (): VNode => h('div');
    }
  });
  return { wrapper: mount(Host), resourceId, available, active };
}

describe('useToolContext', (): void => {
  afterEach((): void => toolContextRegistry.clear());

  it('registers only when available and retains inactive mounted resources', async (): Promise<void> => {
    const harness = createHarness();
    const tools = useActiveToolContext();

    expect(tools.getActiveBinding()).toBeUndefined();
    harness.available.value = true;
    await nextTick();
    const binding = { providerId: 'editor', resourceId: 'document-a' };
    expect(tools.getActiveBinding()).toEqual(binding);

    harness.active.value = false;
    await nextTick();
    expect(tools.getActiveBinding()).toBeUndefined();
    expect(tools.getBoundTools(binding).map((tool) => tool.definition.name)).toEqual(['read_current_document']);

    harness.wrapper.unmount();
    expect(tools.getBoundTools(binding)).toEqual([]);
  });

  it('moves registration when the resource id changes', async (): Promise<void> => {
    const harness = createHarness();
    const tools = useActiveToolContext();
    harness.available.value = true;
    await nextTick();
    harness.resourceId.value = 'document-b';
    await nextTick();

    expect(tools.getBoundTools({ providerId: 'editor', resourceId: 'document-a' })).toEqual([]);
    expect(tools.getActiveBinding()).toEqual({ providerId: 'editor', resourceId: 'document-b' });
    harness.wrapper.unmount();
  });

  it('deactivates without unregistering across KeepAlive transitions', async (): Promise<void> => {
    const visible = ref<boolean>(true);
    const resourceId = ref<string>('document-a');
    const available = ref<boolean>(true);
    const active = ref<boolean>(true);
    const Host = defineComponent({
      setup(): () => VNode {
        useToolContext({
          providerId: 'editor',
          resourceId,
          available,
          active,
          getTools: () => [createTool()],
          hiddenToolNames: [],
          bridgeHandlers: {}
        });
        return (): VNode => h('div');
      }
    });
    const Root = defineComponent({
      setup(): () => VNode {
        return (): VNode => h(KeepAlive, null, { default: () => (visible.value ? h(Host) : h('span')) });
      }
    });
    const wrapper = mount(Root);
    const tools = useActiveToolContext();
    const binding = { providerId: 'editor', resourceId: 'document-a' };

    expect(tools.getActiveBinding()).toEqual(binding);
    visible.value = false;
    await nextTick();
    expect(tools.getActiveBinding()).toBeUndefined();
    expect(tools.getBoundTools(binding)).toHaveLength(1);
    visible.value = true;
    await nextTick();
    expect(tools.getActiveBinding()).toEqual(binding);
    wrapper.unmount();
  });

  it('does not reactivate a cached page when its registration changes while deactivated', async (): Promise<void> => {
    const visible = ref<boolean>(true);
    const resourceId = ref<string>('document-a');
    const available = ref<boolean>(true);
    const active = ref<boolean>(true);
    const Host = defineComponent({
      setup(): () => VNode {
        useToolContext({
          providerId: 'editor',
          resourceId,
          available,
          active,
          getTools: () => [createTool()],
          hiddenToolNames: [],
          bridgeHandlers: {}
        });
        return (): VNode => h('div');
      }
    });
    const Root = defineComponent({
      setup(): () => VNode {
        return (): VNode => h(KeepAlive, null, { default: () => (visible.value ? h(Host) : h('span')) });
      }
    });
    const wrapper = mount(Root);
    const tools = useActiveToolContext();

    visible.value = false;
    await nextTick();
    resourceId.value = 'document-b';
    await nextTick();

    expect(tools.getActiveBinding()).toBeUndefined();
    expect(tools.getBoundTools({ providerId: 'editor', resourceId: 'document-a' })).toEqual([]);
    expect(tools.getBoundTools({ providerId: 'editor', resourceId: 'document-b' })).toHaveLength(1);

    visible.value = true;
    await nextTick();
    expect(tools.getActiveBinding()).toEqual({ providerId: 'editor', resourceId: 'document-b' });
    wrapper.unmount();
  });
});
