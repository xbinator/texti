/**
 * @file permission.ts
 * @description AI 工具权限策略执行器。
 */
import type { AIToolConfirmationAdapter, AIToolConfirmationRequest } from './confirmation';
import type { AIToolDefinition, AIToolExecutionResult } from 'types/ai';
import { useChatPermissionStore } from '@/stores/chat/permission';
import { asyncTo } from '@/utils/asyncTo';
import { readToolExecutionErrorCode } from '../../../shared/ai/toolExecutionErrors';
import { createToolDeniedResult, createToolFailureResult, createToolSuccessResult } from './results';

/**
 * 权限包装执行选项。
 */
interface ExecuteWithPermissionOptions<TResult> {
  /** 工具定义 */
  definition: AIToolDefinition;
  /** 确认适配器 */
  adapter: AIToolConfirmationAdapter;
  /** 确认请求 */
  request: AIToolConfirmationRequest;
  /** 实际工具操作 */
  operation: () => TResult | Promise<TResult>;
}

/**
 * 标准工具结果权限包装选项。
 */
interface ExecuteResultPermissionOptions<TResult> {
  /** 工具定义。 */
  definition: AIToolDefinition;
  /** 确认适配器。 */
  adapter: AIToolConfirmationAdapter;
  /** 确认请求。 */
  request: AIToolConfirmationRequest;
  /** 返回标准工具结果的实际工具操作。 */
  operation: () => AIToolExecutionResult<TResult> | Promise<AIToolExecutionResult<TResult>>;
}

/**
 * 获取执行错误消息。
 * @param error - 捕获到的错误
 * @returns 可展示错误消息
 */
function getExecutionErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '工具执行失败';
}

/**
 * 判断工具是否已有授权。
 * @param toolName - 工具名称
 * @returns 是否已有授权
 */
function hasToolGrant(toolName: string): boolean {
  const toolPermissionStore = useChatPermissionStore();

  return Boolean(toolPermissionStore.alwaysToolPermissionGrants[toolName] || toolPermissionStore.sessionToolPermissionGrants[toolName]);
}

/**
 * 判断工具是否可以自动执行。
 * @param definition - 工具定义
 * @returns 是否可以自动执行
 */
function canAutoExecute(definition: AIToolDefinition): boolean {
  const toolPermissionStore = useChatPermissionStore();

  if (definition.riskLevel === 'read') {
    return true;
  }

  if (hasToolGrant(definition.name)) {
    return true;
  }

  return toolPermissionStore.toolPermissionMode === 'autoSafe' && definition.safeAutoApprove === true;
}

/**
 * 生成经过权限策略约束的确认请求。
 * @param definition - 工具定义
 * @param request - 原始确认请求
 * @returns 安全确认请求
 */
function createSafeConfirmationRequest(definition: AIToolDefinition, request: AIToolConfirmationRequest): AIToolConfirmationRequest {
  const rememberAllowed = definition.safeAutoApprove === true || definition.allowPermissionRemember === true;
  const allowRemember = definition.riskLevel !== 'dangerous' && rememberAllowed && request.allowRemember === true;

  return {
    ...request,
    riskLevel: definition.riskLevel,
    allowRemember,
    rememberScopes: allowRemember ? request.rememberScopes : undefined
  };
}

/**
 * 执行操作并同步确认生命周期。
 * @param options - 权限包装执行选项
 * @returns 工具执行结果
 */
async function executeOperation<TResult>(options: ExecuteWithPermissionOptions<TResult>): Promise<AIToolExecutionResult<TResult>> {
  await options.adapter.onExecutionStart?.(options.request);

  try {
    const data = await options.operation();
    await options.adapter.onExecutionComplete?.(options.request, { status: 'success' });
    return createToolSuccessResult(options.definition.name, data);
  } catch (error) {
    const errorMessage = getExecutionErrorMessage(error);
    await options.adapter.onExecutionComplete?.(options.request, { status: 'failure', errorMessage });
    return createToolFailureResult(options.definition.name, 'EXECUTION_FAILED', errorMessage);
  }
}

/**
 * 执行返回标准结果的工具操作，并同步确认生命周期。
 * @param options - 标准结果权限包装选项
 * @returns 页面工具原始标准结果，异常时返回稳定失败结果
 */
async function executeResultOperation<TResult>(options: ExecuteResultPermissionOptions<TResult>): Promise<AIToolExecutionResult<TResult>> {
  const [startError] = await asyncTo(Promise.resolve().then((): void | Promise<void> => options.adapter.onExecutionStart?.(options.request)));
  if (startError) {
    return createToolFailureResult(options.definition.name, 'EXECUTION_FAILED', getExecutionErrorMessage(startError.cause ?? startError));
  }

  const [operationError, result] = await asyncTo(Promise.resolve().then(options.operation));
  if (operationError) {
    const operationCause = operationError.cause ?? operationError;
    const errorCode = readToolExecutionErrorCode(operationCause) ?? 'EXECUTION_FAILED';
    const errorMessage = getExecutionErrorMessage(operationCause);
    await asyncTo(
      Promise.resolve().then((): void | Promise<void> => options.adapter.onExecutionComplete?.(options.request, { status: 'failure', errorMessage }))
    );
    return createToolFailureResult(options.definition.name, errorCode, errorMessage);
  }

  const executionStatus = result.status === 'success' ? 'success' : 'failure';
  const errorMessage = result.status === 'failure' || result.status === 'cancelled' ? result.error.message : undefined;
  await asyncTo(
    Promise.resolve().then((): void | Promise<void> =>
      options.adapter.onExecutionComplete?.(options.request, { status: executionStatus, ...(errorMessage ? { errorMessage } : {}) })
    )
  );
  return result;
}

/**
 * 按用户权限模式、授权记忆和工具风险等级执行工具操作。
 * @param options - 权限包装执行选项
 * @returns 工具执行结果
 */
export async function executeWithPermission<TResult>(options: ExecuteWithPermissionOptions<TResult>): Promise<AIToolExecutionResult<TResult>> {
  const toolPermissionStore = useChatPermissionStore();

  if (toolPermissionStore.toolPermissionMode === 'readonly' && options.definition.riskLevel !== 'read') {
    return createToolFailureResult(options.definition.name, 'PERMISSION_DENIED', '当前权限模式不允许执行该工具');
  }

  if (options.definition.riskLevel !== 'dangerous' && canAutoExecute(options.definition)) {
    return executeOperation(options);
  }

  const safeRequest = createSafeConfirmationRequest(options.definition, options.request);
  const decision = await options.adapter.confirm(safeRequest);
  const normalizedDecision = (typeof decision === 'boolean' ? { approved: decision } : decision) as
    | { approved: false }
    | { approved: true; grantScope?: 'session' | 'always' };

  if (!normalizedDecision.approved) {
    return createToolDeniedResult(options.definition.name);
  }

  const result = await executeOperation({ ...options, request: safeRequest });
  if (result.status === 'success' && normalizedDecision.grantScope) {
    toolPermissionStore.grantToolPermission(options.definition.name, normalizedDecision.grantScope);
  }

  return result;
}

/**
 * 按统一权限策略执行已经返回标准结果的页面工具。
 * @param options - 标准结果权限包装选项
 * @returns 保留页面语义的标准工具执行结果
 */
export async function executeResultWithPermission<TResult>(options: ExecuteResultPermissionOptions<TResult>): Promise<AIToolExecutionResult<TResult>> {
  const toolPermissionStore = useChatPermissionStore();

  if (toolPermissionStore.toolPermissionMode === 'readonly' && options.definition.riskLevel !== 'read') {
    return createToolFailureResult(options.definition.name, 'PERMISSION_DENIED', '当前权限模式不允许执行该工具');
  }

  if (options.definition.riskLevel !== 'dangerous' && canAutoExecute(options.definition)) {
    return executeResultOperation(options);
  }

  const safeRequest = createSafeConfirmationRequest(options.definition, options.request);
  const decision = await options.adapter.confirm(safeRequest);
  const normalizedDecision = (typeof decision === 'boolean' ? { approved: decision } : decision) as
    | { approved: false }
    | { approved: true; grantScope?: 'session' | 'always' };

  if (!normalizedDecision.approved) {
    return createToolDeniedResult(options.definition.name);
  }

  const result = await executeResultOperation({ ...options, request: safeRequest });
  if (result.status === 'success' && normalizedDecision.grantScope) {
    toolPermissionStore.grantToolPermission(options.definition.name, normalizedDecision.grantScope);
  }

  return result;
}
