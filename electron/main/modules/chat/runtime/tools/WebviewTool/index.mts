/**
 * @file index.mts
 * @description ChatRuntime 主进程 WebView 工具。
 */
import type { ChatRuntimeMainToolExecutionInput } from '../../types.mjs';
import type { MainToolsDependencies, RuntimeWebpageOperateInput } from '../types.mjs';
import type { AIToolExecutionResult } from 'types/ai';
import { OPERATE_WEBPAGE_TOOL_NAME, READ_CURRENT_WEBPAGE_TOOL_NAME, WEBVIEW_TOOL_NAMES } from '../constants.mjs';
import { isRuntimeWebpageOperateResult, isRuntimeWebpageSnapshot } from '../guards.mjs';
import { createBridgeFailureResult, createMainDeniedResult, createMainToolFailureResult, createMainToolSuccessResult } from '../results.mjs';
import { normalizeWebpageInput } from './input.mjs';
import { sanitizeWebpageResult } from './result.mjs';

/** 网页操作确认文本预览最大长度。 */
const WEBVIEW_CONFIRMATION_PREVIEW_LIMIT = 300;

/**
 * 判断工具是否属于 WebView 工具模块。
 * @param toolName - 工具名称
 * @returns 是否为 WebView 工具
 */
export function isWebviewTool(toolName: string): boolean {
  return WEBVIEW_TOOL_NAMES.has(toolName);
}

/**
 * 创建 WebView 操作确认描述。
 * @param input - 工具输入
 * @returns 确认描述
 */
function createOperateConfirmationDescription(input: RuntimeWebpageOperateInput): string {
  const { action } = input;
  if (action.type === 'click') return `点击当前网页元素 #${String(action.index)}`;
  if (action.type === 'input') return `向当前网页元素 #${String(action.index)} 输入文本：${action.text.slice(0, WEBVIEW_CONFIRMATION_PREVIEW_LIMIT)}`;
  if (action.type === 'select') return `在当前网页元素 #${String(action.index)} 选择：${action.optionText.slice(0, WEBVIEW_CONFIRMATION_PREVIEW_LIMIT)}`;
  if (action.type === 'press') return `在当前网页元素 #${String(action.index)} 按下：${action.key}`;
  if (action.type === 'scroll') return `滚动当前网页：${action.direction}`;
  if (action.type === 'navigate') return `在当前 WebView 中打开：${action.url.slice(0, WEBVIEW_CONFIRMATION_PREVIEW_LIMIT)}`;
  if (action.type === 'wait') return '等待当前网页状态更新。';

  return '操作当前网页。';
}

/**
 * 创建 Renderer 实际需要的 WebView 操作载荷。
 * @param input - 模型工具输入
 * @returns 不包含步骤记忆的 Renderer 载荷，无效时返回 undefined
 */
function createOperateBridgePayload(input: unknown): RuntimeWebpageOperateInput | undefined {
  return normalizeWebpageInput(input);
}

/**
 * 执行 read_current_webpage。
 * @param input - 工具执行输入
 * @param deps - 主进程工具依赖
 * @returns 工具执行结果
 */
async function executeReadCurrentWebpage(input: ChatRuntimeMainToolExecutionInput, deps: MainToolsDependencies): Promise<AIToolExecutionResult> {
  const bridgeResult = await deps.requestBridge({
    runtimeId: input.runtime.runtimeId,
    toolCallId: input.toolCallId,
    kind: 'webview-snapshot',
    payload: input.input
  });
  if (bridgeResult.status === 'failure') return createBridgeFailureResult(input.toolName, bridgeResult.error);
  if (!isRuntimeWebpageSnapshot(bridgeResult.data)) return createMainToolFailureResult(input.toolName, 'INVALID_INPUT', '当前网页快照格式无效');

  return createMainToolSuccessResult(READ_CURRENT_WEBPAGE_TOOL_NAME, bridgeResult.data);
}

/**
 * 执行 operate_webpage。
 * @param input - 工具执行输入
 * @param deps - 主进程工具依赖
 * @returns 工具执行结果
 */
async function executeOperateWebpage(input: ChatRuntimeMainToolExecutionInput, deps: MainToolsDependencies): Promise<AIToolExecutionResult> {
  const bridgePayload = createOperateBridgePayload(input.input);
  if (!bridgePayload) return createMainToolFailureResult(input.toolName, 'INVALID_INPUT', '网页操作参数无效');

  const decision = await deps.requestConfirmation({
    runtimeId: input.runtime.runtimeId,
    toolCallId: input.toolCallId,
    request: {
      toolCallId: input.toolCallId,
      toolName: OPERATE_WEBPAGE_TOOL_NAME,
      title: '操作当前网页',
      description: createOperateConfirmationDescription(bridgePayload),
      riskLevel: 'write',
      allowRemember: true,
      rememberScopes: ['session', 'always']
    }
  });
  if (!decision.approved) return createMainDeniedResult(OPERATE_WEBPAGE_TOOL_NAME);

  const bridgeResult = await deps.requestBridge({
    runtimeId: input.runtime.runtimeId,
    toolCallId: input.toolCallId,
    kind: 'webview-operate',
    payload: bridgePayload
  });
  if (bridgeResult.status === 'failure') return createBridgeFailureResult(input.toolName, bridgeResult.error);
  if (!isRuntimeWebpageOperateResult(bridgeResult.data)) return createMainToolFailureResult(input.toolName, 'INVALID_INPUT', '网页操作结果格式无效');

  return createMainToolSuccessResult(OPERATE_WEBPAGE_TOOL_NAME, sanitizeWebpageResult(bridgeResult.data));
}

/**
 * 执行 WebView 工具。
 * @param input - 工具执行输入
 * @param deps - 主进程工具依赖
 * @returns 工具执行结果
 */
export async function executeWebviewTool(input: ChatRuntimeMainToolExecutionInput, deps: MainToolsDependencies): Promise<AIToolExecutionResult> {
  if (input.toolName === READ_CURRENT_WEBPAGE_TOOL_NAME) return executeReadCurrentWebpage(input, deps);
  if (input.toolName === OPERATE_WEBPAGE_TOOL_NAME) return executeOperateWebpage(input, deps);

  return createMainToolFailureResult(input.toolName, 'TOOL_NOT_FOUND', `Unsupported WebView tool: ${input.toolName}`);
}
