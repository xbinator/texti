/**
 * @file results.mts
 * @description ChatRuntime 主进程工具结果 helper。
 */
import type { AIToolExecutionError, AIToolExecutionResult } from 'types/ai';

/**
 * 创建主进程工具成功结果。
 * @param toolName - 工具名称
 * @param data - 工具结果数据
 * @returns 工具成功结果
 */
export function createMainToolSuccessResult(toolName: string, data: unknown): AIToolExecutionResult {
  return { toolName, status: 'success', data };
}

/**
 * 创建主进程工具失败结果。
 * @param toolName - 工具名称
 * @param code - 工具错误码
 * @param message - 错误描述
 * @returns 工具失败结果
 */
export function createMainToolFailureResult(toolName: string, code: AIToolExecutionError['code'], message: string): AIToolExecutionResult {
  return {
    toolName,
    status: 'failure',
    error: { code, message }
  };
}

/**
 * 创建主进程工具取消结果。
 * @param toolName - 工具名称
 * @returns 工具取消结果
 */
export function createMainToolCancelledResult(toolName: string): AIToolExecutionResult {
  return {
    toolName,
    status: 'cancelled',
    error: { code: 'USER_CANCELLED', message: '用户取消了工具调用' }
  };
}

/**
 * 创建用户拒绝授权的主进程工具失败结果。
 * @param toolName - 工具名称
 * @returns 可继续的用户拒绝结果
 */
export function createMainDeniedResult(toolName: string): AIToolExecutionResult {
  return createMainToolFailureResult(toolName, 'USER_CANCELLED', '用户取消了工具授权');
}

/**
 * 将 bridge failure 转为工具失败结果。
 * @param toolName - 工具名称
 * @param error - Bridge 错误
 * @returns 工具失败结果
 */
export function createBridgeFailureResult(toolName: string, error: AIToolExecutionError): AIToolExecutionResult {
  return { toolName, status: 'failure', error };
}
