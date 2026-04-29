/* eslint-disable no-use-before-define */
/**
 * @file useChatStream.ts
 * @description 聊天消息流式处理 hook，处理 AI 流式输出、工具调用和循环保护
 */
import type { CachedModelMessagesResult } from '../utils/messageHelper';
import type { Message, ServiceConfig, ToolLoopGuardConfig } from '../utils/types';
import type { AIToolExecutor, AIToolContext, AIServiceError, AIStreamFinishChunk, AIStreamToolCallChunk } from 'types/ai';
import type { AIUserChoiceAnswerData, ChatMessageConfirmationAction } from 'types/chat';
import { nextTick, ref, shallowRef, type Ref } from 'vue';
import { getModelToolSupport } from '@/ai/tools/policy';
import { executeToolCall, toTransportTools, type ExecutedToolCall } from '@/ai/tools/stream';
import { buildModelReadyMessages } from '@/components/BChatSidebar/utils/fileReferenceContext';
import { createToolCallTracker, type ToolCallTracker } from '@/components/BChatSidebar/utils/toolCallTracker';
import { createToolLoopGuard, type ToolLoopGuard } from '@/components/BChatSidebar/utils/toolLoopGuard';
import { useChat } from '@/hooks/useChat';
import { chatStorage } from '@/shared/storage';
import { useServiceModelStore } from '@/stores/service-model';
import { append, convert, create, userChoice, is } from '../utils/messageHelper';

export interface UseChatStreamOptions {
  /** 消息列表（响应式引用） */
  messages: Ref<Message[]>;
  /** 可用 AI 工具 */
  tools?: AIToolExecutor[];
  /** 获取工具上下文 */
  getToolContext?: () => AIToolContext | undefined;
  /** 重新生成前回调 */
  onBeforeRegenerate?: (messages: Message[], triggerMessage: Message) => Promise<void> | void;
  /** 消息完成回调 */
  onComplete?: (message: Message) => void;
  /** 确认卡片操作回调 */
  onConfirmationAction?: (confirmationId: string, action: ChatMessageConfirmationAction) => void | Promise<void>;
}

export interface UseChatStreamReturns {
  /** 加载状态 */
  loading: Ref<boolean>;
  /** 解析服务配置 */
  resolveServiceConfig: () => Promise<ServiceConfig | undefined>;
  /** 追加文本片段 */
  appendText: (content: string) => void;
  /** 追加思考片段 */
  appendThinking: (thinking: string) => void;
  /** 追加工具调用 */
  appendToolCall: (chunk: AIStreamToolCallChunk) => void;
  /** 准备助手消息占位符 */
  prepareAssistantMessage: (reuseLastAssistant: boolean) => Message | undefined;
  /** 流式传输消息 */
  streamMessages: (sourceMessages: Message[], config: ServiceConfig, reuseLastAssistant?: boolean) => Promise<void>;
  /** 中止流式传输 */
  abort: () => void;
  /** 用户选择提交 */
  submitUserChoice: (answer: AIUserChoiceAnswerData) => Promise<boolean>;
  /** 重新生成 */
  regenerate: (message: Message) => Promise<boolean>;
}

const DEFAULT_TOOL_LOOP_GUARD_CONFIG: ToolLoopGuardConfig = {
  maxRounds: 5,
  maxRepeatedCalls: 2
};

export function useChatStream(options: UseChatStreamOptions): UseChatStreamReturns {
  const { messages, tools, getToolContext, onBeforeRegenerate, onComplete } = options;

  const loading = ref(false);
  const pendingToolResults = shallowRef<ExecutedToolCall[]>([]);
  const blockedToolLoopReason = ref('');
  const awaitingUserChoice = ref(false);

  const serviceModelStore = useServiceModelStore();

  let lastServiceConfig: ServiceConfig | null = null;
  let executedToolCallIds = new Set<string>();
  let currentToolRoundId = 0;
  let currentToolCallTracker: ToolCallTracker = createToolCallTracker();
  let currentToolLoopGuard: ToolLoopGuard = createToolLoopGuard(DEFAULT_TOOL_LOOP_GUARD_CONFIG);
  let currentModelMessageCache: CachedModelMessagesResult | undefined;

  const { agent } = useChat({
    onText: async (content: string): Promise<void> => {
      appendText(content);
    },
    onThinking: async (thinking: string): Promise<void> => {
      appendThinking(thinking);
    },
    onFinish: async ({ usage }: AIStreamFinishChunk): Promise<void> => {
      const message = messages.value[messages.value.length - 1];
      if (message) {
        message.usage = usage;
      }
    },
    onToolCall: handleAppendToolCall,
    onComplete: handleStreamComplete,
    onError: handleStreamError
  });

  /**
   * 重置工具循环状态
   */
  function resetToolLoopState(): void {
    currentToolRoundId = 0;
    currentToolCallTracker = createToolCallTracker();
    blockedToolLoopReason.value = '';
    executedToolCallIds = new Set();
    pendingToolResults.value = [];
    awaitingUserChoice.value = false;
    lastServiceConfig = null;
  }

  /**
   * 开始工具循环会话
   */
  function startToolLoopSession(): void {
    resetToolLoopState();
    currentToolLoopGuard = createToolLoopGuard(DEFAULT_TOOL_LOOP_GUARD_CONFIG);
  }

  /**
   * 移除尾部空助手消息
   */
  function removeTrailingEmptyAssistantMessage(): void {
    const lastMessage = messages.value[messages.value.length - 1];
    if (is.removableAssistantPlaceholder(lastMessage)) {
      messages.value.pop();
    }
  }

  /**
   * 追加助手工具调用片段
   */
  function appendAssistantToolCall(chunk: AIStreamToolCallChunk): void {
    const message = messages.value[messages.value.length - 1];
    if (message?.role !== 'assistant') {
      return;
    }

    append.toolCallPart(message, chunk.toolCallId, chunk.toolName, chunk.input);
  }

  /**
   * 追加助手工具结果片段
   */
  function appendAssistantToolResult(result: ExecutedToolCall): void {
    const message = messages.value[messages.value.length - 1];
    if (message?.role !== 'assistant') {
      return;
    }

    append.toolResultPart(message, result.toolCallId, result.toolName, result.result);
  }

  /**
   * 停止工具循环
   */
  function stopToolLoop(reason: string): void {
    blockedToolLoopReason.value = reason;
    pendingToolResults.value = [];
    removeTrailingEmptyAssistantMessage();

    const message = create.errorMessage(reason);
    messages.value.push(message);
    onComplete?.(message);
  }

  /**
   * 执行追踪的工具调用
   */
  async function executeTrackedToolCall(chunk: AIStreamToolCallChunk, roundId: number): Promise<void> {
    const result = await executeToolCall(chunk, tools ?? [], getToolContext?.());
    if (roundId !== currentToolRoundId) {
      return;
    }

    appendAssistantToolResult(result);

    if (result.result.status === 'awaiting_user_input') {
      awaitingUserChoice.value = true;
      return;
    }

    pendingToolResults.value = [...pendingToolResults.value, result];
  }

  /**
   * 处理工具调用
   */
  async function handleToolCall(chunk: AIStreamToolCallChunk): Promise<void> {
    if (executedToolCallIds.has(chunk.toolCallId)) {
      return;
    }

    executedToolCallIds.add(chunk.toolCallId);
    appendAssistantToolCall(chunk);

    const guardResult = currentToolLoopGuard.recordToolCall(chunk.toolName, chunk.input);
    if (!guardResult.allowed) {
      stopToolLoop(guardResult.reason ?? '工具调用重复次数超过限制，已停止自动续轮。');
      return;
    }

    const trackedTask = currentToolCallTracker.track(executeTrackedToolCall(chunk, currentToolRoundId));
    await trackedTask;
  }

  /**
   * 解析服务配置
   */
  async function resolveServiceConfig(): Promise<ServiceConfig | undefined> {
    const config = await serviceModelStore.getAvailableServiceConfig('chat');
    if (!config?.providerId || !config?.modelId) {
      return undefined;
    }

    const toolSupport = await getModelToolSupport(config.providerId, config.modelId);
    return { providerId: config.providerId, modelId: config.modelId, toolSupport };
  }

  /**
   * 加载引用快照映射
   */
  async function loadReferenceSnapshotMap(sourceMessages: Message[]) {
    const references = sourceMessages.flatMap((m) => m.references ?? []);
    const snapshotIds = references.map((r) => r.snapshotId).filter((id) => id.length > 0);
    const uniqueSnapshotIds = [...new Set(snapshotIds)];

    if (!uniqueSnapshotIds.length) return new Map();

    const snapshots = await chatStorage.getReferenceSnapshots(uniqueSnapshotIds);
    return new Map(snapshots.map((s) => [s.id, s]));
  }

  /**
   * 追加文本片段
   */
  function appendText(content: string): void {
    const message = messages.value[messages.value.length - 1];
    if (!message) return;

    append.textPart(message, content);
    message.loading = false;
    message.createdAt ||= new Date().toISOString();
  }

  /**
   * 追加思考片段
   */
  function appendThinking(thinking: string): void {
    const message = messages.value[messages.value.length - 1];
    if (!message) return;

    append.thinkingPart(message, thinking);
    message.loading = false;
    message.createdAt ||= new Date().toISOString();
  }

  /**
   * 追加工具调用
   */
  function handleAppendToolCall(chunk: AIStreamToolCallChunk): void {
    handleToolCall(chunk);
  }

  /**
   * 准备助手消息占位符
   */
  function handlePrepareAssistantMessage(reuseLastAssistant: boolean): Message | undefined {
    const lastMessage = messages.value[messages.value.length - 1];
    if (reuseLastAssistant && lastMessage?.role === 'assistant') {
      lastMessage.loading = true;
      lastMessage.finished = false;
      lastMessage.createdAt ||= new Date().toISOString();
      return lastMessage;
    }

    const placeholder = create.assistantPlaceholder();
    messages.value.push(placeholder);
    return placeholder;
  }

  /**
   * 流式传输消息
   */
  async function handleStreamMessages(sourceMessages: Message[], config: ServiceConfig, reuseLastAssistant = false): Promise<void> {
    loading.value = true;
    lastServiceConfig = config;
    currentToolRoundId += 1;
    currentToolCallTracker = createToolCallTracker();
    handlePrepareAssistantMessage(reuseLastAssistant);

    const snapshotsById = await loadReferenceSnapshotMap(sourceMessages);
    const modelMessages = buildModelReadyMessages(sourceMessages, snapshotsById);
    currentModelMessageCache = convert.toCachedModelMessages(modelMessages, currentModelMessageCache);

    const continuedMessages = [...currentModelMessageCache.modelMessages];

    const transportTools = config.toolSupport.supported && Boolean(tools?.length) ? toTransportTools(tools ?? []) : undefined;

    agent.stream({ messages: continuedMessages, modelId: config.modelId, providerId: config.providerId, tools: transportTools });
  }

  /**
   * 处理流式完成
   */
  async function handleStreamComplete(): Promise<void> {
    loading.value = false;
    const roundId = currentToolRoundId;
    const tracker = currentToolCallTracker;

    await tracker.waitForAll();
    if (!roundId || roundId !== currentToolRoundId) {
      return;
    }

    if (blockedToolLoopReason.value) {
      executedToolCallIds = new Set();
      return;
    }

    const message = messages.value[messages.value.length - 1];
    if (message) {
      message.loading = false;
      message.finished = true;
    }

    if (message?.role === 'error') {
      return;
    }

    if (awaitingUserChoice.value || userChoice.findPending(messages.value)) {
      if (message) {
        onComplete?.(message);
      }
      return;
    }

    if (pendingToolResults.value.length && lastServiceConfig) {
      const roundGuardResult = currentToolLoopGuard.advanceRound();
      if (!roundGuardResult.allowed) {
        executedToolCallIds = new Set();
        stopToolLoop(roundGuardResult.reason ?? '工具调用轮次超过限制，已停止自动续轮。');
        return;
      }

      pendingToolResults.value = [];
      if (message) {
        onComplete?.(message);
      }
      nextTick(() => {
        handleStreamMessages(messages.value, lastServiceConfig as ServiceConfig, true);
      });
      return;
    }

    executedToolCallIds = new Set();

    if (message) {
      onComplete?.(message);
    }
  }

  /**
   * 处理流式错误
   */
  function handleStreamError(error: AIServiceError): void {
    loading.value = false;
    resetToolLoopState();
    removeTrailingEmptyAssistantMessage();

    const _message = create.errorMessage(error.message);

    const lastMessage = messages.value[messages.value.length - 1];

    if (lastMessage?.role !== 'user') {
      lastMessage.parts.push(..._message.parts);
      lastMessage.loading = false;
      lastMessage.finished = true;
    } else {
      messages.value.push(_message);
    }

    onComplete?.(_message);
  }

  /**
   * 查找重新生成起始索引
   */
  function findRegenerateStartIndex(targetMessage: Message): number {
    const targetIndex = messages.value.findIndex((item) => item.id === targetMessage.id);
    if (targetIndex === -1 || targetMessage.role !== 'assistant') {
      return -1;
    }

    for (let index = targetIndex - 1; index >= 0; index -= 1) {
      if (messages.value[index].role === 'user') {
        return index;
      }
    }

    return -1;
  }

  /**
   * 中止流式传输
   */
  function abort(): void {
    resetToolLoopState();
    agent.abort();
  }

  /**
   * 用户选择提交
   */
  async function submitUserChoice(answer: AIUserChoiceAnswerData): Promise<boolean> {
    if (loading.value) {
      return false;
    }

    const submitted = userChoice.submitAnswer(messages.value, answer);
    if (!submitted) {
      return false;
    }

    const config = lastServiceConfig ?? (await resolveServiceConfig());
    if (!config) {
      return false;
    }

    awaitingUserChoice.value = false;
    pendingToolResults.value = [];
    nextTick(() => {
      handleStreamMessages(messages.value, config, true);
    });
    return true;
  }

  /**
   * 重新生成
   */
  async function regenerate(message: Message): Promise<boolean> {
    if (loading.value) {
      return false;
    }

    const config = await resolveServiceConfig();
    if (!config) {
      return false;
    }

    const startIndex = findRegenerateStartIndex(message);
    if (startIndex === -1) {
      return false;
    }

    const sourceMessages = messages.value.slice(0, startIndex + 1);
    await onBeforeRegenerate?.(sourceMessages, message);

    // 直接修改 messages 数组（由外部控制）
    messages.value.splice(0, messages.value.length, ...sourceMessages);
    startToolLoopSession();
    nextTick(() => handleStreamMessages(sourceMessages, config));
    return true;
  }

  return {
    loading,
    appendText,
    appendThinking,
    appendToolCall: handleAppendToolCall,
    prepareAssistantMessage: handlePrepareAssistantMessage,
    streamMessages: handleStreamMessages,
    resolveServiceConfig,
    abort,
    submitUserChoice,
    regenerate
  };
}
