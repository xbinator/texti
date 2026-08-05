/**
 * @file useChatWorkflow.ts
 * @description 编排 BChat Session actor、ChatRuntime IPC 与消息级交互流程。
 */
import type { UseChatSessionActorReturn } from './useChatSessionActor';
import type { PreparedRuntimeRequest, useRuntimeRequestConfig } from './useRuntimeRequestConfig';
import type { RuntimeToolBinding, RuntimeToolDiscoveryBinding } from './useRuntimeTools';
import type { Message } from '../utils/types';
import type { AIServiceError, AIToolExecutor } from 'types/ai';
import type { ChatMessageFile } from 'types/chat';
import type {
  ChatRuntimeAbortResult,
  ChatRuntimeBridgeRequestEvent,
  ChatRuntimeContextUsageSnapshot,
  ChatRuntimeModelSelection,
  ChatRuntimeUserInputPart
} from 'types/chat-runtime';
import type { ComputedRef, Ref } from 'vue';
import { computed, nextTick, ref, watch } from 'vue';
import { cloneDeep } from 'lodash-es';
import type { ChatActorSystem } from '@/ai/chat/actorSystem';
import { findLastUserMessage } from '@/ai/chat/policies/memorySelection';
import { createRegenerationSlice } from '@/ai/chat/policies/regeneration';
import { getRuntimeConfirmationGrantScope } from '@/ai/chat/policies/runtimeConfirmation';
import type { ChatSessionUIEvent } from '@/ai/chat/sessionEvents';
import type { ChatWorkflowError } from '@/ai/chat/types';
import { getElectronAPI } from '@/shared/platform/electron-api';
import { useChatPermissionStore } from '@/stores/chat/permission';
import { useChatSessionStore } from '@/stores/chat/session';
import { asyncTo } from '@/utils/asyncTo';
import { hasRuntimeConfirmations, type createChatConfirmationController } from '../utils/confirmationController';
import { parseUserInput } from '../utils/filePartParser';
import { append, create, finalizeFailedMessage, userChoice } from '../utils/messageHelper';
import { appendRuntimeErrorMessage } from '../utils/runtimeError';
import { useChatRuntime } from './useChatRuntime';
import { useChatRuntimeLauncher } from './useChatRuntimeLauncher';
import { useChatSubmitter } from './useChatSubmitter';
import { useRollback, type UseRollbackReturns } from './useRollback';

/** Runtime 请求准备函数。 */
type PrepareRuntimeRequest = ReturnType<typeof useRuntimeRequestConfig>['prepareRuntimeRequest'];
/** Runtime 兼容请求配置函数。 */
type ResolveRuntimeRequestConfig = ReturnType<typeof useRuntimeRequestConfig>['resolveRuntimeRequestConfig'];
/** Chat 确认控制器。 */
type ChatConfirmationController = ReturnType<typeof createChatConfirmationController>;

/**
 * Chat Workflow hook 选项。
 */
interface UseChatWorkflowOptions {
  /** 当前消息列表 */
  messages: Ref<Message[]>;
  /** 当前会话 ID */
  activeSessionId: Ref<string | null>;
  /** 判断一次 null→Session 变化是否为当前操作内部创建的草稿晋升。 */
  isDraftPromotion: (sessionId: string) => boolean;
  /** 当前模型上下文窗口 */
  contextWindow: Ref<number>;
  /** 当前工作区根目录 */
  workspaceRoot: Readonly<Ref<string | null>>;
  /** 当前模型是否支持视觉 */
  supportsVision: Ref<boolean>;
  /** 应用级 Actor system */
  actorSystem: ChatActorSystem;
  /** 当前 Session actor API */
  sessionActor: UseChatSessionActorReturn;
  /** 当前可执行工具 */
  getActiveTools: (binding?: RuntimeToolDiscoveryBinding) => AIToolExecutor[];
  /** 准备 Runtime 请求 */
  prepareRuntimeRequest: PrepareRuntimeRequest;
  /** 解析兼容 Runtime 请求配置 */
  resolveRuntimeRequestConfig: ResolveRuntimeRequestConfig;
  /** 按不可变 Runtime 身份创建 Bridge 请求处理器 */
  createBridgeHandler: (binding?: RuntimeToolBinding) => (event: ChatRuntimeBridgeRequestEvent) => Promise<unknown>;
  /** 工具确认控制器 */
  confirmationController: ChatConfirmationController;
  /** 确保存在可持久化会话 */
  ensureActiveSession: (title: string, model: ChatRuntimeModelSelection) => Promise<string>;
  /** 获取未加载的更早历史 */
  fetchAllPriorHistory: (sessionId: string) => Promise<Message[]>;
  /** 替换 renderer 当前消息 */
  setLoadedMessages: (messages: Message[]) => void;
  /** 合并 Runtime 实时消息并推进历史 revision */
  upsertLiveMessage: (message: Message) => void;
  /** 删除 Runtime 实时消息并推进历史 revision */
  removeLiveMessage: (messageId: string) => void;
  /** 恢复输入草稿 */
  restoreInput: (message: Message) => void;
  /** 清空输入草稿 */
  clearInput: () => void;
  /** 聚焦输入编辑器 */
  focusInput: (options?: { moveToEnd?: boolean }) => void;
  /** 滚动消息到底部 */
  scrollToBottom: () => void;
  /** Runtime 完成后的页面级处理 */
  onRuntimeComplete: (message: Message) => Promise<void> | void;
  /** Runtime 投影完成后的上下文用量处理 */
  onContextUsageUpdated: (snapshot: ChatRuntimeContextUsageSnapshot) => void;
  /** 模型配置不存在 */
  onModelNotFound: () => void;
  /** 展示普通 Runtime 错误 */
  showRuntimeError: (message: string) => void;
  /** 会话切换取消本地准备后同步原会话投影。 */
  onPreparationCancelled: (sessionId: string, status: 'idle' | 'waiting') => void;
  /** 恢复被回退消息关联的 Todo 快照 */
  restoreTodoSnapshots: (sessionId: string | null, messages: Message[]) => void;
}

/**
 * Chat Workflow hook 返回值。
 */
interface UseChatWorkflowReturn {
  /** 当前会话是否忙碌 */
  loading: ComputedRef<boolean>;
  /** 消息级统一提交器 */
  chatSubmitter: ReturnType<typeof useChatSubmitter>;
  /** 回退能力与可回退判断 */
  rollbackController: UseRollbackReturns;
  /** 重新生成指定消息 */
  handleRegenerate: (message: Message) => Promise<void>;
  /** 手动压缩当前会话上下文 */
  compactContext: () => Promise<void>;
  /** 发送用户文本消息 */
  submitUserTextMessage: (content: string, images?: ChatMessageFile[], clearDraft?: boolean) => Promise<void>;
  /** 中止当前流程 */
  abort: () => Promise<void>;
  /** 取消当前流程 */
  cancel: () => Promise<void>;
  /** 回退到指定消息 */
  rollback: (message: Message) => Promise<void>;
  /** 释放 renderer 侧任务资源 */
  dispose: () => void;
  /** 处理应用级总线重放的 Session UI 事件 */
  handleSessionUIEvent: (event: ChatSessionUIEvent) => Promise<void>;
}

/**
 * 发送到 ChatRuntime 的用户消息输入。
 */
interface RuntimeUserMessageSendInput {
  /** 已创建的用户消息 */
  userMessage: Message;
  /** 结构化输入片段 */
  parts: ChatRuntimeUserInputPart[];
  /** 是否清空草稿 */
  clearDraft?: boolean;
}

/**
 * 创建当前 BChat 会话的 Runtime 工作流。
 * @param options - Actor、IPC 与页面回调依赖
 * @returns 可直接绑定到页面事件的工作流 API
 */
export function useChatWorkflow(options: UseChatWorkflowOptions): UseChatWorkflowReturn {
  const chatStore = useChatSessionStore();
  const toolPermissionStore = useChatPermissionStore();
  const preflightLoading = ref<boolean>(false);
  let operationSequence = 0;
  /** 每次可见 Session 身份变化都会推进的世代，用于识别 A→B→A。 */
  let sessionGeneration = 0;
  /** 当前异步准备操作启动时捕获的 Session 世代。 */
  let operationSessionGeneration = 0;
  /** 当前异步准备操作不可漂移的会话身份；null 表示尚未创建持久化草稿会话。 */
  let operationSessionId: string | null = null;
  /**
   * 收敛尚未注册 Main Runtime 的旧会话准备态。
   * @param sessionId - 被切离或卸载的会话 ID
   */
  function settleSessionPreparation(sessionId: string): void {
    const sessionSnapshot = options.actorSystem.getSession(sessionId)?.getSnapshot();
    if (!sessionSnapshot?.matches('preparing')) return;

    const status = sessionSnapshot.context.intent?.type === 'continue' ? 'waiting' : 'idle';
    options.actorSystem.sendToSession(sessionId, { type: 'session.preparationCancelled' });
    options.onPreparationCancelled(sessionId, status);
  }

  watch(
    options.activeSessionId,
    (sessionId: string | null, previousSessionId: string | null): void => {
      sessionGeneration += 1;
      // 旧预检会由世代校验拒绝，切换后的新会话无需继续继承其界面 loading。
      const internalDraftPromotion = previousSessionId === null && sessionId !== null && options.isDraftPromotion(sessionId);
      if (previousSessionId !== sessionId && !internalDraftPromotion) preflightLoading.value = false;
      if (previousSessionId && previousSessionId !== sessionId) settleSessionPreparation(previousSessionId);
    },
    { flush: 'sync' }
  );
  const loading = computed<boolean>(
    () =>
      preflightLoading.value ||
      options.sessionActor.loading.value ||
      options.sessionActor.waitingForUser.value ||
      userChoice.findPending(options.messages.value) !== null
  );

  /** 开始新的 renderer 工作流操作并使旧异步准备结果失效。 */
  function beginOperation(): number {
    operationSequence += 1;
    operationSessionId = options.activeSessionId.value;
    operationSessionGeneration = sessionGeneration;
    return operationSequence;
  }

  /**
   * 判断异步准备结果是否仍属于当前操作和原始会话。
   * @param operationId - 操作序列
   * @returns 操作与会话是否仍匹配
   */
  function isCurrentOperation(operationId: number): boolean {
    return operationId === operationSequence && options.activeSessionId.value === operationSessionId && sessionGeneration === operationSessionGeneration;
  }

  /**
   * 判断操作是否仍是最后启动的异步工作，用于安全释放不再可见的 loading。
   * @param operationId - 操作序列
   * @returns 是否仍是最新操作
   */
  function isLatestOperation(operationId: number): boolean {
    return operationId === operationSequence;
  }

  /**
   * 草稿首次创建会话后，把当前操作从 null 身份安全晋升到持久化会话。
   * @param operationId - 操作序列
   * @param sessionId - 创建或确认的会话 ID
   * @returns 是否仍可继续本次操作
   */
  function adoptOperationSession(operationId: number, sessionId: string): boolean {
    if (operationId !== operationSequence) return false;
    const promotesDraftSession = operationSessionId === null;
    if (!promotesDraftSession && operationSessionId !== sessionId) return false;
    if (options.activeSessionId.value !== sessionId) return false;
    if (!promotesDraftSession && operationSessionGeneration !== sessionGeneration) return false;
    operationSessionId = sessionId;
    // 草稿创建 Session 是同一操作内的合法身份变化，需要显式接纳新世代。
    if (promotesDraftSession) operationSessionGeneration = sessionGeneration;
    return true;
  }

  const runtimeLauncher = useChatRuntimeLauncher({
    activeSessionId: options.activeSessionId,
    actorSystem: options.actorSystem,
    sessionActor: options.sessionActor,
    getActiveTools: options.getActiveTools,
    prepareRuntimeRequest: options.prepareRuntimeRequest,
    createBridgeHandler: options.createBridgeHandler,
    isCurrentOperation
  });

  /** 准备当前操作的 Runtime 请求。 */
  async function prepareRuntimeWithCapabilities(
    selectionSource?: Message | null,
    selectionParts?: ChatRuntimeUserInputPart[]
  ): Promise<PreparedRuntimeRequest | null> {
    return runtimeLauncher.prepare(operationSequence, selectionSource, selectionParts);
  }

  /**
   * 在 Runtime 注册与 IPC 启动前保证会话模型已持久化。
   * @param sessionId - 当前会话 ID
   * @param prepared - 已冻结模型的 Runtime 请求
   */
  async function ensurePreparedModel(sessionId: string, prepared: PreparedRuntimeRequest): Promise<void> {
    await chatStore.ensureSessionModel(sessionId, prepared.config.model);
  }

  /** 处理 Runtime 完成。 */
  async function handleRuntimeComplete(nextMessage: Message): Promise<void> {
    options.sessionActor.markCompleted();
    if (nextMessage.runtimeId) {
      options.actorSystem.unregisterRuntime(nextMessage.runtimeId);
    }
    await options.onRuntimeComplete(nextMessage);
  }

  /**
   * 处理 Runtime 错误并写入持久化错误消息。
   * @param error - Runtime 标准错误
   * @param runtimeId - 失败 Runtime ID
   * @param messagePersistenceFailed - Main 是否未能持久化失败 assistant
   */
  async function handleRuntimeError(error: AIServiceError, runtimeId: string, messagePersistenceFailed = false): Promise<void> {
    const loadingAssistant = [...options.messages.value]
      .reverse()
      .find((message: Message): boolean => message.role === 'assistant' && message.runtimeId === runtimeId && message.loading === true);
    const recoveredMessage = loadingAssistant ? cloneDeep(loadingAssistant) : undefined;
    if (recoveredMessage) {
      finalizeFailedMessage(recoveredMessage, error);
      options.upsertLiveMessage(recoveredMessage);
    }
    options.sessionActor.markFailed({ code: 'runtime_failed', message: error.message, cause: error });
    const activeRuntimeId = options.sessionActor.activeRuntimeId.value;
    if (activeRuntimeId) {
      options.actorSystem.unregisterRuntime(activeRuntimeId);
    }
    if (error.code === 'MODEL_NOT_FOUND') {
      options.onModelNotFound();
      if (!recoveredMessage && !messagePersistenceFailed) return;
    }

    const sessionId = options.activeSessionId.value;
    if (!sessionId) {
      options.showRuntimeError(error.message);
      return;
    }
    await appendRuntimeErrorMessage({
      sessionId,
      content: error.message,
      visibleMessages: options.messages.value,
      fetchAllPriorHistory: options.fetchAllPriorHistory,
      persistMessages: chatStore.setSessionMessages,
      setLoadedMessages: options.setLoadedMessages,
      persistExistingError: Boolean(recoveredMessage) || messagePersistenceFailed,
      isSessionActive: (targetSessionId: string): boolean => options.activeSessionId.value === targetSessionId,
      afterMessagesUpdated: async (): Promise<void> => {
        await nextTick();
        options.scrollToBottom();
      }
    });
  }

  /** 将已解决交互同步回 Agent、Turn 与 Session。 */
  function markInteractionResolved(runtimeId: string, sessionId: string, confirmationId: string): void {
    options.actorSystem.clearSessionPendingInteraction(sessionId, confirmationId);
    if (hasRuntimeConfirmations(sessionId, runtimeId)) return;
    options.actorSystem.send({
      type: 'runtime.event',
      runtimeId,
      event: { type: 'runtime.interactionResolved', runtimeId }
    });
    options.actorSystem.sendToSession(sessionId, { type: 'session.interactionResolved' });
  }

  const chatRuntime = useChatRuntime();
  /** 最近一次用户选择续跑对应的操作序列。 */
  let continuationOperationId = 0;
  /** 最近一次用户选择续跑所属的不可变会话。 */
  let continuationSessionId: string | null = null;

  /**
   * 把启动失败路由到发起操作的 Session，而不是切换后的当前 Session。
   * @param sessionId - 发起操作的会话 ID
   * @param error - 标准工作流错误
   * @param runtimeId - 已在 Renderer 注册的 Runtime ID
   */
  function markSessionStartFailed(sessionId: string, error: ChatWorkflowError, runtimeId?: string): void {
    if (options.activeSessionId.value === sessionId) {
      if (runtimeId) options.sessionActor.markFailed(error);
      else options.sessionActor.markPreparationFailed(error);
      return;
    }
    options.actorSystem.sendToSession(sessionId, runtimeId ? { type: 'session.failed', error } : { type: 'session.preparationFailed', error });
  }

  /**
   * 把用户选择续跑失败路由到原 Session。
   * @param sessionId - 发起续跑的会话 ID
   * @param error - 标准工作流错误
   * @param runtimeId - 已在 Renderer 注册的 Runtime ID
   */
  function markSessionContinueFailed(sessionId: string, error: ChatWorkflowError, runtimeId?: string): void {
    if (options.activeSessionId.value === sessionId) {
      if (runtimeId) options.sessionActor.markUserChoiceSubmissionFailed(error);
      else options.sessionActor.markPreparationFailed(error);
      return;
    }
    options.actorSystem.sendToSession(
      sessionId,
      runtimeId ? { type: 'session.userChoiceSubmissionFailed', error } : { type: 'session.preparationFailed', error }
    );
  }

  /**
   * 将主进程中止结果投影到当前可见消息。
   * @param result - 主进程已经持久化的消息变更
   */
  function applyAbortResult(result: ChatRuntimeAbortResult): void {
    if (result.deletedMessageId) options.removeLiveMessage(result.deletedMessageId);
    if (result.assistantMessage) options.upsertLiveMessage(result.assistantMessage);
    if (result.interruptMessage) options.upsertLiveMessage(result.interruptMessage);
  }

  /**
   * 持久化重新生成前的消息截断。
   * @param sessionId - 原始会话 ID
   * @param nextMessages - 截断后的可见消息
   */
  async function handleBeforeRegenerate(sessionId: string, nextMessages: Message[]): Promise<void> {
    options.confirmationController.expirePendingConfirmation();
    const historyMessages = await options.fetchAllPriorHistory(sessionId);
    await chatStore.setSessionMessages(sessionId, [...historyMessages, ...nextMessages]);
  }

  /** 启动指定 assistant 消息的重新生成。 */
  async function startRuntimeRegenerate(targetMessage: Message): Promise<boolean> {
    const operationId = operationSequence;
    let managedRuntimeId: string | undefined;
    let runtimeRequestStarted = false;
    const sessionId = options.activeSessionId.value;
    const regenerationSlice = createRegenerationSlice(options.messages.value, targetMessage.id);
    if (!regenerationSlice || !sessionId) return false;

    const { sourceMessages, removedMessages } = regenerationSlice;
    options.messages.value.splice(0, options.messages.value.length, ...sourceMessages);
    const [preparationError, prepared] = await asyncTo(prepareRuntimeWithCapabilities(findLastUserMessage(sourceMessages)));
    if (preparationError || !prepared) {
      if (!isCurrentOperation(operationId)) return false;
      options.messages.value.splice(0, options.messages.value.length, ...sourceMessages, ...removedMessages);
      if (preparationError) options.showRuntimeError(preparationError.message);
      return false;
    }

    try {
      await ensurePreparedModel(sessionId, prepared);
      if (!isCurrentOperation(operationId)) return false;
      const runtimeAddress = runtimeLauncher.start(prepared);
      const { runtimeId } = runtimeAddress;
      managedRuntimeId = runtimeId;
      await handleBeforeRegenerate(sessionId, sourceMessages);
      runtimeRequestStarted = true;
      const result = await chatRuntime.continueTurn({
        ...runtimeAddress,
        messages: sourceMessages,
        ...prepared.config
      });
      if (!isCurrentOperation(operationId)) return false;
      runtimeLauncher.finish(result, runtimeId);
    } catch (error: unknown) {
      if (managedRuntimeId) options.actorSystem.unregisterRuntime(managedRuntimeId);
      const workflowError = {
        code: 'runtime_start_failed',
        message: error instanceof Error ? error.message : '重新生成失败',
        cause: error
      } as const;
      markSessionStartFailed(sessionId, workflowError, managedRuntimeId);
      if (!isCurrentOperation(operationId)) return false;
      if (!runtimeRequestStarted) options.messages.value.splice(0, options.messages.value.length, ...sourceMessages, ...removedMessages);
      throw error;
    }
    return true;
  }

  /** 处理消息重新生成。 */
  async function handleRegenerate(nextMessage: Message): Promise<void> {
    if (loading.value) return;
    const operationId = beginOperation();
    options.sessionActor.regenerate(nextMessage.id);
    const [error, started] = await asyncTo(startRuntimeRegenerate(nextMessage));
    if (error) {
      if (isCurrentOperation(operationId)) options.showRuntimeError(error.message);
      return;
    }
    if (!started && isCurrentOperation(operationId)) {
      options.sessionActor.markPreparationFailed({ code: 'preparation_failed', message: '重新生成准备未完成' });
    }
  }

  /**
   * 通过当前选中模型手动压缩会话，不创建用户消息。
   */
  async function compactContext(): Promise<void> {
    const sessionId = options.activeSessionId.value;
    if (!sessionId || loading.value) return;

    const operationId = beginOperation();
    let managedRuntimeId: string | undefined;
    preflightLoading.value = true;
    options.sessionActor.compact();
    try {
      const prepared = await prepareRuntimeWithCapabilities();
      if (!prepared) {
        if (isCurrentOperation(operationId)) {
          options.sessionActor.markPreparationFailed({ code: 'preparation_failed', message: '上下文压缩准备未完成' });
        }
        return;
      }

      await ensurePreparedModel(sessionId, prepared);
      if (!isCurrentOperation(operationId)) return;
      const runtimeAddress = runtimeLauncher.start(prepared);
      const { runtimeId } = runtimeAddress;
      managedRuntimeId = runtimeId;
      const result = await chatRuntime.compact({
        ...runtimeAddress,
        ...prepared.config
      });
      if (!isCurrentOperation(operationId)) return;
      runtimeLauncher.finish(result, runtimeId);
    } catch (error: unknown) {
      if (managedRuntimeId) options.actorSystem.unregisterRuntime(managedRuntimeId);
      const workflowError = {
        code: 'runtime_start_failed',
        message: error instanceof Error ? error.message : '上下文压缩失败',
        cause: error
      } as const;
      markSessionStartFailed(sessionId, workflowError, managedRuntimeId);
      if (!isCurrentOperation(operationId)) return;
      options.showRuntimeError(workflowError.message);
    } finally {
      if (isLatestOperation(operationId)) preflightLoading.value = false;
    }
  }

  /** 发送已构造的用户消息。 */
  async function sendRuntimeUserMessage(input: RuntimeUserMessageSendInput): Promise<void> {
    let pendingSessionId: string | null = null;
    let pendingUserMessage: Message | null = null;
    const operationId = beginOperation();
    let managedRuntimeId: string | undefined;
    preflightLoading.value = true;
    try {
      // SkillReference 必须在清空草稿和创建用户消息前完成最新磁盘解析。
      const prepared = await prepareRuntimeWithCapabilities(input.userMessage, input.parts);
      if (!isCurrentOperation(operationId) || !prepared) return;

      const sessionId = await options.ensureActiveSession(input.userMessage.content, prepared.config.model);
      if (!adoptOperationSession(operationId, sessionId)) return;
      pendingSessionId = sessionId;
      pendingUserMessage = input.userMessage;
      options.sessionActor.submit({
        messageId: input.userMessage.id,
        createdAt: input.userMessage.createdAt,
        content: input.userMessage.content,
        parts: input.parts,
        files: input.userMessage.files
      });
      preflightLoading.value = false;
      options.confirmationController.expirePendingConfirmation();
      options.focusInput();
      if (input.clearDraft === true) options.clearInput();
      options.scrollToBottom();

      const runtimeAddress = runtimeLauncher.start(prepared);
      const { runtimeId } = runtimeAddress;
      managedRuntimeId = runtimeId;
      const result = await chatRuntime.send({
        ...runtimeAddress,
        content: input.userMessage.content,
        parts: input.parts,
        files: input.userMessage.files,
        userMessageId: input.userMessage.id,
        userMessageCreatedAt: input.userMessage.createdAt,
        ...prepared.config
      });
      if (!isCurrentOperation(operationId)) return;
      runtimeLauncher.finish(result, runtimeId);
    } catch (error: unknown) {
      if (managedRuntimeId) options.actorSystem.unregisterRuntime(managedRuntimeId);
      const workflowError = {
        code: 'runtime_start_failed',
        message: error instanceof Error ? error.message : '发送消息失败',
        cause: error
      } as const;
      if (pendingSessionId) markSessionStartFailed(pendingSessionId, workflowError, managedRuntimeId);
      if (!isCurrentOperation(operationId)) return;
      const errorMessage = error instanceof Error ? error.message : '发送消息失败';
      if (pendingSessionId && pendingUserMessage) {
        await appendRuntimeErrorMessage({
          sessionId: pendingSessionId,
          content: errorMessage,
          visibleMessages: options.messages.value,
          precedingMessage: pendingUserMessage,
          fetchAllPriorHistory: options.fetchAllPriorHistory,
          persistMessages: chatStore.setSessionMessages,
          setLoadedMessages: options.setLoadedMessages,
          isSessionActive: (targetSessionId: string): boolean => options.activeSessionId.value === targetSessionId,
          afterMessagesUpdated: async (): Promise<void> => {
            await nextTick();
            options.scrollToBottom();
          }
        });
        return;
      }
      options.showRuntimeError(errorMessage);
    } finally {
      if (isLatestOperation(operationId)) preflightLoading.value = false;
    }
  }

  const chatSubmitter = useChatSubmitter({
    isWorkflowBusy: (): boolean => loading.value,
    messages: options.messages,
    getSessionId: (): string | undefined => options.activeSessionId.value ?? undefined,
    getActiveRuntimeId: (): string | undefined => options.sessionActor.activeRuntimeId.value,
    resolveRuntimeRequestConfig: options.resolveRuntimeRequestConfig,
    prepareRuntimeRequest: (): ReturnType<PrepareRuntimeRequest> => prepareRuntimeWithCapabilities(findLastUserMessage(options.messages.value)),
    ensureSessionModel: async (sessionId: string, model: ChatRuntimeModelSelection): Promise<void> => {
      await chatStore.ensureSessionModel(sessionId, model);
    },
    onContinueStarted: (answer): void => {
      continuationOperationId = beginOperation();
      continuationSessionId = options.activeSessionId.value;
      options.sessionActor.continueWithAnswer(answer);
    },
    isContinuationCurrent: (): boolean => isCurrentOperation(continuationOperationId),
    startRuntime: runtimeLauncher.start,
    finishRuntimeStart: runtimeLauncher.finish,
    onContinueFailed: (error: unknown, runtimeId?: string): void => {
      if (runtimeId) options.actorSystem.unregisterRuntime(runtimeId);
      const workflowError = {
        code: 'runtime_start_failed',
        message: error instanceof Error ? error.message : '继续生成失败',
        cause: error
      } as const;
      if (continuationSessionId) markSessionContinueFailed(continuationSessionId, workflowError, runtimeId);
      if (!isCurrentOperation(continuationOperationId)) return;
      options.showRuntimeError(workflowError.message);
    },
    submitUserChoice: chatRuntime.submitUserChoice,
    controlRuntimeTool: chatRuntime.controlTool,
    sendRuntimeUserMessage,
    submitRuntimeMessagePart: chatRuntime.submitMessagePart,
    updateSessionMessage: chatStore.updateSessionMessage
  });

  const rollbackController = useRollback({
    messages: options.messages,
    getSessionId: (): string | undefined => options.activeSessionId.value ?? undefined,
    isSessionActive: (sessionId: string): boolean => options.activeSessionId.value === sessionId,
    fetchAllPriorHistory: options.fetchAllPriorHistory,
    persistMessages: chatStore.setSessionMessages,
    restoreInput: options.restoreInput,
    expireConfirmation: options.confirmationController.expirePendingConfirmation,
    focusInput: options.focusInput
  });

  /** 发送一条新的用户文本消息。 */
  async function submitUserTextMessage(content: string, images: ChatMessageFile[] = [], clearDraft = true): Promise<void> {
    const trimmedContent = content.trim();
    if (!trimmedContent && !images.length) return;
    if (loading.value) return;

    const parsedInput = parseUserInput(trimmedContent, options.workspaceRoot.value || undefined);
    const userMessage = create.userMessage(parsedInput.content);
    if (images.length && options.supportsVision.value) userMessage.files = [...images];
    await sendRuntimeUserMessage({
      userMessage,
      parts: parsedInput.parts,
      clearDraft
    });
  }

  /** 取消等待用户选择的持久化消息。 */
  async function abortPendingUserChoiceIfNeeded(): Promise<boolean> {
    const sessionId = options.activeSessionId.value;
    if (!sessionId) return false;
    const nextMessages = cloneDeep(options.messages.value);
    const cancelledAssistantMessage = userChoice.cancelPending(nextMessages);
    if (!cancelledAssistantMessage) return false;

    const visibleMessages = [...nextMessages, create.interruptMessage(cancelledAssistantMessage)];
    const historyMessages = await options.fetchAllPriorHistory(sessionId);
    await chatStore.setSessionMessages(sessionId, [...historyMessages, ...visibleMessages]);
    if (options.activeSessionId.value !== sessionId) return true;
    options.setLoadedMessages(visibleMessages);
    await nextTick();
    options.scrollToBottom();
    return true;
  }

  /**
   * 把取消完成事件发送到发起取消的会话，而不是切换后的当前会话。
   * @param sessionId - 发起取消的会话 ID
   */
  function markSessionCancelled(sessionId: string): void {
    if (options.activeSessionId.value === sessionId) options.sessionActor.markRuntimeCancelled();
    else options.actorSystem.sendToSession(sessionId, { type: 'session.runtimeCancelled' });
  }

  /**
   * 把取消失败事件发送到发起取消的会话。
   * @param sessionId - 发起取消的会话 ID
   * @param error - 取消失败错误
   */
  function markSessionCancelFailed(sessionId: string, error: unknown): void {
    const workflowError = {
      code: 'cancel_failed',
      message: error instanceof Error ? error.message : '取消生成失败',
      cause: error
    } as const;
    if (options.activeSessionId.value === sessionId) options.sessionActor.markCancelFailed(workflowError);
    else options.actorSystem.sendToSession(sessionId, { type: 'session.cancelFailed', error: workflowError });
  }

  /** 判断命令适配器当前记录的 Runtime 是否属于可见会话。 */
  function hasCurrentSessionCommandRuntime(): boolean {
    const runtimeId = options.sessionActor.activeRuntimeId.value;
    if (!runtimeId) return false;
    const address = options.actorSystem.actor.getSnapshot().context.runtimeRoutes.get(runtimeId);
    return address?.sessionId === options.activeSessionId.value;
  }

  /** 中止当前 Chat Runtime。 */
  async function abort(): Promise<void> {
    beginOperation();
    preflightLoading.value = false;
    options.confirmationController.expirePendingConfirmation();
    const runtimeId = options.sessionActor.activeRuntimeId.value;
    const abortedSessionId = options.activeSessionId.value;
    if (!abortedSessionId) return;
    options.sessionActor.cancel();
    const sessionSnapshot = options.actorSystem.getSession(abortedSessionId)?.getSnapshot();
    // waitingChildren 只能由持久化 Checkpoint 取消事件收敛；不得 abort 已释放的 Runtime A 或本地宣布成功。
    if (sessionSnapshot?.matches('cancellingChildren')) return;
    try {
      if (!hasCurrentSessionCommandRuntime() && (await abortPendingUserChoiceIfNeeded())) {
        markSessionCancelled(abortedSessionId);
        return;
      }
      if (runtimeId) {
        const result = await chatRuntime.abort(runtimeId);
        options.actorSystem.clearRuntimeInteractions(abortedSessionId, runtimeId);
        if (options.activeSessionId.value === abortedSessionId) {
          applyAbortResult(result);
          await nextTick();
          options.scrollToBottom();
        }
      }
      markSessionCancelled(abortedSessionId);
      if (runtimeId) options.actorSystem.unregisterRuntime(runtimeId);
    } catch (error: unknown) {
      markSessionCancelFailed(abortedSessionId, error);
      throw error;
    }
  }

  /** 仅在工作流忙碌时执行取消。 */
  async function cancel(): Promise<void> {
    if (loading.value) await abort();
  }

  /** 回退消息并同步 Session machine 结果。 */
  async function rollback(message: Message): Promise<void> {
    if (loading.value) await abort();
    const rollbackSessionId = options.activeSessionId.value;
    if (!rollbackSessionId) return;
    const index = options.messages.value.findIndex((item: Message): boolean => item.id === message.id);
    if (index === -1) return;
    options.sessionActor.rollback(message.id);

    const rolledBackMessages = options.messages.value.slice(index);
    for (const rolledBackMessage of rolledBackMessages) {
      if (rolledBackMessage.runtimeId) {
        options.actorSystem.unregisterRuntime(rolledBackMessage.runtimeId);
      }
    }
    try {
      await rollbackController.rollback(message);
      options.restoreTodoSnapshots(rollbackSessionId, rolledBackMessages);
      if (options.activeSessionId.value === rollbackSessionId) options.sessionActor.markRollbackCompleted();
      else options.actorSystem.sendToSession(rollbackSessionId, { type: 'session.rollbackCompleted' });
    } catch (error: unknown) {
      const workflowError = {
        code: 'rollback_failed',
        message: error instanceof Error ? error.message : '回退消息失败',
        cause: error
      } as const;
      if (options.activeSessionId.value === rollbackSessionId) options.sessionActor.markRollbackFailed(workflowError);
      else options.actorSystem.sendToSession(rollbackSessionId, { type: 'session.rollbackFailed', error: workflowError });
      throw error;
    }
  }

  /** 处理切回会话时重放的待确认交互。 */
  async function handleSessionUIEvent(event: ChatSessionUIEvent): Promise<void> {
    if (event.type === 'shellRunEvent') {
      for (const message of options.messages.value) append.shellRunEventPart(message, event.event);
      return;
    }
    if (event.type === 'contextUsageUpdated') {
      options.onContextUsageUpdated(event.event.snapshot);
      return;
    }
    if (event.type === 'messageCreated' || event.type === 'messageUpdated') {
      options.upsertLiveMessage(event.event.message);
      return;
    }
    if (event.type === 'messageDeleted') {
      options.removeLiveMessage(event.event.messageId);
      return;
    }
    if (event.type === 'runtimeError') {
      await handleRuntimeError(event.event.error, event.event.runtimeId, event.event.messagePersistenceFailed);
      return;
    }
    if (event.type === 'runtimeCompleted') {
      const completedMessage = [...options.messages.value]
        .reverse()
        .find((message): boolean => message.role === 'assistant' && message.runtimeId === event.event.runtimeId && message.finished === true);
      if (completedMessage) await handleRuntimeComplete(completedMessage);
      return;
    }
    if (event.type === 'confirmationRequested') {
      const confirmation = options.confirmationController.requestConfirmation(
        event.event.request,
        {
          sessionId: event.event.sessionId,
          runtimeId: event.event.runtimeId,
          toolCallId: event.event.toolCallId ?? event.event.request.toolCallId
        },
        event.event.confirmationId
      );
      // 重放订阅只展示既有 flight；创建它的唯一处理器负责提交 IPC。
      if (!confirmation.created) return;
      const decision = await confirmation.decision;
      // Runtime 终态、工具取消或会话删除只负责释放 waiter，不再向已失效的 Main confirmation 回写。
      if (confirmation.wasExpired()) return;
      const grantScope = getRuntimeConfirmationGrantScope(event.event.request, decision);
      if (grantScope) {
        toolPermissionStore.grantToolPermission(event.event.request.toolName, grantScope);
      }
      const [submitError, result] = await asyncTo(
        getElectronAPI().chatRuntimeSubmitConfirmation({
          runtimeId: event.event.runtimeId,
          confirmationId: event.event.confirmationId,
          decision
        })
      );
      if (submitError || !result?.ok) {
        // Main 仍持有原 confirmation；重新发布同一身份，让当前或后续会话视图接管重试。
        options.actorSystem.emitSessionEvent(event.event.sessionId, { type: 'confirmationRequested', event: event.event });
        throw submitError ?? new Error(result?.error ?? '提交确认结果失败');
      }
      markInteractionResolved(event.event.runtimeId, event.event.sessionId, event.event.confirmationId);
    }
  }

  /** 释放 renderer 局部预处理状态，不中止主进程后台 Runtime。 */
  function dispose(): void {
    const sessionId = options.activeSessionId.value;
    if (sessionId) settleSessionPreparation(sessionId);
    beginOperation();
    preflightLoading.value = false;
  }

  return {
    loading,
    chatSubmitter,
    rollbackController,
    handleRegenerate,
    compactContext,
    submitUserTextMessage,
    abort,
    cancel,
    rollback,
    dispose,
    handleSessionUIEvent
  };
}
