/**
 * @file index.mts
 * @description ChatRuntime 主进程 WebView 工具。
 */
import type { ChatRuntimeMainToolExecutionInput } from '../../types.mjs';
import type { MainToolsDependencies } from '../types.mjs';
import type { AIToolExecutionResult } from 'types/ai';
import { OPERATE_WEBPAGE_TOOL_NAME, READ_CURRENT_WEBPAGE_TOOL_NAME, WEBVIEW_TOOL_NAMES } from '../constants.mjs';
import { isRuntimeWebpageOperateResult, isRuntimeWebpageSnapshot } from '../guards.mjs';
import { createBridgeFailureResult, createMainDeniedResult, createMainToolFailureResult, createMainToolSuccessResult } from '../results.mjs';

/**
 * WebView 操作动作最小描述。
 */
interface WebviewActionSummary {
  /** 操作类型。 */
  type?: unknown;
  /** 目标元素索引。 */
  index?: unknown;
  /** 输入文本。 */
  text?: unknown;
  /** 选项文本。 */
  optionText?: unknown;
  /** 滚动方向。 */
  direction?: unknown;
  /** 模拟按键。 */
  key?: unknown;
  /** 导航地址。 */
  url?: unknown;
}

/**
 * WebView 操作输入最小描述。
 */
interface WebviewOperateSummary {
  /** 操作动作。 */
  action?: WebviewActionSummary;
}

/**
 * 判断工具是否属于 WebView 工具模块。
 * @param toolName - 工具名称
 * @returns 是否为 WebView 工具
 */
export function isWebviewTool(toolName: string): boolean {
  return WEBVIEW_TOOL_NAMES.has(toolName);
}

/**
 * 判断值是否为对象记录。
 * @param value - 待判断值
 * @returns 是否为对象记录
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * 读取 WebView 操作摘要。
 * @param input - 工具输入
 * @returns 操作摘要
 */
function readOperateSummary(input: unknown): WebviewOperateSummary {
  if (!isRecord(input) || !isRecord(input.action)) return {};

  return {
    action: {
      type: input.action.type,
      index: input.action.index,
      text: input.action.text,
      optionText: input.action.optionText,
      direction: input.action.direction,
      key: input.action.key,
      url: input.action.url
    }
  };
}

/**
 * 创建 WebView 操作确认描述。
 * @param input - 工具输入
 * @returns 确认描述
 */
function createOperateConfirmationDescription(input: unknown): string {
  const { action } = readOperateSummary(input);
  if (!action || typeof action.type !== 'string') return '操作当前网页。';

  if (action.type === 'click') return `点击当前网页元素 #${String(action.index ?? '')}`;
  if (action.type === 'input') return `向当前网页元素 #${String(action.index ?? '')} 输入文本：${String(action.text ?? '')}`;
  if (action.type === 'select') return `在当前网页元素 #${String(action.index ?? '')} 选择：${String(action.optionText ?? '')}`;
  if (action.type === 'press') return `在当前网页元素 #${String(action.index ?? '')} 按下：${String(action.key ?? '')}`;
  if (action.type === 'scroll') return `滚动当前网页：${String(action.direction ?? '')}`;
  if (action.type === 'navigate') return `在当前 WebView 中打开：${String(action.url ?? '')}`;
  if (action.type === 'wait') return '等待当前网页状态更新。';

  return '操作当前网页。';
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
  const decision = await deps.requestConfirmation({
    runtimeId: input.runtime.runtimeId,
    toolCallId: input.toolCallId,
    request: {
      toolCallId: input.toolCallId,
      toolName: OPERATE_WEBPAGE_TOOL_NAME,
      title: '操作当前网页',
      description: createOperateConfirmationDescription(input.input),
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
    payload: input.input
  });
  if (bridgeResult.status === 'failure') return createBridgeFailureResult(input.toolName, bridgeResult.error);
  if (!isRuntimeWebpageOperateResult(bridgeResult.data)) return createMainToolFailureResult(input.toolName, 'INVALID_INPUT', '网页操作结果格式无效');

  return createMainToolSuccessResult(OPERATE_WEBPAGE_TOOL_NAME, bridgeResult.data);
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
