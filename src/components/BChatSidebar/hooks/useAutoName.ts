/**
 * @file useAutoName.ts
 * @description 负责首轮会话的自动命名快照冻结、延迟调度与标题持久化
 */
import { ref } from 'vue';
import type { Message } from '@/components/BChatSidebar/utils/types';
import { useChat } from '@/hooks/useChat';
import { useChatStore } from '@/stores/chat';
import { useServiceModelStore } from '@/stores/serviceModel';
import { asyncTo } from '@/utils/asyncTo';
import { AUTONAME_DEFAULT_PROMPT } from '@/views/settings/service-model/constants';

const DEBOUNCE_MS = 300;

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
  /** LLM 调用代理。 */
  const { agent } = useChat({});
  /** 服务模型配置 Store。 */
  const serviceModelStore = useServiceModelStore();
  /** 聊天数据 Store。 */
  const chatStore = useChatStore();

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
    if (namedSessionIds.value.has(snapshot.sessionId)) {
      return;
    }

    const serviceConfig = await serviceModelStore.getAvailableServiceConfig('autoname');
    if (!serviceConfig?.providerId || !serviceConfig?.modelId) {
      namedSessionIds.value.add(snapshot.sessionId);
      return;
    }

    const promptTemplate = serviceConfig.customPrompt || AUTONAME_DEFAULT_PROMPT;
    const prompt = promptTemplate.replace(/\{\{USER_MESSAGE\}\}/g, snapshot.userMessage).replace(/\{\{AI_RESPONSE\}\}/g, snapshot.aiResponse);

    const [invokeError, result] = await agent.invoke({
      providerId: serviceConfig.providerId,
      modelId: serviceConfig.modelId,
      prompt
    });

    if (invokeError || !result?.text) {
      namedSessionIds.value.add(snapshot.sessionId);
      return;
    }

    const title = result.text.replace(/(^["'\u201c\u201d\u2018\u2019]+)|(["'\u201c\u201d\u2018\u2019]+$)/g, '').trim();
    if (!title) {
      namedSessionIds.value.add(snapshot.sessionId);
      return;
    }

    const [persistError] = await asyncTo(chatStore.updateSessionTitle(snapshot.sessionId, title));
    if (persistError) {
      namedSessionIds.value.add(snapshot.sessionId);
      return;
    }

    const currentSession = options.getCurrentSession();
    if (currentSession?.id === snapshot.sessionId) {
      currentSession.title = title;
    }

    // 列表刷新失败不影响已完成的持久化。
    await asyncTo(Promise.resolve(options.onTitlePersisted?.(snapshot.sessionId, title)));
    namedSessionIds.value.add(snapshot.sessionId);
  }

  /**
   * 为指定会话排入或刷新自动命名任务。
   * @param snapshot - 当前冻结的快照。
   * @param isLoading - 用于判断流式是否仍在继续。
   */
  function scheduleAutoName(snapshot: AutoNameSnapshot, isLoading: () => boolean): void {
    const { sessionId } = snapshot;
    const task = pendingTasks.value.get(sessionId);

    if (task) {
      task.snapshot = snapshot;
      if (task.timer) {
        clearTimeout(task.timer);
      }
    } else {
      pendingTasks.value.set(sessionId, { snapshot, timer: null });
    }

    const nextTask = pendingTasks.value.get(sessionId);
    if (!nextTask) {
      return;
    }

    nextTask.timer = setTimeout(async () => {
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
