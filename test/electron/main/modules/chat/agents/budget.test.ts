/**
 * @file budget.test.ts
 * @description 使用真实 SQLite 验证 Main-owned Turn/Checkpoint/Task 分层预算预留、结算和恢复事实。
 */
import type { AgentStoreDatabase } from '../../../../../../electron/main/modules/chat/agents/types.mjs';
import type { AgentBudgetSnapshot, AgentPreAttemptCancellationResult, AgentUsageAccounting, ChatAgentResult } from 'types/chat-agent';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAgentBudgetLedger } from '../../../../../../electron/main/modules/chat/agents/budget.mjs';
import { hashAgentPayload } from '../../../../../../electron/main/modules/chat/agents/contracts.mjs';
import { createAgentTables } from '../../../../../../electron/main/modules/database/service.mjs';

/** 仅在 ABI 与 better-sqlite3 一致的 Electron Node 进程中执行真实数据库测试。 */
const describeWithSqlite = 'electron' in process.versions ? describe : describe.skip;

/** 已知价格 Turn 总上限。 */
const knownTurnBudget: AgentBudgetSnapshot = {
  tokenLimit: 2_000,
  costLimitUsd: 0.2,
  pricingVersion: 'pricing-v1'
};

/** Primary 续接必须优先预留的额度。 */
const resumeBudget: AgentBudgetSnapshot = {
  tokenLimit: 500,
  costLimitUsd: 0.05,
  pricingVersion: 'pricing-v1'
};

/** 单个 Child 默认预留额度。 */
const childBudget: AgentBudgetSnapshot = {
  tokenLimit: 250,
  costLimitUsd: 0.025,
  pricingVersion: 'pricing-v1'
};

/**
 * 把 better-sqlite3 适配为预算账本窄数据库边界。
 * @param database - 真实内存数据库
 * @returns 同步事务数据库接口
 */
function createDatabase(database: InstanceType<typeof Database>): AgentStoreDatabase {
  return {
    execute: (sql: string, params: readonly unknown[] = []): { changes: number; lastInsertRowid: number | bigint } => database.prepare(sql).run(...params),
    select: <T>(sql: string, params: readonly unknown[] = []): T[] => database.prepare(sql).all(...params) as T[],
    transaction: <T>(operation: () => T): T => database.transaction(operation)()
  };
}

/**
 * 插入预算账本需要的最小 Checkpoint 和 Task 身份。
 * @param database - 真实内存数据库
 * @param checkpointId - Checkpoint 身份
 * @param sessionId - Session 身份
 * @param turnId - Turn 身份
 * @param taskCount - 创建 Task 数量
 */
function seedBudgetFacts(database: InstanceType<typeof Database>, checkpointId: string, sessionId: string, turnId: string, taskCount: number): void {
  database
    .prepare(
      `INSERT INTO chat_agent_delegation_checkpoints (
        checkpoint_id, session_id, turn_id, primary_agent_id, root_runtime_id,
        source_runtime_id, assistant_message_id, continuation_snapshot_json,
        continuation_snapshot_hash, status, version, terminal_results_json,
        record_state, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      checkpointId,
      sessionId,
      turnId,
      'primary',
      `runtime-root-${turnId}`,
      `runtime-a-${turnId}`,
      `assistant-${checkpointId}`,
      '{"checkpointSchemaVersion":1}',
      'a'.repeat(64),
      'waiting_children',
      1,
      '{}',
      'active',
      '2026-07-27T00:00:00.000Z',
      '2026-07-27T00:00:00.000Z'
    );

  const insertTask = database.prepare(
    `INSERT INTO chat_agent_tasks (
      task_id, session_id, turn_id, agent_id, parent_agent_id, root_runtime_id,
      checkpoint_id, tool_call_id, contract_snapshot_json, contract_snapshot_hash,
      status, priority, record_state, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (let index = 1; index <= taskCount; index += 1) {
    insertTask.run(
      `${checkpointId}-task-${index}`,
      sessionId,
      turnId,
      `${checkpointId}-child-${index}`,
      'primary',
      `runtime-root-${turnId}`,
      checkpointId,
      `${checkpointId}-call-${index}`,
      '{"contractSchemaVersion":1}',
      `${index}`.repeat(64),
      'created',
      'normal',
      'active',
      '2026-07-27T00:00:00.000Z',
      '2026-07-27T00:00:00.000Z'
    );
  }
}

/**
 * 创建一次已知价格的实际 Attempt usage。
 * @param totalTokens - 实际 token 数
 * @param estimatedCost - 可信估算成本
 * @returns 完整 usage
 */
function createUsage(totalTokens: number, estimatedCost: number): AgentUsageAccounting {
  return {
    inputTokens: totalTokens,
    outputTokens: 0,
    totalTokens,
    modelCalls: 1,
    toolRounds: 1,
    queueDurationMs: 0,
    executionDurationMs: 10,
    externalRequests: 0,
    monetaryCost: {
      currency: 'USD',
      pricingVersion: 'pricing-v1',
      estimated: estimatedCost,
      actual: 'unknown'
    }
  };
}

/**
 * 创建预算恢复使用的终态 Attempt 结果。
 * @param taskId - 结果所属 Task
 * @param usage - 已冻结实际用量
 * @returns 完整终态结果
 */
function createCompletedResult(taskId: string, usage: AgentUsageAccounting): ChatAgentResult {
  return {
    taskId,
    agentId: taskId.replace('-task-', '-child-'),
    attemptId: `${taskId}-attempt-1`,
    executionStatus: 'completed',
    completion: { level: 'none', criteria: [] },
    summary: 'Completed the bounded task.',
    warnings: [],
    artifacts: [],
    usage
  };
}

/**
 * 创建预算恢复使用的无 Attempt 取消结果。
 * @param taskId - 结果所属 Task
 * @returns canonical 零用量取消结果
 */
function createPreCancellation(taskId: string): AgentPreAttemptCancellationResult {
  return {
    resultKind: 'pre_attempt_cancelled',
    taskId,
    agentId: taskId.replace('-task-', '-child-'),
    executionStatus: 'cancelled',
    completion: { level: 'none', criteria: [] },
    summary: 'Child Task was cancelled before Runtime creation.',
    warnings: [],
    artifacts: [],
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      modelCalls: 0,
      toolRounds: 0,
      queueDurationMs: 0,
      executionDurationMs: 0,
      externalRequests: 0,
      monetaryCost: {
        currency: 'unknown',
        pricingVersion: 'unknown',
        estimated: 'unknown',
        actual: 'unknown'
      }
    },
    error: {
      code: 'cancelled',
      phase: 'queue',
      category: 'user',
      retryable: false
    }
  };
}

describeWithSqlite('agent budget ledger', (): void => {
  let database: InstanceType<typeof Database>;
  let adapter: AgentStoreDatabase;

  beforeEach((): void => {
    database = new Database(':memory:');
    createAgentTables(database);
    adapter = createDatabase(database);
  });

  afterEach((): void => {
    database.close();
  });

  it('requires the Primary resume reservation before sharing one Turn ceiling across six Child Tasks', (): void => {
    seedBudgetFacts(database, 'checkpoint-1', 'session-1', 'turn-1', 7);
    const ledger = createAgentBudgetLedger({
      database: adapter,
      resolveTurnBudget: (): AgentBudgetSnapshot => knownTurnBudget,
      now: (): string => '2026-07-27T00:00:01.000Z'
    });

    expect((): void => {
      ledger.reserveTask('checkpoint-1-task-1', childBudget);
    }).toThrowError(expect.objectContaining({ code: 'budget_exceeded', reason: 'resume_reservation_missing' }));

    ledger.reserveResume('checkpoint-1', resumeBudget);
    for (let index = 1; index <= 6; index += 1) {
      ledger.reserveTask(`checkpoint-1-task-${index}`, childBudget);
    }

    expect(ledger.remainingTurnTokens('checkpoint-1')).toBe(0);
    expect((): void => {
      ledger.reserveTask('checkpoint-1-task-7', { ...childBudget, tokenLimit: 1 });
    }).toThrowError(expect.objectContaining({ code: 'budget_exceeded', reason: 'turn_budget_exceeded' }));
    // 幂等重放不能重复消耗 Turn 额度。
    ledger.reserveTask('checkpoint-1-task-1', childBudget);
    expect(ledger.remainingTurnTokens('checkpoint-1')).toBe(0);
  });

  it('settles actual usage and returns the unused reservation to the same Turn', (): void => {
    seedBudgetFacts(database, 'checkpoint-1', 'session-1', 'turn-1', 7);
    const ledger = createAgentBudgetLedger({
      database: adapter,
      resolveTurnBudget: (): AgentBudgetSnapshot => knownTurnBudget,
      now: (): string => '2026-07-27T00:00:01.000Z'
    });
    ledger.reserveResume('checkpoint-1', resumeBudget);
    for (let index = 1; index <= 6; index += 1) {
      ledger.reserveTask(`checkpoint-1-task-${index}`, childBudget);
    }

    ledger.settleAttempt('checkpoint-1-task-1', createUsage(100, 0.01));

    expect(ledger.remainingTurnTokens('checkpoint-1')).toBe(150);
    ledger.reserveTask('checkpoint-1-task-7', {
      tokenLimit: 150,
      costLimitUsd: 0.015,
      pricingVersion: 'pricing-v1'
    });
    expect(ledger.remainingTurnTokens('checkpoint-1')).toBe(0);
    expect(
      adapter.select<{ reserved_tokens: number; used_tokens: number; status: string }>(
        'SELECT reserved_tokens, used_tokens, status FROM chat_agent_budget_reservations WHERE task_id = ?',
        ['checkpoint-1-task-1']
      )
    ).toEqual([{ reserved_tokens: 250, used_tokens: 100, status: 'settled' }]);
  });

  it('shares the ceiling across checkpoints in one Turn and releases only active Task reservations', (): void => {
    seedBudgetFacts(database, 'checkpoint-1', 'session-1', 'turn-1', 1);
    seedBudgetFacts(database, 'checkpoint-2', 'session-1', 'turn-1', 1);
    const ledger = createAgentBudgetLedger({
      database: adapter,
      resolveTurnBudget: (): AgentBudgetSnapshot => knownTurnBudget,
      now: (): string => '2026-07-27T00:00:01.000Z'
    });
    ledger.reserveResume('checkpoint-1', resumeBudget);
    ledger.reserveTask('checkpoint-1-task-1', { ...childBudget, tokenLimit: 1_000, costLimitUsd: 0.1 });
    ledger.reserveResume('checkpoint-2', { ...resumeBudget, tokenLimit: 250, costLimitUsd: 0.025 });
    ledger.reserveTask('checkpoint-2-task-1', childBudget);

    expect(ledger.remainingTurnTokens('checkpoint-2')).toBe(0);
    ledger.releaseTask('checkpoint-1-task-1');
    expect(ledger.remainingTurnTokens('checkpoint-2')).toBe(1_000);
    ledger.releaseTask('checkpoint-1-task-1');
    expect(ledger.remainingTurnTokens('checkpoint-1')).toBe(1_000);
  });

  it('does not revive a released Task reservation during idempotent recovery', (): void => {
    seedBudgetFacts(database, 'checkpoint-release', 'session-release', 'turn-release', 1);
    const ledger = createAgentBudgetLedger({
      database: adapter,
      resolveTurnBudget: (): AgentBudgetSnapshot => knownTurnBudget,
      now: (): string => '2026-07-27T00:00:01.000Z'
    });
    ledger.reserveResume('checkpoint-release', resumeBudget);
    ledger.reserveTask('checkpoint-release-task-1', childBudget);
    ledger.releaseTask('checkpoint-release-task-1');

    expect((): void => {
      ledger.reserveTask('checkpoint-release-task-1', childBudget);
    }).toThrowError(expect.objectContaining({ code: 'protocol_error', reason: 'budget_reservation_released' }));
  });

  it('preserves unknown pricing without fabricating numeric usage cost', (): void => {
    seedBudgetFacts(database, 'checkpoint-unknown', 'session-2', 'turn-unknown', 1);
    const unknownBudget: AgentBudgetSnapshot = {
      tokenLimit: 1_000,
      costLimitUsd: 0,
      pricingVersion: 'unknown'
    };
    const ledger = createAgentBudgetLedger({
      database: adapter,
      resolveTurnBudget: (): AgentBudgetSnapshot => unknownBudget,
      now: (): string => '2026-07-27T00:00:01.000Z'
    });
    ledger.reserveResume('checkpoint-unknown', { ...unknownBudget, tokenLimit: 400 });
    ledger.reserveTask('checkpoint-unknown-task-1', { ...unknownBudget, tokenLimit: 300 });
    const unknownUsage: AgentUsageAccounting = {
      ...createUsage(120, 0),
      monetaryCost: {
        currency: 'unknown',
        pricingVersion: 'unknown',
        estimated: 'unknown',
        actual: 'unknown'
      }
    };

    ledger.settleAttempt('checkpoint-unknown-task-1', unknownUsage);

    expect(
      adapter.select<{ used_cost_usd: number | null; pricing_version: string }>(
        'SELECT used_cost_usd, pricing_version FROM chat_agent_budget_reservations WHERE task_id = ?',
        ['checkpoint-unknown-task-1']
      )
    ).toEqual([{ used_cost_usd: null, pricing_version: 'unknown' }]);
    expect(ledger.remainingTurnTokens('checkpoint-unknown')).toBe(480);
  });

  it('releases every active reservation at a terminal cancellation while preserving settled usage', (): void => {
    seedBudgetFacts(database, 'checkpoint-cancel', 'session-cancel', 'turn-cancel', 2);
    const ledger = createAgentBudgetLedger({
      database: adapter,
      resolveTurnBudget: (): AgentBudgetSnapshot => knownTurnBudget,
      now: (): string => '2026-07-27T00:00:01.000Z'
    });
    ledger.reserveResume('checkpoint-cancel', resumeBudget);
    ledger.reserveTask('checkpoint-cancel-task-1', childBudget);
    ledger.reserveTask('checkpoint-cancel-task-2', childBudget);
    ledger.settleAttempt('checkpoint-cancel-task-1', createUsage(100, 0.01));

    ledger.releaseCheckpoint('checkpoint-cancel');

    expect(ledger.remainingTurnTokens('checkpoint-cancel')).toBe(1_900);
    expect(
      adapter.select<{ task_id: string | null; status: string }>(
        `SELECT task_id, status
         FROM chat_agent_budget_reservations
         WHERE checkpoint_id = ?
         ORDER BY reservation_id`,
        ['checkpoint-cancel']
      )
    ).toEqual([
      { task_id: null, status: 'released' },
      { task_id: 'checkpoint-cancel-task-1', status: 'settled' },
      { task_id: 'checkpoint-cancel-task-2', status: 'released' }
    ]);
    ledger.releaseCheckpoint('checkpoint-cancel');
    expect(ledger.remainingTurnTokens('checkpoint-cancel')).toBe(1_900);
  });

  it('keeps a result-bearing active Task reservation until its Attempt usage is settled', (): void => {
    seedBudgetFacts(database, 'checkpoint-result', 'session-result', 'turn-result', 1);
    const ledger = createAgentBudgetLedger({
      database: adapter,
      resolveTurnBudget: (): AgentBudgetSnapshot => knownTurnBudget,
      now: (): string => '2026-07-27T00:00:01.000Z'
    });
    ledger.reserveResume('checkpoint-result', resumeBudget);
    ledger.reserveTask('checkpoint-result-task-1', childBudget);
    adapter.execute(
      `UPDATE chat_agent_tasks
       SET result_json = ?, result_hash = ?
       WHERE task_id = ?`,
      ['{}', 'f'.repeat(64), 'checkpoint-result-task-1']
    );

    ledger.releaseCheckpoint('checkpoint-result');

    expect(
      adapter.select<{ kind: string; status: string }>(
        `SELECT kind, status
         FROM chat_agent_budget_reservations
         WHERE checkpoint_id = ?
         ORDER BY reservation_id`,
        ['checkpoint-result']
      )
    ).toEqual([
      { kind: 'resume', status: 'released' },
      { kind: 'task', status: 'active' }
    ]);
    ledger.settleAttempt('checkpoint-result-task-1', createUsage(100, 0.01));
    expect(ledger.remainingTurnTokens('checkpoint-result')).toBe(1_900);
  });

  it('recovers one terminal Attempt reservation from frozen durable usage', (): void => {
    seedBudgetFacts(database, 'checkpoint-recover', 'session-recover', 'turn-recover', 2);
    const ledger = createAgentBudgetLedger({
      database: adapter,
      resolveTurnBudget: (): AgentBudgetSnapshot => knownTurnBudget,
      now: (): string => '2026-07-27T00:00:02.000Z'
    });
    ledger.reserveResume('checkpoint-recover', resumeBudget);
    ledger.reserveTask('checkpoint-recover-task-1', childBudget);
    ledger.reserveTask('checkpoint-recover-task-2', childBudget);
    const taskId = 'checkpoint-recover-task-1';
    const usage = createUsage(100, 0.01);
    const result = createCompletedResult(taskId, usage);
    adapter.execute(
      `INSERT INTO chat_agent_attempts (
        attempt_id, task_id, attempt_number, parent_runtime_id, plan_hash,
        initial_runtime_id, current_runtime_id, status, usage_snapshot_json,
        usage_complete, usage_updated_at, finished_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      [
        result.attemptId,
        taskId,
        1,
        'runtime-root-turn-recover',
        'a'.repeat(64),
        'runtime-child-1',
        'runtime-child-1',
        'completed',
        JSON.stringify(usage),
        '2026-07-27T00:00:01.000Z',
        '2026-07-27T00:00:01.000Z',
        '2026-07-27T00:00:00.000Z'
      ]
    );
    adapter.execute(
      `UPDATE chat_agent_tasks
       SET status = 'completed', current_attempt_id = ?, result_json = ?, result_hash = ?
       WHERE task_id = ?`,
      [result.attemptId, JSON.stringify(result), hashAgentPayload(result), taskId]
    );

    expect(ledger.recoverTerminalReservations()).toBe(1);
    expect(ledger.recoverTerminalReservations()).toBe(0);
    expect(
      adapter.select<{ task_id: string; status: string; used_tokens: number }>(
        `SELECT task_id, status, used_tokens
         FROM chat_agent_budget_reservations
         WHERE kind = 'task'
         ORDER BY task_id`
      )
    ).toEqual([
      { task_id: 'checkpoint-recover-task-1', status: 'settled', used_tokens: 100 },
      { task_id: 'checkpoint-recover-task-2', status: 'active', used_tokens: 0 }
    ]);
  });

  it('releases a canonical pre-Attempt cancellation without touching resume budget', (): void => {
    seedBudgetFacts(database, 'checkpoint-pre-cancel', 'session-pre-cancel', 'turn-pre-cancel', 1);
    const ledger = createAgentBudgetLedger({
      database: adapter,
      resolveTurnBudget: (): AgentBudgetSnapshot => knownTurnBudget,
      now: (): string => '2026-07-27T00:00:02.000Z'
    });
    ledger.reserveResume('checkpoint-pre-cancel', resumeBudget);
    ledger.reserveTask('checkpoint-pre-cancel-task-1', childBudget);
    const taskId = 'checkpoint-pre-cancel-task-1';
    const result = createPreCancellation(taskId);
    adapter.execute(
      `UPDATE chat_agent_tasks
       SET status = 'cancelled', result_json = ?, result_hash = ?
       WHERE task_id = ?`,
      [JSON.stringify(result), hashAgentPayload(result), taskId]
    );

    expect(ledger.recoverTerminalReservations(taskId)).toBe(1);
    expect(
      adapter.select<{ kind: string; status: string }>(
        `SELECT kind, status
         FROM chat_agent_budget_reservations
         WHERE checkpoint_id = ?
         ORDER BY kind`,
        ['checkpoint-pre-cancel']
      )
    ).toEqual([
      { kind: 'resume', status: 'active' },
      { kind: 'task', status: 'released' }
    ]);
  });
});
