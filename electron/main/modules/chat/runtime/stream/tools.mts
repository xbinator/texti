/**
 * @file stream/tools.mts
 * @description ChatRuntime 流式执行器工具执行与结果工厂。
 */
import type { ToolWatchdogLease } from '../controllers/tool-watchdog.mjs';
import type { ActiveChatRuntime, ChatRuntimeMainToolExecutor, ChatRuntimeRendererToolExecutor } from '../types.mjs';
import type { AIToolActivityReporter, AIToolExecutionError, AIToolExecutionResult } from 'types/ai';
import { AI_ERROR_CODE, createAIServiceError, isAIServiceError } from '../../../ai/errors/codes.mjs';
import { MAIN_PROCESS_TOOL_NAMES } from '../tools/constants.mjs';
import { isToolExecutionErrorCode } from '../tools/results.mjs';

/**
 * 判断值是否为对象记录。
 * @param value - 待判断值
 * @returns 是否为对象记录
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Renderer 本地工具默认开始确认超时时间。 */
export const DEFAULT_RENDERER_START_TIMEOUT_MS = 30_000;
/** 支持活动协议的 Main 工具默认心跳周期。 */
export const TOOL_HEARTBEAT_INTERVAL_MS = 15_000;

/**
 * 将异常规范化为 AIServiceError。
 * @param error - 原始错误
 * @returns AI 服务错误
 */
export function normalizeRuntimeError(error: unknown): ReturnType<typeof createAIServiceError> {
  if (isAIServiceError(error)) return error;
  if (error instanceof Error) return createAIServiceError(AI_ERROR_CODE.REQUEST_FAILED, error.message);

  return createAIServiceError(AI_ERROR_CODE.REQUEST_FAILED, 'ChatRuntime 流式调用失败');
}

/**
 * 从未知错误中读取可用于工具结果的稳定错误码。
 * @param error - 原始异常
 * @returns 工具错误码
 */
export function getToolExecutionErrorCode(error: unknown): AIToolExecutionError['code'] {
  if (isRecord(error) && isToolExecutionErrorCode(error.code)) return error.code;

  return 'EXECUTION_FAILED';
}

/**
 * 将工具异常转为工具失败结果。
 * @param toolName - 工具名称
 * @param error - 原始异常
 * @returns 工具失败结果
 */
export function createToolFailureResultFromError(toolName: string, error: unknown): AIToolExecutionResult {
  const message = error instanceof Error ? error.message : String(error);
  const code = getToolExecutionErrorCode(error);
  if (code === 'USER_CANCELLED') {
    return {
      toolName,
      status: 'cancelled',
      error: { code, message }
    };
  }
  return {
    toolName,
    status: 'failure',
    error: {
      code,
      message
    }
  };
}

/**
 * 创建未注册工具的失败结果。
 * @param toolName - 工具名称
 * @returns 工具失败结果
 */
export function createUnknownToolFailureResult(toolName: string): AIToolExecutionResult {
  return {
    toolName,
    status: 'failure',
    error: {
      code: 'TOOL_NOT_FOUND',
      message: `未找到工具 ${toolName} 的执行器，既不是主进程工具也未在 runtime.tools 中注册`
    }
  };
}

/**
 * 规整 renderer 工具开始确认超时时间。
 * @param timeoutMs - 原始超时时间
 * @returns 可使用的超时时间
 */
export function normalizeRendererStartTimeoutMs(timeoutMs: number | undefined): number {
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) return DEFAULT_RENDERER_START_TIMEOUT_MS;

  return Math.floor(timeoutMs);
}

/**
 * 判断工具结果是否允许 runtime 进入下一轮续跑。
 * @param result - 工具执行结果
 * @returns 是否继续工具续轮
 */
export function shouldContinueAfterToolResult(result: AIToolExecutionResult): boolean {
  return result.status !== 'awaiting_user_input' && result.status !== 'cancelled';
}

/**
 * 判断工具结果是否应停止继续消费当前模型流。
 * @param result - 工具执行结果
 * @returns 是否停止当前模型流
 */
export function shouldStopStreamAfterToolResult(result: AIToolExecutionResult): boolean {
  return result.status === 'awaiting_user_input' || result.status === 'cancelled';
}

/**
 * 创建带不可枚举中止信号的工具输入，避免信号进入日志、快照或结构化比较。
 * @param input - 原始工具执行输入
 * @param signal - 组合中止信号
 * @returns 可供执行器读取 signal 的工具输入副本
 */
function attachToolRuntime<TInput extends { signal?: AbortSignal; activity?: AIToolActivityReporter }>(
  input: TInput,
  signal: AbortSignal,
  activity?: AIToolActivityReporter
): TInput {
  const executionInput = { ...input };
  Object.defineProperty(executionInput, 'signal', { value: signal, enumerable: false });
  if (activity) Object.defineProperty(executionInput, 'activity', { value: activity, enumerable: false });
  return executionInput;
}

/**
 * 从 Watchdog 租约创建受限活动上报器。
 * @param lease - 当前工具租约
 * @returns 工具可使用的活动上报器
 */
function createLeaseReporter(lease: ToolWatchdogLease): AIToolActivityReporter {
  return {
    heartbeat(): void {
      lease.report({ kind: 'heartbeat' });
    },
    progress(progress): void {
      lease.report({ kind: 'progress', progress });
    },
    waitUser(prompt: string): void {
      lease.report({ kind: 'waiting_user', prompt });
    },
    waitExternal(wait): void {
      lease.report({ kind: 'waiting_external', wait });
    },
    resume(): void {
      lease.report({ kind: 'resumed' });
    }
  };
}

/**
 * 执行 renderer 本地工具，并把异常或超时转换为工具失败结果。
 * @param executeRendererTool - renderer 工具执行器
 * @param input - renderer 工具输入
 * @param lease - 当前工具 Watchdog 租约
 * @returns 工具执行结果
 */
export async function executeRendererToolSafely(
  executeRendererTool: ChatRuntimeRendererToolExecutor,
  input: Parameters<ChatRuntimeRendererToolExecutor>[0],
  lease: ToolWatchdogLease
): Promise<AIToolExecutionResult> {
  const signal = AbortSignal.any([input.runtime.abortController.signal, lease.signal]);
  const executionInput = attachToolRuntime(input, signal);

  try {
    return await Promise.race([executeRendererTool(executionInput), lease.settled]);
  } catch (error: unknown) {
    return createToolFailureResultFromError(input.toolName, error);
  } finally {
    lease.finish();
  }
}

/**
 * 执行主进程工具，并把异常或超时转换为工具失败结果。
 * @param executeMainTool - 主进程工具执行器
 * @param input - 主进程工具输入
 * @param lease - 当前工具 Watchdog 租约
 * @returns 工具执行结果
 */
export async function executeMainToolSafely(
  executeMainTool: ChatRuntimeMainToolExecutor,
  input: Parameters<ChatRuntimeMainToolExecutor>[0],
  lease: ToolWatchdogLease
): Promise<AIToolExecutionResult> {
  const signal = AbortSignal.any([input.runtime.abortController.signal, lease.signal]);
  const activity = createLeaseReporter(lease);
  const executionInput = attachToolRuntime(input, signal, activity);
  lease.report({ kind: 'started' });
  const heartbeatTimer = setInterval((): void => activity.heartbeat(), TOOL_HEARTBEAT_INTERVAL_MS);

  try {
    return await Promise.race([executeMainTool(executionInput), lease.settled]);
  } catch (error: unknown) {
    return createToolFailureResultFromError(input.toolName, error);
  } finally {
    clearInterval(heartbeatTimer);
    lease.finish();
  }
}

/**
 * 判断工具是否由主进程执行。
 * @param toolName - 工具名称
 * @returns 是否为主进程工具
 */
export function isMainProcessTool(toolName: string): boolean {
  return MAIN_PROCESS_TOOL_NAMES.has(toolName);
}

/**
 * 判断工具是否由 renderer 本地执行。
 * @param runtime - runtime 状态
 * @param toolName - 工具名称
 * @returns 是否为 renderer 工具
 */
export function isRendererManagedTool(runtime: ActiveChatRuntime, toolName: string): boolean {
  return !isMainProcessTool(toolName) && Boolean(runtime.tools?.some((tool) => tool.name === toolName));
}
