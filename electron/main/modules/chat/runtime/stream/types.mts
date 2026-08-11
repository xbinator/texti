/**
 * @file stream/types.mts
 * @description ChatRuntime 流式执行器内部类型。
 */
import type { ToolWatchdogLease, ToolWatchdogs } from '../controllers/tool-watchdog.mjs';
import type { ChatModelResolver } from '../model/resolver.mjs';
import type { ActiveChatRuntime, ChatRuntimeMainToolExecutor, ChatRuntimeRendererToolExecutor } from '../types.mjs';
import type { AIRequestOptions, AIServiceError, AIStreamFinishReason, AIStreamResult, AIUsage, AIToolExecutionResult } from 'types/ai';

/** AI SDK 可执行工具获取 Watchdog 租约的受限桥。 */
export interface RuntimeToolActivityBridge {
  /**
   * 启动当前 Runtime 内的工具租约。
   * @param toolCallId - 工具调用 ID
   * @param toolName - 工具名称
   * @returns Watchdog 租约
   */
  start(toolCallId: string, toolName: string): ToolWatchdogLease;
}

/** ChatRuntime 传给 AI 服务的内部调用策略。 */
export interface RuntimeStreamCallOptions {
  /** 工具续轮固定由 ChatRuntime 托管。 */
  runtimeToolLoop: true;
  /** 是否强制本次调用只生成最终回答。 */
  forceFinal: boolean;
  /** Runtime 工具活动桥，仅供 AI SDK 可执行工具使用。 */
  toolActivity?: RuntimeToolActivityBridge;
}

/** Runtime 模型流式调用函数。 */
export type RuntimeStreamText = (
  createOptions: NonNullable<Awaited<ReturnType<ChatModelResolver['resolve']>>>['createOptions'],
  request: AIRequestOptions,
  callOptions: RuntimeStreamCallOptions
) => Promise<[AIServiceError] | [undefined, AIStreamResult]>;

/** 工具结果或执行器的实际来源。 */
export type RuntimeToolGuardSource = 'provider' | 'main' | 'renderer' | 'unknown';

/** 强制工具授权钩子的最小输入。 */
export interface RuntimeToolGuardInput {
  /** 当前完整 Runtime 地址和易失状态。 */
  runtime: ActiveChatRuntime;
  /** Provider 工具调用 ID。 */
  toolCallId: string;
  /** Provider 工具名称。 */
  toolName: string;
  /** Provider 工具输入。 */
  input: unknown;
  /** 待接受结果或待调用 executor 的来源。 */
  source: RuntimeToolGuardSource;
}

/**
 * 强制工具授权函数。
 * null 表示允许继续；返回工具结果表示在任何副作用前拒绝。
 */
export type RuntimeToolGuard = (input: RuntimeToolGuardInput) => Promise<AIToolExecutionResult | null>;

/** 主进程工具安全执行后的规范化观察输入。 */
export interface RuntimeMainToolObservation {
  /** 执行工具的当前 Runtime。 */
  readonly runtime: ActiveChatRuntime;
  /** Provider 工具调用 ID。 */
  readonly toolCallId: string;
  /** 主进程工具名称。 */
  readonly toolName: string;
  /** 已完成异常与超时归一化的最终结果。 */
  readonly result: AIToolExecutionResult;
}

/** 主进程工具最终结果观察器。 */
export type RuntimeMainToolObserver = (input: RuntimeMainToolObservation) => Promise<void> | void;

/** Runtime 流式执行器依赖。 */
export interface RuntimeStreamExecutorDependencies {
  /** 聊天模型解析器。 */
  resolver: ChatModelResolver;
  /** 模型流式调用函数。 */
  streamText: RuntimeStreamText;
  /** 立即中止 AIService 中对应 requestId 的 Provider 流。 */
  abortStream?: (requestId: string) => void;
  /** Renderer 本地工具执行函数。 */
  executeRendererTool?: ChatRuntimeRendererToolExecutor;
  /** 主进程工具执行函数。 */
  executeMainTool?: ChatRuntimeMainToolExecutor;
  /** 主进程工具安全执行完成后的可选观察器。 */
  observeMainTool?: RuntimeMainToolObserver;
  /** Provider 结果或本地 executor 之前的强制授权钩子。 */
  guardToolCall?: RuntimeToolGuard;
  /** 当前 ChatRuntimeService 唯一的工具 Watchdog 注册表。 */
  toolWatchdogs?: ToolWatchdogs;
}

/** AI SDK 文本增量 chunk。 */
export interface RuntimeTextDeltaChunk {
  /** chunk 类型。 */
  type: 'text-delta';
  /** 文本增量。 */
  text: string;
}

/** AI SDK reasoning 增量 chunk。 */
export interface RuntimeReasoningDeltaChunk {
  /** chunk 类型。 */
  type: 'reasoning-delta';
  /** 思考增量。 */
  text: string;
}

/** AI SDK 错误 chunk。 */
export interface RuntimeErrorChunk {
  /** chunk 类型。 */
  type: 'error';
  /** 错误对象。 */
  error: unknown;
}

/** AI SDK 中止 chunk。 */
export interface RuntimeAbortChunk {
  /** chunk 类型。 */
  type: 'abort';
  /** SDK 提供的可选中止原因。 */
  reason?: string;
}

/** AI SDK 完成 chunk。 */
export interface RuntimeFinishChunk {
  /** chunk 类型。 */
  type: 'finish';
  /** 完成原因。 */
  finishReason: AIStreamFinishReason;
  /** 总 usage。 */
  totalUsage: AIUsage;
}

/** AI SDK 单步骤完成 chunk。 */
export interface RuntimeFinishStepChunk {
  /** chunk 类型。 */
  type: 'finish-step';
  /** 当前模型步骤的 usage。 */
  stepUsage: AIUsage;
}

/** AI SDK 工具调用 chunk。 */
export interface RuntimeToolCallChunk {
  /** chunk 类型。 */
  type: 'tool-call';
  /** 工具调用 ID。 */
  toolCallId: string;
  /** 工具名称。 */
  toolName: string;
  /** 工具输入。 */
  input: unknown;
  /** Provider 返回的工具调用元数据。 */
  providerMetadata?: unknown;
}

/** AI SDK 工具输入开始 chunk。 */
export interface RuntimeToolInputStartChunk {
  /** chunk 类型。 */
  type: 'tool-input-start';
  /** 工具调用 ID。 */
  toolCallId: string;
  /** 工具名称。 */
  toolName: string;
  /** Provider 返回的工具调用元数据。 */
  providerMetadata?: unknown;
}

/** AI SDK 工具输入增量 chunk。 */
export interface RuntimeToolInputDeltaChunk {
  /** chunk 类型。 */
  type: 'tool-input-delta';
  /** 工具调用 ID。 */
  toolCallId: string;
  /** 输入 JSON 文本增量。 */
  inputTextDelta: string;
}

/** AI SDK 工具输入结束 chunk。 */
export interface RuntimeToolInputEndChunk {
  /** chunk 类型。 */
  type: 'tool-input-end';
  /** 工具调用 ID。 */
  toolCallId: string;
}

/** AI SDK 工具结果 chunk。 */
export interface RuntimeToolResultChunk {
  /** chunk 类型。 */
  type: 'tool-result';
  /** 工具调用 ID。 */
  toolCallId: string;
  /** 工具名称。 */
  toolName: string;
  /** 规范化工具结果。 */
  result: AIToolExecutionResult;
}

/** Runtime 暂不处理的 AI stream chunk。 */
export interface RuntimeUnsupportedChunk {
  /** chunk 类型。 */
  type: 'unsupported';
  /** 已显式识别但暂不消费的 SDK 事件类型。 */
  sourceType: string;
}

/** Runtime 当前支持消费的 AI stream chunk。 */
export type RuntimeStreamChunk =
  | RuntimeTextDeltaChunk
  | RuntimeReasoningDeltaChunk
  | RuntimeErrorChunk
  | RuntimeAbortChunk
  | RuntimeFinishChunk
  | RuntimeFinishStepChunk
  | RuntimeToolCallChunk
  | RuntimeToolInputStartChunk
  | RuntimeToolInputDeltaChunk
  | RuntimeToolInputEndChunk
  | RuntimeToolResultChunk
  | RuntimeUnsupportedChunk;
