/**
 * @file useRuntimeEvents.ts
 * @description 应用级 ChatRuntime IPC 事件监听、路由和 renderer 请求处理。
 */
import type {
  ChatRuntimeBridgeRequestEvent,
  ChatRuntimeBridgeResult,
  ChatRuntimeCompleteEvent,
  ChatRuntimeConfirmationRequestEvent,
  ChatRuntimeContextUsageEvent,
  ChatRuntimeErrorEvent,
  ChatRuntimeEventBase,
  ChatRuntimeMessageDeletedEvent,
  ChatRuntimeMessageEvent,
  ChatRuntimeToolCancelledEvent,
  ChatRuntimeToolRequestEvent
} from 'types/chat-runtime';
import type { ElectronShellRunEventEnvelope } from 'types/electron-api';
import { onScopeDispose } from 'vue';
import type { ChatActorSystem } from '@/ai/chat/actorSystem';
import { getRememberedRuntimeConfirmationDecision } from '@/ai/chat/policies/runtimeConfirmation';
import { normalizeToolConfirmationRequest } from '@/ai/tools/confirmation';
import { createShellCommandId } from '@/ai/tools/shellCommandId';
import { executeToolCall } from '@/ai/tools/stream';
import { expireRuntimeConfirmations } from '@/components/BChat/utils/confirmationController';
import { createChatTabId } from '@/router/routes/helpers/chatRouteTab';
import { getElectronAPI } from '@/shared/platform/electron-api';
import { useChatPermissionStore } from '@/stores/chat/permission';
import { useChatTabStore } from '@/stores/chat/tab';
import type { Tab } from '@/stores/workspace/tabs';
import { useTabsStore } from '@/stores/workspace/tabs';
import { asyncTo } from '@/utils/asyncTo';
import { assertRuntimeResult, createBridgeFailure, createToolFailure, createWorkflowError, isManagedRuntime } from './error';

/** 工具 Promise 完成后等待已排队 finished 事件的最大时间。 */
const SHELL_ROUTE_GRACE_MS = 5_000;

/** 单个 auto-default Shell 工具的 renderer 路由状态。 */
interface ShellEventRoute extends Pick<ChatRuntimeToolRequestEvent, 'runtimeId' | 'sessionId' | 'toolCallId'> {
  /** 异常事件缺失时的有界回收定时器。 */
  cleanupTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * 判断工具请求是否会产生 Shell PTY 有序事件。
 * @param event - Runtime 工具请求
 * @returns 是否为 auto-default Shell 请求
 */
function hasShellRunEvents(event: ChatRuntimeToolRequestEvent): boolean {
  if (event.toolName !== 'run_shell_command' || typeof event.input !== 'object' || event.input === null || Array.isArray(event.input)) return false;
  return (event.input as Record<string, unknown>).interactionMode === 'auto-default';
}

/**
 * 注册应用级 ChatRuntime 事件监听。
 * 未被 Actor system 注册的 Runtime 保留给迁移期间的旧 BChat listener。
 * @param actorSystem - 应用级 Chat Actor system
 */
export function useRuntimeEvents(actorSystem: ChatActorSystem): void {
  const electronAPI = getElectronAPI();
  const toolAbortControllers = new Map<string, AbortController>();
  const shellRoutes = new Map<string, ShellEventRoute>();
  const runtimeStore = useChatTabStore();
  const tabsStore = useTabsStore();

  /**
   * 解析 Runtime 会话当前所属的聊天标签，兼容尚未晋升的 chat:new。
   * @param sessionId - Runtime 会话 ID
   * @returns 顶部聊天标签 ID
   */
  function resolveRuntimeTabId(sessionId: string): string {
    return runtimeStore.findOwner(sessionId)?.tabId ?? createChatTabId(sessionId);
  }

  /**
   * 判断 Runtime 记录当前是否仍有顶部可见标签。
   * @param tabId - Runtime 记录键
   * @returns 是否存在对应顶部标签
   */
  function hasVisibleTab(tabId: string): boolean {
    return tabsStore.tabs.some((tab: Tab): boolean => tab.id === tabId);
  }

  /**
   * 创建 renderer 工具调用的稳定索引。
   * @param runtimeId - Runtime ID
   * @param toolCallId - 工具调用 ID
   * @returns 工具执行索引
   */
  function createToolAbortKey(runtimeId: string, toolCallId: string): string {
    return `${runtimeId}:${toolCallId}`;
  }
  const toolPermissionStore = useChatPermissionStore();

  /**
   * 判断事件是否属于已接管 Runtime。
   * @param event - Runtime 事件
   * @returns 是否接管
   */
  function shouldHandle(event: ChatRuntimeEventBase): boolean {
    return isManagedRuntime(actorSystem, event.runtimeId);
  }

  /**
   * 校验 Main 在 Checkpoint fence 下广播的 source assistant 终态更新。
   * Runtime A route 已注销时只允许固定 marker 与当前三层 Actor lineage 完全匹配的消息更新绕过。
   * @param event - Runtime 消息更新
   * @returns 是否为可信 continuation assistant 更新
   */
  function isContinuationUpdate(event: ChatRuntimeMessageEvent): boolean {
    if (event.clientId !== 'agent-continuation' || event.agentId !== 'primary') return false;
    const sessionSnapshot = actorSystem.getSession(event.sessionId)?.getSnapshot();
    const turnSnapshot = sessionSnapshot?.context.turnRef?.getSnapshot();
    const agentSnapshot = turnSnapshot?.context.primaryAgentRef?.getSnapshot();
    return Boolean(
      sessionSnapshot?.context.checkpointId &&
        sessionSnapshot.context.checkpointId === turnSnapshot?.context.checkpointId &&
        sessionSnapshot.context.checkpointId === agentSnapshot?.context.checkpointId &&
        sessionSnapshot.context.sourceRuntimeId === event.runtimeId &&
        turnSnapshot?.context.sourceRuntimeId === event.runtimeId &&
        agentSnapshot?.context.sourceRuntimeId === event.runtimeId &&
        turnSnapshot.context.turnId === event.turnId &&
        agentSnapshot.context.address.agentId === event.agentId &&
        event.message.runtimeId === event.runtimeId &&
        (!event.message.sessionId || event.message.sessionId === event.sessionId)
    );
  }

  /** 发布 Runtime 消息新增事件。 */
  function handleMessageCreated(event: ChatRuntimeMessageEvent): void {
    if (!shouldHandle(event)) return;
    actorSystem.emitSessionEvent(event.sessionId, { type: 'messageCreated', event });
  }

  /** 发布 Runtime 消息更新事件。 */
  function handleMessageUpdated(event: ChatRuntimeMessageEvent): void {
    if (!shouldHandle(event) && !isContinuationUpdate(event)) return;
    actorSystem.emitSessionEvent(event.sessionId, { type: 'messageUpdated', event });
  }

  /** 发布 Runtime 消息删除事件。 */
  function handleMessageDeleted(event: ChatRuntimeMessageDeletedEvent): void {
    if (shouldHandle(event)) actorSystem.emitSessionEvent(event.sessionId, { type: 'messageDeleted', event });
  }

  /** 发布 Runtime 上下文用量更新事件。 */
  function handleContextUsage(event: ChatRuntimeContextUsageEvent): void {
    if (shouldHandle(event)) actorSystem.emitSessionEvent(event.sessionId, { type: 'contextUsageUpdated', event });
  }

  /** 完成目标 Agent 并释放 Runtime。 */
  function handleComplete(event: ChatRuntimeCompleteEvent): void {
    if (!shouldHandle(event)) return;
    if (event.reason === 'awaiting_user_input') {
      runtimeStore.setStatus(resolveRuntimeTabId(event.sessionId), 'waiting');
      actorSystem.send({
        type: 'runtime.event',
        runtimeId: event.runtimeId,
        event: { type: 'runtime.userChoiceRequired', runtimeId: event.runtimeId, interaction: 'userChoice' }
      });
      actorSystem.sendToSession(event.sessionId, { type: 'session.userChoiceRequired', interaction: event.interaction });
      actorSystem.unregisterRuntime(event.runtimeId);
      return;
    }
    if (event.reason === 'waiting_children') {
      runtimeStore.setStatus(resolveRuntimeTabId(event.sessionId), 'waiting');
      actorSystem.send({
        type: 'runtime.event',
        runtimeId: event.runtimeId,
        event: {
          type: 'runtime.suspended',
          runtimeId: event.runtimeId,
          checkpointId: event.checkpointId
        }
      });
      actorSystem.sendToSession(event.sessionId, {
        type: 'session.waitingChildren',
        runtimeId: event.runtimeId,
        checkpointId: event.checkpointId
      });
      actorSystem.unregisterRuntime(event.runtimeId);
      return;
    }
    expireRuntimeConfirmations(event.runtimeId);
    actorSystem.clearRuntimeInteractions(event.sessionId, event.runtimeId);
    // 先写入后台完成标记，让已挂载页面可在同步事件回调中按当前激活态覆盖它。
    const runtimeTabId = resolveRuntimeTabId(event.sessionId);
    if (hasVisibleTab(runtimeTabId)) runtimeStore.markCompleted(runtimeTabId, false);
    else runtimeStore.removeTab(runtimeTabId);
    actorSystem.emitSessionEvent(event.sessionId, { type: 'runtimeCompleted', event });
    actorSystem.send({ type: 'runtime.event', runtimeId: event.runtimeId, event: { type: 'runtime.completed', runtimeId: event.runtimeId } });
    actorSystem.sendToSession(event.sessionId, { type: 'session.completed' });
    actorSystem.unregisterRuntime(event.runtimeId);
  }

  /** 标记目标 Agent 失败并释放 Runtime。 */
  function handleError(event: ChatRuntimeErrorEvent): void {
    if (!shouldHandle(event)) return;
    expireRuntimeConfirmations(event.runtimeId);
    actorSystem.clearRuntimeInteractions(event.sessionId, event.runtimeId);
    actorSystem.send({
      type: 'runtime.event',
      runtimeId: event.runtimeId,
      event: { type: 'runtime.failed', runtimeId: event.runtimeId, error: createWorkflowError(event.error) }
    });
    actorSystem.sendToSession(event.sessionId, { type: 'session.failed', error: createWorkflowError(event.error) });
    actorSystem.emitSessionEvent(event.sessionId, { type: 'runtimeError', event });
    actorSystem.unregisterRuntime(event.runtimeId);
    const runtimeTabId = resolveRuntimeTabId(event.sessionId);
    if (hasVisibleTab(runtimeTabId)) runtimeStore.setStatus(runtimeTabId, 'error');
    else runtimeStore.removeTab(runtimeTabId);
  }

  /** 执行已捕获的 renderer 工具。 */
  async function handleToolRequest(event: ChatRuntimeToolRequestEvent): Promise<void> {
    const capabilities = actorSystem.getRuntimeCapabilities(event.runtimeId);
    if (!shouldHandle(event) || !capabilities) return;
    const abortKey = createToolAbortKey(event.runtimeId, event.toolCallId);
    const abortController = new AbortController();
    toolAbortControllers.set(abortKey, abortController);
    const shellCommandId = createShellCommandId(event.runtimeId, event.toolCallId);
    if (hasShellRunEvents(event)) {
      shellRoutes.set(shellCommandId, {
        runtimeId: event.runtimeId,
        sessionId: event.sessionId,
        toolCallId: event.toolCallId,
        cleanupTimer: null
      });
    }

    try {
      const executed = await executeToolCall(
        { toolCallId: event.toolCallId, toolName: event.toolName, input: event.input },
        [...capabilities.tools],
        capabilities.getToolContext(),
        { runtimeId: event.runtimeId, abortSignal: abortController.signal }
      );
      assertRuntimeResult(await electronAPI.chatRuntimeSubmitToolResult({ runtimeId: event.runtimeId, toolCallId: event.toolCallId, result: executed.result }));
    } catch (error: unknown) {
      assertRuntimeResult(
        await electronAPI.chatRuntimeSubmitToolResult({
          runtimeId: event.runtimeId,
          toolCallId: event.toolCallId,
          result: createToolFailure(event.toolName, error)
        })
      );
    } finally {
      toolAbortControllers.delete(abortKey);
      const route = shellRoutes.get(shellCommandId);
      if (route) {
        route.cleanupTimer = setTimeout((): void => {
          if (shellRoutes.get(shellCommandId) === route) shellRoutes.delete(shellCommandId);
        }, SHELL_ROUTE_GRACE_MS);
      }
    }
  }

  /**
   * 将 Shell PTY 事件路由到拥有该 toolCallId 的会话。
   * @param event - Shell 有序运行事件
   */
  function handleShellRunEvent(event: ElectronShellRunEventEnvelope): void {
    const route = shellRoutes.get(event.commandId);
    if (!route || !isManagedRuntime(actorSystem, route.runtimeId)) return;
    let translatedRunEvent = event.event;
    if (event.event.type === 'finished') {
      translatedRunEvent = { ...event.event, result: { ...event.event.result, commandId: route.toolCallId } };
    }
    const translatedEvent: ElectronShellRunEventEnvelope = {
      ...event,
      commandId: route.toolCallId,
      event: translatedRunEvent
    };
    actorSystem.emitSessionEvent(route.sessionId, { type: 'shellRunEvent', event: translatedEvent });
    if (event.event.type === 'finished') {
      if (route.cleanupTimer) clearTimeout(route.cleanupTimer);
      shellRoutes.delete(event.commandId);
    }
  }

  /** 中止 main 已停止等待的 renderer 本地工具。 */
  function handleToolCancelled(event: ChatRuntimeToolCancelledEvent): void {
    if (!shouldHandle(event)) return;
    toolAbortControllers.get(createToolAbortKey(event.runtimeId, event.toolCallId))?.abort();
    expireRuntimeConfirmations(event.runtimeId, event.toolCallId);
    actorSystem.clearRuntimeInteractions(event.sessionId, event.runtimeId, event.toolCallId);
  }

  /** 将确认请求路由到目标 Session UI 和 Agent。 */
  async function handleConfirmationRequest(event: ChatRuntimeConfirmationRequestEvent): Promise<void> {
    if (!shouldHandle(event)) return;
    const normalizedEvent = { ...event, request: normalizeToolConfirmationRequest(event.request) };
    const rememberedDecision = getRememberedRuntimeConfirmationDecision(normalizedEvent.request, {
      session: toolPermissionStore.sessionToolPermissionGrants,
      always: toolPermissionStore.alwaysToolPermissionGrants
    });
    if (rememberedDecision) {
      const [submitError, result] = await asyncTo(
        electronAPI.chatRuntimeSubmitConfirmation({
          runtimeId: event.runtimeId,
          confirmationId: event.confirmationId,
          decision: rememberedDecision
        })
      );
      if (!submitError && result?.ok) return;
      // 自动授权提交失败时回退到可见确认，避免 Main 的无超时 confirmation 永久悬挂。
    }
    actorSystem.send({
      type: 'runtime.event',
      runtimeId: event.runtimeId,
      event: { type: 'runtime.userChoiceRequired', runtimeId: event.runtimeId, interaction: 'confirmation' }
    });
    actorSystem.sendToSession(event.sessionId, { type: 'session.userChoiceRequired' });
    actorSystem.emitSessionEvent(event.sessionId, { type: 'confirmationRequested', event: normalizedEvent });
    runtimeStore.setStatus(resolveRuntimeTabId(event.sessionId), 'waiting');
  }

  /** 执行已捕获的应用级 Bridge handler。 */
  async function handleBridgeRequest(event: ChatRuntimeBridgeRequestEvent): Promise<void> {
    const capabilities = actorSystem.getRuntimeCapabilities(event.runtimeId);
    if (!shouldHandle(event) || !capabilities) return;

    let result: ChatRuntimeBridgeResult;
    try {
      result = { status: 'success', data: await capabilities.handleBridgeRequest(event) };
    } catch (error: unknown) {
      result = createBridgeFailure(error);
    }
    assertRuntimeResult(await electronAPI.chatRuntimeSubmitBridgeResponse({ runtimeId: event.runtimeId, requestId: event.requestId, result }));
  }

  /**
   * 兼容尚未暴露 Shell run-event bridge 的旧 preload，并保持 capability fail-closed。
   * @returns Shell 事件监听释放函数
   */
  function subscribeShellEvents(): () => void {
    if (typeof electronAPI.onShellRunEvent !== 'function') return (): void => undefined;
    return electronAPI.onShellRunEvent(handleShellRunEvent);
  }

  const disposers = [
    electronAPI.chatRuntimeOnMessageCreated(handleMessageCreated),
    electronAPI.chatRuntimeOnMessageUpdated(handleMessageUpdated),
    electronAPI.chatRuntimeOnMessageDeleted(handleMessageDeleted),
    electronAPI.chatRuntimeOnContextUsageUpdated(handleContextUsage),
    electronAPI.chatRuntimeOnToolRequest((event) => {
      handleToolRequest(event).catch(() => undefined);
    }),
    electronAPI.chatRuntimeOnToolCancelled(handleToolCancelled),
    subscribeShellEvents(),
    electronAPI.chatRuntimeOnConfirmationRequested((event) => {
      handleConfirmationRequest(event).catch(() => undefined);
    }),
    electronAPI.chatRuntimeOnBridgeRequested((event) => {
      handleBridgeRequest(event).catch(() => undefined);
    }),
    electronAPI.chatRuntimeOnComplete(handleComplete),
    electronAPI.chatRuntimeOnError(handleError)
  ];

  onScopeDispose((): void => {
    for (const controller of toolAbortControllers.values()) controller.abort();
    toolAbortControllers.clear();
    for (const route of shellRoutes.values()) {
      if (route.cleanupTimer) clearTimeout(route.cleanupTimer);
    }
    shellRoutes.clear();
    for (const dispose of disposers) dispose();
  });
}
