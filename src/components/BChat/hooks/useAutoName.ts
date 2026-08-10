/**
 * @file useAutoName.ts
 * @description 负责首轮会话的自动命名快照冻结、延迟调度与标题持久化
 */
import { getCurrentScope, onScopeDispose, ref } from 'vue';
import type { Message } from '@/components/BChat/utils/types';
import { getElectronAPI } from '@/shared/platform/electron-api';
import { storeEvents } from '@/stores/helpers/events';
import { asyncTo } from '@/utils/asyncTo';

const DEBOUNCE_MS = 300;

/** 最多保留的已完成自动命名会话数。 */
export const AUTO_NAME_SESSION_LIMIT = 256;

/** 最多同时保留的待执行自动命名任务数。 */
export const AUTO_NAME_PENDING_LIMIT = 8;

/**
 * 自动命名快照。
 */
interface AutoNameSnapshot {
  /** 需要被命名的会话 ID。 */
  sessionId: string;
  /** 用户首条消息内容。 */
  userMessage: string;
  /** 首轮 AI 回复内容。 */
  aiResponse: string;
}

/**
 * 单个会话的待处理命名任务。
 */
interface PendingAutoNameTask {
  /** 当前会话最近一次冻结的快照。 */
  snapshot: AutoNameSnapshot;
  /** 当前会话的防抖定时器。 */
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * 自动命名 Hook 的依赖项。
 */
interface AutoNameOptions {
  /** 获取当前激活会话，用于仅刷新当前 UI 镜像。 */
  getCurrentSession: () => { id: string; title: string } | undefined;
  /** 从完成回调现场提取首轮命名内容，非首轮或中间态时返回 null。 */
  getFirstRoundContent: (message: Pick<Message, 'content'>) => { userMessage: string; aiResponse: string } | null;
  /** 标题持久化完成后的回调。 */
  onTitlePersisted?: (sessionId: string, title: string) => Promise<void> | void;
}

/**
 * 提供自动命名能力。
 * @param options - 调用方提供的上下文读取能力。
 * @returns 快照采集与调度方法。
 */
export function useAutoName(options: AutoNameOptions): {
  captureSnapshot: (message: Pick<Message, 'content'>, sessionId: string | null | undefined) => AutoNameSnapshot | null;
  scheduleAutoName: (snapshot: AutoNameSnapshot, isLoading: () => boolean) => void;
} {
  /** 已经处理过自动命名的会话集合。 */
  const namedSessionIds = ref(new Set<string>());
  /** 按会话隔离的待执行任务。 */
  const pendingTasks = ref(new Map<string, PendingAutoNameTask>());
  /** Electron API。 */
  const electronAPI = getElectronAPI();
  /** 所属 Vue scope 是否已释放。 */
  let disposed = false;

  /** 清理全部待命名定时器和会话去重状态。 */
  function disposeAutoName(): void {
    disposed = true;
    for (const task of pendingTasks.value.values()) {
      if (task.timer) clearTimeout(task.timer);
    }
    pendingTasks.value.clear();
    namedSessionIds.value.clear();
  }

  if (getCurrentScope()) onScopeDispose(disposeAutoName);

  /**
   * 记录已完成会话并淘汰最旧去重标记。
   * @param sessionId - 已命名会话 ID
   */
  function rememberNamedSession(sessionId: string): void {
    namedSessionIds.value.delete(sessionId);
    namedSessionIds.value.add(sessionId);
    while (namedSessionIds.value.size > AUTO_NAME_SESSION_LIMIT) {
      const oldestSessionId = namedSessionIds.value.values().next().value;
      if (typeof oldestSessionId !== 'string') break;
      namedSessionIds.value.delete(oldestSessionId);
    }
  }

  /**
   * 为新会话预留待执行槽位，并取消超出上限的最旧定时器。
   */
  function reservePendingSlot(): void {
    while (pendingTasks.value.size >= AUTO_NAME_PENDING_LIMIT) {
      const oldestSessionId = pendingTasks.value.keys().next().value;
      if (typeof oldestSessionId !== 'string') break;
      const oldestTask = pendingTasks.value.get(oldestSessionId);
      if (oldestTask?.timer) clearTimeout(oldestTask.timer);
      pendingTasks.value.delete(oldestSessionId);
    }
  }

  /**
   * 在任何异步持久化之前冻结会话 ID 与首轮内容。
   * @param message - 当前完成的 assistant 消息。
   * @param sessionId - 当前活跃会话 ID，在调用点先行冻结。
   * @returns 可用于后续异步命名的纯数据快照。
   */
  function captureSnapshot(message: Pick<Message, 'content'>, sessionId: string | null | undefined): AutoNameSnapshot | null {
    const content = options.getFirstRoundContent(message);
    if (!content || !sessionId) {
      return null;
    }

    return {
      sessionId,
      userMessage: content.userMessage,
      aiResponse: content.aiResponse
    };
  }

  /**
   * 执行一次自动命名。
   * @param snapshot - 已冻结的首轮对话快照。
   */
  async function doAutoName(snapshot: AutoNameSnapshot): Promise<void> {
    if (disposed || namedSessionIds.value.has(snapshot.sessionId)) {
      return;
    }

    const result = await electronAPI.chatRuntimeAutoName({
      sessionId: snapshot.sessionId,
      userMessage: snapshot.userMessage,
      aiResponse: snapshot.aiResponse
    });
    if (disposed) return;

    if (!result.ok || result.data?.status !== 'success') {
      rememberNamedSession(snapshot.sessionId);
      return;
    }

    const currentSession = options.getCurrentSession();
    if (currentSession?.id === snapshot.sessionId) {
      currentSession.title = result.data.title;
    }

    // 页面可能已被关闭，使用全局事件同步仍然存活的顶部标签。
    storeEvents.emitChatSessionTitleUpdated(snapshot.sessionId, result.data.title);
    // 列表刷新失败不影响已完成的持久化。
    await asyncTo(Promise.resolve(options.onTitlePersisted?.(snapshot.sessionId, result.data.title)));
    rememberNamedSession(snapshot.sessionId);
  }

  /**
   * 为指定会话排入或刷新自动命名任务。
   * @param snapshot - 当前冻结的快照。
   * @param isLoading - 用于判断流式是否仍在继续。
   */
  function scheduleAutoName(snapshot: AutoNameSnapshot, isLoading: () => boolean): void {
    if (disposed) return;
    const { sessionId } = snapshot;
    const task = pendingTasks.value.get(sessionId);

    if (task) {
      task.snapshot = snapshot;
      if (task.timer) {
        clearTimeout(task.timer);
      }
    } else {
      reservePendingSlot();
      pendingTasks.value.set(sessionId, { snapshot, timer: null });
    }

    const nextTask = pendingTasks.value.get(sessionId);
    if (!nextTask) {
      return;
    }

    nextTask.timer = setTimeout(async () => {
      if (disposed) return;
      const latestTask = pendingTasks.value.get(sessionId);
      const latestSnapshot = latestTask?.snapshot ?? snapshot;

      if (isLoading()) {
        scheduleAutoName(latestSnapshot, isLoading);
        return;
      }

      await doAutoName(latestSnapshot);
      pendingTasks.value.delete(sessionId);
    }, DEBOUNCE_MS);
  }

  return { captureSnapshot, scheduleAutoName };
}
