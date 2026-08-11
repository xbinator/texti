/**
 * @file stream/index.mts
 * @description ChatRuntime 主进程模型流式执行器主循环与公共入口。
 */
import type {
  ChatRuntimeAssistantDeltaEmitter,
  ChatRuntimeAssistantUpdater,
  ChatRuntimeStreamExecutor,
  ChatRuntimeStreamExecutorInput,
  ChatRuntimeStreamExecutorResult
} from '../types.mjs';
import type { RuntimeStreamExecutorDependencies, RuntimeStreamText } from './types.mjs';
import type { ToolWatchdogLease, ToolWatchdogs } from '../controllers/tool-watchdog.mjs';
import type { ChatToolActivitySnapshot } from 'types/ai';
import type { ChatMessageRecord } from 'types/chat';
import { AI_ERROR_CODE, createAIServiceError } from '../../../ai/errors/codes.mjs';
import { createToolWatchdogs } from '../controllers/tool-watchdog.mjs';
import { createPersistableAssistant, getDeferredToolNames, hasExecutableMcp, hasExecutableTavily } from './deferred-tools.mjs';
import { applyToolActivity, finishAssistantMessage } from './message-parts.mjs';
import { observeRuntimeStream, type RuntimeStreamObservation } from './observer.mjs';
import { createAssistantProjection, type AssistantProjection } from './projection.mjs';
import { createRuntimeStreamRequest } from './request.mjs';
import { classifyToolStep, executeToolStep, type RuntimeToolStepResult } from './tool-step.mjs';

export type { RuntimeStreamText, RuntimeStreamExecutorDependencies };

/** 单次 Runtime 模型流的投影与 Watchdog 上下文。 */
interface StreamExecutionContext {
  /** 当前步骤延迟调用 ID。 */
  deferredToolCallIds: Set<string>;
  /** Assistant 实时与耐久投影器。 */
  projection: AssistantProjection;
  /** 将结构变化投影为完整检查点。 */
  persistAssistant: () => Promise<void>;
  /** 启动工具 Watchdog 租约。 */
  startToolLease: (toolCallId: string, toolName: string) => ToolWatchdogLease;
  /** 在工具 Part 出现后应用早到活动快照。 */
  applyPendingActivity: (toolCallId: string) => void;
}

/** Runtime 终态收口输入。 */
interface StreamFinalizationInput {
  /** 当前工作 Assistant。 */
  assistantMessage: ChatMessageRecord;
  /** Provider 流观察事实。 */
  observation: RuntimeStreamObservation;
  /** 工具步骤执行结果。 */
  toolStepResult: RuntimeToolStepResult;
  /** Assistant 投影器。 */
  projection: AssistantProjection;
  /** 完整检查点投影函数。 */
  persistAssistant: () => Promise<void>;
}

/**
 * 创建当前模型步骤的投影与 Watchdog 上下文。
 * @param input - Runtime 流执行输入
 * @param updateAssistant - 完整 Assistant 持久化函数
 * @param emitDelta - 小型实时增量发送函数
 * @param toolWatchdogs - Runtime 共享 Watchdog 注册表
 * @returns 流观察和工具执行依赖
 */
function createStreamContext(
  input: ChatRuntimeStreamExecutorInput,
  updateAssistant: ChatRuntimeAssistantUpdater,
  emitDelta: ChatRuntimeAssistantDeltaEmitter | undefined,
  toolWatchdogs: ToolWatchdogs
): StreamExecutionContext {
  const { runtime, assistantMessage } = input;
  const deferredToolCallIds = new Set<string>();
  const pendingActivities = new Map<string, ChatToolActivitySnapshot>();
  const projection = createAssistantProjection({
    messageId: assistantMessage.id,
    createSnapshot: (): ChatMessageRecord => createPersistableAssistant(assistantMessage, deferredToolCallIds),
    emitDelta: (delta): void => emitDelta?.(delta),
    persist: updateAssistant,
    initialRevision: emitDelta ? runtime.messageRevision ?? 0 : 0,
    onRevision: emitDelta
      ? (revision: number): void => {
          runtime.messageRevision = revision;
        }
      : undefined
  });

  /** 把结构变化作为完整检查点立即投影。 */
  const persistAssistant = async (): Promise<void> => {
    projection.mark();
    await projection.checkpoint();
  };
  /** 投影 Watchdog 活动或缓存早到快照。 */
  const projectToolActivity = (toolCallId: string, snapshot: ChatToolActivitySnapshot): void => {
    if (!applyToolActivity(assistantMessage, toolCallId, snapshot)) {
      pendingActivities.set(toolCallId, structuredClone(snapshot));
      return;
    }
    projection.mark();
  };
  /** 为当前 Runtime 的工具调用创建唯一租约。 */
  const startToolLease = (toolCallId: string, toolName: string): ToolWatchdogLease => {
    return toolWatchdogs.start({
      runtimeId: runtime.runtimeId,
      toolCallId,
      toolName,
      onChange: (snapshot): void => projectToolActivity(toolCallId, snapshot)
    });
  };
  /** 在工具 Part 创建后应用更早到达的活动快照。 */
  const applyPendingActivity = (toolCallId: string): void => {
    const pending = pendingActivities.get(toolCallId);
    if (!pending || !applyToolActivity(assistantMessage, toolCallId, pending)) return;
    pendingActivities.delete(toolCallId);
  };

  return { deferredToolCallIds, projection, persistAssistant, startToolLease, applyPendingActivity };
}

/**
 * 将 Provider usage、工具步骤结果与 Assistant 终态收口。
 * @param input - 流观察、工具结果与投影依赖
 * @returns ChatRuntime 流执行结果
 */
async function finalizeStreamStep(input: StreamFinalizationInput): Promise<ChatRuntimeStreamExecutorResult> {
  let { stepUsage, totalUsage, finishReason } = input.observation;
  const { toolStepResult } = input;
  if (toolStepResult.discardUsage) {
    stepUsage = undefined;
    totalUsage = undefined;
    finishReason = undefined;
  } else if (toolStepResult.discardFinishReason) {
    finishReason = undefined;
  }
  const usageResult = {
    ...(stepUsage ? { stepUsage } : {}),
    ...(totalUsage ? { totalUsage } : {})
  };
  if (toolStepResult.suspensionToolCalls) {
    await input.projection.flush();
    return { ...usageResult, shouldContinue: false, suspension: { toolCalls: toolStepResult.suspensionToolCalls } };
  }

  const shouldContinue = toolStepResult.executedToolCount > 0 && toolStepResult.allToolsContinueable && finishReason === 'tool-calls';
  if (shouldContinue || toolStepResult.isWaitingForUserInput) {
    await input.projection.flush();
    return shouldContinue ? { ...usageResult, shouldContinue } : usageResult;
  }
  if (input.assistantMessage.finished !== true) {
    finishAssistantMessage(input.assistantMessage, totalUsage);
    await input.persistAssistant();
  }
  await input.projection.flush();
  return usageResult;
}

/**
 * 执行一次 ChatRuntime Provider 流。
 * @param dependencies - 执行器依赖
 * @param toolWatchdogs - Runtime 共享 Watchdog 注册表
 * @param input - Runtime、源消息与工作 Assistant
 * @param updateAssistant - 完整 Assistant 更新函数
 * @param emitDelta - 小型实时增量发送函数
 * @returns 用量、续轮或 suspension 结果
 */
async function executeRuntimeStream(
  dependencies: RuntimeStreamExecutorDependencies,
  toolWatchdogs: ToolWatchdogs,
  input: ChatRuntimeStreamExecutorInput,
  updateAssistant: ChatRuntimeAssistantUpdater,
  emitDelta?: ChatRuntimeAssistantDeltaEmitter
): Promise<ChatRuntimeStreamExecutorResult> {
  const { runtime, sourceMessages, userMessage, assistantMessage, forceFinal = false } = input;
  runtime.currentToolStep = { toolCalls: [] };
  const exposedDeferredToolNames = getDeferredToolNames(runtime.tools);
  if (exposedDeferredToolNames.size > 0 && (hasExecutableTavily(runtime.tavily) || hasExecutableMcp(runtime.mcp))) {
    throw createAIServiceError(AI_ERROR_CODE.INVALID_REQUEST, '延迟协调工具不能与 AI SDK 可执行的 Tavily 或 MCP 工具同时暴露');
  }
  const resolution = runtime.resolvedModel ?? (await dependencies.resolver.resolve(runtime.model));
  if (!resolution) throw createAIServiceError(AI_ERROR_CODE.MODEL_NOT_FOUND, '没有可用的聊天模型');
  runtime.resolvedModel = resolution;
  delete runtime.failedAssistantProjection;
  const context = createStreamContext(input, updateAssistant, emitDelta, toolWatchdogs);

  try {
    const [error, result] = await dependencies.streamText(
      resolution.createOptions,
      createRuntimeStreamRequest(resolution.modelId, runtime, userMessage, sourceMessages, resolution.maxOutputTokens),
      { runtimeToolLoop: true, forceFinal, toolActivity: { start: context.startToolLease } }
    );
    if (error) throw error;
    if (!result) throw createAIServiceError(AI_ERROR_CODE.REQUEST_FAILED, 'ChatRuntime 流式调用未返回结果');

    const observation = await observeRuntimeStream({
      runtime,
      stream: result.stream,
      assistantMessage,
      projection: context.projection,
      forceFinal,
      deferredToolCallIds: context.deferredToolCallIds,
      persistAssistant: context.persistAssistant,
      applyPendingActivity: context.applyPendingActivity,
      abortStream: dependencies.abortStream
    });
    const classification = classifyToolStep({ observedTools: observation.observedTools, exposedDeferredToolNames });
    const toolStepResult = await executeToolStep({
      runtime,
      assistantMessage,
      classification,
      deferredToolCallIds: context.deferredToolCallIds,
      stoppedToolCallId: observation.stoppedToolCallId,
      dependencies,
      startToolLease: context.startToolLease,
      persistAssistant: context.persistAssistant
    });
    const finalResult = await finalizeStreamStep({
      assistantMessage,
      observation,
      toolStepResult,
      projection: context.projection,
      persistAssistant: context.persistAssistant
    });
    return finalResult;
  } catch (error) {
    // 任意异常都保留最新安全内存投影，避免耐久窗口把 Renderer 已见正文回滚到旧快照。
    runtime.failedAssistantProjection = createPersistableAssistant(assistantMessage, context.deferredToolCallIds);
    throw error;
  } finally {
    await context.projection.cancel();
  }
}

/**
 * 创建 ChatRuntime 模型流式执行器。
 * @param dependencies - 执行器依赖
 * @returns Runtime 流式执行器
 */
export function createRuntimeStreamExecutor(dependencies: RuntimeStreamExecutorDependencies): ChatRuntimeStreamExecutor {
  const toolWatchdogs = dependencies.toolWatchdogs ?? createToolWatchdogs();
  return (input, updateAssistant, emitDelta): Promise<ChatRuntimeStreamExecutorResult> =>
    executeRuntimeStream(dependencies, toolWatchdogs, input, updateAssistant, emitDelta);
}
