/**
 * @file stream.ts
 * @description AI 工具流式执行相关函数
 */
import type { JSONValue, ModelMessage } from 'ai';
import type { AIToolContext, AIToolExecutionResult, AIToolExecutor, AIStreamToolCallChunk, AITransportTool } from 'types/ai';
import { createToolFailureResult } from './results';

/**
 * 已执行的工具调用
 * @description 包含工具调用 ID、名称、输入和执行结果
 */
export interface ExecutedToolCall {
  /** 工具调用 ID */
  toolCallId: string;
  /** 工具名称 */
  toolName: string;
  /** 工具输入参数 */
  input: unknown;
  /** 执行结果 */
  result: AIToolExecutionResult;
}

/**
 * 将任意值转换为 JSON 可序列化的值
 * @param value - 任意值
 * @returns JSON 值
 * @description Tool result parts in the AI SDK only accept JSON-serializable payloads
 */
function toJsonValue(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}

/**
 * 为等待用户输入的工具结果补齐真实 toolCallId。
 * @param result - 原始工具执行结果
 * @param toolCallId - AI SDK 工具调用 ID
 * @returns 补齐关联 ID 后的工具结果
 */
function attachToolCallIdToAwaitingResult(result: AIToolExecutionResult, toolCallId: string): AIToolExecutionResult {
  if (result.status !== 'awaiting_user_input') {
    return result;
  }

  return {
    ...result,
    data: {
      ...result.data,
      toolCallId
    }
  };
}

/**
 * 将工具执行器列表转换为传输格式
 * @param tools - 工具执行器列表
 * @returns 传输格式的工具列表
 */
export function toTransportTools(tools: AIToolExecutor[]): AITransportTool[] {
  return tools.map((item) => ({
    name: item.definition.name,
    description: item.definition.description,
    parameters: item.definition.parameters
  }));
}

/**
 * 执行工具调用
 * @param call - 工具调用数据块
 * @param tools - 可用工具列表
 * @param context - 编辑器上下文
 * @returns 执行结果
 */
export async function executeToolCall(call: AIStreamToolCallChunk, tools: AIToolExecutor[], context: AIToolContext | undefined): Promise<ExecutedToolCall> {
  // 查找对应的工具执行器
  const executor = tools.find((item) => item.definition.name === call.toolName);

  if (!executor) {
    return {
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      input: call.input,
      result: createToolFailureResult(call.toolName, 'TOOL_NOT_FOUND', `未找到工具：${call.toolName}`)
    };
  }

  // 检查上下文是否可用
  if (!context) {
    return {
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      input: call.input,
      result: createToolFailureResult(call.toolName, 'NO_ACTIVE_DOCUMENT', '当前没有可用的编辑器文档')
    };
  }

  // 执行工具，等待用户输入结果仍作为普通终态 tool-result 进入消息历史。
  const rawResult = await executor.execute(call.input, context);

  return {
    toolCallId: call.toolCallId,
    toolName: call.toolName,
    input: call.input,
    result: attachToolCallIdToAwaitingResult(rawResult, call.toolCallId)
  };
}

/**
 * 创建工具结果消息
 * @param results - 已执行的工具调用列表
 * @returns AI SDK 兼容的消息格式
 */
export function createToolResultMessages(results: ExecutedToolCall[]): ModelMessage[] {
  return results.map((item) => ({
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolCallId: item.toolCallId,
        toolName: item.toolName,
        output: {
          type: 'json',
          value: toJsonValue(item.result)
        }
      }
    ]
  }));
}
