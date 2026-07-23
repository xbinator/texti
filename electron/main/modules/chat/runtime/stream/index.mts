/**
 * @file stream/index.mts
 * @description ChatRuntime 主进程模型流式执行器主循环与公共入口。
 */
import type { ChatRuntimeDeferredToolCall, ChatRuntimeStreamExecutor, ChatRuntimeStreamExecutorResult } from '../types.mjs';
import type { RuntimeStreamExecutorDependencies, RuntimeStreamText, RuntimeToolCallChunk, RuntimeToolResultChunk } from './types.mjs';
import type { AIUsage, AIToolExecutionResult } from 'types/ai';
import type { ChatMessageRecord, ChatMessageToolPart } from 'types/chat';
import { AI_ERROR_CODE, createAIServiceError } from '../../../ai/errors/codes.mjs';
import { AI_TASK_TIMEOUT_MS } from '../../../ai/tool-loop-policy.mjs';
import { toRuntimeStreamChunk } from './chunks.mjs';
import {
  createPersistableAssistant,
  createProtocolToolResult,
  getDeferredToolNames,
  hasExecutableMcp,
  hasExecutableTavily,
  isDeferredToolName,
  parseDeferredToolCall,
  scrubDeferredParts,
  type DeferredToolCallParseResult
} from './deferred-tools.mjs';
import { sanitizeFinalText } from './final-text.mjs';
import {
  appendReasoningDelta,
  appendTextDelta,
  appendToolCall,
  appendToolInputDelta,
  appendToolInputEnd,
  appendToolInputStart,
  appendToolResult,
  finishAssistantMessage
} from './message-parts.mjs';
import { createRuntimeStreamRequest } from './request.mjs';
import {
  createUnknownToolFailureResult,
  executeMainToolSafely,
  executeRendererToolSafely,
  isMainProcessTool,
  isRendererManagedTool,
  normalizeRendererToolTimeoutMs,
  normalizeRuntimeError,
  shouldContinueAfterToolResult,
  shouldStopStreamAfterToolResult
} from './tools.mjs';

export type { RuntimeStreamText, RuntimeStreamExecutorDependencies };

/** 同一 toolCallId 在 Provider 流中的全部定义观察。 */
interface ObservedToolDefinition {
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

/**
 * 读取或创建一个工具调用的定义观察记录。
 * @param definitions - 当前步骤全部观察记录
 * @param toolCallId - 工具调用 ID
 * @returns 可追加观察事实的记录
 */
function getObservedTool(definitions: Map<string, ObservedToolDefinition>, toolCallId: string): ObservedToolDefinition {
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
 * @param message - 当前 working assistant
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
 * 创建 ChatRuntime 模型流式执行器。
 * @param dependencies - 执行器依赖
 * @returns runtime 流式执行器
 */
export function createRuntimeStreamExecutor(dependencies: RuntimeStreamExecutorDependencies): ChatRuntimeStreamExecutor {
  return async (
    { runtime, sourceMessages, userMessage, assistantMessage, forceFinal = false, totalTimeoutMs = AI_TASK_TIMEOUT_MS },
    updateAssistant
  ): Promise<ChatRuntimeStreamExecutorResult> => {
    runtime.currentToolStep = { toolCalls: [] };
    const exposedDeferredToolNames = getDeferredToolNames(runtime.tools);
    if (exposedDeferredToolNames.size > 0 && (hasExecutableTavily(runtime.tavily) || hasExecutableMcp(runtime.mcp))) {
      throw createAIServiceError(AI_ERROR_CODE.INVALID_REQUEST, '延迟协调工具不能与 AI SDK 可执行的 Tavily 或 MCP 工具同时暴露');
    }
    const resolution = runtime.resolvedModel ?? (await dependencies.resolver.resolve(runtime.model));
    if (!resolution) {
      throw createAIServiceError(AI_ERROR_CODE.MODEL_NOT_FOUND, '没有可用的聊天模型');
    }
    // 冻结本次 Provider 实际使用的默认或显式模型，供 suspension prepare 构造不可变快照。
    runtime.resolvedModel = resolution;
    const [error, result] = await dependencies.streamText(
      resolution.createOptions,
      createRuntimeStreamRequest(resolution.modelId, runtime, userMessage, sourceMessages),
      { runtimeToolLoop: true, forceFinal, totalTimeoutMs }
    );
    if (error) {
      throw error;
    }
    if (!result) {
      throw createAIServiceError(AI_ERROR_CODE.REQUEST_FAILED, 'ChatRuntime 流式调用未返回结果');
    }

    let stepUsage: AIUsage | undefined;
    let totalUsage: AIUsage | undefined;
    let finishReason: import('types/ai').AIStreamFinishReason | undefined;
    let executedToolCount = 0;
    let allToolsContinueable = true;
    let anyToolStopped = false;
    let isWaitingForUserInput = false;
    let finalTextBuffer = '';
    const deferredToolCallIds = new Set<string>();
    const observedTools = new Map<string, ObservedToolDefinition>();
    let stoppedToolCallId: string | undefined;
    const runtimeToolTimeoutMs = Math.min(normalizeRendererToolTimeoutMs(dependencies.rendererToolTimeoutMs), totalTimeoutMs);

    /**
     * 仅持久化尚未提交的延迟工具片段之外的 assistant 快照。
     * @returns 持久化操作完成
     */
    async function persistAssistant(): Promise<void> {
      await updateAssistant(createPersistableAssistant(assistantMessage, deferredToolCallIds));
    }

    /**
     * 将一个工具结果投影到工作消息和当前步骤统计。
     * @param toolCallId - 工具调用 ID
     * @param toolName - 工具名称
     * @param toolResult - 规范化工具结果
     */
    function applyToolResult(toolCallId: string, toolName: string, toolResult: AIToolExecutionResult): void {
      appendToolResult(assistantMessage, {
        type: 'tool-result',
        toolCallId,
        toolName,
        result: toolResult
      });
      executedToolCount += 1;
      allToolsContinueable = allToolsContinueable && shouldContinueAfterToolResult(toolResult);
      anyToolStopped = anyToolStopped || shouldStopStreamAfterToolResult(toolResult);
      isWaitingForUserInput = isWaitingForUserInput || toolResult.status === 'awaiting_user_input';
      assistantMessage.loading = toolResult.status === 'awaiting_user_input';
      assistantMessage.finished = false;
    }

    for await (const rawChunk of result.stream) {
      const chunk = toRuntimeStreamChunk(rawChunk);
      if (
        stoppedToolCallId !== undefined &&
        (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta' || chunk.type === 'error' || chunk.type === 'abort')
      ) {
        // Provider 已给出权威停止结果后只继续审计工具定义事实，晚到内容与终止噪声不能覆盖停止语义。
        continue;
      }

      if (chunk.type === 'text-delta') {
        if (forceFinal) {
          // 收口调用先完整缓冲，避免跨 chunk 的协议标记在流式 UI 中短暂泄漏。
          finalTextBuffer += chunk.text;
          continue;
        }
        appendTextDelta(assistantMessage, chunk.text);
        await persistAssistant();
      } else if (chunk.type === 'reasoning-delta') {
        appendReasoningDelta(assistantMessage, chunk.text);
        await persistAssistant();
      } else if (chunk.type === 'finish-step') {
        stepUsage = chunk.stepUsage;
      } else if (chunk.type === 'finish') {
        finishReason = chunk.finishReason;
        totalUsage = chunk.totalUsage;
      } else if (chunk.type === 'error') {
        throw normalizeRuntimeError(chunk.error);
      } else if (chunk.type === 'abort') {
        throw createAIServiceError(AI_ERROR_CODE.REQUEST_FAILED, chunk.reason?.trim() || '模型流已中止');
      } else if (chunk.type === 'tool-input-start') {
        getObservedTool(observedTools, chunk.toolCallId).startNames.push(chunk.toolName);
        if (isDeferredToolName(chunk.toolName)) {
          deferredToolCallIds.add(chunk.toolCallId);
        }
        appendToolInputStart(assistantMessage, chunk);
        await persistAssistant();
      } else if (chunk.type === 'tool-input-delta') {
        appendToolInputDelta(assistantMessage, chunk);
        await persistAssistant();
      } else if (chunk.type === 'tool-input-end') {
        appendToolInputEnd(assistantMessage, chunk);
        await persistAssistant();
      } else if (chunk.type === 'tool-call') {
        appendToolCall(assistantMessage, chunk);
        const completedCall = inheritToolMetadata(assistantMessage, chunk);
        getObservedTool(observedTools, chunk.toolCallId).calls.push(completedCall);
        runtime.currentToolStep.toolCalls.push({ toolName: chunk.toolName, input: chunk.input });
        if (isDeferredToolName(chunk.toolName)) {
          deferredToolCallIds.add(chunk.toolCallId);
        }
        await persistAssistant();
      } else if (chunk.type === 'tool-result') {
        const definition = getObservedTool(observedTools, chunk.toolCallId);
        definition.resultNames.push(chunk.toolName);
        definition.results.push(chunk);
        if (isDeferredToolName(chunk.toolName)) {
          deferredToolCallIds.add(chunk.toolCallId);
        }
        if (shouldStopStreamAfterToolResult(chunk.result) && stoppedToolCallId === undefined) {
          stoppedToolCallId = chunk.toolCallId;
        }
      }
    }

    if (forceFinal && finalTextBuffer) {
      appendTextDelta(assistantMessage, sanitizeFinalText(finalTextBuffer));
      await persistAssistant();
    }

    const observedDefinitions = [...observedTools.values()];
    const observedNames = observedDefinitions.flatMap((definition): string[] => [
      ...definition.startNames,
      ...definition.calls.map((call): string => call.toolName)
    ]);
    const completedToolCalls = observedDefinitions.flatMap((definition): RuntimeToolCallChunk[] => definition.calls);
    const hasUnexposedDeferredCalls = observedNames.some((toolName): boolean => isDeferredToolName(toolName) && !exposedDeferredToolNames.has(toolName));
    const hasDeferredCalls = observedNames.some((toolName): boolean => exposedDeferredToolNames.has(toolName));
    const hasDirectCalls = observedNames.some((toolName): boolean => !isDeferredToolName(toolName));
    const deferredResultDefinition = observedDefinitions.find(
      (definition): boolean =>
        definition.results.length > 0 &&
        [...definition.startNames, ...definition.calls.map((call): string => call.toolName), ...definition.resultNames].some((toolName): boolean =>
          exposedDeferredToolNames.has(toolName)
        )
    );
    let deferredToolCalls: ChatRuntimeDeferredToolCall[] = [];
    let delegationProtocolReason: string | undefined;
    const duplicatedDefinition = observedDefinitions.find(
      (definition): boolean => definition.startNames.length > 1 || definition.calls.length > 1 || definition.results.length > 1
    );
    const conflictingDefinition = observedDefinitions.find((definition): boolean => {
      const names = [...definition.startNames, ...definition.calls.map((call): string => call.toolName), ...definition.resultNames];
      return new Set(names).size > 1;
    });
    const incompleteDefinition = observedDefinitions.find((definition): boolean => definition.calls.length !== 1);
    if (duplicatedDefinition) {
      delegationProtocolReason = 'duplicate_tool_call_id';
    } else if (conflictingDefinition) {
      delegationProtocolReason = 'tool_definition_conflict';
    } else if (hasUnexposedDeferredCalls) {
      delegationProtocolReason = 'deferred_tool_not_exposed';
    } else if (hasDeferredCalls && hasDirectCalls) {
      delegationProtocolReason = 'mixed_execution_classes';
    } else if (incompleteDefinition) {
      delegationProtocolReason = 'incomplete_tool_definition';
    } else if (deferredResultDefinition) {
      delegationProtocolReason = 'deferred_provider_result_forbidden';
    } else if (hasDeferredCalls) {
      const parsedCalls = completedToolCalls.map((call): DeferredToolCallParseResult => parseDeferredToolCall(call, exposedDeferredToolNames));
      const invalidCall = parsedCalls.find((call): boolean => !call.ok);
      if (invalidCall && !invalidCall.ok) {
        delegationProtocolReason = invalidCall.error.details?.reason?.toString() ?? 'delegation_contract_invalid';
      } else {
        deferredToolCalls = parsedCalls.flatMap((call): ChatRuntimeDeferredToolCall[] => (call.ok ? [call.toolCall] : []));
      }
    }

    if (delegationProtocolReason) {
      // 只有完成整个步骤分类后才暴露协议错误，保证此前不会发生 main/renderer 副作用。
      for (const definition of observedDefinitions) {
        const toolName = definition.calls.at(-1)?.toolName ?? definition.startNames.at(-1) ?? definition.resultNames.at(-1) ?? 'unknown_tool';
        applyToolResult(definition.toolCallId, toolName, createProtocolToolResult(toolName, delegationProtocolReason));
      }
      scrubDeferredParts(assistantMessage, deferredToolCallIds);
      if (!deferredResultDefinition) {
        deferredToolCallIds.clear();
      }
      if (deferredResultDefinition) {
        // 含 deferred Provider result 的非法步骤不进入续轮，工作消息仅保留诊断，持久化仍走过滤快照。
        finishReason = undefined;
      }
      await persistAssistant();
    } else if (deferredToolCalls.length > 0) {
      const usageResult = {
        ...(stepUsage ? { stepUsage } : {}),
        ...(totalUsage ? { totalUsage } : {})
      };
      return {
        ...usageResult,
        shouldContinue: false,
        suspension: { toolCalls: deferredToolCalls }
      };
    } else {
      const providerStopIndex = stoppedToolCallId ? completedToolCalls.findIndex((call): boolean => call.toolCallId === stoppedToolCallId) : -1;
      const directCallLimit = providerStopIndex >= 0 ? providerStopIndex : completedToolCalls.length - 1;
      for (let index = 0; index <= directCallLimit; index += 1) {
        const call = completedToolCalls[index];
        const currentPart = assistantMessage.parts.find((part): boolean => part.type === 'tool' && part.toolCallId === call.toolCallId);
        if (currentPart?.type === 'tool' && currentPart.status === 'done') continue;

        const toolExecutionInput = {
          runtime,
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          input: call.input
        };
        const providerResult = observedTools.get(call.toolCallId)?.results[0];
        let toolResult: AIToolExecutionResult | undefined = providerResult?.result;
        if (!providerResult && dependencies.executeMainTool && isMainProcessTool(call.toolName)) {
          // eslint-disable-next-line no-await-in-loop
          toolResult = await executeMainToolSafely(dependencies.executeMainTool, toolExecutionInput, runtimeToolTimeoutMs);
        } else if (!providerResult && dependencies.executeRendererTool && isRendererManagedTool(runtime, call.toolName)) {
          // eslint-disable-next-line no-await-in-loop
          toolResult = await executeRendererToolSafely(dependencies.executeRendererTool, toolExecutionInput, runtimeToolTimeoutMs);
        }
        if (!toolResult) continue;

        applyToolResult(call.toolCallId, providerResult?.toolName ?? call.toolName, toolResult);
        // eslint-disable-next-line no-await-in-loop
        await persistAssistant();
        if (!anyToolStopped) continue;

        // 保持既有“停止后不消费后续调用”投影，虽然 Provider 定义已被完整读取以完成安全分类。
        const skippedIds = new Set(completedToolCalls.slice(index + 1).map((pendingCall): string => pendingCall.toolCallId));
        assistantMessage.parts = assistantMessage.parts.filter((part): boolean => part.type !== 'tool' || !skippedIds.has(part.toolCallId));
        runtime.currentToolStep.toolCalls = runtime.currentToolStep.toolCalls.slice(0, index + 1);
        stepUsage = undefined;
        totalUsage = undefined;
        finishReason = undefined;
        // eslint-disable-next-line no-await-in-loop
        await persistAssistant();
        break;
      }
      if (providerStopIndex >= 0) {
        // Provider 已给出停止结果时，后续定义只参与安全分类，不进入 Runtime 执行。
        const skippedIds = new Set(completedToolCalls.slice(providerStopIndex + 1).map((pendingCall): string => pendingCall.toolCallId));
        assistantMessage.parts = assistantMessage.parts.filter((part): boolean => part.type !== 'tool' || !skippedIds.has(part.toolCallId));
        runtime.currentToolStep.toolCalls = runtime.currentToolStep.toolCalls.slice(0, providerStopIndex + 1);
        stepUsage = undefined;
        totalUsage = undefined;
        finishReason = undefined;
        await persistAssistant();
      }
    }

    // 流结束时仍未收到 tool-result 的 tool-call，按未注册工具兜底失败，
    // 避免 UI 长期处于 executing 状态。
    let finalizedUnknownTool = false;
    for (const part of assistantMessage.parts) {
      if (part.type !== 'tool' || part.status !== 'executing' || deferredToolCallIds.has(part.toolCallId)) continue;

      applyToolResult(part.toolCallId, part.toolName, createUnknownToolFailureResult(part.toolName));
      finalizedUnknownTool = true;
    }
    if (finalizedUnknownTool) {
      await persistAssistant();
    }

    const shouldContinue = executedToolCount > 0 && allToolsContinueable && finishReason === 'tool-calls';
    const usageResult = {
      ...(stepUsage ? { stepUsage } : {}),
      ...(totalUsage ? { totalUsage } : {})
    };
    if (shouldContinue) return { ...usageResult, shouldContinue };
    if (isWaitingForUserInput) return usageResult;

    if (assistantMessage.finished !== true) {
      finishAssistantMessage(assistantMessage, totalUsage);
      await persistAssistant();
    }

    return usageResult;
  };
}
