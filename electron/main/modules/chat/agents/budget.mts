/**
 * @file budget.mts
 * @description Main-owned Child Agent Turn 预算账本，持久化恢复预留、Task 预留和实际用量结算。
 */
import type { AgentStoreDatabase } from './types.mjs';
import type { AgentBudgetSnapshot, AgentTaskError, AgentTaskErrorPhase, AgentUsageAccounting } from 'types/chat-agent';

/** 预算账本可稳定判断的错误码。 */
export type AgentBudgetErrorCode = 'budget_exceeded' | 'protocol_error';

/** 预算账本持久化的预留种类。 */
type AgentBudgetKind = 'resume' | 'task';

/** 预算账本持久化的预留状态。 */
type AgentBudgetStatus = 'active' | 'settled' | 'released';

/** Checkpoint 最小预算身份投影。 */
interface BudgetCheckpointRow {
  /** Checkpoint 身份。 */
  checkpoint_id: unknown;
  /** Session 身份。 */
  session_id: unknown;
  /** Turn 身份。 */
  turn_id: unknown;
  /** 逻辑记录状态。 */
  record_state: unknown;
}

/** Task 最小预算身份投影。 */
interface BudgetTaskRow extends BudgetCheckpointRow {
  /** Task 身份。 */
  task_id: unknown;
}

/** 已持久化预算预留行。 */
interface BudgetReservationRow {
  /** 预留身份。 */
  reservation_id: unknown;
  /** Session 身份。 */
  session_id: unknown;
  /** Turn 身份。 */
  turn_id: unknown;
  /** Checkpoint 身份。 */
  checkpoint_id: unknown;
  /** 可选 Task 身份。 */
  task_id: unknown;
  /** 预留种类。 */
  kind: unknown;
  /** 预留 token 数。 */
  reserved_tokens: unknown;
  /** 预留美元成本。 */
  reserved_cost_usd: unknown;
  /** 已使用 token 数。 */
  used_tokens: unknown;
  /** 已使用美元成本。 */
  used_cost_usd: unknown;
  /** 定价版本。 */
  pricing_version: unknown;
  /** 预留状态。 */
  status: unknown;
}

/** Turn 已占用额度查询结果。 */
interface TurnUsageRow {
  /** 活跃预留与已结算实际 token 合计。 */
  tokens: unknown;
  /** 活跃预留与已结算实际成本合计。 */
  cost_usd: unknown;
}

/** 已验证的预算聚合身份。 */
interface BudgetIdentity {
  /** Session 身份。 */
  sessionId: string;
  /** Turn 身份。 */
  turnId: string;
  /** Checkpoint 身份。 */
  checkpointId: string;
  /** Task 身份；恢复预留时不存在。 */
  taskId?: string;
}

/** 新增预算预留需要的完整事实。 */
interface BudgetReservationInput extends BudgetIdentity {
  /** 稳定预留身份。 */
  reservationId: string;
  /** 预留种类。 */
  kind: AgentBudgetKind;
  /** 请求的冻结预算。 */
  budget: AgentBudgetSnapshot;
}

/** Main-owned Turn 总预算解析上下文。 */
export interface AgentTurnBudgetContext {
  /** Session 身份。 */
  sessionId: string;
  /** Turn 身份。 */
  turnId: string;
  /** 当前 Checkpoint 身份。 */
  checkpointId: string;
}

/** 预算账本依赖。 */
export interface AgentBudgetLedgerDependencies {
  /** 与 Agent Store 共享事务域的同步数据库。 */
  database: AgentStoreDatabase;
  /**
   * 解析 Main-owned Turn ceiling。
   * @param context - 已从持久化事实恢复的 Turn 身份
   * @returns 同一 Session/Turn 必须稳定返回的总预算
   */
  resolveTurnBudget(context: AgentTurnBudgetContext): AgentBudgetSnapshot;
  /** 返回持久化时间。 */
  now(): string;
}

/** 持久化分层预算账本。 */
export interface AgentBudgetLedger {
  /**
   * 优先为 Primary Runtime B 预留续接预算。
   * @param checkpointId - Checkpoint 身份
   * @param budget - 冻结的续接预算
   */
  reserveResume(checkpointId: string, budget: AgentBudgetSnapshot): void;
  /**
   * 从同一 Turn 剩余额度中为 Child Task 预留预算。
   * @param taskId - Task 身份
   * @param budget - 冻结的 Task 预算
   */
  reserveTask(taskId: string, budget: AgentBudgetSnapshot): void;
  /**
   * 使用可信 Attempt 结果结算 Task 实际用量。
   * @param taskId - Task 身份
   * @param usage - 已验证的实际用量
   */
  settleAttempt(taskId: string, usage: AgentUsageAccounting): void;
  /**
   * 释放尚未执行的 Task 预留。
   * @param taskId - Task 身份
   */
  releaseTask(taskId: string): void;
  /**
   * 在 Checkpoint 终止时释放恢复预算和所有尚未结算的 Task 预留。
   * @param checkpointId - Checkpoint 身份
   */
  releaseCheckpoint(checkpointId: string): void;
  /**
   * 查询当前 Checkpoint 所属 Turn 的剩余 token。
   * @param checkpointId - Checkpoint 身份
   * @returns 共享 Turn ceiling 尚未占用的 token
   */
  remainingTurnTokens(checkpointId: string): number;
}

/** 预算账本稳定错误。 */
export class AgentBudgetError extends Error {
  /** 稳定机器错误码。 */
  readonly code: AgentBudgetErrorCode;

  /** 不依赖展示消息的稳定原因。 */
  readonly reason: string;

  /** 预算在计划验证阶段拒绝。 */
  readonly phase: AgentTaskErrorPhase = 'plan_validation';

  /** 策略或协议错误类别。 */
  readonly category: 'policy' | 'protocol';

  /** 冻结预算冲突不能通过原样重试扩张。 */
  readonly retryable = false;

  /** 经 allowlist 保留的稳定机器原因。 */
  readonly details: NonNullable<AgentTaskError['details']>;

  /**
   * 创建预算账本错误。
   * @param code - 稳定错误码
   * @param reason - 稳定机器原因
   * @param message - 可选展示说明
   */
  constructor(code: AgentBudgetErrorCode, reason: string, message = reason) {
    super(message);
    this.name = 'AgentBudgetError';
    this.code = code;
    this.reason = reason;
    this.category = code === 'budget_exceeded' ? 'policy' : 'protocol';
    this.details = { reason };
  }
}

/**
 * 创建协议错误。
 * @param reason - 稳定机器原因
 * @returns 预算协议错误
 */
function protocolError(reason: string): AgentBudgetError {
  return new AgentBudgetError('protocol_error', reason);
}

/**
 * 把持久化值验证为非空身份。
 * @param value - 未可信 SQLite 值
 * @param reason - 无效时的稳定原因
 * @returns 已验证身份
 */
function requireIdentity(value: unknown, reason: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw protocolError(reason);
  }

  return value;
}

/**
 * 把持久化值验证为非负整数。
 * @param value - 未可信 SQLite 值
 * @param reason - 无效时的稳定原因
 * @returns 已验证整数
 */
function requireInteger(value: unknown, reason: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw protocolError(reason);
  }

  return value;
}

/**
 * 把持久化值验证为非负有限数。
 * @param value - 未可信 SQLite 值
 * @param reason - 无效时的稳定原因
 * @returns 已验证数值
 */
function requireCost(value: unknown, reason: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw protocolError(reason);
  }

  return value;
}

/**
 * 校验冻结预算，拒绝虚构 unknown pricing 成本。
 * @param budget - 未可信预算输入
 * @param reason - 无效时的稳定原因
 */
function validateBudget(budget: AgentBudgetSnapshot, reason: string): void {
  if (
    !Number.isSafeInteger(budget.tokenLimit) ||
    budget.tokenLimit <= 0 ||
    !Number.isFinite(budget.costLimitUsd) ||
    budget.costLimitUsd < 0 ||
    budget.pricingVersion.length === 0 ||
    budget.pricingVersion.trim() !== budget.pricingVersion ||
    (budget.pricingVersion === 'unknown' && budget.costLimitUsd !== 0)
  ) {
    throw protocolError(reason);
  }
}

/**
 * 校验 Checkpoint 行并恢复预算身份。
 * @param row - 未可信 SQLite 行
 * @param expectedId - 调用方请求的 Checkpoint
 * @returns 已验证预算身份
 */
function parseCheckpoint(row: BudgetCheckpointRow | undefined, expectedId: string): BudgetIdentity {
  if (!row || row.record_state !== 'active') throw protocolError('budget_checkpoint_unavailable');
  const checkpointId = requireIdentity(row.checkpoint_id, 'budget_checkpoint_invalid');
  if (checkpointId !== expectedId) throw protocolError('budget_checkpoint_mismatch');

  return {
    checkpointId,
    sessionId: requireIdentity(row.session_id, 'budget_session_invalid'),
    turnId: requireIdentity(row.turn_id, 'budget_turn_invalid')
  };
}

/**
 * 校验 Task 行并恢复预算身份。
 * @param row - 未可信 SQLite 行
 * @param expectedId - 调用方请求的 Task
 * @returns 已验证预算身份
 */
function parseTask(row: BudgetTaskRow | undefined, expectedId: string): BudgetIdentity {
  if (!row || row.record_state !== 'active') throw protocolError('budget_task_unavailable');
  const taskId = requireIdentity(row.task_id, 'budget_task_invalid');
  if (taskId !== expectedId) throw protocolError('budget_task_mismatch');

  return {
    taskId,
    checkpointId: requireIdentity(row.checkpoint_id, 'budget_checkpoint_invalid'),
    sessionId: requireIdentity(row.session_id, 'budget_session_invalid'),
    turnId: requireIdentity(row.turn_id, 'budget_turn_invalid')
  };
}

/**
 * 校验持久化预留状态。
 * @param value - 未可信状态
 * @returns 已验证状态
 */
function parseStatus(value: unknown): AgentBudgetStatus {
  if (value !== 'active' && value !== 'settled' && value !== 'released') {
    throw protocolError('budget_status_invalid');
  }

  return value;
}

/**
 * 校验预留重放是否与不可变事实一致。
 * @param row - 已持久化预留
 * @param input - 当前预留请求
 * @returns 已验证的持久化状态
 */
function validateReplay(row: BudgetReservationRow, input: BudgetReservationInput): AgentBudgetStatus {
  const taskId = row.task_id === null ? undefined : requireIdentity(row.task_id, 'budget_task_invalid');
  const matches =
    requireIdentity(row.reservation_id, 'budget_reservation_invalid') === input.reservationId &&
    requireIdentity(row.session_id, 'budget_session_invalid') === input.sessionId &&
    requireIdentity(row.turn_id, 'budget_turn_invalid') === input.turnId &&
    requireIdentity(row.checkpoint_id, 'budget_checkpoint_invalid') === input.checkpointId &&
    taskId === input.taskId &&
    row.kind === input.kind &&
    requireInteger(row.reserved_tokens, 'budget_tokens_invalid') === input.budget.tokenLimit &&
    requireCost(row.reserved_cost_usd, 'budget_cost_invalid') === input.budget.costLimitUsd &&
    requireIdentity(row.pricing_version, 'budget_pricing_invalid') === input.budget.pricingVersion;
  if (!matches) throw protocolError('budget_reservation_conflict');
  return parseStatus(row.status);
}

/**
 * 创建 Main-owned 持久化预算账本。
 * @param dependencies - 数据库、Turn ceiling 和时间依赖
 * @returns 分层预算操作接口
 */
export function createAgentBudgetLedger(dependencies: AgentBudgetLedgerDependencies): AgentBudgetLedger {
  /**
   * 读取 Checkpoint 的持久化身份。
   * @param checkpointId - Checkpoint 身份
   * @returns 已验证预算身份
   */
  function readCheckpoint(checkpointId: string): BudgetIdentity {
    const row = dependencies.database.select<BudgetCheckpointRow>(
      `SELECT checkpoint_id, session_id, turn_id, record_state
       FROM chat_agent_delegation_checkpoints
       WHERE checkpoint_id = ?`,
      [checkpointId]
    )[0];
    return parseCheckpoint(row, checkpointId);
  }

  /**
   * 读取 Task 的持久化身份。
   * @param taskId - Task 身份
   * @returns 已验证预算身份
   */
  function readTask(taskId: string): BudgetIdentity {
    const row = dependencies.database.select<BudgetTaskRow>(
      `SELECT task_id, checkpoint_id, session_id, turn_id, record_state
       FROM chat_agent_tasks
       WHERE task_id = ?`,
      [taskId]
    )[0];
    return parseTask(row, taskId);
  }

  /**
   * 读取 Turn 当前已占用预算。
   * @param identity - 当前聚合身份
   * @returns token 与美元成本占用量
   */
  function readTurnUsage(identity: BudgetIdentity): { tokens: number; costUsd: number } {
    const row = dependencies.database.select<TurnUsageRow>(
      `SELECT
         COALESCE(SUM(
           CASE
             WHEN status = 'active' THEN reserved_tokens
             WHEN status = 'settled' THEN used_tokens
             ELSE 0
           END
         ), 0) AS tokens,
         COALESCE(SUM(
           CASE
             WHEN status = 'active' THEN reserved_cost_usd
             WHEN status = 'settled' THEN COALESCE(used_cost_usd, 0)
             ELSE 0
           END
         ), 0) AS cost_usd
       FROM chat_agent_budget_reservations
       WHERE session_id = ? AND turn_id = ?`,
      [identity.sessionId, identity.turnId]
    )[0];
    if (!row) throw protocolError('budget_turn_usage_missing');

    return {
      tokens: requireInteger(row.tokens, 'budget_turn_tokens_invalid'),
      costUsd: requireCost(row.cost_usd, 'budget_turn_cost_invalid')
    };
  }

  /**
   * 读取并验证同一 Turn 的 Main-owned ceiling。
   * @param identity - 当前聚合身份
   * @returns 已验证总预算
   */
  function readTurnBudget(identity: BudgetIdentity): AgentBudgetSnapshot {
    const budget = dependencies.resolveTurnBudget({
      sessionId: identity.sessionId,
      turnId: identity.turnId,
      checkpointId: identity.checkpointId
    });
    validateBudget(budget, 'turn_budget_invalid');
    return budget;
  }

  /**
   * 校验新增预留仍位于同一 Turn ceiling 内。
   * @param identity - 当前聚合身份
   * @param budget - 请求预留预算
   */
  function assertCapacity(identity: BudgetIdentity, budget: AgentBudgetSnapshot): void {
    const ceiling = readTurnBudget(identity);
    if (ceiling.pricingVersion !== budget.pricingVersion) {
      throw protocolError('budget_pricing_mismatch');
    }
    const usage = readTurnUsage(identity);
    const tokenExceeded = usage.tokens + budget.tokenLimit > ceiling.tokenLimit;
    const costExceeded = usage.costUsd + budget.costLimitUsd > ceiling.costLimitUsd + Number.EPSILON;
    if (tokenExceeded || costExceeded) {
      throw new AgentBudgetError('budget_exceeded', 'turn_budget_exceeded');
    }
  }

  /**
   * 在事务内持久化一个不可变预留。
   * @param input - 完整预留事实
   */
  function reserveBudget(input: BudgetReservationInput): void {
    validateBudget(input.budget, 'budget_reservation_invalid');
    const existing = dependencies.database.select<BudgetReservationRow>('SELECT * FROM chat_agent_budget_reservations WHERE reservation_id = ?', [
      input.reservationId
    ])[0];
    if (existing) {
      if (validateReplay(existing, input) === 'released') {
        throw protocolError('budget_reservation_released');
      }
      return;
    }

    assertCapacity(input, input.budget);
    const timestamp = dependencies.now();
    const result = dependencies.database.execute(
      `INSERT INTO chat_agent_budget_reservations (
        reservation_id, session_id, turn_id, checkpoint_id, task_id, kind,
        reserved_tokens, reserved_cost_usd, used_tokens, used_cost_usd,
        pricing_version, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, 'active', ?, ?)`,
      [
        input.reservationId,
        input.sessionId,
        input.turnId,
        input.checkpointId,
        input.taskId ?? null,
        input.kind,
        input.budget.tokenLimit,
        input.budget.costLimitUsd,
        input.budget.pricingVersion,
        timestamp,
        timestamp
      ]
    );
    if (result.changes !== 1) throw protocolError('budget_reservation_write_failed');
  }

  /**
   * 验证 Checkpoint 已优先获得恢复预留。
   * @param checkpointId - Checkpoint 身份
   */
  function requireResume(checkpointId: string): void {
    const row = dependencies.database.select<BudgetReservationRow>(
      `SELECT * FROM chat_agent_budget_reservations
       WHERE reservation_id = ? AND checkpoint_id = ? AND kind = 'resume'`,
      [`budget:resume:${checkpointId}`, checkpointId]
    )[0];
    if (!row || parseStatus(row.status) === 'released') {
      throw new AgentBudgetError('budget_exceeded', 'resume_reservation_missing');
    }
  }

  /**
   * 提取可信 usage 的结算成本。
   * @param row - Task 预留
   * @param usage - 已验证的实际用量
   * @returns 已知成本或 unknown 对应的 null
   */
  function resolveUsageCost(row: BudgetReservationRow, usage: AgentUsageAccounting): number | null {
    const pricingVersion = requireIdentity(row.pricing_version, 'budget_pricing_invalid');
    const cost = usage.monetaryCost;
    if (pricingVersion === 'unknown') {
      if (cost.currency !== 'unknown' || cost.pricingVersion !== 'unknown' || cost.estimated !== 'unknown' || cost.actual !== 'unknown') {
        throw protocolError('budget_unknown_cost_fabricated');
      }
      return null;
    }
    if (cost.currency !== 'USD' || cost.pricingVersion !== pricingVersion) {
      throw protocolError('budget_usage_pricing_mismatch');
    }
    const amount = typeof cost.actual === 'number' ? cost.actual : cost.estimated;
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
      throw protocolError('budget_usage_cost_invalid');
    }
    return amount;
  }

  /**
   * 校验可信 usage token 算术。
   * @param usage - 已验证的实际用量
   */
  function validateUsage(usage: AgentUsageAccounting): void {
    if (
      !Number.isSafeInteger(usage.inputTokens) ||
      usage.inputTokens < 0 ||
      !Number.isSafeInteger(usage.outputTokens) ||
      usage.outputTokens < 0 ||
      !Number.isSafeInteger(usage.totalTokens) ||
      usage.totalTokens < 0 ||
      usage.inputTokens + usage.outputTokens !== usage.totalTokens
    ) {
      throw protocolError('budget_usage_tokens_invalid');
    }
  }

  return {
    reserveResume(checkpointId: string, budget: AgentBudgetSnapshot): void {
      dependencies.database.transaction((): void => {
        const identity = readCheckpoint(checkpointId);
        reserveBudget({
          ...identity,
          reservationId: `budget:resume:${checkpointId}`,
          kind: 'resume',
          budget
        });
      });
    },

    reserveTask(taskId: string, budget: AgentBudgetSnapshot): void {
      dependencies.database.transaction((): void => {
        const identity = readTask(taskId);
        requireResume(identity.checkpointId);
        reserveBudget({
          ...identity,
          reservationId: `budget:task:${taskId}`,
          kind: 'task',
          budget
        });
      });
    },

    settleAttempt(taskId: string, usage: AgentUsageAccounting): void {
      dependencies.database.transaction((): void => {
        const identity = readTask(taskId);
        validateUsage(usage);
        const row = dependencies.database.select<BudgetReservationRow>('SELECT * FROM chat_agent_budget_reservations WHERE reservation_id = ?', [
          `budget:task:${taskId}`
        ])[0];
        if (!row) throw protocolError('budget_task_reservation_missing');
        validateReplay(row, {
          ...identity,
          reservationId: `budget:task:${taskId}`,
          kind: 'task',
          budget: {
            tokenLimit: requireInteger(row.reserved_tokens, 'budget_tokens_invalid'),
            costLimitUsd: requireCost(row.reserved_cost_usd, 'budget_cost_invalid'),
            pricingVersion: requireIdentity(row.pricing_version, 'budget_pricing_invalid')
          }
        });
        const status = parseStatus(row.status);
        const usedCost = resolveUsageCost(row, usage);
        if (status === 'settled') {
          const persistedCost = row.used_cost_usd === null ? null : requireCost(row.used_cost_usd, 'budget_used_cost_invalid');
          if (requireInteger(row.used_tokens, 'budget_used_tokens_invalid') !== usage.totalTokens || persistedCost !== usedCost) {
            throw protocolError('budget_settlement_conflict');
          }
          return;
        }
        if (status !== 'active') throw protocolError('budget_settlement_released');

        const result = dependencies.database.execute(
          `UPDATE chat_agent_budget_reservations
           SET used_tokens = ?, used_cost_usd = ?, status = 'settled', updated_at = ?
           WHERE reservation_id = ? AND status = 'active'`,
          [usage.totalTokens, usedCost, dependencies.now(), `budget:task:${taskId}`]
        );
        if (result.changes !== 1) throw protocolError('budget_settlement_conflict');
      });
    },

    releaseTask(taskId: string): void {
      dependencies.database.transaction((): void => {
        readTask(taskId);
        const row = dependencies.database.select<BudgetReservationRow>('SELECT * FROM chat_agent_budget_reservations WHERE reservation_id = ?', [
          `budget:task:${taskId}`
        ])[0];
        if (!row) return;
        const status = parseStatus(row.status);
        if (status !== 'active') return;

        const result = dependencies.database.execute(
          `UPDATE chat_agent_budget_reservations
           SET status = 'released', updated_at = ?
           WHERE reservation_id = ? AND status = 'active'`,
          [dependencies.now(), `budget:task:${taskId}`]
        );
        if (result.changes !== 1) throw protocolError('budget_release_conflict');
      });
    },

    releaseCheckpoint(checkpointId: string): void {
      dependencies.database.transaction((): void => {
        readCheckpoint(checkpointId);
        dependencies.database.execute(
          `UPDATE chat_agent_budget_reservations
           SET status = 'released', updated_at = ?
           WHERE checkpoint_id = ? AND status = 'active'
             AND (
               kind = 'resume'
               OR NOT EXISTS (
                 SELECT 1
                 FROM chat_agent_tasks
                 WHERE chat_agent_tasks.task_id = chat_agent_budget_reservations.task_id
                   AND chat_agent_tasks.result_json IS NOT NULL
                   AND chat_agent_tasks.result_hash IS NOT NULL
               )
             )`,
          [dependencies.now(), checkpointId]
        );
      });
    },

    remainingTurnTokens(checkpointId: string): number {
      return dependencies.database.transaction((): number => {
        const identity = readCheckpoint(checkpointId);
        const ceiling = readTurnBudget(identity);
        const usage = readTurnUsage(identity);
        return Math.max(0, ceiling.tokenLimit - usage.tokens);
      });
    }
  };
}
