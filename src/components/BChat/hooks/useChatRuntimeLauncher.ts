/**
 * @file useChatRuntimeLauncher.ts
 * @description ChatRuntime 请求准备、Actor 预注册和恢复 capability 升级。
 */
import type { UseChatSessionActorReturn } from './useChatSessionActor';
import type { PreparedRuntimeRequest, useRuntimeRequestConfig } from './useRuntimeRequestConfig';
import type { Message } from '../utils/types';
import type { AIToolExecutor } from 'types/ai';
import type {
  ChatRuntimeAddress,
  ChatRuntimeBridgeRequestEvent,
  ChatRuntimeCapabilityDescriptor,
  ChatRuntimeStartResult,
  ChatRuntimeUserInputPart
} from 'types/chat-runtime';
import type { Ref } from 'vue';
import { nextTick, watch } from 'vue';
import { nanoid } from 'nanoid';
import type { ChatActorSystem } from '@/ai/chat/actorSystem';
import { editorToolContextRegistry } from '@/ai/tools/context/editor';

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
  getActiveTools: () => AIToolExecutor[];
  /** 准备 Runtime 请求。 */
  prepareRuntimeRequest: PrepareRuntimeRequest;
  /** Runtime bridge 处理器。 */
  handleBridgeRequest: (event: ChatRuntimeBridgeRequestEvent) => Promise<unknown>;
  /** 判断 renderer 操作是否仍有效。 */
  isCurrentOperation: (operationId: number) => boolean;
}

/**
 * 创建 Runtime capability 描述符。
 * @param prepared - Runtime 准备结果
 * @returns 可由主进程持有的 capability 描述
 */
function createCapabilityDescriptor(prepared: PreparedRuntimeRequest): ChatRuntimeCapabilityDescriptor {
  return {
    rendererToolNames: prepared.rendererTools.map((tool): string => tool.definition.name),
    documentId: editorToolContextRegistry.getCurrentContext()?.document.id
  };
}

/**
 * 创建当前 BChat 的 Runtime launcher。
 * @param options - Actor、工具和 bridge 依赖
 * @returns Runtime 准备与生命周期操作
 */
export function useChatRuntimeLauncher(options: UseChatRuntimeLauncherOptions) {
  /** 为请求补充 capability 描述，并丢弃过期准备结果。 */
  async function prepare(
    operationId: number,
    selectionSource?: Message | null,
    selectionParts?: ChatRuntimeUserInputPart[]
  ): Promise<PreparedRuntimeRequest | null> {
    const prepared = await options.prepareRuntimeRequest(selectionSource, selectionParts);
    if (!prepared || !options.isCurrentOperation(operationId)) return null;
    return {
      ...prepared,
      config: { ...prepared.config, capabilities: createCapabilityDescriptor(prepared) }
    };
  }

  /** 将恢复 Runtime 的降级能力升级为当前 BChat 能力。 */
  function upgradeRecoveredCapabilities(): void {
    const runtimeId = options.sessionActor.activeRuntimeId.value;
    if (!runtimeId) return;
    const address = options.actorSystem.actor.getSnapshot().context.runtimeRoutes.get(runtimeId);
    const recoveredCapabilities = options.actorSystem.getRuntimeCapabilities(runtimeId);
    const descriptor = recoveredCapabilities?.descriptor;
    if (!address || !descriptor) return;

    const allowedToolNames = new Set(descriptor.rendererToolNames);
    const tools = options.getActiveTools().filter((tool): boolean => allowedToolNames.has(tool.definition.name));
    const { documentId } = descriptor;
    options.actorSystem.registerRuntime(address, {
      tools,
      descriptor,
      documentId,
      getToolContext: () => (documentId ? editorToolContextRegistry.getContext(documentId) : undefined),
      handleBridgeRequest: options.handleBridgeRequest
    });
  }

  watch(
    [options.activeSessionId, options.sessionActor.activeRuntimeId],
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
    const descriptor = prepared.config.capabilities ?? createCapabilityDescriptor(prepared);
    const { documentId } = descriptor;
    options.actorSystem.registerRuntime(address, {
      tools: prepared.rendererTools,
      descriptor,
      documentId,
      getToolContext: () => (documentId ? editorToolContextRegistry.getContext(documentId) : undefined),
      handleBridgeRequest: options.handleBridgeRequest
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
