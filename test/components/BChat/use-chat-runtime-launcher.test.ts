/**
 * @file use-chat-runtime-launcher.test.ts
 * @description BChat Runtime launcher 资源绑定测试。
 */
import type { AIToolExecutor } from 'types/ai';
import type { ChatRuntimeAddress, ChatToolBinding } from 'types/chat-runtime';
import type { Ref } from 'vue';
import { computed, nextTick, ref, shallowRef } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatActorSystem } from '@/ai/chat/actorSystem';
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
 * 创建 Runtime 恢复测试使用的页面工具。
 * @returns schema-only 页面工具
 */
function createPageTool(): AIToolExecutor {
  return {
    definition: {
      name: 'read_current_widget',
      description: 'read widget',
      source: 'builtin',
      riskLevel: 'read',
      parameters: { type: 'object', properties: {} }
    },
    execute: async () => ({ toolName: 'read_current_widget', status: 'success', data: null })
  };
}

const activeToolsMock = vi.hoisted(() => ({
  activeBinding: { providerId: 'widget', resourceId: 'widget-a' } as ChatToolBinding | undefined,
  revision: null as unknown as Ref<number>
}));

vi.mock('@/hooks/useChat/useContextRegistry', () => ({
  useActiveChatContext: () => ({
    revision: activeToolsMock.revision,
    getActiveBinding: () => activeToolsMock.activeBinding,
    getBoundTools: () => [],
    getHiddenToolNames: () => [],
    getRendererTools: () => [
      {
        name: 'read_current_widget',
        history: { mode: 'latest-only', placeholder: '已保留最新 Widget 快照' }
      }
    ],
    getPresentation: () => undefined,
    dispatchAppBridge: vi.fn()
  })
}));

describe('useChatRuntimeLauncher', (): void => {
  beforeEach((): void => {
    activeToolsMock.activeBinding = { providerId: 'widget', resourceId: 'widget-a' };
    activeToolsMock.revision = ref<number>(0);
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
        toolContext: { providerId: 'widget', resourceId: 'widget-a' }
      })
    );
  });

  it('upgrades a recovered Runtime when its bound page registers later', async (): Promise<void> => {
    const address: ChatRuntimeAddress = {
      sessionId: 'session-a',
      turnId: 'turn-a',
      agentId: 'primary',
      runtimeId: 'runtime-a',
      rootRuntimeId: 'runtime-a'
    };
    const registerRuntime = vi.fn();
    const actorSystem = {
      actor: {
        getSnapshot: () => ({ context: { runtimeRoutes: new Map([[address.runtimeId, address]]) } })
      },
      getRuntimeCapabilities: vi.fn(() => ({
        tools: [],
        descriptor: {
          rendererTools: [
            {
              name: 'read_current_widget',
              history: { mode: 'latest-only', placeholder: '已保留最新 Widget 快照' }
            }
          ],
          workspaceRoot: '/workspace',
          toolContext: { providerId: 'widget', resourceId: 'widget-a' }
        },
        getToolContext: (): undefined => undefined,
        handleBridgeRequest: async (): Promise<unknown> => undefined
      })),
      registerRuntime,
      send: vi.fn()
    } as unknown as ChatActorSystem;
    const sessionActor = {
      ...createSessionActor(),
      activeRuntimeId: ref<string | undefined>('runtime-a')
    } as unknown as UseChatSessionActorReturn;
    const pageTool = createPageTool();
    const getActiveTools = vi.fn((): AIToolExecutor[] => (activeToolsMock.revision.value > 0 ? [pageTool] : []));

    useChatRuntimeLauncher({
      activeSessionId: ref('session-a'),
      actorSystem,
      sessionActor,
      getActiveTools,
      prepareRuntimeRequest: vi.fn(),
      createBridgeHandler: vi.fn(() => async (): Promise<unknown> => undefined),
      isCurrentOperation: vi.fn(() => true)
    });
    await nextTick();
    await nextTick();
    registerRuntime.mockClear();

    activeToolsMock.revision.value += 1;
    await nextTick();
    await nextTick();

    expect(getActiveTools).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sessionId: 'session-a',
        runtimeId: 'runtime-a',
        toolContext: { providerId: 'widget', resourceId: 'widget-a' }
      })
    );
    expect(registerRuntime).toHaveBeenCalledWith(
      address,
      expect.objectContaining({
        tools: [pageTool],
        descriptor: expect.objectContaining({ toolContext: { providerId: 'widget', resourceId: 'widget-a' } })
      })
    );
  });

  it('captures page history metadata without knowing the page provider', async (): Promise<void> => {
    const pageTool = createPageTool();
    const prepared = {
      config: {
        model: { providerId: 'provider', modelId: 'model' },
        contextWindow: 8000,
        workspaceRoot: '/workspace',
        skillContentHashes: {}
      },
      rendererTools: [pageTool],
      editMemoryExposed: false
    } as PreparedRuntimeRequest;
    const launcher = useChatRuntimeLauncher({
      activeSessionId: ref('session-a'),
      actorSystem: createActorSystem(),
      sessionActor: createSessionActor(),
      getActiveTools: vi.fn(() => [pageTool]),
      prepareRuntimeRequest: vi.fn(async (): Promise<PreparedRuntimeRequest> => prepared),
      createBridgeHandler: vi.fn(() => async (): Promise<unknown> => undefined),
      isCurrentOperation: vi.fn(() => true)
    });

    const result = await launcher.prepare(1);

    expect(result?.config.capabilities?.rendererTools).toEqual([
      {
        name: 'read_current_widget',
        history: { mode: 'latest-only', placeholder: '已保留最新 Widget 快照' }
      }
    ]);
  });
});
