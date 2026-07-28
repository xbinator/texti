/**
 * @file write-tools.mts
 * @description 组合 write Plan 内纯读能力与 Attempt 私有 staged 文件工具，并在每次调用前重新授权。
 */
import type { RuntimeToolGuard, RuntimeToolGuardInput } from '../runtime/stream/types.mjs';
import type { ChatRuntimeMainToolExecutor } from '../runtime/types.mjs';
import type { AIToolExecutionError, AIToolExecutionResult, AITransportTool } from 'types/ai';
import type { AgentChangesetSnapshot } from 'types/chat-agent';
import { AGENT_FILE_COMMIT_ADAPTER, STAGE_FILE_EDIT_TOOL_NAME, STAGE_FILE_WRITE_TOOL_NAME } from '../../../../../shared/ai/tools/AgentStagedFileTool/index.js';
import { getToolRegistryEntry, type ToolRegistryEntry } from '../../../../../shared/ai/tools/index.js';
import { createMainToolCancelledResult } from '../runtime/tools/results.mjs';
import { createChildReadTools } from './read-tools.mjs';
import { AgentWriteOverlayError, createAgentWriteOverlay, type CreateAgentWriteOverlayInput, validateAgentOverlayTarget } from './write-overlay.mjs';

/** staged file 工具集合。 */
const STAGED_TOOL_NAMES = new Set<string>([STAGE_FILE_EDIT_TOOL_NAME, STAGE_FILE_WRITE_TOOL_NAME]);

/** write Plan 工具集创建依赖。 */
export interface ChildWriteToolDependencies extends CreateAgentWriteOverlayInput {
  /** Child Runtime cooperative cancellation 信号。 */
  readonly signal: AbortSignal;
}

/** write Runtime 可挂载到 stream executor 的完整工具边界。 */
export interface ChildWriteTools {
  /** 当前 Plan 中仍可用的 pure-read 与 staged 工具 Schema。 */
  readonly tools: AITransportTool[];
  /** Provider 结果或本地执行前的强制授权钩子。 */
  readonly guardToolCall: RuntimeToolGuard;
  /** 只调用纯读 executor 或私有 overlay 的 Main executor。 */
  readonly executeMainTool: ChatRuntimeMainToolExecutor;
  /**
   * 生成完整性绑定 changeset。
   * @returns 非空 changeset；全部 no-op 时为 null
   */
  prepare(): Promise<AgentChangesetSnapshot | null>;
  /**
   * 清理当前 Attempt 的精确 overlay。
   * @returns 清理完成
   */
  dispose(): Promise<void>;
}

/** stage_file_write 输入。 */
interface StageFileWriteInput {
  /** 目标路径。 */
  readonly path: string;
  /** 候选全文。 */
  readonly content: string;
}

/** stage_file_edit 输入。 */
interface StageFileEditInput {
  /** 目标路径。 */
  readonly path: string;
  /** 精确匹配文本。 */
  readonly oldString: string;
  /** 替换文本。 */
  readonly newString: string;
  /** 是否替换全部匹配。 */
  readonly replaceAll: boolean;
}

/** staged 工具输入联合。 */
type StageFileInput = StageFileWriteInput | StageFileEditInput;

/** staged 调用授权成功事实。 */
interface StageAuthorization {
  /** 成功判别。 */
  readonly ok: true;
  /** 重新读取的 registry 条目。 */
  readonly entry: ToolRegistryEntry;
  /** 已验证输入。 */
  readonly input: StageFileInput;
}

/** staged 调用拒绝事实。 */
interface StageDenial {
  /** 失败判别。 */
  readonly ok: false;
  /** 可直接返回模型的规范化结果。 */
  readonly result: AIToolExecutionResult;
}

/** staged 调用授权结果。 */
type StageDecision = StageAuthorization | StageDenial;

/**
 * 判断值是否为普通输入对象。
 * @param value - Provider 输入
 * @returns 是否可按字段安全读取
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 判断对象是否只含允许字段。
 * @param value - Provider 输入对象
 * @param allowedKeys - Schema 字段
 * @returns 是否没有额外字段
 */
function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key): boolean => allowedKeys.has(key));
}

/**
 * 读取非空目标路径。
 * @param value - 未可信字段
 * @returns 规整路径或 undefined
 */
function readPath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

/**
 * 创建包含稳定机器原因的工具失败。
 * @param toolName - 被拒绝工具
 * @param code - 工具错误码
 * @param reason - 稳定失败原因
 * @param message - 展示消息
 * @returns 失败结果
 */
function createFailure(toolName: string, code: AIToolExecutionError['code'], reason: string, message: string): AIToolExecutionResult {
  return {
    toolName,
    status: 'failure',
    error: {
      code,
      message,
      details: { reason, toolName }
    }
  };
}

/**
 * 创建冻结策略拒绝。
 * @param toolName - 被拒绝工具
 * @param reason - 稳定原因
 * @returns staged denial
 */
function denyTool(toolName: string, reason: string): StageDenial {
  return {
    ok: false,
    result: createFailure(toolName, 'protocol_error', reason, 'Child staged tool invocation was rejected by the frozen execution plan')
  };
}

/**
 * 创建输入拒绝。
 * @param toolName - 被拒绝工具
 * @param reason - 稳定原因
 * @returns staged denial
 */
function denyInput(toolName: string, reason: string): StageDenial {
  return {
    ok: false,
    result: createFailure(toolName, 'INVALID_INPUT', reason, 'Child staged tool input is invalid')
  };
}

/**
 * 解析 staged file 工具输入。
 * @param toolName - staged 工具名
 * @param input - Provider 输入
 * @returns 验证后的输入或拒绝
 */
function parseStageInput(toolName: string, input: unknown): StageFileInput | StageDenial {
  if (!isRecord(input)) return denyInput(toolName, 'staged_input_not_object');
  const targetPath = readPath(input.path);
  if (toolName === STAGE_FILE_WRITE_TOOL_NAME) {
    if (!hasOnlyKeys(input, new Set(['path', 'content'])) || !targetPath || typeof input.content !== 'string') {
      return denyInput(toolName, 'stage_file_write_input_invalid');
    }
    return { path: targetPath, content: input.content };
  }
  if (toolName === STAGE_FILE_EDIT_TOOL_NAME) {
    if (
      !hasOnlyKeys(input, new Set(['path', 'oldString', 'newString', 'replaceAll'])) ||
      !targetPath ||
      typeof input.oldString !== 'string' ||
      typeof input.newString !== 'string' ||
      (input.replaceAll !== undefined && typeof input.replaceAll !== 'boolean')
    ) {
      return denyInput(toolName, 'stage_file_edit_input_invalid');
    }
    return {
      path: targetPath,
      oldString: input.oldString,
      newString: input.newString,
      replaceAll: input.replaceAll ?? false
    };
  }
  return denyTool(toolName, 'tool_not_allowed');
}

/**
 * 每次调用重新验证 staged registry 与冻结 Plan。
 * @param toolName - staged 工具名
 * @param dependencies - 当前冻结事实
 * @returns registry 条目或拒绝
 */
function validateStagePlan(toolName: string, dependencies: ChildWriteToolDependencies): ToolRegistryEntry | StageDenial {
  const entry = getToolRegistryEntry(toolName);
  const frozenEffect = dependencies.plan.toolEffectSet.find((effect): boolean => effect.toolName === toolName);
  if (
    !STAGED_TOOL_NAMES.has(toolName) ||
    !entry ||
    entry.runtime !== 'main' ||
    entry.executionClass !== 'direct' ||
    entry.effect.effect !== 'staged_file_write' ||
    entry.effect.resourceScopeResolver !== 'file-path' ||
    entry.effect.commitAdapter !== AGENT_FILE_COMMIT_ADAPTER ||
    !entry.effect.reversible
  ) {
    return denyTool(toolName, 'registry_capability_unavailable');
  }
  if (
    dependencies.plan.commitPolicy.mode !== 'staged' ||
    dependencies.plan.commitPolicy.adapter !== AGENT_FILE_COMMIT_ADAPTER ||
    dependencies.plan.permissionSnapshot.scopeIds.length === 0 ||
    !dependencies.plan.capabilitySet.includes(toolName) ||
    frozenEffect?.effect !== 'staged_file_write'
  ) {
    return denyTool(toolName, 'frozen_capability_denied');
  }
  return entry;
}

/**
 * 校验调用 Runtime 仍属于创建 overlay 的冻结 Attempt。
 * @param input - guard 调用
 * @param dependencies - Task/Attempt/Runtime 事实
 * @returns 身份是否完全一致
 */
function hasRuntimeIdentity(input: RuntimeToolGuardInput, dependencies: ChildWriteToolDependencies): boolean {
  return (
    input.runtime.sessionId === dependencies.task.sessionId &&
    input.runtime.turnId === dependencies.task.turnId &&
    input.runtime.agentId === dependencies.task.agentId &&
    input.runtime.runtimeId === dependencies.runtimeId &&
    input.runtime.rootRuntimeId === dependencies.task.rootRuntimeId &&
    input.runtime.parentAgentId === dependencies.task.parentAgentId &&
    input.runtime.parentRuntimeId === dependencies.attempt.parentRuntimeId
  );
}

/**
 * 把 overlay 错误投影为不泄露本地路径的工具结果。
 * @param toolName - staged 工具名
 * @param reason - 未知 reject 原因
 * @returns 规范化失败
 */
function mapOverlayFailure(toolName: string, reason: unknown): AIToolExecutionResult {
  if (!(reason instanceof AgentWriteOverlayError)) {
    return createFailure(toolName, 'EXECUTION_FAILED', 'overlay_execution_failed', 'Child staged tool execution failed');
  }
  const stableReason = typeof reason.details.reason === 'string' ? reason.details.reason : 'overlay_execution_failed';
  let code: AIToolExecutionError['code'] = 'EXECUTION_FAILED';
  if (reason.code === 'stale_context') code = 'STALE_CONTEXT';
  else if (reason.code === 'resource_scope_invalid') code = 'PERMISSION_DENIED';
  else if (stableReason.startsWith('edit_match_') || stableReason.endsWith('_limit_exceeded')) code = 'INVALID_INPUT';
  return createFailure(toolName, code, stableReason, reason.message);
}

/**
 * 完成一次 staged 工具授权。
 * @param input - guard 调用
 * @param dependencies - 冻结依赖
 * @param signal - 当前组合取消信号
 * @returns 授权事实或拒绝
 */
async function authorizeStage(input: RuntimeToolGuardInput, dependencies: ChildWriteToolDependencies, signal: AbortSignal): Promise<StageDecision> {
  if (signal.aborted) return { ok: false, result: createMainToolCancelledResult(input.toolName) };
  if (input.source !== 'main') return denyTool(input.toolName, 'non_local_result_forbidden');
  if (!hasRuntimeIdentity(input, dependencies)) return denyTool(input.toolName, 'runtime_identity_mismatch');
  const entry = validateStagePlan(input.toolName, dependencies);
  if ('ok' in entry) return entry;
  const parsedInput = parseStageInput(input.toolName, input.input);
  if ('ok' in parsedInput) return parsedInput;

  const [targetResult] = await Promise.allSettled([validateAgentOverlayTarget(parsedInput.path, dependencies.workspaceRoot, dependencies.plan.resourceScopes)]);
  if (targetResult.status === 'rejected') {
    return { ok: false, result: mapOverlayFailure(input.toolName, targetResult.reason) };
  }
  if (signal.aborted) return { ok: false, result: createMainToolCancelledResult(input.toolName) };
  return { ok: true, entry, input: parsedInput };
}

/**
 * 投影当前仍有效的 staged 工具 Schema。
 * @param dependencies - write 工具依赖
 * @returns 当前 Plan 可见 staged schemas
 */
function createStageSchemas(dependencies: ChildWriteToolDependencies): AITransportTool[] {
  return dependencies.plan.capabilitySet.flatMap((toolName): AITransportTool[] => {
    const entry = validateStagePlan(toolName, dependencies);
    if ('ok' in entry) return [];
    return [
      {
        name: entry.definition.name,
        description: typeof entry.definition.description === 'function' ? entry.definition.description() : entry.definition.description,
        parameters: entry.definition.parameters as AITransportTool['parameters']
      }
    ];
  });
}

/**
 * 创建 write Child Runtime 的纯读与 staged 工具集。
 * @param dependencies - 冻结 Task/Attempt/Plan、目录与取消信号
 * @returns 可挂载到 stream executor 的工具边界
 */
export async function createChildWriteTools(dependencies: ChildWriteToolDependencies): Promise<ChildWriteTools> {
  const overlay = await createAgentWriteOverlay(dependencies);
  const readTools = createChildReadTools({
    plan: dependencies.plan,
    workspaceRoot: dependencies.workspaceRoot,
    signal: dependencies.signal
  });

  const guardToolCall: RuntimeToolGuard = async (input: RuntimeToolGuardInput): Promise<AIToolExecutionResult | null> => {
    if (!STAGED_TOOL_NAMES.has(input.toolName)) return readTools.guardToolCall(input);
    const decision = await authorizeStage(input, dependencies, dependencies.signal);
    return decision.ok ? null : decision.result;
  };

  const executeMainTool: ChatRuntimeMainToolExecutor = async (input): Promise<AIToolExecutionResult> => {
    if (!STAGED_TOOL_NAMES.has(input.toolName)) return readTools.executeMainTool(input);
    const signal = input.signal ?? dependencies.signal;
    const decision = await authorizeStage({ ...input, source: 'main' }, dependencies, signal);
    if (!decision.ok) return decision.result;
    const operation =
      input.toolName === STAGE_FILE_WRITE_TOOL_NAME
        ? overlay.writeFile(decision.input as StageFileWriteInput)
        : overlay.editFile(decision.input as StageFileEditInput);
    const [result] = await Promise.allSettled([operation]);
    if (signal.aborted) return createMainToolCancelledResult(input.toolName);
    if (result.status === 'rejected') return mapOverlayFailure(input.toolName, result.reason);
    return { toolName: input.toolName, status: 'success', data: result.value };
  };

  return {
    tools: [...readTools.tools, ...createStageSchemas(dependencies)],
    guardToolCall,
    executeMainTool,
    prepare: (): Promise<AgentChangesetSnapshot | null> => overlay.prepare(),
    dispose: (): Promise<void> => overlay.dispose()
  };
}
