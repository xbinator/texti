/**
 * @file index.mts
 * @description ChatRuntime 主进程资源工具。
 */
import type { ChatRuntimeMainToolExecutionInput } from '../../types.mjs';
import type { MainToolsDependencies, RuntimeOpenResourceInput, RuntimeOpenResourceType } from '../types.mjs';
import type { AIToolExecutionResult } from 'types/ai';
import { OPEN_RESOURCE_TOOL_NAME, RESOURCE_TOOL_NAMES, RUNTIME_URL_PROTOCOL_RE } from '../constants.mjs';
import { isRecord, isRuntimeOpenResourceResult, isRuntimeOpenResourceType } from '../guards.mjs';
import { resolveRuntimeReadTarget } from '../paths.mjs';
import { createBridgeFailureResult, createMainDeniedResult, createMainToolFailureResult, createMainToolSuccessResult } from '../results.mjs';

/**
 * 判断工具是否属于资源工具模块。
 * @param toolName - 工具名称
 * @returns 是否为资源工具
 */
export function isResourceTool(toolName: string): boolean {
  return RESOURCE_TOOL_NAMES.has(toolName);
}

/**
 * 判断字符串是否为 URL。
 * @param input - 输入字符串
 * @returns 是否为 URL
 */
function isRuntimeUrl(input: string): boolean {
  return RUNTIME_URL_PROTOCOL_RE.test(input);
}

/**
 * 归一化打开资源类型。
 * @param rawType - 原始资源类型
 * @param input - 路径或 URL
 * @returns 资源类型
 */
function normalizeRuntimeOpenResourceType(rawType: unknown, input: string): RuntimeOpenResourceType {
  if (isRuntimeOpenResourceType(rawType)) return rawType;
  if (!isRuntimeUrl(input)) return 'file';
  return input.startsWith('http') ? 'webview' : 'external';
}

/**
 * 归一化 open_resource 输入。
 * @param input - 原始工具输入
 * @returns 归一化打开资源输入或失败结果
 */
function normalizeRuntimeOpenResourceInput(input: unknown): RuntimeOpenResourceInput | AIToolExecutionResult {
  const source = isRecord(input) ? input : {};
  let targetPath = '';
  if (typeof source.path === 'string') {
    targetPath = source.path.trim();
  } else if (typeof source.url === 'string') {
    targetPath = source.url.trim();
  }

  if (!targetPath) {
    return createMainToolFailureResult(OPEN_RESOURCE_TOOL_NAME, 'INVALID_INPUT', '路径或 URL 不能为空');
  }

  return {
    path: targetPath,
    resourceType: normalizeRuntimeOpenResourceType(source.resourceType, targetPath)
  };
}

/**
 * 执行资源工具。
 * @param input - 工具执行输入
 * @param deps - 主进程工具依赖
 * @returns 工具执行结果
 */
export async function executeResourceTool(input: ChatRuntimeMainToolExecutionInput, deps: MainToolsDependencies): Promise<AIToolExecutionResult> {
  if (input.toolName !== OPEN_RESOURCE_TOOL_NAME) {
    return createMainToolFailureResult(input.toolName, 'TOOL_NOT_FOUND', `Unsupported resource tool: ${input.toolName}`);
  }

  const normalizedInput = normalizeRuntimeOpenResourceInput(input.input);
  if ('status' in normalizedInput) return normalizedInput;

  let bridgeInput = normalizedInput;
  if (normalizedInput.resourceType === 'file') {
    const target = resolveRuntimeReadTarget(normalizedInput.path, input.runtime.workspaceRoot, input.toolName);
    if ('status' in target) return target;

    bridgeInput = { ...normalizedInput, path: target.filePath };
    if (target.outsideWorkspace) {
      const decision = await deps.requestConfirmation({
        runtimeId: input.runtime.runtimeId,
        toolCallId: input.toolCallId,
        request: {
          toolCallId: input.toolCallId,
          toolName: OPEN_RESOURCE_TOOL_NAME,
          title: 'AI 想要打开本地文件',
          description: `AI 请求打开本地文件：${target.filePath}`,
          riskLevel: 'read',
          beforeText: target.filePath
        }
      });
      if (!decision.approved) return createMainDeniedResult(input.toolName);
    }
  }

  const bridgeResult = await deps.requestBridge({
    runtimeId: input.runtime.runtimeId,
    toolCallId: input.toolCallId,
    kind: 'open-resource',
    payload: bridgeInput
  });
  if (bridgeResult.status === 'failure') return createBridgeFailureResult(input.toolName, bridgeResult.error);
  if (!isRuntimeOpenResourceResult(bridgeResult.data)) return createMainToolFailureResult(input.toolName, 'INVALID_INPUT', '打开资源结果格式无效');

  return createMainToolSuccessResult(OPEN_RESOURCE_TOOL_NAME, bridgeResult.data);
}
