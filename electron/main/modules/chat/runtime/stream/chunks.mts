/**
 * @file stream/chunks.mts
 * @description AI SDK chunk 到 runtime chunk 的规范化。
 */
import type { RuntimeStreamChunk } from './types.mjs';
import type { TextStreamPart, ToolSet } from 'ai';
import type { AIToolExecutionResult } from 'types/ai';
import { normalizeAIUsage } from '../../../ai/usage.mjs';

/**
 * 判断值是否为对象记录。
 * @param value - 待判断值
 * @returns 是否为对象记录
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * 判断对象是否已经是规范化工具执行结果。
 * @param value - 待判断值
 * @returns 是否为工具执行结果
 */
function isToolExecutionResult(value: unknown): value is AIToolExecutionResult {
  return isRecord(value) && typeof value.toolName === 'string' && typeof value.status === 'string';
}

/**
 * 将 SDK 工具结果 chunk 规范化为应用工具结果。
 * @param toolName - 工具名称
 * @param output - SDK output 字段
 * @returns 工具执行结果
 */
export function normalizeToolResult(toolName: string, output: unknown): AIToolExecutionResult {
  if (isToolExecutionResult(output)) return output;

  return {
    toolName,
    status: 'success',
    data: output
  };
}

/**
 * 提取可安全展示的工具异常消息。
 * @param error - SDK 工具异常
 * @returns 稳定错误消息
 */
function readToolErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return '工具执行失败';
}

/**
 * 将 SDK 工具异常转换为稳定的应用工具失败结果。
 * @param toolName - 工具名称
 * @param error - SDK 工具异常
 * @returns 应用工具失败结果
 */
function normalizeToolError(toolName: string, error: unknown): AIToolExecutionResult {
  const message = readToolErrorMessage(error);
  return {
    toolName,
    status: 'failure',
    error: { code: 'EXECUTION_FAILED', message }
  };
}

/**
 * 创建工具审批拒绝结果。
 * @param toolName - 工具名称
 * @param reason - 可选拒绝原因
 * @returns 应用工具失败结果
 */
function normalizeToolDenied(toolName: string, reason?: string): AIToolExecutionResult {
  return {
    toolName,
    status: 'failure',
    error: { code: 'PERMISSION_DENIED', message: reason?.trim() || `工具 ${toolName} 的执行未获批准` }
  };
}

/**
 * 保证 AI SDK 事件联合在升级后仍被显式审计。
 * @param chunk - 理论上不可到达的事件
 * @returns 永不返回
 */
function assertNever(chunk: never): never {
  throw new Error(`未处理的 AI SDK 流事件: ${String((chunk as { type?: unknown }).type)}`);
}

/**
 * 将 AI SDK 7 chunk 规范化为 runtime 可消费 chunk。
 * @param chunk - AI SDK 7 完整流 chunk
 * @returns runtime chunk
 */
export function toRuntimeStreamChunk(chunk: TextStreamPart<ToolSet>): RuntimeStreamChunk {
  switch (chunk.type) {
    case 'text-delta':
      return { type: 'text-delta', text: chunk.text };
    case 'reasoning-delta':
      return { type: 'reasoning-delta', text: chunk.text };
    case 'error':
      return { type: 'error', error: chunk.error };
    case 'abort':
      return { type: 'abort', ...(chunk.reason ? { reason: chunk.reason } : {}) };
    case 'finish-step':
      return { type: 'finish-step', stepUsage: normalizeAIUsage(chunk.usage) };
    case 'finish':
      return {
        type: 'finish',
        finishReason: chunk.finishReason,
        totalUsage: normalizeAIUsage(chunk.totalUsage)
      };
    case 'tool-call':
      return {
        type: 'tool-call',
        toolCallId: chunk.toolCallId,
        toolName: chunk.toolName,
        input: chunk.input,
        ...(chunk.providerMetadata !== undefined ? { providerMetadata: chunk.providerMetadata } : {})
      };
    case 'tool-input-start':
      return {
        type: 'tool-input-start',
        toolCallId: chunk.id,
        toolName: chunk.toolName,
        ...(chunk.providerMetadata !== undefined ? { providerMetadata: chunk.providerMetadata } : {})
      };
    case 'tool-input-delta':
      return { type: 'tool-input-delta', toolCallId: chunk.id, inputTextDelta: chunk.delta };
    case 'tool-input-end':
      return { type: 'tool-input-end', toolCallId: chunk.id };
    case 'tool-result':
      return {
        type: 'tool-result',
        toolCallId: chunk.toolCallId,
        toolName: chunk.toolName,
        result: normalizeToolResult(chunk.toolName, chunk.output)
      };
    case 'tool-error':
      return {
        type: 'tool-result',
        toolCallId: chunk.toolCallId,
        toolName: chunk.toolName,
        result: normalizeToolError(chunk.toolName, chunk.error)
      };
    case 'tool-output-denied':
      return {
        type: 'tool-result',
        toolCallId: chunk.toolCallId,
        toolName: chunk.toolName,
        result: normalizeToolDenied(chunk.toolName)
      };
    case 'tool-approval-request':
      return chunk.isAutomatic
        ? { type: 'unsupported', sourceType: chunk.type }
        : { type: 'error', error: new Error(`工具 ${chunk.toolCall.toolName} 请求 SDK 审批，但当前 Runtime 未启用该审批通道`) };
    case 'tool-approval-response':
      return chunk.approved
        ? { type: 'unsupported', sourceType: chunk.type }
        : {
            type: 'tool-result',
            toolCallId: chunk.toolCall.toolCallId,
            toolName: chunk.toolCall.toolName,
            result: normalizeToolDenied(chunk.toolCall.toolName, chunk.reason)
          };
    case 'text-start':
    case 'text-end':
    case 'reasoning-start':
    case 'reasoning-end':
    case 'custom':
    case 'source':
    case 'file':
    case 'reasoning-file':
    case 'start-step':
    case 'start':
    case 'raw':
      return { type: 'unsupported', sourceType: chunk.type };
    default:
      return assertNever(chunk);
  }
}
