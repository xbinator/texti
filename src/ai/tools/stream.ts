/**
 * @file stream.ts
 * @description AI 工具流式执行相关函数
 */
import type { JSONValue, ModelMessage } from 'ai';
import type { AIToolContext, AIToolExecutionMetadata, AIToolExecutionResult, AIToolExecutor, AIStreamToolCallChunk, AITransportTool } from 'types/ai';
import { isFunction } from 'lodash-es';
import { createToolFailureResult } from './results';
import { createShellCommandId } from './shellCommandId';

/** Shell 命令工具名称。 */
const RUN_SHELL_COMMAND_TOOL_NAME = 'run_shell_command';
/** Todo 写入工具名称。 */
const TODO_WRITE_TOOL_NAME = 'todowrite';

/**
 * 工具执行元数据。
 */
export type ToolExecutionMetadata = AIToolExecutionMetadata;

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
 * 将任意值转换为 JSON 可序列化的值。
 * @param value - 任意值
 * @returns JSON 值
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
 * 判断值是否为普通对象。
 * @param value - 待判断值
 * @returns 是否为普通对象
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 为需要 toolCallId 的本地工具补充内部执行输入。
 * @param toolName - 工具名称
 * @param input - 原始输入
 * @param toolCallId - 工具调用 ID
 * @param metadata - 工具执行元数据
 * @returns 工具执行输入
 */
function createExecutionInput(toolName: string, input: unknown, toolCallId: string, metadata: ToolExecutionMetadata = {}): unknown {
  if (!isRecord(input)) {
    return input;
  }

  if (toolName === TODO_WRITE_TOOL_NAME && metadata.runtimeId) {
    return {
      ...input,
      sourceRuntimeId: metadata.runtimeId
    };
  }

  if (toolName !== RUN_SHELL_COMMAND_TOOL_NAME) {
    return input;
  }

  const executionInput: Record<string, unknown> = {
    ...input,
    toolCallId,
    commandId: metadata.runtimeId ? createShellCommandId(metadata.runtimeId, toolCallId) : toolCallId
  };
  // Runtime 控制信息仅供本地执行器读取，不允许进入枚举、日志或模型输入回放。
  if (metadata.runtimeId) {
    Object.defineProperty(executionInput, 'runtimeManaged', { value: true });
  }
  if (metadata.abortSignal) {
    Object.defineProperty(executionInput, 'abortSignal', { value: metadata.abortSignal });
  }
  return executionInput;
}

/**
 * 将工具执行器列表转换为传输格式
 * @param tools - 工具执行器列表
 * @returns 传输格式的工具列表
 */
export function toTransportTools(tools: AIToolExecutor[]) {
  return tools.map((item) => ({
    name: item.definition.name,
    description: isFunction(item.definition.description) ? item.definition.description() : item.definition.description,
    parameters: item.definition.parameters
  })) as AITransportTool[];
}

/**
 * 执行工具调用
 * @param call - 工具调用数据块
 * @param tools - 可用工具列表
 * @param context - 编辑器上下文
 * @param metadata - 工具执行元数据
 * @returns 执行结果
 */
export async function executeToolCall(
  call: AIStreamToolCallChunk,
  tools: AIToolExecutor[],
  context: AIToolContext | undefined,
  metadata: ToolExecutionMetadata = {}
): Promise<ExecutedToolCall> {
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

  // 仅文档类工具需要活动编辑器上下文；全局工具（如设置修改）可在无文档时执行。
  if (executor.definition.requiresActiveDocument !== false && !context) {
    return {
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      input: call.input,
      result: createToolFailureResult(call.toolName, 'NO_ACTIVE_DOCUMENT', '当前没有可用的编辑器文档')
    };
  }

  // 执行工具，等待用户输入结果仍作为普通终态 tool-result 进入消息历史。
  const executionInput = createExecutionInput(call.toolName, call.input, call.toolCallId, metadata);
  const enrichedContext = context ? { ...context, toolCallId: call.toolCallId, activity: metadata.activity } : undefined;
  const rawResult = await executor.execute(executionInput, enrichedContext, metadata);

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
