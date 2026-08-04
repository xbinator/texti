/**
 * @file useRuntimeEvents.ts
 * @description 应用级 ChatRuntime IPC 事件监听、路由和 renderer 请求处理。
 */
import type { AIToolActivityReporter, AIToolExecutionResult, ChatToolExternalWait, ChatToolProgressSnapshot } from 'types/ai';
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
  ChatRuntimeSubmitToolActivityInput,
  ChatRuntimeToolActivity,
  ChatRuntimeToolCancelledEvent,
  ChatRuntimeToolRequestEvent
} from 'types/chat-runtime';
import type { ElectronShellRunEventEnvelope } from 'types/electron-api';
import { onScopeDispose } from 'vue';
import { findIndex, findLastIndex } from 'lodash-es';
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
/** Renderer 工具存活心跳间隔。 */
const TOOL_HEARTBEAT_INTERVAL_MS = 15_000;
/** Shell 活动消息允许保留的最大字符数。 */
const SHELL_PROGRESS_MESSAGE_MAX = 160;
/** 单个 Renderer 工具最多积压的活动事件数量。 */
const TOOL_ACTIVITY_QUEUE_LIMIT = 64;

/** 单个 Renderer 工具调用的活动上报状态。 */
interface ToolActivityFlight {
  /** 所属 Runtime。 */
  runtimeId: string;
  /** 工具调用 ID。 */
  toolCallId: string;
  /** 下一个活动事件使用的递增序号。 */
  sequence: number;
  /** 串行活动 IPC 队列。 */
  queue: Promise<void>;
  /** 尚未发送的有序活动；相邻高频进展会在这里合并。 */
  pendingActivities: ChatRuntimeToolActivity[];
  /** 是否已有队列消费者在运行。 */
  draining: boolean;
  /** 是否仍接受新的活动。 */
  accepting: boolean;
  /** 周期性存活心跳。 */
  heartbeatTimer: ReturnType<typeof setInterval> | null;
}

/** 单个 auto-default Shell 工具的 renderer 路由状态。 */
interface ShellEventRoute extends Pick<ChatRuntimeToolRequestEvent, 'runtimeId' | 'sessionId' | 'toolCallId'> {
  /** 异常事件缺失时的有界回收定时器。 */
  cleanupTimer: ReturnType<typeof setTimeout> | null;
  /** 向同一工具活动序列提交实质进展。 */
  reportProgress: (progress: Omit<ChatToolProgressSnapshot, 'updatedAt'>) => void;
  /** 最后已上报的终端屏幕，用于跳过重复刷新。 */
  lastTerminalContent: string;
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
 * 从 Shell 屏幕快照提取有界活动摘要。
 * @param content - 当前终端屏幕
 * @returns 不包含完整输出的短摘要
 */
function createShellSummary(content: string): string {
  const normalized = content.replace(/\s+/gu, ' ').trim();
  if (normalized.length <= SHELL_PROGRESS_MESSAGE_MAX) return normalized;
  return `…${normalized.slice(-SHELL_PROGRESS_MESSAGE_MAX)}`;
}

/**
 * 注册应用级 ChatRuntime 事件监听。
 * 未被 Actor system 注册的 Runtime 保留给迁移期间的旧 BChat listener。
 * @param actorSystem - 应用级 Chat Actor system
 */
export function useRuntimeEvents(actorSystem: ChatActorSystem): void {
  const electronAPI = getElectronAPI();
  const toolAbortControllers = new Map<string, AbortController>();
  const toolActivityFlights = new Map<string, ToolActivityFlight>();
  const shellRoutes = new Map<string, ShellEventRoute>();
  const runtimeStore = useChatTabStore();
  const tabsStore = useTabsStore();

  /**
   * 创建工具活动 IPC 输入并占用下一个序号。
   * @param flight - 工具活动状态
   * @param activity - 非终态活动
   * @returns 活动 IPC 输入
   */
  function createActivityInput(flight: ToolActivityFlight, activity: ChatRuntimeToolActivity): ChatRuntimeSubmitToolActivityInput {
    flight.sequence += 1;
    return {
      runtimeId: flight.runtimeId,
      toolCallId: flight.toolCallId,
      sequence: flight.sequence,
      occurredAt: Date.now(),
      activity
    };
  }

  /**
   * 提交一个必须确认成功的活动事件。
   * @param input - 已占用序号的活动输入
   */
  async function sendToolActivity(input: ChatRuntimeSubmitToolActivityInput): Promise<void> {
    assertRuntimeResult(await electronAPI.chatRuntimeSubmitToolActivity(input));
  }

  /**
   * 按调用顺序排空单个工具活动，并在发送边界分配连续序号。
   * @param flight - 工具活动状态
   */
  async function drainToolActivities(flight: ToolActivityFlight): Promise<void> {
    const activity = flight.pendingActivities.shift();
    if (!activity) {
      flight.draining = false;
      return;
    }
    await asyncTo(sendToolActivity(createActivityInput(flight, activity)));
    await drainToolActivities(flight);
  }

  /**
   * 判断活动是否属于可安全合并的高频遥测。
   * @param activity - 工具活动
   * @returns 是否为 progress 或 heartbeat
   */
  function isToolTelemetry(activity: ChatRuntimeToolActivity): boolean {
    return activity.kind === 'progress' || activity.kind === 'heartbeat';
  }

  /**
   * 有界加入单工具活动队列，并在最近控制事件之后只保留每类最新遥测。
   * @param flight - 工具活动状态
   * @param activity - 待加入活动
   * @returns 是否已加入队列
   */
  function enqueueToolActivity(flight: ToolActivityFlight, activity: ChatRuntimeToolActivity): boolean {
    const telemetry = isToolTelemetry(activity);
    if (telemetry) {
      const controlIndex = findLastIndex(flight.pendingActivities, (pending): boolean => !isToolTelemetry(pending));
      const duplicateIndex = findLastIndex(flight.pendingActivities, (pending, index): boolean => index > controlIndex && pending.kind === activity.kind);
      if (duplicateIndex >= 0) flight.pendingActivities.splice(duplicateIndex, 1);
    }

    if (flight.pendingActivities.length >= TOOL_ACTIVITY_QUEUE_LIMIT) {
      if (telemetry) return false;
      const telemetryIndex = findIndex(flight.pendingActivities, isToolTelemetry);
      if (telemetryIndex < 0) {
        // 控制事件也填满队列说明执行器已失控；解除可能已发送的等待后停止续期，让 Watchdog 安全收敛。
        flight.accepting = false;
        flight.pendingActivities.length = 0;
        flight.pendingActivities.push({ kind: 'resumed' });
        return true;
      }
      // 等待/恢复等控制状态优先于可重建的遥测，满队列时只淘汰最早遥测。
      flight.pendingActivities.splice(telemetryIndex, 1);
    }

    flight.pendingActivities.push(activity);
    return true;
  }

  /**
   * 将活动事件串行加入单工具队列，后台上报失败不会阻塞本地工具收敛。
   * @param flight - 工具活动状态
   * @param activity - 非终态活动
   */
  function queueToolActivity(flight: ToolActivityFlight, activity: ChatRuntimeToolActivity): void {
    if (!flight.accepting) return;
    if (!enqueueToolActivity(flight, activity)) return;
    if (flight.draining) return;
    flight.draining = true;
    flight.queue = drainToolActivities(flight);
  }

  /**
   * 创建传给 Renderer 工具的受限活动上报器。
   * @param flight - 工具活动状态
   * @returns 受限活动上报器
   */
  function createActivityReporter(flight: ToolActivityFlight): AIToolActivityReporter {
    return {
      heartbeat(): void {
        queueToolActivity(flight, { kind: 'heartbeat' });
      },
      progress(progress: Omit<ChatToolProgressSnapshot, 'updatedAt'>): void {
        queueToolActivity(flight, { kind: 'progress', progress });
      },
      waitUser(prompt: string): void {
        queueToolActivity(flight, { kind: 'waiting_user', prompt });
      },
      waitExternal(wait: ChatToolExternalWait): void {
        queueToolActivity(flight, { kind: 'waiting_external', wait });
      },
      resume(): void {
        queueToolActivity(flight, { kind: 'resumed' });
      }
    };
  }

  /**
   * 清理 Renderer 工具的本地路由和活动资源。
   * @param abortKey - AbortController 索引
   * @param shellCommandId - Shell 路由索引
   * @param flight - 工具活动状态
   */
  function cleanupToolFlight(abortKey: string, shellCommandId: string, flight: ToolActivityFlight): void {
    if (flight.heartbeatTimer) clearInterval(flight.heartbeatTimer);
    flight.accepting = false;
    flight.pendingActivities.length = 0;
    toolAbortControllers.delete(abortKey);
    toolActivityFlights.delete(abortKey);
    const route = shellRoutes.get(shellCommandId);
    if (!route) return;
    route.cleanupTimer = setTimeout((): void => {
      if (shellRoutes.get(shellCommandId) === route) shellRoutes.delete(shellCommandId);
    }, SHELL_ROUTE_GRACE_MS);
  }

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
    const activityFlight: ToolActivityFlight = {
      runtimeId: event.runtimeId,
      toolCallId: event.toolCallId,
      sequence: 0,
      queue: Promise.resolve(),
      pendingActivities: [],
      draining: false,
      accepting: true,
      heartbeatTimer: null
    };
    toolActivityFlights.set(abortKey, activityFlight);
    const activityReporter = createActivityReporter(activityFlight);
    if (hasShellRunEvents(event)) {
      shellRoutes.set(shellCommandId, {
        runtimeId: event.runtimeId,
        sessionId: event.sessionId,
        toolCallId: event.toolCallId,
        cleanupTimer: null,
        reportProgress: activityReporter.progress,
        lastTerminalContent: ''
      });
    }

    // started 必须先被 Main 接受，Renderer controller 才会撤销启动保护定时器。
    const [startError] = await asyncTo(sendToolActivity(createActivityInput(activityFlight, { kind: 'started' })));
    let toolResult: AIToolExecutionResult;
    if (startError) {
      toolResult = createToolFailure(event.toolName, startError);
    } else {
      activityFlight.heartbeatTimer = setInterval((): void => {
        activityReporter.heartbeat();
      }, TOOL_HEARTBEAT_INTERVAL_MS);
      const [executeError, executed] = await asyncTo(
        executeToolCall(
          { toolCallId: event.toolCallId, toolName: event.toolName, input: event.input },
          [...capabilities.tools],
          capabilities.getToolContext(),
          { runtimeId: event.runtimeId, abortSignal: abortController.signal, activity: activityReporter }
        )
      );
      toolResult =
        executeError || !executed ? createToolFailure(event.toolName, executeError ?? new Error('Renderer tool returned no result')) : executed.result;
    }

    if (activityFlight.heartbeatTimer) clearInterval(activityFlight.heartbeatTimer);
    activityFlight.heartbeatTimer = null;
    await activityFlight.queue;
    const [submitError, submitResult] = await asyncTo(
      electronAPI.chatRuntimeSubmitToolResult({ runtimeId: event.runtimeId, toolCallId: event.toolCallId, result: toolResult })
    );
    cleanupToolFlight(abortKey, shellCommandId, activityFlight);
    if (submitError) throw submitError;
    if (submitResult) assertRuntimeResult(submitResult);
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
    if (event.event.type === 'terminal_update' && event.event.content !== route.lastTerminalContent) {
      route.lastTerminalContent = event.event.content;
      route.reportProgress({
        phase: 'shell_output',
        completed: event.event.content.length,
        message: createShellSummary(event.event.content)
      });
    } else if (event.event.type === 'auto_answer') {
      route.reportProgress({ phase: 'shell_auto_answer', completed: event.event.count, message: `已自动响应 ${event.event.count} 次` });
    } else if (event.event.type === 'finished') {
      route.reportProgress({ phase: 'shell_finished', completed: 1, total: 1, message: '命令执行完成' });
    }
    if (event.event.type === 'finished') {
      if (route.cleanupTimer) clearTimeout(route.cleanupTimer);
      shellRoutes.delete(event.commandId);
    }
  }

  /** 中止 main 已停止等待的 renderer 本地工具。 */
  function handleToolCancelled(event: ChatRuntimeToolCancelledEvent): void {
    if (!shouldHandle(event)) return;
    const abortKey = createToolAbortKey(event.runtimeId, event.toolCallId);
    toolAbortControllers.get(abortKey)?.abort();
    const activityFlight = toolActivityFlights.get(abortKey);
    if (activityFlight?.heartbeatTimer) {
      clearInterval(activityFlight.heartbeatTimer);
      activityFlight.heartbeatTimer = null;
    }
    if (activityFlight) {
      activityFlight.accepting = false;
      activityFlight.pendingActivities.length = 0;
    }
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
    for (const flight of toolActivityFlights.values()) {
      if (flight.heartbeatTimer) clearInterval(flight.heartbeatTimer);
      flight.accepting = false;
      flight.pendingActivities.length = 0;
    }
    toolActivityFlights.clear();
    for (const route of shellRoutes.values()) {
      if (route.cleanupTimer) clearTimeout(route.cleanupTimer);
    }
    shellRoutes.clear();
    for (const dispose of disposers) dispose();
  });
}
