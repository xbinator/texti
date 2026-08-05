/**
 * @file results.mts
 * @description ChatRuntime 主进程工具结果 helper。
 */
import type { AIAwaitingUserChoiceItem, AIAwaitingUserChoiceQuestion, AIToolExecutionError, AIToolExecutionResult } from 'types/ai';
import { isToolExecutionErrorCode } from '../../../../../../shared/ai/toolExecutionErrors.js';

export { isToolExecutionErrorCode } from '../../../../../../shared/ai/toolExecutionErrors.js';

/**
 * 判断未知值是否为非数组对象。
 * @param value - 未知值
 * @returns 是否为记录
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 校验等待用户选择的单题结构。
 * @param value - 原始问题
 * @returns 是否为有效问题项
 */
function isChoiceItem(value: unknown): value is AIAwaitingUserChoiceItem {
  if (!isRecord(value) || !['single', 'multiple', 'input'].includes(String(value.mode))) return false;
  if (typeof value.question !== 'string' || !Array.isArray(value.options)) return false;
  if (value.maxSelections !== undefined && (!Number.isSafeInteger(value.maxSelections) || Number(value.maxSelections) <= 0)) return false;
  if (value.placeholder !== undefined && typeof value.placeholder !== 'string') return false;
  return value.options.every(
    (option: unknown): boolean =>
      isRecord(option) &&
      typeof option.label === 'string' &&
      typeof option.value === 'string' &&
      (option.description === undefined || typeof option.description === 'string')
  );
}

/**
 * 校验等待用户输入的完整问题载荷。
 * @param value - 原始载荷
 * @returns 是否为有效等待问题
 */
function isChoiceQuestion(value: unknown): value is AIAwaitingUserChoiceQuestion {
  if (!isChoiceItem(value) || !isRecord(value)) return false;
  if (typeof value.questionId !== 'string' || typeof value.toolCallId !== 'string') return false;
  return value.questions === undefined || (Array.isArray(value.questions) && value.questions.every(isChoiceItem));
}

/**
 * 归一化工具错误结构。
 * @param value - 原始错误
 * @returns 稳定工具错误；格式非法时返回 null
 */
function normalizeToolError(value: unknown): AIToolExecutionError | null {
  if (!isRecord(value) || typeof value.message !== 'string') return null;
  const code = isToolExecutionErrorCode(value.code) ? value.code : 'EXECUTION_FAILED';
  return { code, message: value.message, ...(value.details === undefined ? {} : { details: value.details }) };
}

/**
 * 从不可信执行边界解析严格工具结果。
 * @param toolName - 当前调用的权威工具名称
 * @param value - 原始结果
 * @returns 严格结果；格式或身份不匹配时返回 null
 */
export function parseToolResult(toolName: string, value: unknown): AIToolExecutionResult | null {
  if (!isRecord(value) || value.toolName !== toolName) return null;
  if (value.status === 'success') {
    if (!('data' in value)) return null;
    return { toolName, status: 'success', data: value.data };
  }
  if (value.status === 'failure' || value.status === 'cancelled') {
    const error = normalizeToolError(value.error);
    if (!error) return null;
    return { toolName, status: value.status, error };
  }
  if (value.status === 'awaiting_user_input' && isChoiceQuestion(value.data)) {
    return { toolName, status: 'awaiting_user_input', data: structuredClone(value.data) };
  }
  return null;
}

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
  if (error.code === 'USER_CANCELLED') return { toolName, status: 'cancelled', error };
  return { toolName, status: 'failure', error };
}
