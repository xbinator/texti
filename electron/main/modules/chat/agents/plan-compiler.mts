/**
 * @file plan-compiler.mts
 * @description 编译并恢复只能单调收缩的本地 read 或 staged-write Child Execution Plan。
 */
import type { AgentScopeResult } from './resource-scopes.mjs';
import type { AgentCheckpointRecord, AgentTaskRecord } from './types.mjs';
import type { ToolRegistryEntry } from '../../../../../shared/ai/tools/index.js';
import type { AgentBudgetSnapshot, AgentExecutionPlanSnapshot, AgentModelSnapshot, AgentResourceReference, AgentTaskError } from 'types/chat-agent';
import {
  AGENT_FILE_COMMIT_ADAPTER,
  AGENT_PLAN_SCHEMA_VERSION,
  AGENT_READ_PLAN_POLICY_VERSION,
  AGENT_WRITE_PLAN_POLICY_VERSION,
  hashExecutionPlanSnapshot,
  validateExecutionPlanSnapshot,
  type AgentExecutionPlanBody
} from './contracts.mjs';

/** Child Runtime 允许的工具与冻结 resolver 映射。 */
const CHILD_TOOL_RESOLVERS = new Map<string, string>([
  ['glob', 'glob-root'],
  ['grep', 'grep-root'],
  ['read_directory', 'directory-path'],
  ['read_file', 'file-path'],
  ['stage_file_edit', 'file-path'],
  ['stage_file_write', 'file-path']
]);

/** 计划编译器外部可信依赖。 */
export interface AgentPlanCompilerDependencies {
  /**
   * 解析契约资源。
   * @param resources - 不可变资源引用
   * @param workspaceRoot - Primary 冻结工作区
   * @returns 完整 scope 集合或失败
   */
  resolveScopes(resources: readonly AgentResourceReference[], workspaceRoot: string): AgentScopeResult;
  /**
   * 读取当前工具 registry 事实。
   * @param toolName - 工具名称
   * @returns 当前 registry 条目
   */
  getToolEntry(toolName: string): ToolRegistryEntry | undefined;
  /**
   * 判断当前 Child mode policy 是否允许工具。
   * @param toolName - 工具名称
   * @returns 是否允许
   */
  isToolAllowed(toolName: string): boolean;
  /**
   * 判断冻结模型是否支持工具调用。
   * @param modelSnapshot - Checkpoint 冻结模型
   * @returns 是否支持工具调用
   */
  isModelToolCapable(modelSnapshot: AgentModelSnapshot): boolean;
}

/** 新计划编译输入。 */
export interface AgentPlanCompileInput {
  /** created 状态的持久化 Task。 */
  readonly task: AgentTaskRecord;
  /** Task 所属 waiting_children Checkpoint。 */
  readonly checkpoint: AgentCheckpointRecord;
  /** Runtime A 冻结工具 schema 中的名称。 */
  readonly parentToolNames: readonly string[];
  /** 当前主进程实际可用工具名称。 */
  readonly availableToolNames: readonly string[];
  /** 可信权限系统返回的 scope IDs。 */
  readonly permissionScopeIds: readonly string[];
  /** Runtime A 冻结工作区。 */
  readonly workspaceRoot: string;
  /** Task 预算分配器返回的额度。 */
  readonly budget: AgentBudgetSnapshot;
}

/** 新计划编译结果。 */
export type AgentPlanCompileResult =
  | {
      /** 编译成功。 */
      readonly ok: true;
      /** 已验证并深冻结的不可变计划。 */
      readonly plan: Readonly<AgentExecutionPlanSnapshot>;
    }
  | {
      /** 编译失败。 */
      readonly ok: false;
      /** 稳定机器错误。 */
      readonly error: AgentTaskError;
    };

/** Runtime 恢复过程中只能继续收缩的有效上限。 */
export interface AgentEffectivePlan {
  /** persisted ∩ previous ∩ available ∩ current policy。 */
  readonly effectiveCapabilitySet: readonly string[];
  /** 只能收缩的权限集合。 */
  readonly effectivePermissionScopeIds: readonly string[];
  /** 只能收缩的资源集合。 */
  readonly effectiveResourceScopes: readonly string[];
  /** 不超过持久化额度和当前额度的预算。 */
  readonly effectiveBudget: Readonly<AgentBudgetSnapshot>;
}

/** 已持久化计划的恢复输入。 */
export interface AgentPlanRestoreInput {
  /** 持有不可变计划的 Task。 */
  readonly task: AgentTaskRecord;
  /** Task 所属 Checkpoint。 */
  readonly checkpoint: AgentCheckpointRecord;
  /** 当前仍可用工具。 */
  readonly availableToolNames: readonly string[];
  /** 当前仍可用权限 scope。 */
  readonly permissionScopeIds: readonly string[];
  /** 当前仍可访问资源 scope。 */
  readonly resourceScopes: readonly string[];
  /** 当前预算上限。 */
  readonly budget: AgentBudgetSnapshot;
  /** 上一次恢复得到的有效上限；首次恢复显式传 null。 */
  readonly previousEffective: Readonly<AgentEffectivePlan> | null;
}

/** 不修改持久化计划的运行时恢复投影。 */
export interface AgentRestoredPlan extends AgentEffectivePlan {
  /** 按原版本重新校验并冻结的不可变 Execution Plan。 */
  readonly persistedPlan: Readonly<AgentExecutionPlanSnapshot>;
}

/** 计划恢复结果。 */
export type AgentPlanRestoreResult =
  | {
      /** 恢复成功。 */
      readonly ok: true;
      /** 可替换 Runtime 使用的易失有效计划。 */
      readonly restored: Readonly<AgentRestoredPlan>;
    }
  | {
      /** 恢复失败。 */
      readonly ok: false;
      /** 稳定恢复错误。 */
      readonly error: AgentTaskError;
    };

/**
 * 创建计划阶段错误。
 * @param code - 稳定错误码
 * @param phase - 计划或恢复阶段
 * @param category - 错误类别
 * @param reason - 稳定原因
 * @param message - 展示说明
 * @returns 失败结果中的结构化错误
 */
function createPlanError(
  code: AgentTaskError['code'],
  phase: 'plan_validation' | 'recovery',
  category: AgentTaskError['category'],
  reason: string,
  message: string
): AgentTaskError {
  return {
    code,
    phase,
    category,
    retryable: false,
    message,
    details: { reason }
  };
}

/**
 * 规范化排序去重的可信字符串集合。
 * @param values - 候选字符串
 * @returns 非空字符串集合
 */
function normalizeStringSet(values: readonly string[]): string[] {
  return [...new Set(values.map((value): string => value.trim()).filter(Boolean))].sort();
}

/**
 * 判断 Task 与 Checkpoint 是否为同一活动聚合。
 * @param task - 待授权或恢复 Task
 * @param checkpoint - 聚合根 Checkpoint
 * @returns 身份是否精确匹配
 */
function hasMatchingAggregate(task: AgentTaskRecord, checkpoint: AgentCheckpointRecord): boolean {
  const orderedCall = checkpoint.continuationSnapshot.orderedToolCalls.find((entry): boolean => entry.taskId === task.taskId);
  return (
    task.recordState === 'active' &&
    checkpoint.recordState === 'active' &&
    checkpoint.status === 'waiting_children' &&
    task.checkpointId === checkpoint.checkpointId &&
    task.sessionId === checkpoint.sessionId &&
    task.turnId === checkpoint.turnId &&
    task.parentAgentId === checkpoint.primaryAgentId &&
    task.rootRuntimeId === checkpoint.rootRuntimeId &&
    orderedCall?.toolCallId === task.toolCallId
  );
}

/**
 * 判断 registry 条目是否仍满足 Task mode 的本地能力策略。
 * @param toolName - 工具名称
 * @param entry - 当前 registry 条目
 * @param resources - Task 契约资源
 * @param mode - Task 读写模式
 * @param dependencies - 当前安全策略依赖
 * @returns 是否可以进入有效能力集合
 */
function isSafeTool(
  toolName: string,
  entry: ToolRegistryEntry | undefined,
  resources: readonly AgentResourceReference[],
  mode: AgentTaskRecord['contractSnapshot']['mode'],
  dependencies: AgentPlanCompilerDependencies
): boolean {
  const expectedResolver = CHILD_TOOL_RESOLVERS.get(toolName);
  const allowedEffects = mode === 'write' ? new Set(['pure_read', 'staged_file_write']) : new Set(['pure_read']);
  if (
    !entry ||
    !expectedResolver ||
    entry.definition.name !== toolName ||
    entry.runtime !== 'main' ||
    entry.executionClass !== 'direct' ||
    !allowedEffects.has(entry.effect.effect) ||
    entry.effect.resourceScopeResolver !== expectedResolver ||
    (entry.effect.effect === 'staged_file_write' && entry.effect.commitAdapter !== AGENT_FILE_COMMIT_ADAPTER) ||
    !dependencies.isToolAllowed(toolName)
  ) {
    return false;
  }
  const resourceKinds = new Set(resources.map((resource): AgentResourceReference['kind'] => resource.kind));
  if (entry.effect.effect === 'staged_file_write') return resourceKinds.has('file') || resourceKinds.has('directory');
  if (toolName === 'read_file') return resourceKinds.has('file');
  if (toolName === 'grep') return resourceKinds.has('file') || resourceKinds.has('directory');
  return resourceKinds.has('directory');
}

/**
 * 创建 plan compiler 的失败结果。
 * @param error - 结构化错误
 * @returns 判别失败
 */
function compileFailure(error: AgentTaskError): AgentPlanCompileResult {
  return { ok: false, error };
}

/**
 * 编译一个 contract-bound、模型继承且符合 Task mode 的计划。
 * @param input - 持久化事实与可信授权输入
 * @param dependencies - registry、scope 和 policy 依赖
 * @returns 深冻结计划或结构化错误
 */
export function compileAgentPlan(input: AgentPlanCompileInput, dependencies: AgentPlanCompilerDependencies): AgentPlanCompileResult {
  if (!hasMatchingAggregate(input.task, input.checkpoint) || input.task.status !== 'created') {
    return compileFailure(
      createPlanError('protocol_error', 'plan_validation', 'protocol', 'plan_aggregate_identity_invalid', 'Task 与 Checkpoint 不是可授权的同一聚合')
    );
  }
  const { modelSnapshot } = input.checkpoint.continuationSnapshot;
  if (!dependencies.isModelToolCapable(modelSnapshot)) {
    return compileFailure(createPlanError('capability_denied', 'plan_validation', 'policy', 'plan_model_tools_unsupported', '冻结模型不支持工具调用'));
  }
  const scopeResolution = dependencies.resolveScopes(input.task.contractSnapshot.resources, input.workspaceRoot);
  if (!scopeResolution.ok) return compileFailure(scopeResolution.error);
  const permissionScopeIds = normalizeStringSet(input.permissionScopeIds);
  if (permissionScopeIds.length === 0) {
    return compileFailure(createPlanError('capability_denied', 'plan_validation', 'policy', 'plan_permission_empty', 'Child Task 没有可用权限范围'));
  }

  const parentTools = new Set(normalizeStringSet(input.parentToolNames));
  const availableTools = new Set(normalizeStringSet(input.availableToolNames));
  const taskMode = input.task.contractSnapshot.mode;
  const capabilitySet = normalizeStringSet(input.task.contractSnapshot.requestedTools).filter((toolName): boolean => {
    return (
      parentTools.has(toolName) &&
      availableTools.has(toolName) &&
      isSafeTool(toolName, dependencies.getToolEntry(toolName), input.task.contractSnapshot.resources, taskMode, dependencies)
    );
  });
  if (capabilitySet.length === 0) {
    return compileFailure(createPlanError('capability_denied', 'plan_validation', 'policy', 'plan_capability_empty', '请求能力经安全交集后为空'));
  }
  const hasStagedCapability = capabilitySet.some((toolName): boolean => dependencies.getToolEntry(toolName)?.effect.effect === 'staged_file_write');
  if (taskMode === 'write' && !hasStagedCapability) {
    return compileFailure(
      createPlanError('capability_denied', 'plan_validation', 'policy', 'write_plan_staged_capability_missing', 'write Task 必须保留至少一个暂存能力')
    );
  }

  const body: AgentExecutionPlanBody = {
    planSchemaVersion: AGENT_PLAN_SCHEMA_VERSION,
    policyVersion: taskMode === 'write' ? AGENT_WRITE_PLAN_POLICY_VERSION : AGENT_READ_PLAN_POLICY_VERSION,
    capabilitySet,
    modelSnapshot: { ...modelSnapshot },
    permissionSnapshot: { scopeIds: permissionScopeIds },
    resourceScopes: [...scopeResolution.resourceScopes],
    toolEffectSet: capabilitySet.map((toolName) => ({
      toolName,
      effect: dependencies.getToolEntry(toolName)?.effect.effect === 'staged_file_write' ? ('staged_file_write' as const) : ('pure_read' as const)
    })),
    commitPolicy: taskMode === 'write' ? { mode: 'staged', adapter: AGENT_FILE_COMMIT_ADAPTER } : { mode: 'none' },
    budget: { ...input.budget }
  };
  const candidate: AgentExecutionPlanSnapshot = {
    ...body,
    planHash: hashExecutionPlanSnapshot(input.task.contractSnapshot, body)
  };
  const validation = validateExecutionPlanSnapshot(input.task.contractSnapshot, candidate);
  if (!validation.ok) return compileFailure(validation.error);
  if (validation.plan.modelSnapshot.providerId !== modelSnapshot.providerId || validation.plan.modelSnapshot.modelId !== modelSnapshot.modelId) {
    return compileFailure(createPlanError('protocol_error', 'plan_validation', 'protocol', 'plan_model_mismatch', 'Execution Plan 未继承 Checkpoint 模型'));
  }
  return { ok: true, plan: validation.plan };
}

/**
 * 创建恢复阶段失败。
 * @param reason - 稳定原因
 * @param message - 展示说明
 * @returns 判别失败
 */
function restoreFailure(reason: string, message: string): AgentPlanRestoreResult {
  return {
    ok: false,
    error: createPlanError('stale_context', 'recovery', 'integrity', reason, message)
  };
}

/**
 * 判断预算是否为可安全求交的有限上限。
 * @param budget - 当前或上一次有效预算
 * @returns 是否满足基础数值与版本约束
 */
function isValidBudget(budget: AgentBudgetSnapshot): boolean {
  return (
    Number.isInteger(budget.tokenLimit) &&
    budget.tokenLimit > 0 &&
    Number.isFinite(budget.costLimitUsd) &&
    budget.costLimitUsd >= 0 &&
    budget.pricingVersion.trim().length > 0
  );
}

/**
 * 判断上一次有效投影仍是 persisted plan 的合法子集。
 * @param previous - 上一次有效投影
 * @param persistedPlan - 不可变计划上限
 * @returns 是否可以作为本次恢复的时间单调 ceiling
 */
function isValidPrevious(previous: Readonly<AgentEffectivePlan>, persistedPlan: Readonly<AgentExecutionPlanSnapshot>): boolean {
  const persistedCapabilities = new Set(persistedPlan.capabilitySet);
  const persistedPermissions = new Set(persistedPlan.permissionSnapshot.scopeIds);
  const persistedResources = new Set(persistedPlan.resourceScopes);
  return (
    previous.effectiveCapabilitySet.length > 0 &&
    previous.effectiveCapabilitySet.every((toolName): boolean => persistedCapabilities.has(toolName)) &&
    previous.effectivePermissionScopeIds.length > 0 &&
    previous.effectivePermissionScopeIds.every((scopeId): boolean => persistedPermissions.has(scopeId)) &&
    previous.effectiveResourceScopes.length > 0 &&
    previous.effectiveResourceScopes.every((scopeId): boolean => persistedResources.has(scopeId)) &&
    isValidBudget(previous.effectiveBudget) &&
    previous.effectiveBudget.tokenLimit <= persistedPlan.budget.tokenLimit &&
    previous.effectiveBudget.costLimitUsd <= persistedPlan.budget.costLimitUsd &&
    previous.effectiveBudget.pricingVersion === persistedPlan.budget.pricingVersion
  );
}

/**
 * 从不可变计划派生只能单调收缩的 Runtime 有效计划。
 * @param input - 持久化计划与当前资源上限
 * @param dependencies - 当前 registry 和 policy
 * @returns 易失恢复投影或 fail-closed 错误
 */
export function restoreAgentPlan(input: AgentPlanRestoreInput, dependencies: AgentPlanCompilerDependencies): AgentPlanRestoreResult {
  const persistedPlan = input.task.executionPlanSnapshot;
  const hasRestorableStatus =
    (input.task.status === 'queued' && input.task.queuePhase === 'start') || input.task.status === 'starting' || input.task.status === 'running';
  if (
    !hasMatchingAggregate(input.task, input.checkpoint) ||
    !hasRestorableStatus ||
    !persistedPlan ||
    input.task.executionPlanSnapshotHash !== persistedPlan.planHash
  ) {
    return restoreFailure('restore_plan_identity_invalid', 'Task 没有可恢复的不可变计划');
  }
  const validation = validateExecutionPlanSnapshot(input.task.contractSnapshot, persistedPlan);
  if (!validation.ok || validation.plan.planHash !== persistedPlan.planHash) {
    return restoreFailure('restore_plan_validation_failed', '持久化计划无法按原版本恢复');
  }
  const canonicalPlan = validation.plan;
  if (input.previousEffective && !isValidPrevious(input.previousEffective, canonicalPlan)) {
    return restoreFailure('restore_previous_invalid', '上一次有效计划不是持久化计划的合法子集');
  }
  if (!isValidBudget(input.budget)) {
    return restoreFailure('restore_budget_invalid', '恢复预算不是有限可信上限');
  }
  const frozenModel = input.checkpoint.continuationSnapshot.modelSnapshot;
  if (
    canonicalPlan.modelSnapshot.providerId !== frozenModel.providerId ||
    canonicalPlan.modelSnapshot.modelId !== frozenModel.modelId ||
    !dependencies.isModelToolCapable(frozenModel)
  ) {
    return restoreFailure('restore_model_mismatch', '恢复不能替换或升级冻结模型');
  }

  const effectByTool = new Map(canonicalPlan.toolEffectSet.map((effect): [string, string] => [effect.toolName, effect.effect]));
  const hasMetadataDrift = canonicalPlan.capabilitySet.some((toolName): boolean => {
    const entry = dependencies.getToolEntry(toolName);
    if (!entry) return false;
    return (
      effectByTool.get(toolName) !== entry.effect.effect ||
      CHILD_TOOL_RESOLVERS.get(toolName) !== entry.effect.resourceScopeResolver ||
      (entry.effect.effect === 'staged_file_write' && entry.effect.commitAdapter !== AGENT_FILE_COMMIT_ADAPTER) ||
      entry.runtime !== 'main' ||
      entry.executionClass !== 'direct'
    );
  });
  if (hasMetadataDrift) {
    return restoreFailure('restore_tool_metadata_drift', '工具安全元数据发生变化，不能按旧计划恢复');
  }

  const availableTools = new Set(normalizeStringSet(input.availableToolNames));
  const previousCapabilities = new Set(input.previousEffective?.effectiveCapabilitySet ?? canonicalPlan.capabilitySet);
  const effectiveCapabilitySet = canonicalPlan.capabilitySet.filter((toolName): boolean => {
    const entry = dependencies.getToolEntry(toolName);
    return (
      previousCapabilities.has(toolName) &&
      availableTools.has(toolName) &&
      effectByTool.get(toolName) === entry?.effect.effect &&
      isSafeTool(toolName, entry, input.task.contractSnapshot.resources, input.task.contractSnapshot.mode, dependencies)
    );
  });
  if (effectiveCapabilitySet.length === 0) {
    return restoreFailure('restore_capability_empty', '恢复后的有效能力集合为空');
  }
  if (input.task.contractSnapshot.mode === 'write' && !effectiveCapabilitySet.some((toolName): boolean => effectByTool.get(toolName) === 'staged_file_write')) {
    return restoreFailure('restore_staged_capability_missing', 'write Task 恢复后没有可用暂存能力');
  }

  const currentPermissions = new Set(normalizeStringSet(input.permissionScopeIds));
  const currentResources = new Set(normalizeStringSet(input.resourceScopes));
  const previousPermissions = new Set(input.previousEffective?.effectivePermissionScopeIds ?? canonicalPlan.permissionSnapshot.scopeIds);
  const previousResources = new Set(input.previousEffective?.effectiveResourceScopes ?? canonicalPlan.resourceScopes);
  const effectivePermissionScopeIds = canonicalPlan.permissionSnapshot.scopeIds.filter(
    (scopeId): boolean => previousPermissions.has(scopeId) && currentPermissions.has(scopeId)
  );
  const effectiveResourceScopes = canonicalPlan.resourceScopes.filter((scopeId): boolean => previousResources.has(scopeId) && currentResources.has(scopeId));
  if (effectivePermissionScopeIds.length === 0 || effectiveResourceScopes.length === 0) {
    return restoreFailure('restore_scope_empty', '恢复后的权限或资源范围为空');
  }
  const previousBudget = input.previousEffective?.effectiveBudget ?? canonicalPlan.budget;
  const effectiveBudget: AgentBudgetSnapshot = {
    tokenLimit: Math.min(canonicalPlan.budget.tokenLimit, previousBudget.tokenLimit, input.budget.tokenLimit),
    costLimitUsd: Math.min(canonicalPlan.budget.costLimitUsd, previousBudget.costLimitUsd, input.budget.costLimitUsd),
    pricingVersion: canonicalPlan.budget.pricingVersion
  };
  if (effectiveBudget.tokenLimit <= 0 || effectiveBudget.costLimitUsd < 0) {
    return restoreFailure('restore_budget_invalid', '恢复后的 Task 预算无效');
  }

  return {
    ok: true,
    restored: Object.freeze({
      persistedPlan: canonicalPlan,
      effectiveCapabilitySet: Object.freeze([...effectiveCapabilitySet]),
      effectivePermissionScopeIds: Object.freeze([...effectivePermissionScopeIds]),
      effectiveResourceScopes: Object.freeze([...effectiveResourceScopes]),
      effectiveBudget: Object.freeze(effectiveBudget)
    })
  };
}
