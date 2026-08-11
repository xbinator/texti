/**
 * @file tool-step.mts
 * @description 对完整 Provider 工具事实先分类，再按安全优先级执行直接工具。
 */
import type { ObservedToolDefinition } from './observer.mjs';
import type { RuntimeMainToolObserver, RuntimeToolGuard, RuntimeToolGuardSource } from './types.mjs';
import type { ToolWatchdogLease } from '../controllers/tool-watchdog.mjs';
import type { ActiveChatRuntime, ChatRuntimeDeferredToolCall, ChatRuntimeMainToolExecutor, ChatRuntimeRendererToolExecutor } from '../types.mjs';
import type { AIToolExecutionResult } from 'types/ai';
import type { ChatMessageRecord } from 'types/chat';
import {
  createProtocolToolResult,
  isDeferredToolName,
  parseDeferredToolCall,
  scrubDeferredParts,
  type DeferredToolCallParseResult
} from './deferred-tools.mjs';
import { appendToolResult, findRendererHistory } from './message-parts.mjs';
import {
  createToolFailureResultFromError,
  createUnknownToolFailureResult,
  executeMainToolSafely,
  executeRendererToolSafely,
  isMainProcessTool,
  isRendererManagedTool,
  shouldContinueAfterToolResult,
  shouldStopStreamAfterToolResult
} from './tools.mjs';

/** 工具步骤纯分类输入。 */
export interface ToolStepClassificationInput {
  /** Provider 流中的全部工具事实。 */
  observedTools: Map<string, ObservedToolDefinition>;
  /** 当前 Runtime 真正暴露的延迟工具名称。 */
  exposedDeferredToolNames: Set<string>;
}

/** 整步工具事实的无副作用分类结果。 */
export interface ToolStepClassification {
  /** 按 Provider 首次出现顺序排列的定义。 */
  definitions: ObservedToolDefinition[];
  /** 可执行的完整工具调用。 */
  completedToolCalls: ObservedToolDefinition['calls'];
  /** 通过契约验证的延迟调用。 */
  deferredToolCalls: ChatRuntimeDeferredToolCall[];
  /** 第一个稳定协议失败原因。 */
  protocolReason?: string;
  /** 违规携带 Provider 结果的延迟工具定义。 */
  deferredResultDefinition?: ObservedToolDefinition;
}

/** 工具执行阶段使用的最小依赖。 */
export interface RuntimeToolStepDependencies {
  /** Renderer 工具执行函数。 */
  executeRendererTool?: ChatRuntimeRendererToolExecutor;
  /** 主进程工具执行函数。 */
  executeMainTool?: ChatRuntimeMainToolExecutor;
  /** 主进程工具结果观察器。 */
  observeMainTool?: RuntimeMainToolObserver;
  /** 所有工具副作用之前的强制授权钩子。 */
  guardToolCall?: RuntimeToolGuard;
}

/** 工具步骤执行输入。 */
export interface ToolStepExecutionInput {
  /** 当前 Runtime。 */
  runtime: ActiveChatRuntime;
  /** 当前工作 Assistant。 */
  assistantMessage: ChatMessageRecord;
  /** 已完成的纯分类结果。 */
  classification: ToolStepClassification;
  /** 当前步骤已观察到的延迟调用 ID。 */
  deferredToolCallIds: Set<string>;
  /** 第一个要求停止当前流的 Provider 工具调用 ID。 */
  stoppedToolCallId?: string;
  /** 工具执行依赖。 */
  dependencies: RuntimeToolStepDependencies;
  /** 启动工具 Watchdog 租约。 */
  startToolLease: (toolCallId: string, toolName: string) => ToolWatchdogLease;
  /** 立即投影最新完整 Assistant。 */
  persistAssistant: () => Promise<void>;
}

/** 工具步骤执行结果。 */
export interface RuntimeToolStepResult {
  /** 已投影的工具结果数量。 */
  executedToolCount: number;
  /** 所有工具结果是否允许模型续轮。 */
  allToolsContinueable: boolean;
  /** 是否需要等待用户输入。 */
  isWaitingForUserInput: boolean;
  /** 是否废弃 usage 和 finish reason。 */
  discardUsage: boolean;
  /** 是否只废弃 finish reason。 */
  discardFinishReason: boolean;
  /** 需要交给 Runtime suspension 的延迟调用。 */
  suspensionToolCalls?: ChatRuntimeDeferredToolCall[];
}

/** 工具结果投影期间的累计状态。 */
interface ToolResultState {
  /** 已投影结果数。 */
  executedToolCount: number;
  /** 是否全部可续轮。 */
  allToolsContinueable: boolean;
  /** 是否已观察停止结果。 */
  anyToolStopped: boolean;
  /** 是否等待用户输入。 */
  isWaitingForUserInput: boolean;
}

/**
 * 读取一个定义中所有已观察工具名称。
 * @param definition - Provider 工具事实
 * @returns 按阶段排列的名称
 */
function getDefinitionNames(definition: ObservedToolDefinition): string[] {
  return [...definition.startNames, ...definition.calls.map((call): string => call.toolName), ...definition.resultNames];
}

/** 工具定义协议检查事实。 */
interface ToolProtocolFacts {
  /** 是否存在重复 ID 定义。 */
  duplicated: boolean;
  /** 是否存在名称冲突。 */
  conflicting: boolean;
  /** 是否观察到未暴露的延迟工具。 */
  hasUnexposedDeferred: boolean;
  /** 是否观察到延迟工具。 */
  hasDeferred: boolean;
  /** 是否观察到直接工具。 */
  hasDirect: boolean;
  /** 是否存在不完整定义。 */
  incomplete: boolean;
  /** 违规携带 Provider 结果的延迟定义。 */
  deferredResultDefinition?: ObservedToolDefinition;
}

/**
 * 按稳定优先级返回第一个工具协议失败。
 * @param facts - 完整工具定义事实
 * @returns 稳定错误原因；协议合法时返回 undefined
 */
function getProtocolReason(facts: ToolProtocolFacts): string | undefined {
  if (facts.duplicated) return 'duplicate_tool_call_id';
  if (facts.conflicting) return 'tool_definition_conflict';
  if (facts.hasUnexposedDeferred) return 'deferred_tool_not_exposed';
  if (facts.hasDeferred && facts.hasDirect) return 'mixed_execution_classes';
  if (facts.incomplete) return 'incomplete_tool_definition';
  if (facts.deferredResultDefinition) return 'deferred_provider_result_forbidden';
  return undefined;
}

/**
 * 解析并验证完整延迟工具调用。
 * @param calls - Provider 完整调用
 * @param exposedNames - Runtime 暴露的延迟工具
 * @returns 延迟调用或契约失败原因
 */
function parseDeferredCalls(
  calls: ObservedToolDefinition['calls'],
  exposedNames: Set<string>
): { toolCalls: ChatRuntimeDeferredToolCall[]; protocolReason?: string } {
  const parsedCalls = calls.map((call): DeferredToolCallParseResult => parseDeferredToolCall(call, exposedNames));
  const invalidCall = parsedCalls.find((call): boolean => !call.ok);
  if (invalidCall && !invalidCall.ok) {
    return { toolCalls: [], protocolReason: invalidCall.error.details?.reason?.toString() ?? 'delegation_contract_invalid' };
  }
  return { toolCalls: parsedCalls.flatMap((call): ChatRuntimeDeferredToolCall[] => (call.ok ? [call.toolCall] : [])) };
}

/**
 * 对完整 Provider 工具事实做无副作用分类。
 * @param input - 观察事实与 Runtime 暴露集
 * @returns 协议错误、延迟调用或直接调用分类
 */
export function classifyToolStep(input: ToolStepClassificationInput): ToolStepClassification {
  const definitions = [...input.observedTools.values()];
  const observedNames = definitions.flatMap((definition): string[] => [...definition.startNames, ...definition.calls.map((call): string => call.toolName)]);
  const completedToolCalls = definitions.flatMap((definition): ObservedToolDefinition['calls'] => definition.calls);
  const hasUnexposedDeferredCalls = observedNames.some((toolName): boolean => isDeferredToolName(toolName) && !input.exposedDeferredToolNames.has(toolName));
  const hasDeferredCalls = observedNames.some((toolName): boolean => input.exposedDeferredToolNames.has(toolName));
  const hasDirectCalls = observedNames.some((toolName): boolean => !isDeferredToolName(toolName));
  const deferredResultDefinition = definitions.find(
    (definition): boolean =>
      definition.results.length > 0 && getDefinitionNames(definition).some((toolName): boolean => input.exposedDeferredToolNames.has(toolName))
  );
  const protocolReason = getProtocolReason({
    duplicated: definitions.some((definition): boolean => definition.startNames.length > 1 || definition.calls.length > 1 || definition.results.length > 1),
    conflicting: definitions.some((definition): boolean => new Set(getDefinitionNames(definition)).size > 1),
    hasUnexposedDeferred: hasUnexposedDeferredCalls,
    hasDeferred: hasDeferredCalls,
    hasDirect: hasDirectCalls,
    incomplete: definitions.some((definition): boolean => definition.calls.length !== 1),
    ...(deferredResultDefinition ? { deferredResultDefinition } : {})
  });
  const deferredResult = !protocolReason && hasDeferredCalls ? parseDeferredCalls(completedToolCalls, input.exposedDeferredToolNames) : { toolCalls: [] };

  return {
    definitions,
    completedToolCalls,
    deferredToolCalls: deferredResult.toolCalls,
    ...(protocolReason ?? deferredResult.protocolReason ? { protocolReason: protocolReason ?? deferredResult.protocolReason } : {}),
    ...(deferredResultDefinition ? { deferredResultDefinition } : {})
  };
}

/**
 * 创建空的工具结果统计。
 * @returns 当前步骤统计初值
 */
function createResultState(): ToolResultState {
  return {
    executedToolCount: 0,
    allToolsContinueable: true,
    anyToolStopped: false,
    isWaitingForUserInput: false
  };
}

/**
 * 投影一个规范化工具结果并更新步骤统计。
 * @param input - 工具步骤输入
 * @param state - 结果统计
 * @param toolCallId - 工具调用 ID
 * @param toolName - 权威工具名称
 * @param toolResult - 规范化结果
 */
function applyToolResult(input: ToolStepExecutionInput, state: ToolResultState, toolCallId: string, toolName: string, toolResult: AIToolExecutionResult): void {
  appendToolResult(
    input.assistantMessage,
    { type: 'tool-result', toolCallId, toolName, result: toolResult },
    findRendererHistory(input.runtime.capabilities, toolName)
  );
  state.executedToolCount += 1;
  state.allToolsContinueable = state.allToolsContinueable && shouldContinueAfterToolResult(toolResult);
  state.anyToolStopped = state.anyToolStopped || shouldStopStreamAfterToolResult(toolResult);
  state.isWaitingForUserInput = state.isWaitingForUserInput || toolResult.status === 'awaiting_user_input';
  input.assistantMessage.loading = toolResult.status === 'awaiting_user_input';
  input.assistantMessage.finished = false;
}

/**
 * 确定工具 guard 需要审计的结果来源。
 * @param input - 工具步骤输入
 * @param definition - 当前工具事实
 * @returns Provider、Main、Renderer 或 unknown
 */
function getToolSource(input: ToolStepExecutionInput, definition: ObservedToolDefinition): RuntimeToolGuardSource {
  const call = definition.calls[0];
  if (definition.results[0]) return 'provider';
  if (input.dependencies.executeMainTool && isMainProcessTool(call.toolName)) return 'main';
  if (input.dependencies.executeRendererTool && isRendererManagedTool(input.runtime, call.toolName)) return 'renderer';
  return 'unknown';
}

/**
 * 按 guard、Provider、Main、Renderer 的严格优先级解析工具结果。
 * @param input - 工具步骤输入
 * @param definition - 当前工具事实
 * @returns 可投影结果；无执行器时返回 undefined
 */
async function resolveToolResult(input: ToolStepExecutionInput, definition: ObservedToolDefinition): Promise<AIToolExecutionResult | undefined> {
  const call = definition.calls[0];
  const executionInput = {
    runtime: input.runtime,
    toolCallId: call.toolCallId,
    toolName: call.toolName,
    input: call.input
  };
  if (input.dependencies.guardToolCall) {
    const source = getToolSource(input, definition);
    const [guardResult] = await Promise.allSettled([input.dependencies.guardToolCall({ ...executionInput, source })]);
    const guarded = guardResult.status === 'fulfilled' ? guardResult.value ?? undefined : createToolFailureResultFromError(call.toolName, guardResult.reason);
    if (guarded) return guarded;
  }

  const providerResult = definition.results[0];
  if (providerResult) return providerResult.result;
  if (input.dependencies.executeMainTool && isMainProcessTool(call.toolName)) {
    const lease = input.startToolLease(call.toolCallId, call.toolName);
    const toolResult = await executeMainToolSafely(input.dependencies.executeMainTool, executionInput, lease);
    await input.dependencies.observeMainTool?.({
      runtime: input.runtime,
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      result: toolResult
    });
    return toolResult;
  }
  if (input.dependencies.executeRendererTool && isRendererManagedTool(input.runtime, call.toolName)) {
    const lease = input.startToolLease(call.toolCallId, call.toolName);
    return executeRendererToolSafely(input.dependencies.executeRendererTool, executionInput, lease);
  }
  return undefined;
}

/**
 * 从工作消息和 Runtime 步骤中剔除停止位置之后的工具调用。
 * @param input - 工具步骤输入
 * @param startIndex - 第一个应剔除的完整调用下标
 */
function pruneToolCalls(input: ToolStepExecutionInput, startIndex: number): void {
  const skippedIds = new Set(input.classification.completedToolCalls.slice(startIndex).map((pendingCall): string => pendingCall.toolCallId));
  input.assistantMessage.parts = input.assistantMessage.parts.filter((part): boolean => part.type !== 'tool' || !skippedIds.has(part.toolCallId));
  const { currentToolStep } = input.runtime;
  if (currentToolStep) currentToolStep.toolCalls = currentToolStep.toolCalls.slice(0, startIndex);
}

/**
 * 把流结束时仍无结果的直接工具收口为未注册失败。
 * @param input - 工具步骤输入
 * @param state - 结果统计
 * @returns 是否产生了新结果
 */
function finalizeUnknownTools(input: ToolStepExecutionInput, state: ToolResultState): boolean {
  let finalized = false;
  for (const part of input.assistantMessage.parts) {
    if (part.type !== 'tool' || part.status !== 'executing' || input.deferredToolCallIds.has(part.toolCallId)) continue;
    applyToolResult(input, state, part.toolCallId, part.toolName, createUnknownToolFailureResult(part.toolName));
    finalized = true;
  }
  return finalized;
}

/**
 * 将内部结果统计转换为公开步骤结果。
 * @param state - 结果统计
 * @param flags - usage、finish reason 与 suspension 标志
 * @returns 编排层可直接消费的步骤结果
 */
function createStepResult(
  state: ToolResultState,
  flags: Pick<RuntimeToolStepResult, 'discardUsage' | 'discardFinishReason' | 'suspensionToolCalls'>
): RuntimeToolStepResult {
  return {
    executedToolCount: state.executedToolCount,
    allToolsContinueable: state.allToolsContinueable,
    isWaitingForUserInput: state.isWaitingForUserInput,
    discardUsage: flags.discardUsage,
    discardFinishReason: flags.discardFinishReason,
    ...(flags.suspensionToolCalls ? { suspensionToolCalls: flags.suspensionToolCalls } : {})
  };
}

/**
 * 将协议失败投影到所有已观察工具定义。
 * @param input - 工具步骤输入
 * @param state - 结果统计
 * @returns 协议失败收口结果
 */
async function executeProtocolStep(input: ToolStepExecutionInput, state: ToolResultState): Promise<RuntimeToolStepResult> {
  const { classification } = input;
  const protocolReason = classification.protocolReason ?? 'delegation_contract_invalid';
  for (const definition of classification.definitions) {
    const toolName = definition.calls.at(-1)?.toolName ?? definition.startNames.at(-1) ?? definition.resultNames.at(-1) ?? 'unknown_tool';
    applyToolResult(input, state, definition.toolCallId, toolName, createProtocolToolResult(toolName, protocolReason));
  }
  scrubDeferredParts(input.assistantMessage, input.deferredToolCallIds);
  if (!classification.deferredResultDefinition) input.deferredToolCallIds.clear();
  await input.persistAssistant();
  if (finalizeUnknownTools(input, state)) await input.persistAssistant();
  return createStepResult(state, {
    discardUsage: false,
    discardFinishReason: classification.deferredResultDefinition !== undefined,
    suspensionToolCalls: undefined
  });
}

/**
 * 按 Provider 定义顺序执行所有可达直接工具。
 * @param input - 工具步骤输入
 * @param state - 结果统计
 * @returns 是否需要废弃 usage 和 finish reason
 */
async function executeDirectTools(input: ToolStepExecutionInput, state: ToolResultState): Promise<boolean> {
  const { classification } = input;
  const providerStopIndex = input.stoppedToolCallId
    ? classification.completedToolCalls.findIndex((call): boolean => call.toolCallId === input.stoppedToolCallId)
    : -1;
  const directCallLimit = providerStopIndex >= 0 ? providerStopIndex : classification.completedToolCalls.length - 1;
  let discardUsage = false;
  for (let index = 0; index <= directCallLimit; index += 1) {
    const call = classification.completedToolCalls[index];
    const currentPart = input.assistantMessage.parts.find((part): boolean => part.type === 'tool' && part.toolCallId === call.toolCallId);
    if (currentPart?.type === 'tool' && currentPart.status === 'done') continue;

    const definition = classification.definitions.find((candidate): boolean => candidate.toolCallId === call.toolCallId);
    if (!definition) continue;
    // 工具副作用必须按 Provider 定义顺序串行。
    // eslint-disable-next-line no-await-in-loop
    const toolResult = await resolveToolResult(input, definition);
    if (!toolResult) continue;

    const [providerResult] = definition.results;
    applyToolResult(input, state, call.toolCallId, providerResult?.toolName ?? call.toolName, toolResult);
    // eslint-disable-next-line no-await-in-loop
    await input.persistAssistant();
    if (!state.anyToolStopped) continue;

    pruneToolCalls(input, index + 1);
    discardUsage = true;
    // eslint-disable-next-line no-await-in-loop
    await input.persistAssistant();
    break;
  }

  if (providerStopIndex >= 0) {
    pruneToolCalls(input, providerStopIndex + 1);
    discardUsage = true;
    await input.persistAssistant();
  }
  if (finalizeUnknownTools(input, state)) await input.persistAssistant();
  return discardUsage;
}

/**
 * 执行已完成全步分类的工具事实。
 * @param input - 分类结果、Runtime、Assistant 与执行依赖
 * @returns 续轮、等待、usage 废弃与 suspension 事实
 */
export async function executeToolStep(input: ToolStepExecutionInput): Promise<RuntimeToolStepResult> {
  const state = createResultState();
  const { classification } = input;
  if (classification.protocolReason) return executeProtocolStep(input, state);

  if (classification.deferredToolCalls.length > 0) {
    return createStepResult(state, {
      discardUsage: false,
      discardFinishReason: false,
      suspensionToolCalls: classification.deferredToolCalls
    });
  }
  const discardUsage = await executeDirectTools(input, state);
  return createStepResult(state, {
    discardUsage,
    discardFinishReason: false,
    suspensionToolCalls: undefined
  });
}
