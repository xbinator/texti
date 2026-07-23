/**
 * @file stream/types.mts
 * @description ChatRuntime 流式执行器内部类型。
 */
import type { ChatModelResolver } from '../model/resolver.mjs';
import type { ChatRuntimeMainToolExecutor, ChatRuntimeRendererToolExecutor } from '../types.mjs';
import type { AIRequestOptions, AIServiceError, AIStreamFinishReason, AIStreamResult, AIUsage, AIToolExecutionResult } from 'types/ai';

/** ChatRuntime 传给 AI 服务的内部调用策略。 */
export interface RuntimeStreamCallOptions {
  /** 工具续轮固定由 ChatRuntime 托管。 */
  runtimeToolLoop: true;
  /** 是否强制本次调用只生成最终回答。 */
  forceFinal: boolean;
  /** 当前用户任务剩余的总超时时间。 */
  totalTimeoutMs: number;
}

/** Runtime 模型流式调用函数。 */
export type RuntimeStreamText = (
  createOptions: NonNullable<Awaited<ReturnType<ChatModelResolver['resolve']>>>['createOptions'],
  request: AIRequestOptions,
  callOptions: RuntimeStreamCallOptions
) => Promise<[AIServiceError] | [undefined, AIStreamResult]>;

/** Runtime 流式执行器依赖。 */
export interface RuntimeStreamExecutorDependencies {
  /** 聊天模型解析器。 */
  resolver: ChatModelResolver;
  /** 模型流式调用函数。 */
  streamText: RuntimeStreamText;
  /** Renderer 本地工具执行函数。 */
  executeRendererTool?: ChatRuntimeRendererToolExecutor;
  /** 主进程工具执行函数。 */
  executeMainTool?: ChatRuntimeMainToolExecutor;
  /** Renderer 本地工具超时时间。 */
  rendererToolTimeoutMs?: number;
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
