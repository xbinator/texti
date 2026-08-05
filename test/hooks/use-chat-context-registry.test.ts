/**
 * @file use-chat-context-registry.test.ts
 * @description 页面工具上下文 Hook 的响应式注册与清理测试。
 * @vitest-environment jsdom
 */
/* eslint-disable vue/one-component-per-file */
import type { AIToolContext, AIToolExecutionMetadata, AIToolExecutionResult } from 'types/ai';
import type { Ref, VNode } from 'vue';
import { defineComponent, h, KeepAlive, nextTick, ref } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toolContextRegistry } from '@/hooks/useChat/lib/registry';
import { useActiveChatContext, useChatContextProvider, type ToolContextTool } from '@/hooks/useChat/useChatContextRegistry';

/** Hook 测试使用的 Runtime 服务。 */
const RUNTIME_SERVICES = { confirmation: { confirm: async (): Promise<boolean> => true } };

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
function createTool(): ToolContextTool {
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
      useChatContextProvider({
        providerId: 'editor',
        resourceId,
        available,
        active,
        getTools: () => [createTool()],
        hiddenToolNames: [],
        appBridgeHandlers: {}
      });
      return (): VNode => h('div');
    }
  });
  return { wrapper: mount(Host), resourceId, available, active };
}

describe('useChatContextRegistry', (): void => {
  afterEach((): void => toolContextRegistry.clear());

  it('registers only when available and retains inactive mounted resources', async (): Promise<void> => {
    const harness = createHarness();
    const tools = useActiveChatContext();

    expect(tools.getActiveBinding()).toBeUndefined();
    harness.available.value = true;
    await nextTick();
    const binding = { providerId: 'editor', resourceId: 'document-a' };
    expect(tools.getActiveBinding()).toEqual(binding);

    harness.active.value = false;
    await nextTick();
    expect(tools.getActiveBinding()).toBeUndefined();
    expect(tools.getBoundTools(binding, RUNTIME_SERVICES).map((tool) => tool.definition.name)).toEqual(['read_current_document']);

    harness.wrapper.unmount();
    expect(tools.getBoundTools(binding, RUNTIME_SERVICES)).toEqual([]);
  });

  it('supports a fourth page tool entirely through its local registration contract', async (): Promise<void> => {
    setActivePinia(createPinia());
    const resourceId = ref<string>('page-a');
    const available = ref<boolean>(true);
    const active = ref<boolean>(true);
    const execute = vi.fn(async (_input: unknown, _context?: AIToolContext, metadata?: AIToolExecutionMetadata): Promise<AIToolExecutionResult> => {
      metadata?.activity?.progress({ phase: 'inspect', completed: 1, total: 1 });
      return { toolName: 'inspect_test_page', status: 'success', data: { title: 'Test page' } };
    });
    const Host = defineComponent({
      setup(): () => VNode {
        useChatContextProvider({
          providerId: 'test-page',
          resourceId,
          available,
          active,
          getTools: () => [
            {
              definition: {
                name: 'inspect_test_page',
                description: 'Inspect the fourth test page',
                source: 'builtin',
                riskLevel: 'read',
                requiresActiveDocument: false,
                parameters: { type: 'object', properties: {}, additionalProperties: false }
              },
              execute,
              presentation: { label: '检查测试页面', summarize: (): string => '已检查测试页面' },
              history: { mode: 'latest-only', placeholder: '历史测试页面结果已裁剪。' }
            }
          ],
          hiddenToolNames: [],
          appBridgeHandlers: {}
        });
        return (): VNode => h('div');
      }
    });
    const wrapper = mount(Host);
    const tools = useActiveChatContext();
    const binding = { providerId: 'test-page', resourceId: 'page-a' };
    const pageTool = tools.getBoundTools(binding, RUNTIME_SERVICES)[0];
    if (!pageTool) throw new Error('fourth page tool should exist');
    const controller = new AbortController();
    const progress = vi.fn();

    await expect(
      pageTool.execute({}, undefined, {
        abortSignal: controller.signal,
        activity: { heartbeat: vi.fn(), progress, waitUser: vi.fn(), waitExternal: vi.fn(), resume: vi.fn() }
      })
    ).resolves.toEqual({ toolName: 'inspect_test_page', status: 'success', data: { title: 'Test page' } });

    expect(tools.getActiveBinding()).toEqual(binding);
    expect(pageTool.definition.name).toBe('inspect_test_page');
    expect(execute).toHaveBeenCalledWith({}, undefined, expect.objectContaining({ abortSignal: controller.signal }));
    expect(progress).toHaveBeenCalledWith({ phase: 'inspect', completed: 1, total: 1 });
    expect(tools.getPresentationByTool('inspect_test_page')?.label).toBe('检查测试页面');
    expect(tools.getRendererTools(binding)).toEqual([{ name: 'inspect_test_page', history: { mode: 'latest-only', placeholder: '历史测试页面结果已裁剪。' } }]);
    wrapper.unmount();
  });

  it('moves registration when the resource id changes', async (): Promise<void> => {
    const harness = createHarness();
    const tools = useActiveChatContext();
    harness.available.value = true;
    await nextTick();
    harness.resourceId.value = 'document-b';
    await nextTick();

    expect(tools.getBoundTools({ providerId: 'editor', resourceId: 'document-a' }, RUNTIME_SERVICES)).toEqual([]);
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
        useChatContextProvider({
          providerId: 'editor',
          resourceId,
          available,
          active,
          getTools: () => [createTool()],
          hiddenToolNames: [],
          appBridgeHandlers: {}
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
    const tools = useActiveChatContext();
    const binding = { providerId: 'editor', resourceId: 'document-a' };

    expect(tools.getActiveBinding()).toEqual(binding);
    visible.value = false;
    await nextTick();
    expect(tools.getActiveBinding()).toBeUndefined();
    expect(tools.getBoundTools(binding, RUNTIME_SERVICES)).toHaveLength(1);
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
        useChatContextProvider({
          providerId: 'editor',
          resourceId,
          available,
          active,
          getTools: () => [createTool()],
          hiddenToolNames: [],
          appBridgeHandlers: {}
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
    const tools = useActiveChatContext();

    visible.value = false;
    await nextTick();
    resourceId.value = 'document-b';
    await nextTick();

    expect(tools.getActiveBinding()).toBeUndefined();
    expect(tools.getBoundTools({ providerId: 'editor', resourceId: 'document-a' }, RUNTIME_SERVICES)).toEqual([]);
    expect(tools.getBoundTools({ providerId: 'editor', resourceId: 'document-b' }, RUNTIME_SERVICES)).toHaveLength(1);

    visible.value = true;
    await nextTick();
    expect(tools.getActiveBinding()).toEqual({ providerId: 'editor', resourceId: 'document-b' });
    wrapper.unmount();
  });
});
