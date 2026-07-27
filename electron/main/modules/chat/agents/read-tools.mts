/**
 * @file read-tools.mts
 * @description 为 Child Runtime 提供按冻结计划逐次授权、无需 Renderer Bridge 的本地纯读工具。
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { RuntimeToolGuard, RuntimeToolGuardInput } from '../runtime/stream/types.mjs';
import type { ChatRuntimeMainToolExecutor } from '../runtime/types.mjs';
import type { AIToolExecutionResult, AITransportTool } from 'types/ai';
import type { AgentExecutionPlanSnapshot } from 'types/chat-agent';
import { getToolRegistryEntry, type ToolRegistryEntry } from '../../../../../shared/ai/tools/index.js';
import { readWorkspaceDirectory, readWorkspaceFile } from '../../workspace/read.mjs';
import {
  DEFAULT_FILE_SEARCH_EXCLUDED_DIRS,
  DEFAULT_FILE_SEARCH_LIMIT,
  DEFAULT_GREP_BATCH_SIZE,
  DEFAULT_GREP_LINE_TEXT_LIMIT,
  DEFAULT_GREP_STDERR_LIMIT_BYTES,
  DEFAULT_GREP_STDOUT_LIMIT_BYTES,
  DEFAULT_GREP_TIMEOUT_MS,
  runGlobSearch,
  runGrepSearch
} from '../runtime/tools/file-search.mjs';
import { createMainToolCancelledResult, createMainToolFailureResult, createMainToolSuccessResult } from '../runtime/tools/results.mjs';

/** 首版 Child Runtime 允许的工具与可信资源 resolver。 */
const CHILD_READ_RESOLVERS = new Map<string, string>([
  ['glob', 'glob-root'],
  ['grep', 'grep-root'],
  ['read_directory', 'directory-path'],
  ['read_file', 'file-path']
]);

/** read_file 输入。 */
interface ChildReadFileInput {
  /** 文件路径。 */
  path: string;
  /** 可选起始行。 */
  offset?: number;
  /** 可选读取行数。 */
  limit?: number;
}

/** read_directory 输入。 */
interface ChildReadDirectoryInput {
  /** 目录路径。 */
  path: string;
}

/** glob 输入。 */
interface ChildGlobInput {
  /** Glob 模式。 */
  pattern: string;
  /** 可选搜索根目录。 */
  path?: string;
}

/** grep 输入。 */
interface ChildGrepInput {
  /** grep -E 模式。 */
  pattern: string;
  /** 可选搜索根。 */
  path?: string;
  /** 可选候选文件 Glob。 */
  include?: string;
}

/** 四种纯读输入的判别联合。 */
type ChildReadInput = ChildReadFileInput | ChildReadDirectoryInput | ChildGlobInput | ChildGrepInput;

/** 工具授权成功后冻结到单次调用的事实。 */
interface ChildReadAuthorization {
  /** 授权判别。 */
  readonly ok: true;
  /** 本次调用重新读取的 registry 条目。 */
  readonly entry: ToolRegistryEntry;
  /** 通过 realpath 解析的目标。 */
  readonly targetPath: string;
  /** 已按具体工具验证的输入。 */
  readonly input: ChildReadInput;
}

/** 工具授权失败。 */
interface ChildReadDenial {
  /** 拒绝判别。 */
  readonly ok: false;
  /** 可直接投影给模型的规范化结果。 */
  readonly result: AIToolExecutionResult;
}

/** 工具授权判别结果。 */
type ChildReadDecision = ChildReadAuthorization | ChildReadDenial;

/** Child 纯读工具集创建依赖。 */
export interface ChildReadToolDependencies {
  /** 不可变执行计划。 */
  readonly plan: AgentExecutionPlanSnapshot;
  /** Checkpoint 冻结工作区真实路径。 */
  readonly workspaceRoot: string;
  /** Child Runtime cooperative cancellation 信号。 */
  readonly signal: AbortSignal;
}

/** Child Runtime 可直接挂载到 stream executor 的工具边界。 */
export interface ChildReadTools {
  /** 仅含冻结 capability 的传输 Schema。 */
  readonly tools: AITransportTool[];
  /** 任何结果或执行前的强制授权钩子。 */
  readonly guardToolCall: RuntimeToolGuard;
  /** 不经过 Renderer Bridge 的本地纯读执行器。 */
  readonly executeMainTool: ChatRuntimeMainToolExecutor;
}

/**
 * 判断值是否为普通输入对象。
 * @param value - Provider 输入
 * @returns 是否可以按字段安全读取
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 判断对象是否只含允许字段。
 * @param value - Provider 输入对象
 * @param allowedKeys - 工具 Schema 允许字段
 * @returns 是否没有额外字段
 */
function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key): boolean => allowedKeys.has(key));
}

/**
 * 读取非空字符串。
 * @param value - 未可信字段
 * @returns 规整字符串或 undefined
 */
function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

/**
 * 读取可选正整数。
 * @param value - 未可信字段
 * @returns 正整数、undefined 或非法标记 null
 */
function readPositiveInt(value: unknown): number | undefined | null {
  if (value === undefined) return undefined;
  return Number.isInteger(value) && (value as number) > 0 ? (value as number) : null;
}

/**
 * 创建协议拒绝结果。
 * @param toolName - 被拒绝工具
 * @param reason - 稳定机器原因
 * @returns 工具失败结果
 */
function denyTool(toolName: string, reason: string): ChildReadDenial {
  return {
    ok: false,
    result: {
      toolName,
      status: 'failure',
      error: {
        code: 'protocol_error',
        message: 'Child tool invocation was rejected by the frozen execution plan',
        details: { reason, toolName }
      }
    }
  };
}

/**
 * 创建输入拒绝结果。
 * @param toolName - 被拒绝工具
 * @param reason - 稳定机器原因
 * @returns 工具失败结果
 */
function denyInput(toolName: string, reason: string): ChildReadDenial {
  return {
    ok: false,
    result: {
      toolName,
      status: 'failure',
      error: {
        code: 'INVALID_INPUT',
        message: 'Child read tool input is invalid',
        details: { reason, toolName }
      }
    }
  };
}

/**
 * 按工具 Schema 解析最小输入。
 * @param toolName - 工具名称
 * @param input - Provider 输入
 * @returns 已验证输入或拒绝
 */
function parseToolInput(toolName: string, input: unknown): ChildReadInput | ChildReadDenial {
  if (!isRecord(input)) return denyInput(toolName, 'input_not_object');

  if (toolName === 'read_file') {
    const offset = readPositiveInt(input.offset);
    const limit = readPositiveInt(input.limit);
    const filePath = readString(input.path);
    if (!hasOnlyKeys(input, new Set(['path', 'offset', 'limit'])) || !filePath || offset === null || limit === null) {
      return denyInput(toolName, 'read_file_input_invalid');
    }
    return { path: filePath, ...(offset ? { offset } : {}), ...(limit ? { limit } : {}) };
  }

  if (toolName === 'read_directory') {
    const directoryPath = readString(input.path);
    if (!hasOnlyKeys(input, new Set(['path'])) || !directoryPath) return denyInput(toolName, 'read_directory_input_invalid');
    return { path: directoryPath };
  }

  if (toolName === 'glob') {
    const pattern = readString(input.pattern);
    const rootPath = input.path === undefined ? undefined : readString(input.path);
    if (!hasOnlyKeys(input, new Set(['pattern', 'path'])) || !pattern || (input.path !== undefined && !rootPath)) {
      return denyInput(toolName, 'glob_input_invalid');
    }
    return { pattern, ...(rootPath ? { path: rootPath } : {}) };
  }

  if (toolName === 'grep') {
    const pattern = readString(input.pattern);
    const rootPath = input.path === undefined ? undefined : readString(input.path);
    const include = input.include === undefined ? undefined : readString(input.include);
    if (
      !hasOnlyKeys(input, new Set(['pattern', 'path', 'include'])) ||
      !pattern ||
      (input.path !== undefined && !rootPath) ||
      (input.include !== undefined && !include)
    ) {
      return denyInput(toolName, 'grep_input_invalid');
    }
    return { pattern, ...(rootPath ? { path: rootPath } : {}), ...(include ? { include } : {}) };
  }

  return denyTool(toolName, 'tool_not_allowed');
}

/**
 * 判断真实路径是否落入一个冻结 scope。
 * @param targetPath - 目标真实路径
 * @param resourceScope - 冻结资源范围
 * @returns 是否被此 scope 覆盖
 */
function matchesScope(targetPath: string, resourceScope: string): boolean {
  if (resourceScope.startsWith('file:')) return targetPath === resourceScope.slice('file:'.length);
  if (!resourceScope.startsWith('directory:') || !resourceScope.endsWith('/**')) return false;

  const rootPath = resourceScope.slice('directory:'.length, -'/**'.length);
  const relativePath = path.relative(rootPath, targetPath);
  return relativePath === '' || (!relativePath.startsWith(`..${path.sep}`) && relativePath !== '..' && !path.isAbsolute(relativePath));
}

/**
 * 将 Provider 路径解析为真实绝对路径。
 * @param rawPath - Provider 路径或空值
 * @param workspaceRoot - 冻结工作区
 * @returns 真实路径或稳定失败原因
 */
async function resolveRealPath(rawPath: string | undefined, workspaceRoot: string): Promise<{ ok: true; path: string } | { ok: false; reason: string }> {
  const targetPath = rawPath ?? workspaceRoot;
  if (targetPath.startsWith('unsaved://')) return { ok: false, reason: 'unsaved_resource_forbidden' };
  const candidatePath = path.isAbsolute(targetPath) ? targetPath : path.resolve(workspaceRoot, targetPath);
  const [result] = await Promise.allSettled([fs.realpath(candidatePath)]);
  if (result.status === 'rejected') return { ok: false, reason: 'resource_realpath_failed' };
  return { ok: true, path: result.value };
}

/**
 * 重新校验 registry 与冻结计划。
 * @param toolName - 工具名称
 * @param plan - 冻结执行计划
 * @returns 当前 registry 条目或拒绝
 */
function validateToolPlan(toolName: string, plan: AgentExecutionPlanSnapshot): ToolRegistryEntry | ChildReadDenial {
  const expectedResolver = CHILD_READ_RESOLVERS.get(toolName);
  const entry = getToolRegistryEntry(toolName);
  const frozenEffect = plan.toolEffectSet.find((effect): boolean => effect.toolName === toolName);
  if (
    !expectedResolver ||
    !entry ||
    entry.runtime !== 'main' ||
    entry.executionClass !== 'direct' ||
    entry.effect.effect !== 'pure_read' ||
    entry.effect.resourceScopeResolver !== expectedResolver ||
    !entry.effect.reversible
  ) {
    return denyTool(toolName, 'registry_capability_unavailable');
  }
  if (
    plan.commitPolicy.mode !== 'none' ||
    plan.permissionSnapshot.scopeIds.length === 0 ||
    !plan.capabilitySet.includes(toolName) ||
    frozenEffect?.effect !== 'pure_read'
  ) {
    return denyTool(toolName, 'frozen_capability_denied');
  }
  return entry;
}

/**
 * 完成单次 Child 工具授权。
 * @param guardInput - stream executor 提供的可信来源和调用
 * @param dependencies - 冻结计划依赖
 * @returns 授权事实或规范化拒绝
 */
async function authorizeTool(guardInput: RuntimeToolGuardInput, dependencies: ChildReadToolDependencies): Promise<ChildReadDecision> {
  if (dependencies.signal.aborted) {
    return { ok: false, result: createMainToolCancelledResult(guardInput.toolName) };
  }
  if (guardInput.source !== 'main') return denyTool(guardInput.toolName, 'non_local_result_forbidden');

  const entry = validateToolPlan(guardInput.toolName, dependencies.plan);
  if ('ok' in entry) return entry;
  const parsedInput = parseToolInput(guardInput.toolName, guardInput.input);
  if ('ok' in parsedInput) return parsedInput;
  const targetInput = 'path' in parsedInput ? parsedInput.path : undefined;
  const resolvedPath = await resolveRealPath(targetInput, dependencies.workspaceRoot);
  if (!resolvedPath.ok) return denyTool(guardInput.toolName, resolvedPath.reason);
  if (!dependencies.plan.resourceScopes.some((scope): boolean => matchesScope(resolvedPath.path, scope))) {
    return denyTool(guardInput.toolName, 'resource_scope_denied');
  }
  if (dependencies.signal.aborted) {
    return { ok: false, result: createMainToolCancelledResult(guardInput.toolName) };
  }
  return {
    ok: true,
    entry,
    targetPath: resolvedPath.path,
    input: parsedInput
  };
}

/**
 * 执行一次已重复授权的纯读 I/O。
 * @param toolName - 工具名称
 * @param authorization - 当前调用授权事实
 * @param signal - 组合取消信号
 * @returns 规范化工具结果
 */
async function executeAuthorized(toolName: string, authorization: ChildReadAuthorization, signal: AbortSignal): Promise<AIToolExecutionResult> {
  if (signal.aborted) return createMainToolCancelledResult(toolName);

  let operation: Promise<unknown>;
  if (toolName === 'read_file') {
    const input = authorization.input as ChildReadFileInput;
    operation = readWorkspaceFile({
      filePath: authorization.targetPath,
      ...(input.offset ? { offset: input.offset } : {}),
      ...(input.limit ? { limit: input.limit } : {})
    });
  } else if (toolName === 'read_directory') {
    operation = readWorkspaceDirectory({ directoryPath: authorization.targetPath });
  } else if (toolName === 'glob') {
    const input = authorization.input as ChildGlobInput;
    operation = runGlobSearch({
      rootPath: authorization.targetPath,
      pattern: input.pattern,
      limit: DEFAULT_FILE_SEARCH_LIMIT,
      excludedDirs: DEFAULT_FILE_SEARCH_EXCLUDED_DIRS,
      signal
    });
  } else if (toolName === 'grep') {
    const input = authorization.input as ChildGrepInput;
    operation = runGrepSearch({
      rootPath: authorization.targetPath,
      pattern: input.pattern,
      ...(input.include ? { include: input.include } : {}),
      limit: DEFAULT_FILE_SEARCH_LIMIT,
      batchSize: DEFAULT_GREP_BATCH_SIZE,
      excludedDirs: DEFAULT_FILE_SEARCH_EXCLUDED_DIRS,
      timeoutMs: DEFAULT_GREP_TIMEOUT_MS,
      stdoutLimitBytes: DEFAULT_GREP_STDOUT_LIMIT_BYTES,
      stderrLimitBytes: DEFAULT_GREP_STDERR_LIMIT_BYTES,
      lineTextLimit: DEFAULT_GREP_LINE_TEXT_LIMIT,
      signal
    });
  } else {
    return createMainToolFailureResult(toolName, 'protocol_error', 'Unsupported Child read tool');
  }

  const [result] = await Promise.allSettled([operation]);
  if (signal.aborted) return createMainToolCancelledResult(toolName);
  if (result.status === 'rejected') {
    const message = result.reason instanceof Error ? result.reason.message : 'Child read tool execution failed';
    return createMainToolFailureResult(toolName, 'EXECUTION_FAILED', message);
  }
  return createMainToolSuccessResult(toolName, result.value);
}

/**
 * 将当前 registry 定义投影为模型可见 Schema。
 * @param plan - 冻结执行计划
 * @returns 仅含当前仍可用能力的传输工具
 */
function createToolSchemas(plan: AgentExecutionPlanSnapshot): AITransportTool[] {
  return plan.capabilitySet.flatMap((toolName): AITransportTool[] => {
    const entry = validateToolPlan(toolName, plan);
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
 * 创建 Child Runtime 受限只读工具集。
 * @param dependencies - 冻结执行计划、工作区和取消信号
 * @returns Schema、强制 guard 和本地主进程 executor
 */
export function createChildReadTools(dependencies: ChildReadToolDependencies): ChildReadTools {
  const guardToolCall: RuntimeToolGuard = async (input: RuntimeToolGuardInput): Promise<AIToolExecutionResult | null> => {
    const decision = await authorizeTool(input, dependencies);
    return decision.ok ? null : decision.result;
  };

  const executeMainTool: ChatRuntimeMainToolExecutor = async (input): Promise<AIToolExecutionResult> => {
    const signal = input.signal ?? dependencies.signal;
    const decision = await authorizeTool({ ...input, source: 'main' }, { ...dependencies, signal });
    if (!decision.ok) return decision.result;
    return executeAuthorized(input.toolName, decision, signal);
  };

  return {
    tools: createToolSchemas(dependencies.plan),
    guardToolCall,
    executeMainTool
  };
}
