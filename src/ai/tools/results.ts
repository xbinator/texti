/**
 * @file results.ts
 * @description AI tool execution result factories.
 */
import type { AIAwaitingUserChoiceQuestion, AIToolExecutionAwaitingUserInputResult, AIToolExecutionError, AIToolExecutionResult } from 'types/ai';

/**
 * Create a successful tool execution result.
 * @param toolName - Tool name.
 * @param data - Result payload.
 * @returns Success result.
 */
export function createToolSuccessResult<TResult>(toolName: string, data: TResult): AIToolExecutionResult<TResult> {
  return { toolName, status: 'success', data };
}

/**
 * Create a failed tool execution result.
 * @param toolName - Tool name.
 * @param code - Error code.
 * @param message - Error message.
 * @returns Failure result.
 */
export function createToolFailureResult(toolName: string, code: AIToolExecutionError['code'], message: string): AIToolExecutionResult<never> {
  return { toolName, status: 'failure', error: { code, message } };
}

/**
 * Create a failure-like tool execution result.
 * @param toolName - Tool name.
 * @param status - Terminal status.
 * @param code - Error code.
 * @param message - Error message.
 * @returns Failure-like result.
 */
function createFailureLikeResult(
  toolName: string,
  status: 'failure' | 'cancelled',
  code: AIToolExecutionError['code'],
  message: string
): AIToolExecutionResult<never> {
  return { toolName, status, error: { code, message } };
}

/**
 * Create a cancelled tool execution result.
 * @param toolName - Tool name.
 * @returns Cancelled result.
 */
export function createToolCancelledResult(toolName: string): AIToolExecutionResult<never> {
  return createFailureLikeResult(toolName, 'cancelled', 'USER_CANCELLED', '用户取消了工具调用');
}

/**
 * Create an awaiting-user-input tool execution result.
 * @param toolName - Tool name.
 * @param question - Choice question payload.
 * @returns Awaiting-user-input result.
 */
export function createAwaitingUserInputResult(toolName: string, question: AIAwaitingUserChoiceQuestion): AIToolExecutionAwaitingUserInputResult {
  return { toolName, status: 'awaiting_user_input', data: question };
}
