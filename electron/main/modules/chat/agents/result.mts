/**
 * @file result.mts
 * @description 在主进程中按不可变 Task 身份、验收标准和冻结预算规范化 Child 终态结果。
 */
import type { AgentExecutionPlanSnapshot, AgentTaskContractSnapshot, AgentTaskError, ChatAgentResult } from 'types/chat-agent';
import { hashAgentPayload, validateChatAgentResult } from './contracts.mjs';

/** Task-aware 结果校验需要的最小不可变上下文。 */
export interface AgentResultValidationContext {
  /** 持久化 Task 身份。 */
  readonly taskId: string;
  /** 持久化 Child Actor 身份。 */
  readonly agentId: string;
  /** 当前 Attempt 身份。 */
  readonly attemptId: string;
  /** 不可变任务契约。 */
  readonly contractSnapshot: AgentTaskContractSnapshot;
  /** 不可变执行计划。 */
  readonly executionPlanSnapshot: AgentExecutionPlanSnapshot;
}

/** 已完成 Task-aware 规范化的 canonical 结果。 */
export interface AgentResultValidationSuccess {
  /** 成功判别。 */
  readonly ok: true;
  /** 深冻结、可安全持久化的结果。 */
  readonly result: Readonly<ChatAgentResult>;
  /** 由主进程对规范化结果计算的 canonical hash。 */
  readonly resultHash: string;
}

/** Task-aware 结果校验失败。 */
export interface AgentResultValidationFailure {
  /** 失败判别。 */
  readonly ok: false;
  /** 不依赖展示消息作机器判断的稳定错误。 */
  readonly error: AgentTaskError;
}

/** Task-aware 结果校验返回值。 */
export type AgentResultValidation = AgentResultValidationSuccess | AgentResultValidationFailure;

/**
 * 判断值是否为普通字符串键对象。
 * @param value - 未可信输入
 * @returns 是否可安全按字段读取
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 创建稳定的 result_validation 错误。
 * @param reason - 机器原因
 * @param message - 用户可读说明
 * @returns 失败结果
 */
function resultFailure(reason: string, message: string): AgentResultValidationFailure {
  let category: AgentTaskError['category'] = 'protocol';
  if (reason === 'result_budget_exceeded') category = 'policy';
  if (reason.includes('identity')) category = 'integrity';
  return {
    ok: false,
    error: {
      code: reason === 'result_budget_exceeded' ? 'budget_exceeded' : 'result_evidence_invalid',
      phase: 'result_validation',
      category,
      retryable: false,
      message,
      details: { reason }
    }
  };
}

/**
 * 从 Child 提交的 criterion 事实推导完成度。
 * contradicted 与 unverified 都不能贡献完成度。
 * @param criteria - 未可信 criterion 数组
 * @returns 主进程推导的完成度
 */
function deriveCompletion(criteria: readonly unknown[]): ChatAgentResult['completion']['level'] {
  const effectiveCount = criteria.filter((criterion): boolean => {
    if (!isRecord(criterion) || !isRecord(criterion.claim) || !isRecord(criterion.verification)) return false;
    return criterion.claim.status === 'satisfied' && criterion.verification.status === 'verified';
  }).length;
  if (criteria.length > 0 && effectiveCount === criteria.length) return 'full';
  if (effectiveCount > 0) return 'partial';
  return 'none';
}

/**
 * 在共享 shape validator 前覆盖不可信 completion level，并追加稳定警告。
 * @param input - Child 原始结果
 * @returns 可交给共享 validator 的 clone，结构不完整时原样返回
 */
function normalizeCompletion(input: unknown): unknown {
  if (!isRecord(input) || !isRecord(input.completion) || !Array.isArray(input.completion.criteria) || !Array.isArray(input.warnings)) {
    return input;
  }
  let clone: Record<string, unknown>;
  try {
    clone = structuredClone(input);
  } catch {
    return input;
  }
  if (!isRecord(clone.completion) || !Array.isArray(clone.completion.criteria) || !Array.isArray(clone.warnings)) return input;
  let downgradedVerification = false;
  clone.completion.criteria.forEach((criterion): void => {
    if (!isRecord(criterion) || !isRecord(criterion.verification) || criterion.verification.status !== 'verified') return;
    // Child 结果没有可信 Coordinator 上下文，任何自报 verified 都只能降级。
    criterion.verification = {
      status: 'unverified',
      verifier: 'policy',
      evidence: []
    };
    downgradedVerification = true;
  });
  if (downgradedVerification) {
    clone.warnings.push({
      code: 'child_verification_downgraded',
      message: 'Child-supplied verified criteria were downgraded because no trusted verifier context was provided.'
    });
  }
  const derivedLevel = deriveCompletion(clone.completion.criteria);
  const suppliedLevel = clone.completion.level;
  clone.completion.level = derivedLevel;
  if (suppliedLevel !== derivedLevel) {
    clone.warnings.push({
      code: 'completion_level_corrected',
      message: `Child completion level was normalized to ${derivedLevel}.`
    });
  }
  return clone;
}

/**
 * 校验结果身份、criteria 顺序与持久化 Task 完全一致。
 * @param result - 已通过共享 shape validator 的结果
 * @param context - 持久化 Task 上下文
 * @returns 不一致时的失败结果
 */
function validateIdentity(result: Readonly<ChatAgentResult>, context: AgentResultValidationContext): AgentResultValidationFailure | null {
  if (result.taskId !== context.taskId || result.agentId !== context.agentId || result.attemptId !== context.attemptId) {
    return resultFailure('result_identity_invalid', 'Agent result identity does not match the persisted Task and Attempt');
  }
  if (
    result.completion.criteria.length !== context.contractSnapshot.acceptanceCriteria.length ||
    result.completion.criteria.some((criterion, index): boolean => criterion.criterionIndex !== index)
  ) {
    return resultFailure('result_criteria_identity_invalid', 'Agent result criteria must exactly preserve the Task acceptance-criteria order');
  }
  if (
    result.artifacts.some(
      (artifact): boolean =>
        artifact.owner.taskId !== context.taskId || artifact.owner.agentId !== context.agentId || artifact.owner.attemptId !== context.attemptId
    )
  ) {
    return resultFailure('result_artifact_owner_invalid', 'Artifact ownership does not match the persisted Task, Agent, and Attempt');
  }
  return null;
}

/**
 * 校验 read/write 结果与冻结 commit policy 的一致性。
 * @param result - 已规范化结果
 * @param context - Task 契约与冻结计划
 * @returns 越界时的失败结果
 */
function validateChangeset(result: Readonly<ChatAgentResult>, context: AgentResultValidationContext): AgentResultValidationFailure | null {
  if (context.contractSnapshot.mode === 'read') {
    if (context.executionPlanSnapshot.commitPolicy.mode !== 'none') {
      return resultFailure('result_commit_policy_mismatch', 'Read Task results require a none commit policy');
    }
    if (result.changeset !== undefined) {
      return resultFailure('result_changeset_unsupported', 'Read Task results cannot contain a changeset');
    }
    return null;
  }
  if (context.executionPlanSnapshot.commitPolicy.mode !== 'staged') {
    return resultFailure('result_commit_policy_mismatch', 'Write Task results require the frozen staged commit policy');
  }
  if (result.changeset && result.changeset.planHash !== context.executionPlanSnapshot.planHash) {
    return resultFailure('result_changeset_plan_mismatch', 'Write result changeset does not bind the frozen execution plan');
  }
  if (result.changeset && result.executionStatus !== 'completed') {
    return resultFailure('result_changeset_status_invalid', 'Only finalized completed write results may expose a changeset');
  }
  return null;
}

/**
 * 将 Task usage 与冻结计划预算、定价版本交叉校验。
 * 此处只校验 Task 自身记账，不推断或虚构父子累计成本。
 * @param result - 已规范化结果
 * @param plan - 冻结执行计划
 * @returns 超预算或定价不一致时的失败结果
 */
function validateUsage(result: Readonly<ChatAgentResult>, plan: AgentExecutionPlanSnapshot): AgentResultValidationFailure | null {
  const { usage } = result;
  const { budget } = plan;
  const reportsBudgetOverrun = result.executionStatus === 'failed' && result.error?.code === 'budget_exceeded';
  if (usage.totalTokens > budget.tokenLimit && !reportsBudgetOverrun) {
    return resultFailure('result_budget_exceeded', 'Agent result token usage exceeds the frozen Task budget');
  }
  const cost = usage.monetaryCost;
  if (budget.pricingVersion === 'unknown') {
    if (cost.currency !== 'unknown' || cost.pricingVersion !== 'unknown' || cost.estimated !== 'unknown' || cost.actual !== 'unknown') {
      return resultFailure('result_pricing_unknown', 'Unknown Task pricing cannot be represented as a fabricated numeric cost');
    }
    return null;
  }
  if (cost.pricingVersion !== budget.pricingVersion) {
    return resultFailure('result_pricing_mismatch', 'Agent result pricing version does not match the frozen Task budget');
  }
  if (cost.currency !== 'USD') {
    return resultFailure('result_currency_invalid', 'Known Task pricing must use the USD currency of the frozen budget');
  }
  if (cost.estimated === 'unknown' && cost.actual === 'unknown') {
    return resultFailure('result_cost_missing', 'Known Task pricing requires at least one trusted numeric cost amount');
  }
  if (
    !reportsBudgetOverrun &&
    ((typeof cost.estimated === 'number' && cost.estimated > budget.costLimitUsd) || (typeof cost.actual === 'number' && cost.actual > budget.costLimitUsd))
  ) {
    return resultFailure('result_budget_exceeded', 'Agent result monetary usage exceeds the frozen Task budget');
  }
  return null;
}

/**
 * 规范化并校验一个 Child 终态结果。
 * 主进程推导 completion、绑定 Task 身份并计算 canonical hash；不接受 Child 提交的 hash。
 * @param input - Child 提交的未可信结果
 * @param context - 持久化 Task/Attempt/Plan 上下文
 * @returns canonical 结果、hash 或稳定错误
 */
export function validateAgentResult(input: unknown, context: AgentResultValidationContext): AgentResultValidation {
  const normalizedInput = normalizeCompletion(input);
  const shapeValidation = validateChatAgentResult(normalizedInput);
  if (!shapeValidation.ok) {
    return {
      ok: false,
      error: shapeValidation.error
    };
  }
  const identityFailure = validateIdentity(shapeValidation.result, context);
  if (identityFailure) return identityFailure;
  const changesetFailure = validateChangeset(shapeValidation.result, context);
  if (changesetFailure) return changesetFailure;
  const usageFailure = validateUsage(shapeValidation.result, context.executionPlanSnapshot);
  if (usageFailure) return usageFailure;
  return {
    ok: true,
    result: shapeValidation.result,
    resultHash: hashAgentPayload(shapeValidation.result)
  };
}
