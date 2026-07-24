/**
 * @file useChatWorkflow.ts
 * @description 编排 BChat Session actor、ChatRuntime IPC 与消息级交互流程。
 */
import type { UseChatSessionActorReturn } from './useChatSessionActor';
import type { PreparedRuntimeRequest, useRuntimeRequestConfig } from './useRuntimeRequestConfig';
import type { createChatConfirmationController } from '../utils/confirmationController';
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
import { computed, nextTick, ref } from 'vue';
import { cloneDeep } from 'lodash-es';
import type { ChatActorSystem } from '@/ai/chat/actorSystem';
import { findLastUserMessage } from '@/ai/chat/policies/memorySelection';
import { createRegenerationSlice } from '@/ai/chat/policies/regeneration';
import { getRuntimeConfirmationGrantScope } from '@/ai/chat/policies/runtimeConfirmation';
import type { ChatSessionUIEvent } from '@/ai/chat/sessionEvents';
import { getElectronAPI } from '@/shared/platform/electron-api';
import { useChatPermissionStore } from '@/stores/chat/permission';
import { useChatSessionStore } from '@/stores/chat/session';
import { asyncTo } from '@/utils/asyncTo';
import { parseUserInput } from '../utils/filePartParser';
import { append, create, userChoice } from '../utils/messageHelper';
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
  getActiveTools: () => AIToolExecutor[];
  /** 准备 Runtime 请求 */
  prepareRuntimeRequest: PrepareRuntimeRequest;
  /** 解析兼容 Runtime 请求配置 */
  resolveRuntimeRequestConfig: ResolveRuntimeRequestConfig;
  /** Runtime Bridge 请求处理器 */
  handleBridgeRequest: (event: ChatRuntimeBridgeRequestEvent) => Promise<unknown>;
  /** 工具确认控制器 */
  confirmationController: ChatConfirmationController;
  /** 确保存在可持久化会话 */
  ensureActiveSession: (title: string, model: ChatRuntimeModelSelection) => Promise<string>;
  /** 获取未加载的更早历史 */
  fetchAllPriorHistory: (sessionId: string) => Promise<Message[]>;
  /** 替换 renderer 当前消息 */
  setLoadedMessages: (messages: Message[]) => void;
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
    return operationSequence;
  }

  /** 判断异步准备结果是否仍属于当前操作。 */
  function isCurrentOperation(operationId: number): boolean {
    return operationId === operationSequence;
  }

  const runtimeLauncher = useChatRuntimeLauncher({
    activeSessionId: options.activeSessionId,
    actorSystem: options.actorSystem,
    sessionActor: options.sessionActor,
    getActiveTools: options.getActiveTools,
    prepareRuntimeRequest: options.prepareRuntimeRequest,
    handleBridgeRequest: options.handleBridgeRequest,
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

  /** 处理 Runtime 错误并写入持久化错误消息。 */
  async function handleRuntimeError(error: AIServiceError): Promise<void> {
    options.sessionActor.markFailed({ code: 'runtime_failed', message: error.message, cause: error });
    const activeRuntimeId = options.sessionActor.activeRuntimeId.value;
    if (activeRuntimeId) {
      options.actorSystem.unregisterRuntime(activeRuntimeId);
    }
    if (error.code === 'MODEL_NOT_FOUND') {
      options.onModelNotFound();
      return;
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
      afterMessagesUpdated: async (): Promise<void> => {
        await nextTick();
        options.scrollToBottom();
      }
    });
  }

  /** 将已解决交互同步回 Agent、Turn 与 Session。 */
  function markInteractionResolved(runtimeId: string, sessionId: string, confirmationId: string): void {
    options.actorSystem.send({
      type: 'runtime.event',
      runtimeId,
      event: { type: 'runtime.interactionResolved', runtimeId }
    });
    options.actorSystem.sendToSession(sessionId, { type: 'session.interactionResolved' });
    options.actorSystem.clearSessionPendingInteraction(sessionId, confirmationId);
  }

  const chatRuntime = useChatRuntime();

  /**
   * 按消息 ID 新增或合并当前可见消息。
   * @param nextMessage - 待投影的消息
   */
  function upsertMessage(nextMessage: Message): void {
    const normalizedMessage = userChoice.normalizePendingState(nextMessage);
    const index = options.messages.value.findIndex((message: Message): boolean => message.id === normalizedMessage.id);
    if (index < 0) options.messages.value.push(normalizedMessage);
    else options.messages.value.splice(index, 1, { ...options.messages.value[index], ...normalizedMessage });
  }

  /**
   * 按消息 ID 删除当前可见消息。
   * @param messageId - 待删除消息 ID
   */
  function removeMessage(messageId: string): void {
    const index = options.messages.value.findIndex((message: Message): boolean => message.id === messageId);
    if (index >= 0) options.messages.value.splice(index, 1);
  }

  /**
   * 将主进程中止结果投影到当前可见消息。
   * @param result - 主进程已经持久化的消息变更
   */
  function applyAbortResult(result: ChatRuntimeAbortResult): void {
    if (result.deletedMessageId) removeMessage(result.deletedMessageId);
    if (result.assistantMessage) upsertMessage(result.assistantMessage);
    if (result.interruptMessage) upsertMessage(result.interruptMessage);
  }

  /** 持久化重新生成前的消息截断。 */
  async function handleBeforeRegenerate(nextMessages: Message[]): Promise<void> {
    options.confirmationController.expirePendingConfirmation();
    const sessionId = options.activeSessionId.value;
    if (!sessionId) return;
    const historyMessages = await options.fetchAllPriorHistory(sessionId);
    await chatStore.setSessionMessages(sessionId, [...historyMessages, ...nextMessages]);
  }

  /** 启动指定 assistant 消息的重新生成。 */
  async function startRuntimeRegenerate(targetMessage: Message): Promise<boolean> {
    const operationId = operationSequence;
    let managedRuntimeId: string | undefined;
    const regenerationSlice = createRegenerationSlice(options.messages.value, targetMessage.id);
    if (!regenerationSlice || !options.activeSessionId.value) return false;

    const { sourceMessages, removedMessages } = regenerationSlice;
    options.messages.value.splice(0, options.messages.value.length, ...sourceMessages);
    const [preparationError, prepared] = await asyncTo(prepareRuntimeWithCapabilities(findLastUserMessage(sourceMessages)));
    if (preparationError || !prepared) {
      options.messages.value.splice(0, options.messages.value.length, ...sourceMessages, ...removedMessages);
      if (preparationError) options.showRuntimeError(preparationError.message);
      return false;
    }

    try {
      await ensurePreparedModel(options.activeSessionId.value, prepared);
      await handleBeforeRegenerate(sourceMessages);
      const runtimeAddress = runtimeLauncher.start(prepared);
      const { runtimeId } = runtimeAddress;
      managedRuntimeId = runtimeId;
      const result = await chatRuntime.continueTurn({
        ...runtimeAddress,
        messages: sourceMessages,
        ...prepared.config
      });
      if (!isCurrentOperation(operationId)) return false;
      runtimeLauncher.finish(result, runtimeId);
    } catch (error: unknown) {
      if (!isCurrentOperation(operationId)) return false;
      if (!managedRuntimeId) options.messages.value.splice(0, options.messages.value.length, ...sourceMessages, ...removedMessages);
      if (managedRuntimeId) options.actorSystem.unregisterRuntime(managedRuntimeId);
      const workflowError = {
        code: 'runtime_start_failed',
        message: error instanceof Error ? error.message : '重新生成失败',
        cause: error
      } as const;
      if (managedRuntimeId) options.sessionActor.markFailed(workflowError);
      else options.sessionActor.markPreparationFailed(workflowError);
      throw error;
    }
    return true;
  }

  /** 处理消息重新生成。 */
  async function handleRegenerate(nextMessage: Message): Promise<void> {
    if (loading.value) return;
    beginOperation();
    options.sessionActor.regenerate(nextMessage.id);
    const [error, started] = await asyncTo(startRuntimeRegenerate(nextMessage));
    if (error) {
      options.showRuntimeError(error.message);
      return;
    }
    if (!started) {
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
        options.sessionActor.markPreparationFailed({ code: 'preparation_failed', message: '上下文压缩准备未完成' });
        return;
      }

      await ensurePreparedModel(sessionId, prepared);
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
      if (!isCurrentOperation(operationId)) return;
      if (managedRuntimeId) options.actorSystem.unregisterRuntime(managedRuntimeId);
      const workflowError = {
        code: 'runtime_start_failed',
        message: error instanceof Error ? error.message : '上下文压缩失败',
        cause: error
      } as const;
      if (managedRuntimeId) options.sessionActor.markFailed(workflowError);
      else options.sessionActor.markPreparationFailed(workflowError);
      options.showRuntimeError(workflowError.message);
    } finally {
      if (isCurrentOperation(operationId)) preflightLoading.value = false;
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
      if (!isCurrentOperation(operationId)) return;
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
      if (!isCurrentOperation(operationId)) return;
      if (managedRuntimeId) options.actorSystem.unregisterRuntime(managedRuntimeId);
      const workflowError = {
        code: 'runtime_start_failed',
        message: error instanceof Error ? error.message : '发送消息失败',
        cause: error
      } as const;
      if (managedRuntimeId) options.sessionActor.markFailed(workflowError);
      else options.sessionActor.markPreparationFailed(workflowError);
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
          afterMessagesUpdated: async (): Promise<void> => {
            await nextTick();
            options.scrollToBottom();
          }
        });
        return;
      }
      options.showRuntimeError(errorMessage);
    } finally {
      if (isCurrentOperation(operationId)) preflightLoading.value = false;
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
      beginOperation();
      options.sessionActor.continueWithAnswer(answer);
    },
    startRuntime: runtimeLauncher.start,
    finishRuntimeStart: runtimeLauncher.finish,
    onContinueFailed: (error: unknown, runtimeId?: string): void => {
      const workflowError = {
        code: 'runtime_start_failed',
        message: error instanceof Error ? error.message : '继续生成失败',
        cause: error
      } as const;
      if (runtimeId) {
        options.sessionActor.markUserChoiceSubmissionFailed(workflowError);
        options.actorSystem.unregisterRuntime(runtimeId);
      } else {
        options.sessionActor.markPreparationFailed(workflowError);
      }
      options.showRuntimeError(workflowError.message);
    },
    submitUserChoice: chatRuntime.submitUserChoice,
    sendRuntimeUserMessage,
    submitRuntimeMessagePart: chatRuntime.submitMessagePart,
    updateSessionMessage: chatStore.updateSessionMessage
  });

  const rollbackController = useRollback({
    messages: options.messages,
    getSessionId: (): string | undefined => options.activeSessionId.value ?? undefined,
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
    options.setLoadedMessages(visibleMessages);
    await nextTick();
    options.scrollToBottom();
    return true;
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
    options.sessionActor.cancel();
    const sessionSnapshot = abortedSessionId ? options.actorSystem.getSession(abortedSessionId)?.getSnapshot() : undefined;
    // waitingChildren 只能由持久化 Checkpoint 取消事件收敛；不得 abort 已释放的 Runtime A 或本地宣布成功。
    if (sessionSnapshot?.matches('cancellingChildren')) return;
    try {
      if (!hasCurrentSessionCommandRuntime() && (await abortPendingUserChoiceIfNeeded())) {
        options.sessionActor.markRuntimeCancelled();
        return;
      }
      if (runtimeId) {
        const result = await chatRuntime.abort(runtimeId);
        if (options.activeSessionId.value === abortedSessionId) {
          applyAbortResult(result);
          await nextTick();
          options.scrollToBottom();
        }
      }
      options.sessionActor.markRuntimeCancelled();
      if (runtimeId) options.actorSystem.unregisterRuntime(runtimeId);
    } catch (error: unknown) {
      options.sessionActor.markCancelFailed({
        code: 'cancel_failed',
        message: error instanceof Error ? error.message : '取消生成失败',
        cause: error
      });
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
      options.restoreTodoSnapshots(options.activeSessionId.value, rolledBackMessages);
      options.sessionActor.markRollbackCompleted();
    } catch (error: unknown) {
      options.sessionActor.markRollbackFailed({
        code: 'rollback_failed',
        message: error instanceof Error ? error.message : '回退消息失败',
        cause: error
      });
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
      upsertMessage(event.event.message);
      return;
    }
    if (event.type === 'messageDeleted') {
      removeMessage(event.event.messageId);
      return;
    }
    if (event.type === 'runtimeError') {
      await handleRuntimeError(event.event.error);
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
      const decision = await options.confirmationController.requestConfirmation(event.event.request);
      const grantScope = getRuntimeConfirmationGrantScope(event.event.request, decision);
      if (grantScope) {
        toolPermissionStore.grantToolPermission(event.event.request.toolName, grantScope);
      }
      const result = await getElectronAPI().chatRuntimeSubmitConfirmation({
        runtimeId: event.event.runtimeId,
        confirmationId: event.event.confirmationId,
        decision
      });
      if (!result.ok) {
        throw new Error(result.error ?? '提交确认结果失败');
      }
      markInteractionResolved(event.event.runtimeId, event.event.sessionId, event.event.confirmationId);
    }
  }

  /** 释放 renderer 局部预处理状态，不中止主进程后台 Runtime。 */
  function dispose(): void {
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
