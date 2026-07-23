/**
 * @file service.mts
 * @description 主进程 ChatRuntime 服务骨架。
 */
import type { ChatModelResolution } from './model/resolver.mjs';
import type {
  ActiveChatRuntime,
  ChatRuntimeDelegationPrepareAck,
  ChatRuntimeMainToolExecutionInput,
  ChatRuntimeDelegationSuspension,
  ChatRuntimeMessageReader,
  ChatRuntimeMessageKind,
  ChatRuntimeMessageWriter,
  ChatRuntimeRendererToolExecutionInput,
  ChatRuntimeServiceDependencies,
  ChatRuntimeStreamAborter,
  ChatRuntimeStreamExecutor
} from './types.mjs';
import type { AIServiceError, AIToolExecutionResult, AIUsage } from 'types/ai';
import type { ChatMessageCompactionPart, ChatMessagePart, ChatMessageRecord, ChatPendingInteraction, CompactionModelSnapshot } from 'types/chat';
import type {
  ChatRuntimeAbortInput,
  ChatRuntimeAbortResult,
  ChatRuntimeAutoNameInput,
  ChatRuntimeAutoNameResult,
  ChatRuntimeBridgeResponseInput,
  ChatRuntimeBridgeResult,
  ChatRuntimeCompactInput,
  ChatRuntimeConfirmationDecision,
  ChatRuntimeCompletionReason,
  ChatRuntimeContinueInput,
  ChatRuntimeContextUsageSnapshot,
  ChatRuntimeEstimateContextInput,
  ChatRuntimeModelSelection,
  ChatRuntimeRecoverySnapshot,
  ChatRuntimeSendInput,
  ChatRuntimeStartResult,
  ChatRuntimeSubmitConfirmationInput,
  ChatRuntimeSubmitMessagePartInput,
  ChatRuntimeSubmitUserChoiceInput,
  ChatRuntimeSubmitToolResultInput
} from 'types/chat-runtime';
import { BrowserWindow } from 'electron';
import { groupBy } from 'lodash-es';
import { nanoid } from 'nanoid';
import { AI_ERROR_CODE, createAIServiceError, isAIServiceError } from '../../ai/errors/codes.mjs';
import { aiService } from '../../ai/service.mjs';
import { getLoopStopReason, type ToolLoopStopReason, type ToolStepSnapshot } from '../../ai/tool-loop-policy.mjs';
import { log } from '../../logger/service.mjs';
import { chatAgentDelegationService } from '../agents/service.mjs';
import { chatSessionManager } from '../service.mjs';
import { createArtifactRegistry } from './compaction/artifact-registry.mjs';
import { createCompactionBudget, exceedsHardLimit, shouldAutoCompact } from './compaction/budget.mjs';
import { createCompactionExecutor } from './compaction/executor.mjs';
import { projectContext } from './compaction/projector.mjs';
import { generateStructuredSummary } from './compaction/summary-generator.mjs';
import { addRuntimeUsage, isSameRuntimeUsage } from './context/usage.mjs';
import { createRuntimeBridgeRequests, type RuntimeBridgeRequestInput } from './controllers/bridge.mjs';
import { createRuntimeConfirmationRequests, type RuntimeConfirmationRequestInput } from './controllers/confirmation.mjs';
import { createRuntimeRendererToolRequests } from './controllers/renderer-tool.mjs';
import { ChatRuntimeError } from './errors.mjs';
import { chatRuntimeLocks, createRuntimeLockRegistry, type RuntimeLockResult } from './infrastructure/locks.mjs';
import { findLastRuntimeAssistantMessage, findLastRuntimeUserMessage, normalizeContinuationMessages } from './messages/continuation.mjs';
import { createRuntimeAssistantPlaceholder, createRuntimeInterruptMessage, createRuntimeUserMessage } from './messages/factory.mjs';
import { materializeRuntimeFileParts } from './messages/file-parts.mjs';
import {
  ensureRuntimeMessageCreatedAt,
  finishAssistantMessageInterrupted,
  hasAssistantResponseContent,
  markAssistantMessageFailed
} from './messages/finalizer.mjs';
import { applyRuntimeContext } from './messages/runtime-context.mjs';
import { applyUserChoiceAnswer, cloneRuntimeMessage } from './messages/user-choice.mjs';
import { createAutoNamePrompt, normalizeAutoNameTitle } from './model/auto-name.mjs';
import { createDefaultChatModelResolver } from './model/resolver.mjs';
import { createCompactRuntime, createContinuationRuntime, createSendRuntime, createUserChoiceRuntime } from './runners/factory.mjs';
import { createPersistableAssistant } from './stream/deferred-tools.mjs';
import { createRuntimeStreamExecutor } from './stream/index.mjs';
import { getRuntimeTaskDeadlineAt, getRuntimeTaskTimeout } from './task-clock.mjs';
import { createMainToolExecutor } from './tools/index.mjs';
import { createRuntimeEventBase } from './types.mjs';

/** Renderer 请求默认超时时间。 */
const RUNTIME_RENDERER_REQUEST_TIMEOUT_MS = 30_000;

export { ChatRuntimeError } from './errors.mjs';

/** Runtime 多轮模型执行的内部收口结果。 */
interface RuntimeStreamRoundsResult {
  /** Provider 累计 usage。 */
  usage?: AIUsage;
  /** Runtime A 挂起后持有 continuation fence 的 Checkpoint。 */
  checkpointId?: string;
}

/**
 * 创建默认 Electron runtime 事件发送器。
 * @returns runtime 事件发送器
 */
function createDefaultEmitter(): ChatRuntimeServiceDependencies['emit'] {
  return (name, payload): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(name, payload);
    }
  };
}

/**
 * 创建默认 runtime 消息写入器。
 * @returns runtime 消息写入器
 */
function createDefaultMessageWriter(): ChatRuntimeMessageWriter {
  return {
    addMessage(message: ChatMessageRecord): void {
      chatSessionManager.addMessage(message);
    },

    updateMessage(message: ChatMessageRecord): void {
      chatSessionManager.updateMessage(message);
    },

    deleteMessage(sessionId: string, messageId: string): void {
      chatSessionManager.deleteMessage(sessionId, messageId);
    }
  };
}

/**
 * 创建默认 runtime 消息读取器。
 * @returns runtime 消息读取器
 */
function createDefaultMessageReader(): ChatRuntimeMessageReader {
  return {
    getMessages(sessionId: string): ChatMessageRecord[] {
      return chatSessionManager.getAllMessages(sessionId);
    }
  };
}

/**
 * 创建默认 runtime 流式执行器。
 * @returns runtime 流式执行器
 */
function createDefaultStreamExecutor(
  executeRendererTool?: (input: ChatRuntimeRendererToolExecutionInput) => Promise<AIToolExecutionResult>,
  executeMainTool?: (input: ChatRuntimeMainToolExecutionInput) => Promise<AIToolExecutionResult>,
  rendererToolTimeoutMs?: number
): ChatRuntimeStreamExecutor {
  const resolver = createDefaultChatModelResolver();
  return createRuntimeStreamExecutor({
    resolver,
    streamText: (createOptions, request, callOptions) => aiService.streamText(createOptions, request, callOptions),
    executeRendererTool,
    executeMainTool,
    rendererToolTimeoutMs
  });
}

/**
 * 记录 ChatRuntime 进入最终回答阶段的固定策略原因。
 * @param runtime - 当前 runtime
 * @param reason - 收口原因
 * @param stepNumber - 即将执行的零基步骤号
 */
function logLoopFinalizing(runtime: ActiveChatRuntime, reason: ToolLoopStopReason, stepNumber: number): void {
  log.info('[ChatRuntime] Tool loop finalizing:', { runtimeId: runtime.runtimeId, reason, stepNumber });
}

/**
 * 创建默认 runtime 流式中止函数。
 * @returns runtime 流式中止函数
 */
function createDefaultStreamAborter(): ChatRuntimeStreamAborter {
  return (runtimeId: string): void => {
    aiService.abortStream(runtimeId);
  };
}

/**
 * 创建默认 runtime 消息 ID。
 * @param kind - 消息类型
 * @returns 消息 ID
 */
function createDefaultMessageId(kind: ChatRuntimeMessageKind): string {
  return `${kind}-${nanoid()}`;
}

/**
 * 将 runtime 流式异常规范化为 AI 服务错误。
 * @param error - 原始异常
 * @returns AI 服务错误
 */
function normalizeRuntimeStreamError(error: unknown): AIServiceError {
  if (isAIServiceError(error)) return error;
  if (error instanceof Error) return createAIServiceError(AI_ERROR_CODE.REQUEST_FAILED, error.message);

  return createAIServiceError(AI_ERROR_CODE.REQUEST_FAILED, 'ChatRuntime stream failed');
}

/**
 * 判断并消费 Promise 或自定义 thenable 的潜在 rejection。
 * then getter 异常按异步 ACK 处理；可调用 then 通过原生 Promise assimilation
 * 统一挂 rejection sink，但绝不等待其完成。
 * @param value - Coordinator 返回值
 * @returns 是否必须按异步 ACK 拒绝
 */
function consumeAsyncAck(value: unknown): boolean {
  if ((typeof value !== 'object' || value === null) && typeof value !== 'function') return false;

  let then: unknown;
  try {
    then = Reflect.get(value, 'then');
  } catch {
    return true;
  }
  if (typeof then !== 'function') return false;

  // 当前调用栈内挂 sink，确保 rejected Promise 与 then 调用异常不会形成 unhandled rejection。
  Promise.resolve(value).catch((): void => undefined);
  return true;
}

/**
 * 校验 Coordinator 必须在当前调用栈内返回精确 prepare ACK。
 * @param value - Coordinator 返回值
 */
function assertDelegationAck(value: unknown): asserts value is ChatRuntimeDelegationPrepareAck {
  if (consumeAsyncAck(value)) {
    throw new ChatRuntimeError('DELEGATION_PREPARE_ASYNC', '委派 prepare 必须同步完成，不能返回 Promise 或 thenable');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new ChatRuntimeError('DELEGATION_PREPARE_ACK_INVALID', '委派 prepare 未返回精确确认');
  }

  const keys = Reflect.ownKeys(value);
  if (keys.length !== 1 || keys[0] !== 'prepared' || (value as { prepared?: unknown }).prepared !== true) {
    throw new ChatRuntimeError('DELEGATION_PREPARE_ACK_INVALID', '委派 prepare 未返回精确确认');
  }
}

/**
 * 创建 ChatRuntime 服务。
 * @param dependencies - runtime 依赖项
 * @returns ChatRuntime 服务
 */
export function createChatRuntimeService(dependencies: Partial<ChatRuntimeServiceDependencies> = {}) {
  const emit = dependencies.emit ?? createDefaultEmitter();
  const messageWriter = dependencies.messageWriter ?? createDefaultMessageWriter();
  const messageReader = dependencies.messageReader ?? createDefaultMessageReader();
  const listPendingCompactionMessages = dependencies.listPendingCompactionMessages ?? (() => chatSessionManager.listPendingCompactionMessages());
  const materializeFileParts = dependencies.materializeFileParts ?? materializeRuntimeFileParts;
  const streamAbort = dependencies.streamAbort ?? createDefaultStreamAborter();
  const { prepareDelegation, rendererToolTimeoutMs } = dependencies;
  const createMessageId = dependencies.createMessageId ?? createDefaultMessageId;
  const now = dependencies.now ?? (() => new Date().toISOString());
  const requestModelResolver = createDefaultChatModelResolver();
  const resolveModel =
    dependencies.resolveModel ?? ((model?: ChatRuntimeModelSelection): Promise<ChatModelResolution | null> => requestModelResolver.resolve(model));
  const compactionGenerateText =
    dependencies.compactionGenerateText ?? ((createOptions, request, callOptions) => aiService.generateText(createOptions, request, callOptions));
  const autoNameResolver = dependencies.autoNameResolveModel ?? (() => createDefaultChatModelResolver().resolve());
  const autoNameGenerateText = dependencies.autoNameGenerateText ?? ((createOptions, request) => aiService.generateText(createOptions, request));
  const autoNameUpdateSessionTitle = dependencies.autoNameUpdateSessionTitle ?? ((sessionId, title) => chatSessionManager.updateSessionTitle(sessionId, title));
  const locks = dependencies.locks ?? createRuntimeLockRegistry();
  const activeRuntimes = new Map<string, ActiveChatRuntime>();
  const activeAssistantMessages = new Map<string, ChatMessageRecord>();
  const safeAssistantMessages = new Map<string, ChatMessageRecord>();
  const activeCompactionSources = new Map<string, ChatMessageRecord[]>();
  const activeCompactionModels = new Map<string, Awaited<ReturnType<typeof resolveModel>>>();
  const activeCompactionRuntimes = new Map<string, ActiveChatRuntime>();
  let interruptedCompactionRecovery: Promise<boolean> | undefined;
  let interruptedCompactionRecovered = false;
  const getRuntime = (runtimeId: string): ActiveChatRuntime | undefined => activeRuntimes.get(runtimeId);
  const confirmationRequests = createRuntimeConfirmationRequests({ emit, getRuntime });
  const bridgeRequests = createRuntimeBridgeRequests({
    emit,
    getRuntime,
    timeoutMs: RUNTIME_RENDERER_REQUEST_TIMEOUT_MS
  });
  const rendererToolRequests = createRuntimeRendererToolRequests({
    emit,
    getRuntime,
    timeoutMs: RUNTIME_RENDERER_REQUEST_TIMEOUT_MS
  });

  /**
   * 将模型输入投影的 Token 估算广播给对应会话。
   * @param runtime - 当前 runtime
   * @param usedTokens - 当前模型输入投影估算 Token 数
   */
  function emitContextUsage(runtime: ActiveChatRuntime, usedTokens: number): void {
    const { contextWindow } = runtime;
    if (!contextWindow || contextWindow < 1) return;

    emit('chat:runtime:context-usage-updated', {
      ...createRuntimeEventBase(runtime),
      snapshot: {
        usedTokens: Math.max(0, Math.round(usedTokens)),
        contextWindow
      }
    });
  }

  /**
   * 为 compaction executor 读取冻结 raw source，并在 pending 写入后合并活动 assistant。
   * @param sessionId - Session 标识
   * @returns 当前 compaction 可验证的完整消息
   */
  async function readCompactionMessages(sessionId: string): Promise<ChatMessageRecord[]> {
    const runtime = [...activeCompactionRuntimes.values()].find((candidate: ActiveChatRuntime): boolean => candidate.sessionId === sessionId);
    const sourceMessages = runtime ? activeCompactionSources.get(runtime.runtimeId) : undefined;
    const persistedMessages = sourceMessages ?? (await messageReader.getMessages(sessionId));
    const messages = structuredClone(persistedMessages);
    if (!runtime) return messages;

    const assistantMessage = activeAssistantMessages.get(runtime.runtimeId);
    if (!assistantMessage) return messages;
    const assistantIndex = messages.findIndex((message: ChatMessageRecord): boolean => message.id === assistantMessage.id);
    if (assistantIndex >= 0) {
      messages[assistantIndex] = structuredClone(assistantMessage);
    } else if (assistantMessage.parts.length > 0 || assistantMessage.content.trim()) {
      messages.push(structuredClone(assistantMessage));
    }

    return messages;
  }

  /**
   * 原子写入 compaction 承载消息并沿用标准 runtime 更新事件。
   * @param message - 包含 compaction Part 的 assistant 消息
   */
  async function writeCompactionMessage(message: ChatMessageRecord): Promise<void> {
    const safeCandidate = structuredClone(message);
    await messageWriter.updateMessage(safeCandidate);
    const runtime = message.runtimeId ? activeCompactionRuntimes.get(message.runtimeId) : undefined;
    if (!runtime || !activeRuntimes.has(runtime.runtimeId)) return;

    safeAssistantMessages.set(runtime.runtimeId, structuredClone(safeCandidate));
    emit('chat:runtime:message-updated', {
      ...createRuntimeEventBase(runtime),
      message: safeCandidate
    });
  }

  /**
   * 将 service ISO 时间转换为 executor 时间戳。
   * @returns 有限时间戳
   */
  function getCompactionNow(): number {
    const timestamp = Date.parse(now());
    return Number.isFinite(timestamp) ? timestamp : Date.now();
  }

  const executeMainTool = createMainToolExecutor({
    now,
    requestBridge: bridgeRequests.request,
    requestConfirmation: confirmationRequests.request
  });

  const streamExecutor = dependencies.streamExecutor ?? createDefaultStreamExecutor(rendererToolRequests.request, executeMainTool, rendererToolTimeoutMs);
  const compactionExecutor =
    dependencies.compactionExecutor ??
    createCompactionExecutor({
      readMessages: readCompactionMessages,
      writeMessage: writeCompactionMessage,
      generateSummary: (input) =>
        generateStructuredSummary(input, {
          resolveModel: async () => activeCompactionModels.get(input.runtimeId) ?? null,
          generateText: compactionGenerateText
        }),
      hasLease: (sessionId: string, runtimeId: string): boolean => locks.getWritingOwner(sessionId) === runtimeId,
      abortSummary: streamAbort,
      createPartId: (): string => `checkpoint-${nanoid()}`,
      now: getCompactionNow,
      diagnosticLog: (entry): void => {
        log.info(`[chat-compaction] ${JSON.stringify(entry)}`);
      }
    });

  /**
   * 拒绝 renderer 重复分配仍在使用的 Runtime ID。
   * @param runtimeId - renderer 分配的 Runtime ID
   */
  function assertRuntimeIdAvailable(runtimeId: string): void {
    if (activeRuntimes.has(runtimeId)) {
      throw new ChatRuntimeError('RUNTIME_ALREADY_ACTIVE', `Runtime ${runtimeId} is already active`);
    }
  }

  /**
   * 把共享锁拒绝转换为稳定 Runtime 错误。
   * @param sessionId - Session ID
   * @param lock - 锁获取结果
   */
  function assertWritingLock(sessionId: string, lock: RuntimeLockResult): asserts lock is { ok: true } {
    if (lock.ok) return;
    if (lock.reason === 'turn_waiting_children') {
      throw new ChatRuntimeError(
        'TURN_WAITING_CHILDREN',
        `Session ${sessionId} is waiting for Child tasks at ${lock.ownerCheckpointId ?? 'unknown-checkpoint'}`
      );
    }
    throw new ChatRuntimeError('SESSION_BUSY', `Session ${sessionId} is already running ${lock.ownerRuntimeId ?? 'unknown-runtime'}`);
  }

  /**
   * 判断 assistant 是否正暂停等待用户输入。
   * @param message - assistant 消息
   * @returns 是否存在等待用户输入的工具结果
   */
  function isAssistantAwaitingUserInput(message: ChatMessageRecord): boolean {
    return message.parts.some((part) => part.type === 'tool' && part.result?.status === 'awaiting_user_input');
  }

  /**
   * 将等待用户输入的消息转换为可恢复交互。
   * @param runtime - 产生交互的 Runtime
   * @param message - 等待用户输入的 assistant 消息
   * @returns 可恢复交互，不存在等待片段时返回 null
   */
  function createPendingInteraction(runtime: ActiveChatRuntime, message: ChatMessageRecord): ChatPendingInteraction | null {
    const part = message.parts.find((messagePart) => messagePart.type === 'tool' && messagePart.result?.status === 'awaiting_user_input');
    if (!part || part.type !== 'tool' || part.result?.status !== 'awaiting_user_input') return null;
    return {
      type: 'userChoice',
      status: 'pending',
      sessionId: runtime.sessionId,
      messageId: message.id,
      runtimeId: runtime.runtimeId,
      agentId: runtime.agentId,
      toolCallId: part.toolCallId,
      questionId: part.result.data.questionId
    };
  }

  /**
   * 完成 runtime 并释放 session 写入锁。
   * @param runtime - 需要完成的 runtime
   * @param usage - Provider 返回的 usage
   * @param reason - Runtime 成功完成、暂停等待用户或等待 Child
   * @param checkpointId - waiting_children 对应的 Checkpoint
   */
  function completeRuntime(runtime: ActiveChatRuntime, usage?: AIUsage, reason?: ChatRuntimeCompletionReason, checkpointId?: string): void {
    const completionReason = reason ?? 'completed';
    const workingMessage = activeAssistantMessages.get(runtime.runtimeId);
    const assistantMessage = structuredClone(safeAssistantMessages.get(runtime.runtimeId) ?? workingMessage);
    runtime.status = 'completed';
    activeRuntimes.delete(runtime.runtimeId);
    activeAssistantMessages.delete(runtime.runtimeId);
    safeAssistantMessages.delete(runtime.runtimeId);
    rendererToolRequests.rejectRuntime(runtime.runtimeId, 'Runtime completed');
    confirmationRequests.rejectRuntime(runtime.runtimeId, 'Runtime completed');
    bridgeRequests.rejectRuntime(runtime.runtimeId, 'Runtime completed');
    locks.releaseWritingLock({ sessionId: runtime.sessionId, runtimeId: runtime.runtimeId });
    if ((completionReason === 'awaiting_user_input' || completionReason === 'waiting_children') && assistantMessage) {
      emit('chat:runtime:message-updated', {
        ...createRuntimeEventBase(runtime),
        message: assistantMessage
      });
    }
    const completeEventBase = {
      ...createRuntimeEventBase(runtime),
      usage
    };
    const interaction = assistantMessage ? createPendingInteraction(runtime, assistantMessage) : null;
    if (completionReason === 'awaiting_user_input' && interaction) {
      emit('chat:runtime:complete', { ...completeEventBase, reason: completionReason, interaction });
      return;
    }
    if (completionReason === 'waiting_children' && checkpointId) {
      emit('chat:runtime:complete', { ...completeEventBase, reason: completionReason, checkpointId });
      return;
    }
    emit('chat:runtime:complete', { ...completeEventBase, reason: 'completed' });
  }

  /**
   * 更新 assistant 草稿并发送 runtime 事件。
   * @param runtime - runtime 状态
   * @param message - assistant 草稿消息
   */
  async function updateAssistantMessage(runtime: ActiveChatRuntime, message: ChatMessageRecord): Promise<void> {
    if (!activeRuntimes.has(runtime.runtimeId)) return;

    const safeCandidate = structuredClone(message);
    await messageWriter.updateMessage(safeCandidate);
    if (!activeRuntimes.has(runtime.runtimeId)) return;

    safeAssistantMessages.set(runtime.runtimeId, structuredClone(safeCandidate));
    // 等待用户的消息只能在 completeRuntime 释放会话写锁后对 renderer 可见。
    if (safeCandidate.loading === true && safeCandidate.finished === false && isAssistantAwaitingUserInput(safeCandidate)) return;
    emit('chat:runtime:message-updated', {
      ...createRuntimeEventBase(runtime),
      message: safeCandidate
    });
  }

  /**
   * 删除空 assistant 占位并广播删除事件。
   * @param runtime - runtime 状态
   * @param assistantMessage - assistant 占位消息
   */
  async function deleteAssistantMessage(runtime: ActiveChatRuntime, assistantMessage: ChatMessageRecord): Promise<void> {
    await messageWriter.deleteMessage?.(assistantMessage.sessionId, assistantMessage.id);
    emit('chat:runtime:message-deleted', {
      ...createRuntimeEventBase(runtime),
      messageId: assistantMessage.id
    });
  }

  /**
   * 在所有模型续轮结束后维持等待态或兜底标记 assistant 消息完成。
   * @param runtime - runtime 状态
   * @param assistantMessage - assistant 草稿消息
   * @param usage - 汇总后的 provider usage
   */
  async function finishAssistantMessageIfNeeded(runtime: ActiveChatRuntime, assistantMessage: ChatMessageRecord, usage: AIUsage | undefined): Promise<void> {
    if (isAssistantAwaitingUserInput(assistantMessage)) {
      if (assistantMessage.loading === true && assistantMessage.finished === false) return;
      assistantMessage.loading = true;
      assistantMessage.finished = false;
      await updateAssistantMessage(runtime, assistantMessage);
      return;
    }
    if (assistantMessage.finished === true) return;

    assistantMessage.loading = false;
    assistantMessage.finished = true;
    if (usage) {
      assistantMessage.usage = usage;
    }
    await updateAssistantMessage(runtime, assistantMessage);
  }

  /**
   * 以完整持久化历史为基线合并 renderer 提供的最新消息快照。
   * @param persistedMessages - 数据库完整历史
   * @param snapshotMessages - renderer 或续轮最新快照
   * @returns 保持持久化顺序并覆盖同 ID 消息的 raw clone
   */
  function mergeSourceMessages(persistedMessages: ChatMessageRecord[], snapshotMessages: ChatMessageRecord[]): ChatMessageRecord[] {
    const snapshotById = new Map(snapshotMessages.map((message: ChatMessageRecord): [string, ChatMessageRecord] => [message.id, message]));
    const merged = persistedMessages.map((message: ChatMessageRecord): ChatMessageRecord => structuredClone(snapshotById.get(message.id) ?? message));
    const persistedIds = new Set(persistedMessages.map((message: ChatMessageRecord): string => message.id));
    for (const message of snapshotMessages) {
      if (!persistedIds.has(message.id)) merged.push(structuredClone(message));
    }

    return merged;
  }

  /**
   * 从最新 checkpoint 与其 raw tail 重建 Runtime artifact identity。
   * @param runtime - 当前 runtime
   * @param messages - 完整 raw source
   */
  function initializeArtifactRegistry(runtime: ActiveChatRuntime, messages: ChatMessageRecord[]): void {
    if (runtime.artifactRegistry) return;
    const projection = projectContext({ messages, skillContentHashes: runtime.skillContentHashes });
    const checkpoint = projection.checkpointId
      ? messages.flatMap((message: ChatMessageRecord): ChatMessagePart[] => message.parts).find((part): boolean => part.id === projection.checkpointId)
      : undefined;
    const checkpointArtifacts = checkpoint?.type === 'compaction' && checkpoint.status === 'success' ? checkpoint.summary?.artifacts : undefined;
    runtime.artifactRegistry = createArtifactRegistry({ checkpointArtifacts, messages: projection.messages });
  }

  /**
   * 读取当前 runtime 可发送给模型的源消息。
   * @param runtime - runtime 状态
   * @param userMessage - 当前用户消息
   * @param assistantMessage - 当前 assistant 草稿消息
   * @param sourceMessageSnapshot - renderer 或续轮消息快照
   * @returns 源消息列表
   */
  async function readRuntimeSourceMessages(
    runtime: ActiveChatRuntime,
    userMessage: ChatMessageRecord,
    assistantMessage: ChatMessageRecord,
    sourceMessageSnapshot: ChatMessageRecord[] = []
  ): Promise<ChatMessageRecord[]> {
    const persistedMessages = await messageReader.getMessages(runtime.sessionId);
    const mergedMessages = mergeSourceMessages(persistedMessages, sourceMessageSnapshot);
    const messagesWithoutEmptyDraft = mergedMessages.filter(
      (message: ChatMessageRecord): boolean => message.id !== assistantMessage.id || message.parts.length > 0 || Boolean(message.content.trim())
    );
    const hasCurrentUserMessage = messagesWithoutEmptyDraft.some((message) => message.id === userMessage.id);
    const sourceMessages = hasCurrentUserMessage ? messagesWithoutEmptyDraft : [...messagesWithoutEmptyDraft, structuredClone(userMessage)];
    initializeArtifactRegistry(runtime, sourceMessages);

    return sourceMessages;
  }

  /**
   * 将当前 assistant 草稿纳入下一轮模型上下文。
   * @param sourceMessages - 上一轮源消息
   * @param assistantMessage - 当前 assistant 草稿
   * @returns 下一轮源消息
   */
  function createContinuationSourceMessages(sourceMessages: ChatMessageRecord[], assistantMessage: ChatMessageRecord): ChatMessageRecord[] {
    const nextMessages = sourceMessages.filter((message) => message.id !== assistantMessage.id);
    return [...nextMessages, assistantMessage];
  }

  /**
   * 在单次模型请求边界冻结模型、按需同步压缩并返回纯投影上下文。
   * @param runtime - 当前 runtime
   * @param rawMessages - 不可被 projection 覆盖的原始消息
   * @param userMessage - 当前用户任务
   * @param assistantMessage - 当前 assistant 草稿
   * @returns 仅供本次模型调用使用的消息 projection
   */
  async function prepareRequestContext(
    runtime: ActiveChatRuntime,
    rawMessages: ChatMessageRecord[],
    userMessage: ChatMessageRecord,
    assistantMessage: ChatMessageRecord
  ): Promise<ChatMessageRecord[]> {
    let currentRawMessages =
      assistantMessage.parts.length > 0 || assistantMessage.content.trim() ? createContinuationSourceMessages(rawMessages, assistantMessage) : rawMessages;
    // 临时 Runtime 上下文仅进入模型投影，压缩源保持原始消息，避免把临时指令写入 checkpoint 摘要。
    let projection = projectContext({
      messages: applyRuntimeContext(currentRawMessages, runtime),
      system: runtime.system,
      tools: runtime.tools,
      skillContentHashes: runtime.skillContentHashes
    });
    if (!runtime.contextWindow || runtime.contextWindow < 1) return projection.messages;

    const [resolutionResult] = await Promise.allSettled([resolveModel(runtime.model)]);
    const resolution = resolutionResult.status === 'fulfilled' ? resolutionResult.value : null;
    if (resolution) runtime.resolvedModel = resolution;
    const thresholdBudget = createCompactionBudget({ contextWindow: runtime.contextWindow, noncompressibleTokens: 0 });
    if (shouldAutoCompact(projection.estimatedTokens, thresholdBudget)) {
      if (resolution) {
        const modelSnapshot: CompactionModelSnapshot = {
          providerType: resolution.createOptions.providerType,
          providerId: resolution.createOptions.providerId,
          modelId: resolution.modelId,
          contextWindow: runtime.contextWindow
        };
        activeCompactionSources.set(runtime.runtimeId, structuredClone(currentRawMessages));
        activeCompactionModels.set(runtime.runtimeId, resolution);
        activeCompactionRuntimes.set(runtime.runtimeId, runtime);
        runtime.phase = 'compacting';
        runtime.compactionTrigger = 'automatic';
        await Promise.allSettled([
          compactionExecutor.execute({
            runtimeId: runtime.runtimeId,
            sessionId: runtime.sessionId,
            trigger: 'automatic',
            assistantMessage,
            currentUserMessageId: userMessage.id,
            contextWindow: runtime.contextWindow,
            modelSnapshot,
            system: runtime.system,
            tools: runtime.tools,
            skillContentHashes: runtime.skillContentHashes,
            taskDeadlineAt: getRuntimeTaskDeadlineAt(runtime)
          })
        ]);
        activeCompactionSources.delete(runtime.runtimeId);
        activeCompactionModels.delete(runtime.runtimeId);
        activeCompactionRuntimes.delete(runtime.runtimeId);
        if (activeRuntimes.has(runtime.runtimeId)) {
          runtime.phase = 'streaming';
          runtime.compactionTrigger = undefined;
        }
        currentRawMessages = createContinuationSourceMessages(rawMessages, assistantMessage);
      }
      projection = projectContext({
        messages: applyRuntimeContext(currentRawMessages, runtime),
        system: runtime.system,
        tools: runtime.tools,
        skillContentHashes: runtime.skillContentHashes,
        activeTurnToolPruneMode: 'preserve-latest'
      });
      if (exceedsHardLimit(projection.estimatedTokens, thresholdBudget)) {
        projection = projectContext({
          messages: applyRuntimeContext(currentRawMessages, runtime),
          system: runtime.system,
          tools: runtime.tools,
          skillContentHashes: runtime.skillContentHashes,
          activeTurnToolPruneMode: 'all-complete'
        });
      }
    }

    if (!activeRuntimes.has(runtime.runtimeId)) {
      throw new ChatRuntimeError('RUNTIME_NOT_ACTIVE', `Runtime ${runtime.runtimeId} is not active`);
    }

    if (exceedsHardLimit(projection.estimatedTokens, thresholdBudget)) {
      const message = runtime.runtimeContext?.skill?.snapshots.length
        ? '所选技能内容与不可压缩上下文已超过当前模型可用窗口'
        : '当前任务与不可压缩上下文已达到模型输入上限';
      throw createAIServiceError(AI_ERROR_CODE.INVALID_REQUEST, message);
    }

    emitContextUsage(runtime, projection.estimatedTokens);
    return projection.messages;
  }

  /**
   * 在任务剩余截止时间内完成模型解析与上下文压缩准备。
   * @param runtime - 当前 runtime
   * @param rawMessages - 原始消息上下文
   * @param userMessage - 当前用户消息
   * @param assistantMessage - 当前 assistant 草稿
   * @param timeoutMs - 当前任务剩余毫秒数
   * @returns 模型请求上下文投影
   */
  async function prepareContextBeforeDeadline(
    runtime: ActiveChatRuntime,
    rawMessages: ChatMessageRecord[],
    userMessage: ChatMessageRecord,
    assistantMessage: ChatMessageRecord,
    timeoutMs: number
  ): Promise<ChatMessageRecord[]> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        prepareRequestContext(runtime, rawMessages, userMessage, assistantMessage),
        new Promise<ChatMessageRecord[]>((_resolve, reject) => {
          timeoutId = setTimeout((): void => {
            // 超时收口并行触发两个取消动作；allSettled 避免清理失败产生未处理拒绝。
            Promise.allSettled([compactionExecutor.cancel(runtime.runtimeId), streamAbort(runtime.runtimeId)]);
            reject(createAIServiceError(AI_ERROR_CODE.REQUEST_FAILED, '本次 AI 任务已达到固定的 300 秒总时限'));
          }, timeoutMs);
        })
      ]);
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
  }

  /**
   * 在同步原子边界提交委派，并保证失败收尾只能看到过滤消息。
   * @param runtime - 产生委派的 Primary Runtime
   * @param assistantMessage - 保留完整延迟片段的工作消息
   * @param suspension - Provider 边界捕获的延迟调用
   */
  function prepareRuntimeDelegation(runtime: ActiveChatRuntime, assistantMessage: ChatMessageRecord, suspension: ChatRuntimeDelegationSuspension): string {
    const deferredToolCallIds = new Set(suspension.toolCalls.map((toolCall): string => toolCall.toolCallId));
    const checkpointId = `checkpoint-${nanoid()}`;
    try {
      if (!prepareDelegation) {
        throw new ChatRuntimeError('DELEGATION_NOT_CONFIGURED', '委派协调器尚未配置');
      }
      const acknowledgement = prepareDelegation({
        checkpointId,
        runtime,
        assistantMessage: structuredClone(assistantMessage),
        suspension
      });
      assertDelegationAck(acknowledgement);
      // 只有 prepare 已原子提交后，完整 deferred assistant 才升级为 Renderer 可见的安全快照。
      safeAssistantMessages.set(runtime.runtimeId, structuredClone(assistantMessage));
    } catch (error) {
      // prepare 事务失败后回到最后一次成功写入的安全快照；缺失时才按 deferred ID 现场裁剪。
      const safeMessage = safeAssistantMessages.get(runtime.runtimeId) ?? createPersistableAssistant(assistantMessage, deferredToolCallIds);
      Object.assign(assistantMessage, structuredClone(safeMessage));
      throw error;
    }
    return checkpointId;
  }

  /**
   * 执行模型流与工具续轮，并把多轮 usage 汇总回 assistant。
   * @param runtime - runtime 状态
   * @param sourceMessages - 当前源消息
   * @param userMessage - user 消息
   * @param assistantMessage - assistant 草稿消息
   * @returns 汇总 usage 与可选挂起 Checkpoint
   */
  async function executeRuntimeStreamRounds(
    runtime: ActiveChatRuntime,
    sourceMessages: ChatMessageRecord[],
    userMessage: ChatMessageRecord,
    assistantMessage: ChatMessageRecord
  ): Promise<RuntimeStreamRoundsResult> {
    let currentSourceMessages = sourceMessages;
    let accumulatedUsage: AIUsage | undefined;
    let completedSteps = 0;
    let forceFinal = false;
    let shouldRun = true;
    const toolSteps: ToolStepSnapshot[] = [];

    while (shouldRun) {
      const totalTimeoutMs = getRuntimeTaskTimeout(runtime);
      if (totalTimeoutMs <= 0) {
        throw createAIServiceError(AI_ERROR_CODE.REQUEST_FAILED, '本次 AI 任务已达到固定的 300 秒总时限');
      }

      // 每个模型请求边界都重新预算，并且只把 projection 交给模型。
      // eslint-disable-next-line no-await-in-loop
      const projectedMessages = await prepareContextBeforeDeadline(runtime, currentSourceMessages, userMessage, assistantMessage, totalTimeoutMs);
      if (!activeRuntimes.has(runtime.runtimeId)) {
        throw new ChatRuntimeError('RUNTIME_NOT_ACTIVE', `Runtime ${runtime.runtimeId} is not active`);
      }

      runtime.currentToolStep = { toolCalls: [] };
      // Runtime 是主聊天唯一续轮控制者；最终步骤通过内部参数关闭工具。
      // eslint-disable-next-line no-await-in-loop
      const streamResult = await streamExecutor(
        { runtime, sourceMessages: projectedMessages, userMessage, assistantMessage, forceFinal, totalTimeoutMs },
        (message) => updateAssistantMessage(runtime, message)
      );
      completedSteps += 1;
      toolSteps.push(runtime.currentToolStep ?? { toolCalls: [] });
      if (!activeRuntimes.has(runtime.runtimeId)) {
        throw new ChatRuntimeError('RUNTIME_NOT_ACTIVE', `Runtime ${runtime.runtimeId} is not active`);
      }

      accumulatedUsage = addRuntimeUsage(accumulatedUsage, streamResult.totalUsage);
      if (streamResult.suspension) {
        if (accumulatedUsage) {
          assistantMessage.usage = accumulatedUsage;
        }
        const checkpointId = prepareRuntimeDelegation(runtime, assistantMessage, streamResult.suspension);
        return { usage: accumulatedUsage, checkpointId };
      }
      runtime.resolvedModel = undefined;
      if (!streamResult.shouldContinue || forceFinal) {
        shouldRun = false;
        continue;
      }

      const stopReason = getLoopStopReason(toolSteps);
      forceFinal = stopReason !== undefined;
      if (stopReason) logLoopFinalizing(runtime, stopReason, completedSteps);

      // 将上一轮 assistant 草稿纳入下一轮上下文，保证工具结果续轮能拿到 assistant 历史。
      currentSourceMessages = createContinuationSourceMessages(currentSourceMessages, assistantMessage);
    }

    await finishAssistantMessageIfNeeded(runtime, assistantMessage, accumulatedUsage);

    if (accumulatedUsage && !isSameRuntimeUsage(assistantMessage.usage, accumulatedUsage)) {
      assistantMessage.usage = accumulatedUsage;
      await updateAssistantMessage(runtime, assistantMessage);
    }

    const completedProjection = projectContext({
      messages: createContinuationSourceMessages(currentSourceMessages, assistantMessage),
      system: runtime.system,
      tools: runtime.tools,
      skillContentHashes: runtime.skillContentHashes
    });
    emitContextUsage(runtime, completedProjection.estimatedTokens);

    return { usage: accumulatedUsage };
  }

  /**
   * 后台执行模型流并收尾 runtime。
   * @param runtime - runtime 状态
   * @param userMessage - user 消息
   * @param assistantMessage - assistant 草稿消息
   * @param sourceMessageSnapshot - 可选的续轮消息快照
   */
  async function runRuntimeStream(
    runtime: ActiveChatRuntime,
    userMessage: ChatMessageRecord,
    assistantMessage: ChatMessageRecord,
    sourceMessageSnapshot?: ChatMessageRecord[]
  ): Promise<void> {
    try {
      const sourceMessages = await readRuntimeSourceMessages(runtime, userMessage, assistantMessage, sourceMessageSnapshot);
      const result = await executeRuntimeStreamRounds(runtime, sourceMessages, userMessage, assistantMessage);
      if (result.checkpointId) {
        completeRuntime(runtime, result.usage, 'waiting_children', result.checkpointId);
        return;
      }
      completeRuntime(runtime, result.usage, isAssistantAwaitingUserInput(assistantMessage) ? 'awaiting_user_input' : 'completed');
    } catch (error) {
      if (!activeRuntimes.has(runtime.runtimeId)) return;

      const runtimeError = normalizeRuntimeStreamError(error);
      const safeMessage = structuredClone(safeAssistantMessages.get(runtime.runtimeId) ?? assistantMessage);
      markAssistantMessageFailed(safeMessage, runtimeError);
      activeAssistantMessages.set(runtime.runtimeId, safeMessage);
      await updateAssistantMessage(runtime, safeMessage);
      if (!activeRuntimes.has(runtime.runtimeId)) return;
      emit('chat:runtime:error', {
        ...createRuntimeEventBase(runtime),
        error: runtimeError
      });
      completeRuntime(runtime);
    }
  }

  /**
   * 为无法进入 executor 的手动压缩写入失败终态。
   * @param assistantMessage - compaction 承载消息
   * @param errorCode - 稳定失败码
   */
  function appendManualFailure(assistantMessage: ChatMessageRecord, errorCode: string): void {
    const timestamp = getCompactionNow();
    const checkpoint: ChatMessageCompactionPart = {
      id: `checkpoint-${nanoid()}`,
      type: 'compaction',
      status: 'failed',
      trigger: 'manual',
      errorCode,
      createdAt: timestamp,
      completedAt: timestamp
    };
    assistantMessage.parts.push(checkpoint);
  }

  /**
   * 仅将已存在的 pending 压缩 Part 收敛为取消状态。
   * @param assistantMessage - compaction 承载消息
   * @returns 是否找到并更新了 pending 压缩 Part
   */
  function cancelExistingCompactionPart(assistantMessage: ChatMessageRecord): boolean {
    const timestamp = getCompactionNow();
    const pendingIndex = assistantMessage.parts.findIndex((part: ChatMessagePart): boolean => part.type === 'compaction' && part.status === 'pending');
    if (pendingIndex < 0) return false;

    const pending = assistantMessage.parts[pendingIndex];
    if (pending.type !== 'compaction') return false;
    assistantMessage.parts[pendingIndex] = {
      ...structuredClone(pending),
      status: 'cancelled',
      errorCode: 'USER_CANCELLED',
      completedAt: timestamp
    };
    return true;
  }

  /**
   * 后台执行手动上下文压缩并通过标准 Runtime 完成事件收尾。
   * @param runtime - 手动压缩 runtime
   * @param assistantMessage - compaction-only assistant 消息
   */
  async function runManualCompaction(runtime: ActiveChatRuntime, assistantMessage: ChatMessageRecord): Promise<void> {
    const [sourceResult, resolutionResult] = await Promise.allSettled([
      Promise.resolve().then(() => messageReader.getMessages(runtime.sessionId)),
      resolveModel(runtime.model)
    ]);
    if (!activeRuntimes.has(runtime.runtimeId)) return;
    const capturedMessages =
      sourceResult.status === 'fulfilled'
        ? structuredClone(sourceResult.value).filter((message: ChatMessageRecord): boolean => message.id !== assistantMessage.id)
        : undefined;

    if (sourceResult.status === 'rejected') {
      appendManualFailure(assistantMessage, 'CAPTURE_FAILED');
    } else if (resolutionResult.status === 'rejected' || !resolutionResult.value) {
      appendManualFailure(assistantMessage, 'MODEL_NOT_FOUND');
    } else {
      const sourceMessages = capturedMessages ?? [];
      const resolution = resolutionResult.value;
      const contextWindow = runtime.contextWindow ?? 0;
      const modelSnapshot: CompactionModelSnapshot = {
        providerType: resolution.createOptions.providerType,
        providerId: resolution.createOptions.providerId,
        modelId: resolution.modelId,
        contextWindow
      };
      runtime.resolvedModel = resolution;
      initializeArtifactRegistry(runtime, sourceMessages);
      activeCompactionSources.set(runtime.runtimeId, sourceMessages);
      activeCompactionModels.set(runtime.runtimeId, resolution);
      activeCompactionRuntimes.set(runtime.runtimeId, runtime);
      const [executionResult] = await Promise.allSettled([
        compactionExecutor.execute({
          runtimeId: runtime.runtimeId,
          sessionId: runtime.sessionId,
          trigger: 'manual',
          assistantMessage,
          contextWindow,
          modelSnapshot,
          system: runtime.system,
          tools: runtime.tools,
          skillContentHashes: runtime.skillContentHashes,
          taskDeadlineAt: getRuntimeTaskDeadlineAt(runtime)
        })
      ]);
      if (executionResult.status === 'rejected' && !assistantMessage.parts.some((part: ChatMessagePart): boolean => part.type === 'compaction')) {
        appendManualFailure(assistantMessage, 'EXECUTION_FAILED');
      }
    }

    activeCompactionSources.delete(runtime.runtimeId);
    activeCompactionModels.delete(runtime.runtimeId);
    activeCompactionRuntimes.delete(runtime.runtimeId);
    runtime.resolvedModel = undefined;
    if (!activeRuntimes.has(runtime.runtimeId)) return;

    assistantMessage.loading = false;
    assistantMessage.finished = true;
    await Promise.allSettled([updateAssistantMessage(runtime, assistantMessage)]);
    if (capturedMessages) {
      const projection = projectContext({
        messages: [...capturedMessages, assistantMessage],
        system: runtime.system,
        tools: runtime.tools,
        skillContentHashes: runtime.skillContentHashes
      });
      emitContextUsage(runtime, projection.estimatedTokens);
    }
    if (activeRuntimes.has(runtime.runtimeId)) completeRuntime(runtime);
  }

  /**
   * 把单条消息中的遗留 pending checkpoint 转为稳定失败终态。
   * @param message - 应用重启后扫描出的消息
   * @returns 不修改输入的恢复消息
   */
  function interruptPendingCheckpoints(message: ChatMessageRecord): ChatMessageRecord {
    const recovered = structuredClone(message);
    const completedAt = getCompactionNow();
    recovered.parts = recovered.parts.map((part: ChatMessagePart): ChatMessagePart => {
      if (part.type !== 'compaction' || part.status !== 'pending') return part;
      return {
        ...part,
        status: 'failed',
        errorCode: 'INTERRUPTED',
        completedAt
      };
    });
    recovered.loading = false;
    recovered.finished = true;
    return recovered;
  }

  /**
   * 在独占 session 写锁下恢复一组同会话遗留 checkpoint。
   * @param sessionId - 会话 ID
   * @param messages - 同会话 pending 消息
   */
  async function recoverCompactionSession(sessionId: string, messages: ChatMessageRecord[]): Promise<boolean> {
    const runtimeId = `recovery-${nanoid()}`;
    const lock = locks.acquireWritingLock({ sessionId, runtimeId });
    if (!lock.ok) return false;

    try {
      const writes = messages.map(
        (message: ChatMessageRecord): Promise<void> =>
          Promise.resolve()
            .then(() => messageWriter.updateMessage(interruptPendingCheckpoints(message)))
            .then((): void => undefined)
      );
      const results = await Promise.allSettled(writes);
      return results.every((result): boolean => result.status === 'fulfilled');
    } finally {
      locks.releaseWritingLock({ sessionId, runtimeId });
    }
  }

  /**
   * 扫描并恢复应用重启遗留的 pending checkpoint。
   * @returns 本轮扫描和全部写入是否成功
   */
  async function runInterruptedRecovery(): Promise<boolean> {
    const [messagesResult] = await Promise.allSettled([Promise.resolve().then(() => listPendingCompactionMessages())]);
    if (messagesResult.status === 'rejected') return false;

    const messagesBySession = groupBy(messagesResult.value, (message: ChatMessageRecord): string => message.sessionId);
    const results = await Promise.allSettled(
      Object.entries(messagesBySession).map(([sessionId, messages]): Promise<boolean> => recoverCompactionSession(sessionId, messages))
    );
    return results.every((result): boolean => result.status === 'fulfilled' && result.value);
  }

  return {
    /**
     * 启动一轮 ChatRuntime。
     * @param input - 发送内容与 renderer 快照
     * @returns 已启动 runtime 标识
     */
    async send(input: ChatRuntimeSendInput): Promise<ChatRuntimeStartResult> {
      const sessionId = input.sessionId ?? `session-${nanoid()}`;
      const { runtimeId } = input;
      assertRuntimeIdAvailable(runtimeId);
      const lock = locks.acquireWritingLock({ sessionId, runtimeId });
      assertWritingLock(sessionId, lock);

      const runtime = createSendRuntime(input, runtimeId, sessionId);
      activeRuntimes.set(runtimeId, runtime);

      try {
        const createdAt = input.userMessageCreatedAt ?? now();
        const userParts = input.parts?.length
          ? await materializeFileParts({
              parts: input.parts,
              runtime,
              now,
              requestBridge: bridgeRequests.request
            })
          : undefined;
        if (!activeRuntimes.has(runtimeId)) {
          throw new ChatRuntimeError('RUNTIME_NOT_ACTIVE', `Runtime ${runtimeId} was aborted before message persistence`);
        }
        const userMessage = createRuntimeUserMessage({ ...input, parts: userParts }, runtime, input.userMessageId ?? createMessageId('user'), createdAt);
        const assistantMessage = createRuntimeAssistantPlaceholder(runtime, createMessageId('assistant'), createdAt);
        activeAssistantMessages.set(runtimeId, assistantMessage);

        await messageWriter.addMessage(userMessage);
        emit('chat:runtime:message-created', {
          ...createRuntimeEventBase(runtime),
          message: userMessage
        });

        await messageWriter.addMessage(assistantMessage);
        safeAssistantMessages.set(runtimeId, structuredClone(assistantMessage));
        emit('chat:runtime:message-created', {
          ...createRuntimeEventBase(runtime),
          message: assistantMessage
        });

        if (!dependencies.keepRuntimeOpenForTest) {
          runRuntimeStream(runtime, userMessage, assistantMessage).catch(() => undefined);
        }
      } catch (error) {
        activeRuntimes.delete(runtime.runtimeId);
        activeAssistantMessages.delete(runtime.runtimeId);
        safeAssistantMessages.delete(runtime.runtimeId);
        rendererToolRequests.rejectRuntime(runtime.runtimeId, 'Runtime start failed');
        confirmationRequests.rejectRuntime(runtime.runtimeId, 'Runtime start failed');
        bridgeRequests.rejectRuntime(runtime.runtimeId, 'Runtime start failed');
        locks.releaseWritingLock({ sessionId: runtime.sessionId, runtimeId: runtime.runtimeId });
        throw error;
      }

      return { runtimeId, sessionId };
    },

    /**
     * 继续一轮已暂停的 assistant 消息。
     * @param input - 续轮输入
     * @returns 已启动 runtime 标识
     */
    async continue(input: ChatRuntimeContinueInput): Promise<ChatRuntimeStartResult> {
      const { runtimeId } = input;
      assertRuntimeIdAvailable(runtimeId);
      const lock = locks.acquireWritingLock({ sessionId: input.sessionId, runtimeId });
      assertWritingLock(input.sessionId, lock);

      const continuationMessages = normalizeContinuationMessages(input);
      const userMessage = findLastRuntimeUserMessage(continuationMessages);
      const existingAssistantMessage = findLastRuntimeAssistantMessage(continuationMessages);
      if (!userMessage) {
        locks.releaseWritingLock({ sessionId: input.sessionId, runtimeId });
        throw new ChatRuntimeError('INVALID_CONTINUATION', 'Continuation requires a user message');
      }

      const runtime = createContinuationRuntime(input, runtimeId);
      activeRuntimes.set(runtimeId, runtime);
      const createdAt = now();
      const assistantMessage = existingAssistantMessage ?? createRuntimeAssistantPlaceholder(runtime, createMessageId('assistant'), createdAt);
      ensureRuntimeMessageCreatedAt(assistantMessage, createdAt);
      assistantMessage.runtimeId = runtimeId;
      assistantMessage.agentId = runtime.agentId;
      assistantMessage.parentRuntimeId = runtime.parentRuntimeId;
      assistantMessage.loading = true;
      assistantMessage.finished = false;
      activeAssistantMessages.set(runtimeId, assistantMessage);
      const sourceMessageSnapshot = existingAssistantMessage
        ? continuationMessages.map((message) => (message.id === assistantMessage.id ? assistantMessage : message))
        : [...continuationMessages, assistantMessage];

      try {
        if (existingAssistantMessage) {
          await messageWriter.updateMessage(assistantMessage);
          emit('chat:runtime:message-updated', {
            ...createRuntimeEventBase(runtime),
            message: assistantMessage
          });
        } else {
          await messageWriter.addMessage(assistantMessage);
          emit('chat:runtime:message-created', {
            ...createRuntimeEventBase(runtime),
            message: assistantMessage
          });
        }
        safeAssistantMessages.set(runtimeId, structuredClone(assistantMessage));

        if (!dependencies.keepRuntimeOpenForTest) {
          runRuntimeStream(runtime, userMessage, assistantMessage, sourceMessageSnapshot).catch(() => undefined);
        }
      } catch (error) {
        activeRuntimes.delete(runtime.runtimeId);
        activeAssistantMessages.delete(runtime.runtimeId);
        safeAssistantMessages.delete(runtime.runtimeId);
        rendererToolRequests.rejectRuntime(runtime.runtimeId, 'Runtime continue failed');
        confirmationRequests.rejectRuntime(runtime.runtimeId, 'Runtime continue failed');
        bridgeRequests.rejectRuntime(runtime.runtimeId, 'Runtime continue failed');
        locks.releaseWritingLock({ sessionId: runtime.sessionId, runtimeId: runtime.runtimeId });
        throw error;
      }

      return { runtimeId, sessionId: runtime.sessionId };
    },

    /**
     * 启动一次不创建用户消息的手动上下文压缩。
     * @param input - 压缩配置与现有会话 ID
     * @returns 已启动 runtime 标识
     */
    async compact(input: ChatRuntimeCompactInput): Promise<ChatRuntimeStartResult> {
      const { runtimeId, sessionId } = input;
      assertRuntimeIdAvailable(runtimeId);
      const lock = locks.acquireWritingLock({ sessionId, runtimeId });
      assertWritingLock(sessionId, lock);

      const runtime = createCompactRuntime(input, runtimeId);
      activeRuntimes.set(runtimeId, runtime);
      const assistantMessage = createRuntimeAssistantPlaceholder(runtime, createMessageId('assistant'), now());
      activeAssistantMessages.set(runtimeId, assistantMessage);

      const [writeResult] = await Promise.allSettled([messageWriter.addMessage(assistantMessage)]);
      if (writeResult.status === 'rejected') {
        activeRuntimes.delete(runtimeId);
        activeAssistantMessages.delete(runtimeId);
        safeAssistantMessages.delete(runtimeId);
        locks.releaseWritingLock({ sessionId, runtimeId });
        throw writeResult.reason;
      }
      safeAssistantMessages.set(runtimeId, structuredClone(assistantMessage));
      emit('chat:runtime:message-created', {
        ...createRuntimeEventBase(runtime),
        message: assistantMessage
      });

      if (!dependencies.keepRuntimeOpenForTest) {
        runManualCompaction(runtime, assistantMessage).catch(() => undefined);
      }

      return { runtimeId, sessionId };
    },

    /**
     * 提交用户选择答案并从主进程持久化消息续跑。
     * @param input - 用户选择提交输入
     * @returns 已启动 runtime 标识
     */
    async submitUserChoice(input: ChatRuntimeSubmitUserChoiceInput): Promise<ChatRuntimeStartResult> {
      const { runtimeId } = input;
      assertRuntimeIdAvailable(runtimeId);
      const lock = locks.acquireWritingLock({ sessionId: input.sessionId, runtimeId });
      assertWritingLock(input.sessionId, lock);

      const runtime = createUserChoiceRuntime(input, runtimeId);
      activeRuntimes.set(runtimeId, runtime);

      try {
        const continuationMessages = (await messageReader.getMessages(input.sessionId)).map(cloneRuntimeMessage);
        if (!activeRuntimes.has(runtimeId)) {
          throw new ChatRuntimeError('RUNTIME_NOT_ACTIVE', `Runtime ${runtimeId} was aborted before continuation started`);
        }
        const assistantMessage = applyUserChoiceAnswer(continuationMessages, input.answer);
        const userMessage = findLastRuntimeUserMessage(continuationMessages);
        if (!userMessage || !assistantMessage) {
          throw new ChatRuntimeError('USER_CHOICE_NOT_FOUND', 'No pending user choice was found');
        }

        ensureRuntimeMessageCreatedAt(assistantMessage, now());
        assistantMessage.runtimeId = runtimeId;
        assistantMessage.agentId = runtime.agentId;
        assistantMessage.parentRuntimeId = runtime.parentRuntimeId;
        assistantMessage.loading = true;
        assistantMessage.finished = false;
        activeAssistantMessages.set(runtimeId, assistantMessage);
        const sourceMessageSnapshot = continuationMessages.map((message) => (message.id === assistantMessage.id ? assistantMessage : message));
        await messageWriter.updateMessage(assistantMessage);
        safeAssistantMessages.set(runtimeId, structuredClone(assistantMessage));
        emit('chat:runtime:message-updated', {
          ...createRuntimeEventBase(runtime),
          message: assistantMessage
        });

        if (!dependencies.keepRuntimeOpenForTest) {
          runRuntimeStream(runtime, userMessage, assistantMessage, sourceMessageSnapshot).catch(() => undefined);
        }
      } catch (error) {
        activeRuntimes.delete(runtime.runtimeId);
        activeAssistantMessages.delete(runtime.runtimeId);
        safeAssistantMessages.delete(runtime.runtimeId);
        rendererToolRequests.rejectRuntime(runtime.runtimeId, 'Runtime user choice submit failed');
        confirmationRequests.rejectRuntime(runtime.runtimeId, 'Runtime user choice submit failed');
        bridgeRequests.rejectRuntime(runtime.runtimeId, 'Runtime user choice submit failed');
        locks.releaseWritingLock({ sessionId: runtime.sessionId, runtimeId: runtime.runtimeId });
        throw error;
      }

      return { runtimeId, sessionId: runtime.sessionId };
    },

    /**
     * 请求 renderer 展示确认弹窗并等待决策。
     * @param input - 确认请求输入
     * @returns renderer 确认决策
     */
    requestConfirmation(input: RuntimeConfirmationRequestInput): Promise<ChatRuntimeConfirmationDecision> {
      return confirmationRequests.request(input);
    },

    /**
     * 提交 renderer 确认决策。
     * @param input - 确认决策输入
     */
    submitConfirmation(input: ChatRuntimeSubmitConfirmationInput): void {
      confirmationRequests.submit(input);
    },

    /**
     * 请求 renderer 执行通用 bridge 操作并等待结果。
     * @param input - bridge 请求输入
     * @returns renderer bridge 结果
     */
    requestBridge(input: RuntimeBridgeRequestInput): Promise<ChatRuntimeBridgeResult> {
      return bridgeRequests.request(input);
    },

    /**
     * 提交 renderer bridge 响应。
     * @param input - bridge 响应输入
     */
    submitBridgeResponse(input: ChatRuntimeBridgeResponseInput): void {
      bridgeRequests.submit(input);
    },

    /**
     * 自动生成并持久化会话标题。
     * @param input - 自动命名输入
     * @returns 自动命名结果
     */
    async autoName(input: ChatRuntimeAutoNameInput): Promise<ChatRuntimeAutoNameResult> {
      const resolution = await autoNameResolver();
      if (!resolution) {
        return { status: 'skipped', reason: 'no_model_config' };
      }

      const [error, result] = await autoNameGenerateText(resolution.createOptions, {
        modelId: resolution.modelId,
        prompt: createAutoNamePrompt(input)
      });
      if (error) {
        return { status: 'failed', errorMessage: error.message };
      }

      const title = normalizeAutoNameTitle(result.text);
      if (!title) {
        return { status: 'skipped', reason: 'empty_title' };
      }

      try {
        await autoNameUpdateSessionTitle(input.sessionId, title);
      } catch (persistError: unknown) {
        const message = persistError instanceof Error ? persistError.message : String(persistError);
        return { status: 'failed', errorMessage: message };
      }

      return { status: 'success', title };
    },

    /**
     * 中止指定 runtime。
     * @param input - 中止参数
     */
    async abort(input: ChatRuntimeAbortInput): Promise<ChatRuntimeAbortResult> {
      const runtime = activeRuntimes.get(input.runtimeId);
      if (!runtime) return {};

      runtime.abortController.abort();
      const compactionCancellation = runtime.phase === 'compacting' ? compactionExecutor.cancel(runtime.runtimeId) : Promise.resolve();
      activeRuntimes.delete(runtime.runtimeId);
      const workingMessage = activeAssistantMessages.get(runtime.runtimeId);
      const safeMessage = safeAssistantMessages.get(runtime.runtimeId);
      activeAssistantMessages.delete(runtime.runtimeId);
      safeAssistantMessages.delete(runtime.runtimeId);
      rendererToolRequests.rejectRuntime(runtime.runtimeId, 'Runtime aborted');
      confirmationRequests.rejectRuntime(runtime.runtimeId, 'Runtime aborted');
      bridgeRequests.rejectRuntime(runtime.runtimeId, 'Runtime aborted');
      const abortResult: ChatRuntimeAbortResult = {};
      try {
        // compaction cancel 只有在 pending 已持久化为终态后才完成；锁必须覆盖整个收敛与中断消息写入过程。
        await Promise.allSettled([compactionCancellation, Promise.resolve().then(() => streamAbort(runtime.runtimeId))]);

        const assistantMessage = structuredClone(runtime.phase === 'compacting' ? workingMessage : safeMessage ?? workingMessage);
        if (!assistantMessage) return abortResult;

        if (runtime.phase === 'compacting') {
          cancelExistingCompactionPart(assistantMessage);
          finishAssistantMessageInterrupted(assistantMessage);
          await messageWriter.updateMessage(assistantMessage);
          abortResult.assistantMessage = cloneRuntimeMessage(assistantMessage);
          emit('chat:runtime:message-updated', {
            ...createRuntimeEventBase(runtime),
            message: assistantMessage
          });
          return abortResult;
        }

        if (!hasAssistantResponseContent(assistantMessage)) {
          await deleteAssistantMessage(runtime, assistantMessage);
          abortResult.deletedMessageId = assistantMessage.id;
        } else {
          finishAssistantMessageInterrupted(assistantMessage);
          await messageWriter.updateMessage(assistantMessage);
          abortResult.assistantMessage = cloneRuntimeMessage(assistantMessage);
          emit('chat:runtime:message-updated', {
            ...createRuntimeEventBase(runtime),
            message: assistantMessage
          });
        }

        const interruptMessage = createRuntimeInterruptMessage(runtime, createMessageId('interrupt'), now());
        await messageWriter.addMessage(interruptMessage);
        abortResult.interruptMessage = cloneRuntimeMessage(interruptMessage);
        emit('chat:runtime:message-created', {
          ...createRuntimeEventBase(runtime),
          message: interruptMessage
        });
        return abortResult;
      } finally {
        locks.releaseWritingLock({ sessionId: runtime.sessionId, runtimeId: runtime.runtimeId });
      }
    },

    /**
     * 提交 renderer 本地工具执行结果。
     * @param input - 工具结果
     */
    submitToolResult(input: ChatRuntimeSubmitToolResultInput): void {
      rendererToolRequests.submit(input);
    },

    /**
     * 提交 renderer 侧产生的消息片段更新。
     * @param input - 消息片段更新输入
     */
    async submitMessagePart(input: ChatRuntimeSubmitMessagePartInput): Promise<void> {
      const runtime = activeRuntimes.get(input.runtimeId);
      if (!runtime) {
        throw new ChatRuntimeError('RUNTIME_NOT_ACTIVE', `Runtime ${input.runtimeId} is not active`);
      }

      const workingMessage = activeAssistantMessages.get(runtime.runtimeId);
      const safeMessage = safeAssistantMessages.get(runtime.runtimeId);
      if (!workingMessage || workingMessage.id !== input.messageId || !safeMessage || safeMessage.id !== input.messageId) {
        throw new ChatRuntimeError('MESSAGE_NOT_ACTIVE', `Message ${input.messageId} is not active in runtime ${input.runtimeId}`);
      }

      const safePartIndex = safeMessage.parts.findIndex((part): boolean => part.id === input.part.id);
      const workingPartIndex = workingMessage.parts.findIndex((part): boolean => part.id === input.part.id);
      if (safePartIndex < 0 || workingPartIndex < 0) {
        throw new ChatRuntimeError('MESSAGE_PART_NOT_ACTIVE', `Message part ${input.part.id} is not active in message ${input.messageId}`);
      }

      // 只从已持久化安全快照构造下一版本，避免 working 中尚未提交的 deferred part 被 renderer 更新顺带写出。
      const nextSafeMessage = structuredClone(safeMessage);
      nextSafeMessage.parts.splice(safePartIndex, 1, structuredClone(input.part));
      await updateAssistantMessage(runtime, nextSafeMessage);
      if (!activeRuntimes.has(runtime.runtimeId)) return;

      // 持久化成功后仅同步目标 Part 回 working；其余隐藏片段保持原有内存状态。
      const currentWorkingMessage = activeAssistantMessages.get(runtime.runtimeId);
      const currentPartIndex = currentWorkingMessage?.parts.findIndex((part): boolean => part.id === input.part.id) ?? -1;
      if (currentWorkingMessage && currentPartIndex >= 0) {
        currentWorkingMessage.parts.splice(currentPartIndex, 1, structuredClone(input.part));
      }
    },

    /**
     * 读取空闲会话消息并按 checkpoint 投影估算当前上下文用量。
     * Runtime 启动后的精确值仍由包含 system 与工具 schema 的实时投影事件覆盖。
     * @param input - 会话与当前模型上下文窗口
     * @returns 初始上下文用量快照
     */
    async estimateContext(input: ChatRuntimeEstimateContextInput): Promise<ChatRuntimeContextUsageSnapshot> {
      const messages = await messageReader.getMessages(input.sessionId);
      const projection = projectContext({ messages });
      const contextWindow = Number.isFinite(input.contextWindow) ? Math.max(1, Math.round(input.contextWindow)) : 1;

      return {
        usedTokens: Math.max(0, Math.round(projection.estimatedTokens)),
        contextWindow
      };
    },

    /**
     * 读取 renderer 重建所需的活跃 Runtime 投影。
     * @returns 按创建时间排序的可克隆 Runtime 快照
     */
    listRecoverySnapshots(): ChatRuntimeRecoverySnapshot[] {
      return [...activeRuntimes.values()]
        .filter((runtime): boolean => runtime.status !== 'completed')
        .sort((left, right): number => left.createdAt - right.createdAt)
        .map(
          (runtime): ChatRuntimeRecoverySnapshot => ({
            ...createRuntimeEventBase(runtime),
            phase: runtime.phase,
            createdAt: runtime.createdAt,
            capabilities: runtime.capabilities ? { ...runtime.capabilities, rendererToolNames: [...runtime.capabilities.rendererToolNames] } : undefined,
            pendingRequests: [
              ...rendererToolRequests.listPending(runtime.runtimeId),
              ...confirmationRequests.listPending(runtime.runtimeId),
              ...bridgeRequests.listPending(runtime.runtimeId)
            ]
          })
        );
    },

    /**
     * 在暴露 Runtime recovery 快照前只执行一次遗留 checkpoint 恢复。
     */
    async recoverInterruptedCompactions(): Promise<void> {
      if (interruptedCompactionRecovered) return;
      interruptedCompactionRecovery ??= runInterruptedRecovery();
      const activeRecovery = interruptedCompactionRecovery;
      try {
        interruptedCompactionRecovered = await activeRecovery;
      } finally {
        if (interruptedCompactionRecovery === activeRecovery) interruptedCompactionRecovery = undefined;
      }
    },

    /**
     * 读取活跃 runtime，供测试和诊断使用。
     * @param runtimeId - runtime id
     * @returns 活跃 runtime
     */
    getActiveRuntime(runtimeId: string): ActiveChatRuntime | undefined {
      return activeRuntimes.get(runtimeId);
    }
  };
}

/** IPC handlers 使用的默认 ChatRuntime 单例。 */
export const chatRuntimeService = createChatRuntimeService({
  locks: chatRuntimeLocks,
  prepareDelegation: (input): ChatRuntimeDelegationPrepareAck => chatAgentDelegationService.prepareDelegation(input)
});
