/**
 * @file useRuntimeRecovery.ts
 * @description 从主进程活跃 Runtime 快照重建 renderer Chat actor 与待处理请求。
 */
import type { ChatRuntimeHandlerResult, ChatRuntimeRecoveryPendingRequest, ChatRuntimeRecoverySnapshot } from 'types/chat-runtime';
import { useRoute } from 'vue-router';
import type { ChatActorSystem } from '@/ai/chat/actorSystem';
import type { RuntimeExecutionCapabilities } from '@/ai/chat/runtimeCapabilities';
import { CHAT_DRAFT_TAB_ID, createChatTabId } from '@/router/routes/helpers/chatRouteTab';
import { logger } from '@/shared/logger';
import { getElectronAPI } from '@/shared/platform/electron-api';
import { useChatTabStore } from '@/stores/chat/tab';
import { useSettingStore } from '@/stores/ui/setting';
import type { Tab } from '@/stores/workspace/tabs';
import { useTabsStore } from '@/stores/workspace/tabs';
import { asyncTo } from '@/utils/asyncTo';

/** 恢复 Runtime 与顶部标签的临时绑定信息。 */
interface RecoveredRuntimeBinding {
  /** Runtime 所属标签 ID。 */
  tabId: string;
}

/** Runtime 恢复流程的页面状态依赖。 */
interface RuntimeRecoveryOptions {
  /** 判断恢复记录所属标签当前是否正在被查看。 */
  isTabActive?: (tabId: string) => boolean;
}

/** 已恢复请求的稳定键。 */
function createPendingRequestKey(request: ChatRuntimeRecoveryPendingRequest): string {
  if (request.type === 'tool') return `${request.event.runtimeId}:tool:${request.event.toolCallId}`;
  if (request.type === 'confirmation') return `${request.event.runtimeId}:confirmation:${request.event.confirmationId}`;
  return `${request.event.runtimeId}:bridge:${request.event.requestId}`;
}

/** 解包 Runtime IPC 结果。 */
function unwrapRuntimeResult<T>(result: ChatRuntimeHandlerResult<T>): T {
  if (!result.ok || result.data === undefined) {
    throw new Error(result.error ?? 'ChatRuntime recovery request failed');
  }
  return result.data;
}

/** 为尚未挂载 BChat 的 Runtime 创建明确降级能力。 */
function createDegradedCapabilities(snapshot: ChatRuntimeRecoverySnapshot): RuntimeExecutionCapabilities {
  return {
    tools: [],
    descriptor: snapshot.capabilities,
    getToolContext: (): undefined => undefined,
    handleBridgeRequest: async (): Promise<never> => {
      throw Object.assign(new Error('Renderer context is unavailable after reload'), { code: 'EDITOR_UNAVAILABLE' as const });
    }
  };
}

/**
 * 识别重启前仍由唯一草稿标签持有的 Runtime。
 * @param snapshots - 当前活跃 Runtime 快照
 * @returns 可明确归属 chat:new 的 Runtime ID
 */
function findDraftRuntimeId(snapshots: ChatRuntimeRecoverySnapshot[]): string | undefined {
  const { tabs } = useTabsStore();
  if (!tabs.some((tab: Tab): boolean => tab.id === CHAT_DRAFT_TAB_ID)) return undefined;

  const sidebarSessionId = useSettingStore().chatSidebarActiveSessionId;
  const candidates = snapshots.filter((snapshot: ChatRuntimeRecoverySnapshot): boolean => {
    if (snapshot.sessionId === sidebarSessionId) return false;
    return !tabs.some((tab: Tab): boolean => tab.id === createChatTabId(snapshot.sessionId));
  });
  return candidates.length === 1 ? candidates[0]?.runtimeId : undefined;
}

/**
 * 将恢复 Runtime 同步到可见标签或后台分离记录。
 * @param snapshot - 恢复 Runtime 快照
 * @param bindings - 本轮恢复识别的 Runtime 标签绑定
 * @param draftRuntimeId - 可明确归属唯一草稿标签的 Runtime ID
 */
function syncRecoveredRuntime(snapshot: ChatRuntimeRecoverySnapshot, bindings: Map<string, RecoveredRuntimeBinding>, draftRuntimeId?: string): void {
  const runtimeStore = useChatTabStore();
  const { tabs } = useTabsStore();
  const persistedTabId = createChatTabId(snapshot.sessionId);
  const boundTabId = bindings.get(snapshot.runtimeId)?.tabId;
  // 用户可能在两次快照查询之间关闭标签，旧绑定只有在标签仍可见时才可复用。
  const visibleBoundTabId = boundTabId && tabs.some((tab: Tab): boolean => tab.id === boundTabId) ? boundTabId : undefined;
  const knownTabId = visibleBoundTabId ?? (snapshot.runtimeId === draftRuntimeId ? CHAT_DRAFT_TAB_ID : undefined);
  const tabId = knownTabId ?? persistedTabId;

  runtimeStore.ensureTab(tabId, snapshot.sessionId);
  const waitingForConfirmation = snapshot.pendingRequests.some((request: ChatRuntimeRecoveryPendingRequest): boolean => request.type === 'confirmation');
  runtimeStore.setStatus(tabId, waitingForConfirmation ? 'waiting' : 'running');

  bindings.set(snapshot.runtimeId, { tabId });
}

/** 处理主进程仍在等待的 renderer 请求。 */
async function replayPendingRequest(actorSystem: ChatActorSystem, request: ChatRuntimeRecoveryPendingRequest): Promise<void> {
  const electronAPI = getElectronAPI();
  if (request.type === 'confirmation') {
    actorSystem.emitSessionEvent(request.event.sessionId, { type: 'confirmationRequested', event: request.event });
    return;
  }
  if (request.type === 'tool') {
    const result = await electronAPI.chatRuntimeSubmitToolResult({
      runtimeId: request.event.runtimeId,
      toolCallId: request.event.toolCallId,
      result: {
        toolName: request.event.toolName,
        status: 'failure',
        error: { code: 'RUNTIME_INTERRUPTED', message: 'Renderer reloaded before the local tool request completed' }
      }
    });
    if (!result.ok) throw new Error(result.error ?? 'Failed to resolve recovered renderer tool request');
    return;
  }

  const result = await electronAPI.chatRuntimeSubmitBridgeResponse({
    runtimeId: request.event.runtimeId,
    requestId: request.event.requestId,
    result: {
      status: 'failure',
      error: { code: 'EDITOR_UNAVAILABLE', message: 'Renderer reloaded before the bridge request completed' }
    }
  });
  if (!result.ok) throw new Error(result.error ?? 'Failed to resolve recovered bridge request');
}

/** 第二份权威快照确认 pending 后的 replay 退避序列。 */
const REPLAY_RETRY_DELAYS = [50, 100] as const;

/**
 * 等待下一次 Runtime replay。
 * @param delayMs - 等待毫秒数
 */
function waitForReplay(delayMs: number): Promise<void> {
  return new Promise<void>((resolve): void => {
    setTimeout(resolve, delayMs);
  });
}

/**
 * 立即重放一次，并在失败后执行两次有限退避。
 * @param actorSystem - 应用级 Chat actor system
 * @param request - Main 仍在等待的 Renderer 请求
 */
async function replayWithRetry(actorSystem: ChatActorSystem, request: ChatRuntimeRecoveryPendingRequest): Promise<void> {
  let [lastError] = await asyncTo(replayPendingRequest(actorSystem, request));
  if (!lastError) return;

  for (const delayMs of REPLAY_RETRY_DELAYS) {
    // 重试必须串行等待，确保当前请求成功前后续请求不能越过。
    // eslint-disable-next-line no-await-in-loop
    await waitForReplay(delayMs);
    // eslint-disable-next-line no-await-in-loop
    const [retryError] = await asyncTo(replayPendingRequest(actorSystem, request));
    if (!retryError) return;
    lastError = retryError;
  }

  throw lastError;
}

/**
 * 恢复一批 Runtime 快照并重放其待处理请求。
 * @param actorSystem - 应用级 Chat actor system
 * @param snapshots - 当前活跃 Runtime 快照
 * @param replayedRequestKeys - 已重放请求的稳定键
 * @param bindings - 本轮恢复识别的 Runtime 标签绑定
 * @param draftRuntimeId - 可明确归属唯一草稿标签的 Runtime ID
 * @param tolerateReplayFailure - 是否允许第二份权威快照重试失败请求
 */
async function hydrateSnapshots(
  actorSystem: ChatActorSystem,
  snapshots: ChatRuntimeRecoverySnapshot[],
  replayedRequestKeys: Set<string>,
  bindings: Map<string, RecoveredRuntimeBinding>,
  draftRuntimeId?: string,
  tolerateReplayFailure = false
): Promise<void> {
  for (const snapshot of snapshots) {
    actorSystem.recoverRuntime(snapshot, createDegradedCapabilities(snapshot));
    syncRecoveredRuntime(snapshot, bindings, draftRuntimeId);
    for (const request of snapshot.pendingRequests) {
      const requestKey = createPendingRequestKey(request);
      if (replayedRequestKeys.has(requestKey)) continue;
      // 请求必须按 Runtime 内原始顺序重放，避免 Bridge 与确认结果交叉。
      const replay = tolerateReplayFailure ? replayPendingRequest(actorSystem, request) : replayWithRetry(actorSystem, request);
      // eslint-disable-next-line no-await-in-loop
      const [replayError] = await asyncTo(replay);
      if (replayError) {
        if (!tolerateReplayFailure) throw replayError;
        // 当前请求仍未收敛时暂停该 Runtime 的后续回放，由第二份权威快照保持原序重试。
        break;
      }
      replayedRequestKeys.add(requestKey);
    }
  }
}

/**
 * 从主进程事实源恢复活跃 ChatRuntime。
 * @param actorSystem - 应用级 Chat actor system
 * @param options - 当前页面状态依赖
 */
export async function recoverRuntimes(actorSystem: ChatActorSystem, options: RuntimeRecoveryOptions = {}): Promise<void> {
  const electronAPI = getElectronAPI();
  const replayedRequestKeys = new Set<string>();
  const bindings = new Map<string, RecoveredRuntimeBinding>();
  const firstSnapshots = unwrapRuntimeResult(await electronAPI.chatRuntimeListActive());
  await hydrateSnapshots(actorSystem, firstSnapshots, replayedRequestKeys, bindings, findDraftRuntimeId(firstSnapshots), true);

  // 第二次查询吸收首次查询期间新建或完成的 Runtime，避免恢复出过期路由。
  const finalSnapshots = unwrapRuntimeResult(await electronAPI.chatRuntimeListActive());
  await hydrateSnapshots(actorSystem, finalSnapshots, replayedRequestKeys, bindings, findDraftRuntimeId(finalSnapshots));
  const finalRuntimeIds = new Set(finalSnapshots.map((snapshot): string => snapshot.runtimeId));
  for (const snapshot of firstSnapshots) {
    if (finalRuntimeIds.has(snapshot.runtimeId)) continue;
    for (const pendingRequest of snapshot.pendingRequests) {
      if (pendingRequest.type === 'confirmation') {
        actorSystem.clearSessionPendingInteraction(snapshot.sessionId, pendingRequest.event.confirmationId);
      }
    }
    actorSystem.sendToSession(snapshot.sessionId, { type: 'session.completed' });
    actorSystem.unregisterRuntime(snapshot.runtimeId);
    const binding = bindings.get(snapshot.runtimeId);
    if (binding) {
      const hasVisibleTab = useTabsStore().tabs.some((tab: Tab): boolean => tab.id === binding.tabId);
      if (hasVisibleTab) useChatTabStore().markCompleted(binding.tabId, options.isTabActive?.(binding.tabId) ?? false);
      else useChatTabStore().removeTab(binding.tabId);
    }
  }
}

/** 在应用启动时异步恢复 ChatRuntime，失败只记录日志。 */
export function useRuntimeRecovery(actorSystem: ChatActorSystem): void {
  const route = useRoute();
  const tabsStore = useTabsStore();
  recoverRuntimes(actorSystem, {
    isTabActive: (tabId: string): boolean => tabsStore.tabs.some((tab: Tab): boolean => tab.id === tabId && tab.path === route.fullPath)
  }).catch((error: unknown): void => {
    logger.error(`[chat-runtime-recovery] ${error instanceof Error ? error.message : String(error)}`);
  });
}
