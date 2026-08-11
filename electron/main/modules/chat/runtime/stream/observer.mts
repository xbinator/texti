/**
 * @file observer.mts
 * @description 消费 Provider 流并返回无副作用后处理所需的步骤事实。
 */
import { Buffer } from 'node:buffer';
import type { ActiveChatRuntime } from '../types.mjs';
import type { AssistantProjection } from './projection.mjs';
import type { RuntimeStreamChunk, RuntimeToolCallChunk, RuntimeToolResultChunk } from './types.mjs';
import type { AIStreamFinishReason, AIStreamResult, AIUsage } from 'types/ai';
import type { ChatMessageRecord, ChatMessageToolPart } from 'types/chat';
import { AI_ERROR_CODE, createAIServiceError } from '../../../ai/errors/codes.mjs';
import { toRuntimeStreamChunk } from './chunks.mjs';
import { isDeferredToolName } from './deferred-tools.mjs';
import { createFinalTextFilter, type FinalTextFilter } from './final-text.mjs';
import {
  appendReasoningDelta,
  appendTextDelta,
  appendToolCall,
  appendToolInputDelta,
  appendToolInputEnd,
  appendToolInputStart,
  findRendererHistory
} from './message-parts.mjs';
import { measureJsonBytes } from './resource-budget.mjs';
import { normalizeRuntimeError, shouldStopStreamAfterToolResult } from './tools.mjs';

/** 单个模型步骤可接收的最大流事件数量。 */
const STREAM_EVENT_LIMIT = 100_000;
/** 单个模型步骤可接收的最大流文本字节数。 */
const STREAM_TEXT_LIMIT_BYTES = 2 * 1024 * 1024;

/** 同一 toolCallId 在 Provider 流中的全部定义观察。 */
export interface ObservedToolDefinition {
  /** 工具调用 ID。 */
  toolCallId: string;
  /** tool-input-start 阶段观察到的工具名称。 */
  startNames: string[];
  /** 完整 tool-call 定义。 */
  calls: RuntimeToolCallChunk[];
  /** tool-result 阶段观察到的工具名称。 */
  resultNames: string[];
  /** 分类完成前缓存的 Provider 工具结果。 */
  results: RuntimeToolResultChunk[];
}

/** Provider 流消费完成后的事实快照。 */
export interface RuntimeStreamObservation {
  /** 最后一个模型步骤用量。 */
  stepUsage?: AIUsage;
  /** 当前 Provider 调用总用量。 */
  totalUsage?: AIUsage;
  /** Provider 完成原因。 */
  finishReason?: AIStreamFinishReason;
  /** 按 toolCallId 聚合的工具事实。 */
  observedTools: Map<string, ObservedToolDefinition>;
  /** 第一个要求停止当前流的 Provider 工具调用 ID。 */
  stoppedToolCallId?: string;
}

/** Provider 流观察器依赖。 */
export interface RuntimeStreamObserverOptions {
  /** 当前 Runtime。 */
  runtime: ActiveChatRuntime;
  /** AI Service 返回的 Provider 流。 */
  stream: AIStreamResult['stream'];
  /** 主进程内存工作 Assistant。 */
  assistantMessage: ChatMessageRecord;
  /** 实时与耐久投影器。 */
  projection: AssistantProjection;
  /** 是否过滤强制最终回答内部协议。 */
  forceFinal: boolean;
  /** 当前步骤已观察到的延迟工具调用 ID。 */
  deferredToolCallIds: Set<string>;
  /** 将结构变化立即投影为完整检查点。 */
  persistAssistant: () => Promise<void>;
  /** 在工具 Part 创建后应用早到的活动快照。 */
  applyPendingActivity: (toolCallId: string) => void;
  /** 立即中止 AI Service Provider 流。 */
  abortStream?: (requestId: string) => void;
}

/** 流观察器的有界计数状态。 */
interface StreamBudgetState {
  /** 已消费事件数。 */
  eventCount: number;
  /** 已消费文本字节数。 */
  textBytes: number;
  /** 已通过 delta 观察的工具输入字节数。 */
  toolInputBytes: Map<string, number>;
}

/** 流观察器的可变上下文。 */
interface StreamObserverContext {
  /** 外部依赖。 */
  options: RuntimeStreamObserverOptions;
  /** 最终返回事实。 */
  observation: RuntimeStreamObservation;
  /** 有界计数状态。 */
  budget: StreamBudgetState;
  /** 强制最终回答常量尾缓冲过滤器。 */
  finalTextFilter?: FinalTextFilter;
}

/**
 * 读取或创建一个工具调用的定义观察记录。
 * @param definitions - 当前步骤全部观察记录
 * @param toolCallId - 工具调用 ID
 * @returns 可追加观察事实的记录
 */
export function getObservedTool(definitions: Map<string, ObservedToolDefinition>, toolCallId: string): ObservedToolDefinition {
  const existing = definitions.get(toolCallId);
  if (existing) return existing;

  const created: ObservedToolDefinition = {
    toolCallId,
    startNames: [],
    calls: [],
    resultNames: [],
    results: []
  };
  definitions.set(toolCallId, created);
  return created;
}

/**
 * 当完整 tool-call 未重复携带元数据时，继承 input-start 已写入工作消息的值。
 * @param message - 当前工作 Assistant
 * @param chunk - 完整工具调用 chunk
 * @returns 含最终 Provider 元数据的调用定义
 */
function inheritToolMetadata(message: ChatMessageRecord, chunk: RuntimeToolCallChunk): RuntimeToolCallChunk {
  if (chunk.providerMetadata !== undefined) return chunk;

  const toolPart = message.parts.find((part): part is ChatMessageToolPart => part.type === 'tool' && part.toolCallId === chunk.toolCallId);
  if (toolPart?.providerMetadata === undefined) return chunk;

  return {
    ...chunk,
    providerMetadata: toolPart.providerMetadata
  };
}

/**
 * 中止超限 Provider 流并抛出稳定错误。
 * @param context - 当前观察上下文
 * @param code - 错误代码
 * @param reason - Runtime 中止原因
 * @param message - 用户可见错误消息
 * @returns 永不返回
 */
function abortOversizedStream(
  context: StreamObserverContext,
  code: typeof AI_ERROR_CODE.STREAM_EVENT_LIMIT | typeof AI_ERROR_CODE.OUTPUT_TOO_LARGE,
  reason: string,
  message: string
): never {
  context.options.abortStream?.(context.options.runtime.runtimeId);
  context.options.runtime.abortController.abort(reason);
  throw createAIServiceError(code, message);
}

/**
 * 核算单个已规范化 chunk 占用的流预算。
 * @param context - 当前观察上下文
 * @param chunk - 已规范化 chunk
 */
function consumeChunkBudget(context: StreamObserverContext, chunk: RuntimeStreamChunk): void {
  let streamedText = '';
  if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') streamedText = chunk.text;
  if (chunk.type === 'tool-input-delta') {
    streamedText = chunk.inputTextDelta;
    const deltaBytes = Buffer.byteLength(chunk.inputTextDelta, 'utf8');
    const previousBytes = context.budget.toolInputBytes.get(chunk.toolCallId) ?? 0;
    context.budget.toolInputBytes.set(chunk.toolCallId, previousBytes + deltaBytes);
  }
  context.budget.textBytes += Buffer.byteLength(streamedText, 'utf8');
  if (chunk.type === 'tool-call') {
    const streamedBytes = context.budget.toolInputBytes.get(chunk.toolCallId) ?? 0;
    const authoritativeBytes = measureJsonBytes(chunk.input, STREAM_TEXT_LIMIT_BYTES);
    context.budget.textBytes += Math.max(0, authoritativeBytes - streamedBytes);
  }
  if (context.budget.textBytes <= STREAM_TEXT_LIMIT_BYTES) return;

  abortOversizedStream(
    context,
    AI_ERROR_CODE.OUTPUT_TOO_LARGE,
    `stream-output-limit:${context.budget.textBytes}`,
    `模型流文本超过安全上限：${context.budget.textBytes} 字节`
  );
}

/**
 * 判断 Provider 权威停止结果之后的 chunk 是否只属于噪声。
 * @param observation - 当前步骤事实
 * @param chunk - 已规范化 chunk
 * @returns 是否忽略该 chunk
 */
function shouldSkipChunk(observation: RuntimeStreamObservation, chunk: RuntimeStreamChunk): boolean {
  if (observation.stoppedToolCallId === undefined) return false;
  return chunk.type === 'text-delta' || chunk.type === 'reasoning-delta' || chunk.type === 'error' || chunk.type === 'abort';
}

/**
 * 追加一个已确认可见的 Assistant 文本片段。
 * @param context - 当前观察上下文
 * @param text - 不含内部协议的安全文本
 */
function appendVisibleText(context: StreamObserverContext, text: string): void {
  if (!text) return;
  const partId = appendTextDelta(context.options.assistantMessage, text);
  context.options.projection.append({ kind: 'append-text', partId, text });
}

/**
 * 投影文本或思考追加 chunk。
 * @param context - 当前观察上下文
 * @param chunk - 已规范化 chunk
 * @returns 是否已消费该 chunk
 */
function projectContentChunk(context: StreamObserverContext, chunk: RuntimeStreamChunk): boolean {
  const { options } = context;
  if (chunk.type === 'text-delta') {
    appendVisibleText(context, context.finalTextFilter ? context.finalTextFilter.push(chunk.text) : chunk.text);
    return true;
  }
  if (chunk.type === 'reasoning-delta') {
    const partId = appendReasoningDelta(options.assistantMessage, chunk.text);
    options.projection.append({ kind: 'append-reasoning', partId, text: chunk.text });
    return true;
  }
  return false;
}

/**
 * 记录 usage、完成或异常终止 chunk。
 * @param context - 当前观察上下文
 * @param chunk - 已规范化 chunk
 * @returns 是否已消费该 chunk
 */
function projectStatusChunk(context: StreamObserverContext, chunk: RuntimeStreamChunk): boolean {
  const { observation } = context;
  if (chunk.type === 'finish-step') {
    observation.stepUsage = chunk.stepUsage;
    return true;
  }
  if (chunk.type === 'finish') {
    observation.finishReason = chunk.finishReason;
    observation.totalUsage = chunk.totalUsage;
    return true;
  }
  if (chunk.type === 'error') throw normalizeRuntimeError(chunk.error);
  if (chunk.type === 'abort') throw createAIServiceError(AI_ERROR_CODE.REQUEST_FAILED, chunk.reason?.trim() || '模型流已中止');
  return false;
}

/**
 * 投影工具输入、定义或结果 chunk。
 * @param context - 当前观察上下文
 * @param chunk - 已规范化 chunk
 * @returns 需要等待的结构检查点
 */
async function projectToolChunk(context: StreamObserverContext, chunk: RuntimeStreamChunk): Promise<void> {
  const { options, observation } = context;
  if (chunk.type === 'tool-input-start') {
    getObservedTool(observation.observedTools, chunk.toolCallId).startNames.push(chunk.toolName);
    if (isDeferredToolName(chunk.toolName)) options.deferredToolCallIds.add(chunk.toolCallId);
    appendToolInputStart(options.assistantMessage, chunk, findRendererHistory(options.runtime.capabilities, chunk.toolName));
    await options.persistAssistant();
    return;
  }
  if (chunk.type === 'tool-input-delta') {
    appendToolInputDelta(options.assistantMessage, chunk);
    options.projection.append({ kind: 'append-tool-input', toolCallId: chunk.toolCallId, text: chunk.inputTextDelta });
    return;
  }
  if (chunk.type === 'tool-input-end') {
    appendToolInputEnd(options.assistantMessage, chunk);
    await options.persistAssistant();
    return;
  }
  if (chunk.type === 'tool-call') {
    appendToolCall(options.assistantMessage, chunk, findRendererHistory(options.runtime.capabilities, chunk.toolName));
    options.applyPendingActivity(chunk.toolCallId);
    const completedCall = inheritToolMetadata(options.assistantMessage, chunk);
    getObservedTool(observation.observedTools, chunk.toolCallId).calls.push(completedCall);
    const { currentToolStep } = options.runtime;
    if (!currentToolStep) throw createAIServiceError(AI_ERROR_CODE.INVALID_REQUEST, 'Runtime 工具步骤未初始化');
    currentToolStep.toolCalls.push({ toolName: chunk.toolName, input: chunk.input });
    if (isDeferredToolName(chunk.toolName)) options.deferredToolCallIds.add(chunk.toolCallId);
    await options.persistAssistant();
    return;
  }
  if (chunk.type === 'tool-result') {
    const definition = getObservedTool(observation.observedTools, chunk.toolCallId);
    definition.resultNames.push(chunk.toolName);
    definition.results.push(chunk);
    if (isDeferredToolName(chunk.toolName)) options.deferredToolCallIds.add(chunk.toolCallId);
    if (shouldStopStreamAfterToolResult(chunk.result) && observation.stoppedToolCallId === undefined) {
      observation.stoppedToolCallId = chunk.toolCallId;
    }
  }
}

/**
 * 把一个已审计 chunk 投影到工作 Assistant 和步骤事实。
 * @param context - 当前观察上下文
 * @param chunk - 已规范化 chunk
 * @returns 需要等待的结构检查点
 */
async function projectChunk(context: StreamObserverContext, chunk: RuntimeStreamChunk): Promise<void> {
  if (projectContentChunk(context, chunk) || projectStatusChunk(context, chunk)) return;
  await projectToolChunk(context, chunk);
}

/**
 * 消费 Provider 流并投影可见 chunk。
 * @param options - 流观察器依赖
 * @returns 后续协议分类和工具执行所需的步骤事实
 */
export async function observeRuntimeStream(options: RuntimeStreamObserverOptions): Promise<RuntimeStreamObservation> {
  const context: StreamObserverContext = {
    options,
    observation: { observedTools: new Map<string, ObservedToolDefinition>() },
    budget: { eventCount: 0, textBytes: 0, toolInputBytes: new Map<string, number>() },
    ...(options.forceFinal ? { finalTextFilter: createFinalTextFilter() } : {})
  };

  for await (const rawChunk of options.stream) {
    context.budget.eventCount += 1;
    if (context.budget.eventCount > STREAM_EVENT_LIMIT) {
      abortOversizedStream(
        context,
        AI_ERROR_CODE.STREAM_EVENT_LIMIT,
        `stream-event-limit:${context.budget.eventCount}`,
        `Provider 流事件数量超过安全上限：${context.budget.eventCount}`
      );
    }
    const chunk = toRuntimeStreamChunk(rawChunk);
    consumeChunkBudget(context, chunk);
    if (shouldSkipChunk(context.observation, chunk)) continue;
    // 语义边界必须与 Provider 流顺序一致。
    // eslint-disable-next-line no-await-in-loop
    await projectChunk(context, chunk);
  }

  if (context.finalTextFilter) {
    appendVisibleText(context, context.finalTextFilter.finish());
    await options.projection.checkpoint();
  }
  return context.observation;
}
