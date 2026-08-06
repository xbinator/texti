/**
 * @file useChatRuntimeLauncher.ts
 * @description ChatRuntime 请求准备、Actor 预注册和恢复 capability 升级。
 */
import type { UseChatSessionActorReturn } from './useChatSessionActor';
import type { PreparedRuntimeRequest, useRuntimeRequestConfig } from './useRuntimeRequestConfig';
import type { RuntimeToolBinding, RuntimeToolDiscoveryBinding } from './useRuntimeTools';
import type { Message } from '../utils/types';
import type { AIToolExecutor } from 'types/ai';
import type {
  ChatRuntimeAddress,
  ChatRuntimeBridgeRequestEvent,
  ChatRuntimeCapabilityDescriptor,
  ChatRendererToolDescriptor,
  ChatRuntimeStartResult,
  ChatRuntimePageEnvironmentContext,
  ChatRuntimeUserInputPart,
  ChatToolBinding
} from 'types/chat-runtime';
import type { Ref } from 'vue';
import { nextTick, watch } from 'vue';
import { nanoid } from 'nanoid';
import type { ChatActorSystem } from '@/ai/chat/actorSystem';
import { useActiveChatContext } from '@/hooks/useChat/useContextRegistry';

/** Runtime 请求准备函数。 */
type PrepareRuntimeRequest = ReturnType<typeof useRuntimeRequestConfig>['prepareRuntimeRequest'];

/** Runtime launcher 依赖。 */
interface UseChatRuntimeLauncherOptions {
  /** 当前会话 ID。 */
  activeSessionId: Ref<string | null>;
  /** 应用级 Actor system。 */
  actorSystem: ChatActorSystem;
  /** 当前 Session actor。 */
  sessionActor: UseChatSessionActorReturn;
  /** 当前 renderer 工具。 */
  getActiveTools: (binding?: RuntimeToolDiscoveryBinding) => AIToolExecutor[];
  /** 准备 Runtime 请求。 */
  prepareRuntimeRequest: PrepareRuntimeRequest;
  /** 按不可变 Runtime 身份创建 bridge 处理器。 */
  createBridgeHandler: (binding?: RuntimeToolBinding) => (event: ChatRuntimeBridgeRequestEvent) => Promise<unknown>;
  /** 判断 renderer 操作是否仍有效。 */
  isCurrentOperation: (operationId: number) => boolean;
}

/** Runtime 预检开始时冻结的 Renderer 资源身份。 */
interface RuntimeResourceSnapshot {
  /** 预检开始时的页面工具 binding。 */
  readonly toolContext?: ChatToolBinding;
  /** 预检开始时的页面轻量环境上下文。 */
  readonly pageEnvironment?: ChatRuntimePageEnvironmentContext;
  /** 预检开始时页面声明的 Renderer 元数据。 */
  readonly rendererTools: readonly ChatRendererToolDescriptor[];
}

/**
 * 将捕获的 Renderer 资源转换为工具发现绑定。
 * @param resources - 预检开始时冻结的 Renderer 资源
 * @returns 工具发现绑定
 */
function createResourceBinding(resources: RuntimeResourceSnapshot): RuntimeToolDiscoveryBinding {
  return Object.freeze({
    toolContext: resources.toolContext,
    pageEnvironment: resources.pageEnvironment
  });
}

/**
 * 创建 Runtime capability 描述符。
 * @param prepared - Runtime 准备结果
 * @param resources - 预检开始时冻结的 Renderer 资源
 * @returns 可由主进程持有的 capability 描述
 */
function createCapabilityDescriptor(prepared: PreparedRuntimeRequest, resources: RuntimeResourceSnapshot): ChatRuntimeCapabilityDescriptor {
  const pageTools = new Map(resources.rendererTools.map((tool: ChatRendererToolDescriptor): [string, ChatRendererToolDescriptor] => [tool.name, tool]));
  return {
    rendererTools: prepared.rendererTools.map((tool): ChatRendererToolDescriptor => {
      const pageTool = pageTools.get(tool.definition.name);
      return {
        name: tool.definition.name,
        ...(pageTool?.history ? { history: pageTool.history } : {})
      };
    }),
    workspaceRoot: prepared.config.workspaceRoot,
    toolContext: resources.toolContext
  };
}

/**
 * 创建当前 BChat 的 Runtime launcher。
 * @param options - Actor、工具和 bridge 依赖
 * @returns Runtime 准备与生命周期操作
 */
export function useChatRuntimeLauncher(options: UseChatRuntimeLauncherOptions) {
  const activeChatTools = useActiveChatContext();

  /** 捕获预检开始时的页面资源。 */
  function captureRuntimeResources(): RuntimeResourceSnapshot {
    const toolContext = activeChatTools.getActiveBinding();
    return Object.freeze({
      toolContext,
      pageEnvironment: toolContext ? activeChatTools.getEnvironmentContext(toolContext) : undefined,
      rendererTools: toolContext ? activeChatTools.getRendererTools(toolContext) : Object.freeze([] as ChatRendererToolDescriptor[])
    });
  }

  /** 为请求补充 capability 描述，并丢弃过期准备结果。 */
  async function prepare(
    operationId: number,
    selectionSource?: Message | null,
    selectionParts?: ChatRuntimeUserInputPart[]
  ): Promise<PreparedRuntimeRequest | null> {
    const resources = captureRuntimeResources();
    const prepared = await options.prepareRuntimeRequest(selectionSource, selectionParts, createResourceBinding(resources));
    if (!prepared || !options.isCurrentOperation(operationId)) return null;
    return {
      ...prepared,
      config: { ...prepared.config, capabilities: createCapabilityDescriptor(prepared, resources) }
    };
  }

  /** 将恢复 Runtime 的降级能力升级为当前 BChat 能力。 */
  function upgradeRecoveredCapabilities(): void {
    const runtimeId = options.sessionActor.activeRuntimeId.value;
    if (!runtimeId) return;
    const address = options.actorSystem.actor.getSnapshot().context.runtimeRoutes.get(runtimeId);
    const recoveredCapabilities = options.actorSystem.getRuntimeCapabilities(runtimeId);
    const descriptor = recoveredCapabilities?.descriptor;
    if (!address || !descriptor || address.sessionId !== options.activeSessionId.value) return;

    const allowedToolNames = new Set(descriptor.rendererTools.map((tool: ChatRendererToolDescriptor): string => tool.name));
    const binding: RuntimeToolBinding = Object.freeze({
      sessionId: address.sessionId,
      runtimeId: address.runtimeId,
      workspaceRoot: descriptor.workspaceRoot ?? null,
      toolContext: descriptor.toolContext
    });
    const tools = options.getActiveTools(binding).filter((tool): boolean => allowedToolNames.has(tool.definition.name));
    options.actorSystem.registerRuntime(address, {
      tools,
      descriptor,
      getToolContext: (): undefined => undefined,
      handleBridgeRequest: options.createBridgeHandler(binding)
    });
  }

  watch(
    [options.activeSessionId, options.sessionActor.activeRuntimeId, activeChatTools.revision],
    async (): Promise<void> => {
      await nextTick();
      upgradeRecoveredCapabilities();
    },
    { immediate: true }
  );

  /** 在 IPC 前注册 Actor 路由和 capability。 */
  function start(prepared: PreparedRuntimeRequest): ChatRuntimeAddress {
    const runtimeId = `runtime-${nanoid()}`;
    options.sessionActor.markPrepared();
    const sessionId = options.activeSessionId.value;
    const turnRef = options.sessionActor.sessionRef.value?.getSnapshot().context.turnRef;
    const turnId = turnRef?.getSnapshot().context.turnId;
    if (!sessionId || !turnId) throw new Error('Chat Session Actor is missing the active Turn');

    const address: ChatRuntimeAddress = {
      sessionId,
      turnId,
      agentId: 'primary',
      runtimeId,
      rootRuntimeId: runtimeId
    };
    const descriptor = prepared.config.capabilities ?? createCapabilityDescriptor(prepared, captureRuntimeResources());
    const allowedToolNames = new Set(prepared.rendererTools.map((tool): string => tool.definition.name));
    const binding: RuntimeToolBinding = Object.freeze({
      sessionId,
      runtimeId,
      workspaceRoot: prepared.config.workspaceRoot ?? null,
      toolContext: descriptor.toolContext
    });
    const tools = options.getActiveTools(binding).filter((tool): boolean => allowedToolNames.has(tool.definition.name));
    options.actorSystem.registerRuntime(address, {
      tools,
      descriptor,
      getToolContext: (): undefined => undefined,
      handleBridgeRequest: options.createBridgeHandler(binding)
    });
    options.actorSystem.send({ type: 'runtime.event', runtimeId, event: { type: 'runtime.started', runtimeId } });
    return address;
  }

  /** 校验启动结果，并处理无需保持活跃的 Runtime。 */
  function finish(result: ChatRuntimeStartResult, runtimeId: string): void {
    if (result.runtimeId !== runtimeId) {
      options.actorSystem.unregisterRuntime(runtimeId);
      throw new Error(`ChatRuntime returned an unexpected runtime id: ${result.runtimeId}`);
    }
    if (result.completed === true) {
      options.sessionActor.markCompleted();
      options.actorSystem.unregisterRuntime(runtimeId);
    }
  }

  return { prepare, start, finish };
}
