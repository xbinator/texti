/**
 * @file use-chat-runtime-launcher.test.ts
 * @description BChat Runtime launcher 资源绑定测试。
 */
import { computed, ref, shallowRef } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatActorSystem } from '@/ai/chat/actorSystem';
import { widgetToolContextRegistry, type WidgetToolContext } from '@/ai/tools/context/widget';
import { useChatRuntimeLauncher } from '@/components/BChat/hooks/useChatRuntimeLauncher';
import type { UseChatSessionActorReturn } from '@/components/BChat/hooks/useChatSessionActor';
import type { PreparedRuntimeRequest } from '@/components/BChat/hooks/useRuntimeRequestConfig';

/**
 * 创建 Runtime launcher 测试用 Actor system。
 * @returns Actor system 测试替身
 */
function createActorSystem(): ChatActorSystem {
  return {
    actor: {
      getSnapshot: () => ({
        context: {
          runtimeRoutes: new Map()
        }
      })
    },
    getRuntimeCapabilities: vi.fn(() => undefined),
    registerRuntime: vi.fn(),
    send: vi.fn()
  } as unknown as ChatActorSystem;
}

/**
 * 创建 Runtime launcher 测试用 Session actor。
 * @returns Session actor 测试替身
 */
function createSessionActor(): UseChatSessionActorReturn {
  return {
    sessionRef: shallowRef(),
    snapshot: shallowRef(),
    loading: computed(() => false),
    waitingForUser: computed(() => false),
    pendingInteraction: computed(() => undefined),
    activeRuntimeId: computed(() => undefined),
    markPrepared: vi.fn()
  } as unknown as UseChatSessionActorReturn;
}

/**
 * 创建 Widget 工具上下文。
 * @param title - Widget 标题
 * @returns Widget 工具上下文
 */
function createWidgetContext(title: string): WidgetToolContext {
  return {
    widget: {
      title,
      path: `/home/user/.tibis/widgets/${title}/widget.json`,
      getContent: () => JSON.stringify({ name: title }, null, 2)
    }
  };
}

describe('useChatRuntimeLauncher', (): void => {
  afterEach((): void => {
    widgetToolContextRegistry.unregister('widget-a');
  });

  it('passes the captured Widget identity into asynchronous request preparation', async (): Promise<void> => {
    const prepared = {
      config: {
        model: { providerId: 'provider', modelId: 'model' },
        contextWindow: 8000,
        workspaceRoot: '/workspace',
        skillContentHashes: {}
      },
      rendererTools: [],
      editMemoryExposed: false
    } as PreparedRuntimeRequest;
    const prepareRuntimeRequest = vi.fn(async (): Promise<PreparedRuntimeRequest> => prepared);
    widgetToolContextRegistry.register('widget-a', createWidgetContext('aether-weather'));
    widgetToolContextRegistry.setCurrent('widget-a');
    const launcher = useChatRuntimeLauncher({
      activeSessionId: ref('session-a'),
      actorSystem: createActorSystem(),
      sessionActor: createSessionActor(),
      getActiveTools: vi.fn(() => []),
      prepareRuntimeRequest,
      createBridgeHandler: vi.fn(() => async (): Promise<unknown> => undefined),
      isCurrentOperation: vi.fn(() => true)
    });

    await launcher.prepare(1);

    expect(prepareRuntimeRequest).toHaveBeenCalledWith(
      undefined,
      undefined,
      expect.objectContaining({
        widgetId: 'widget-a'
      })
    );
  });
});
