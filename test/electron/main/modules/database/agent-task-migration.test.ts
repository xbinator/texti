/**
 * @file agent-task-migration.test.ts
 * @description 验证 Agent 委派事实表可增量创建且不破坏既有聊天数据。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAgentDelegationStore, type AgentStoreDatabase } from '../../../../../electron/main/modules/chat/agents/store.mts';
import { closeDatabase, createAgentTables, dbExecute, dbSelect, initDatabase } from '../../../../../electron/main/modules/database/service.mts';

const testState = vi.hoisted(() => ({
  userDataPath: ''
}));

vi.mock('electron', () => ({
  app: {
    getPath: (): string => testState.userDataPath
  }
}));

/**
 * 把 migration 内存库适配到真实 Agent Store 窄边界。
 * @param database - 已迁移 SQLite
 * @returns 可读取迁移投影的 Store database
 */
function createStoreDatabase(database: InstanceType<typeof Database>): AgentStoreDatabase {
  return {
    execute: (sql: string, params: readonly unknown[] = []): { changes: number; lastInsertRowid: number | bigint } => database.prepare(sql).run(...params),
    select: <T>(sql: string, params: readonly unknown[] = []): T[] => database.prepare(sql).all(...params) as T[],
    transaction: <T>(operation: () => T): T => database.transaction(operation)()
  };
}

/** 仅在 ABI 与 better-sqlite3 一致的 Electron Node 进程中执行真实数据库测试。 */
const describeWithSqlite = 'electron' in process.versions ? describe : describe.skip;

/**
 * 创建含重复 Assistant Message 身份的旧版 Checkpoint 表。
 * @returns 可用于执行 Agent 表迁移的内存数据库
 */
function createDuplicateDatabase(): InstanceType<typeof Database> {
  const database = new Database(':memory:');
  database.exec(`
    CREATE TABLE chat_agent_delegation_checkpoints (
      checkpoint_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      primary_agent_id TEXT NOT NULL,
      root_runtime_id TEXT NOT NULL,
      source_runtime_id TEXT NOT NULL,
      assistant_message_id TEXT NOT NULL,
      continuation_snapshot_json TEXT NOT NULL,
      continuation_snapshot_hash TEXT NOT NULL,
      status TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 0,
      terminal_results_json TEXT NOT NULL DEFAULT '{}',
      resume_runtime_id TEXT,
      error_json TEXT,
      record_state TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    INSERT INTO chat_agent_delegation_checkpoints (
      checkpoint_id, session_id, turn_id, primary_agent_id, root_runtime_id,
      source_runtime_id, assistant_message_id, continuation_snapshot_json,
      continuation_snapshot_hash, status, created_at, updated_at
    ) VALUES
      (
        'checkpoint-duplicate-a', 'session-a', 'turn-a', 'primary',
        'runtime-root-a', 'runtime-source-a', 'assistant-duplicate', '{}',
        '${'a'.repeat(64)}', 'waiting_children',
        '2026-07-28T08:00:00.000Z', '2026-07-28T08:00:00.000Z'
      ),
      (
        'checkpoint-duplicate-b', 'session-b', 'turn-b', 'primary',
        'runtime-root-b', 'runtime-source-b', 'assistant-duplicate', '{}',
        '${'b'.repeat(64)}', 'waiting_children',
        '2026-07-28T08:01:00.000Z', '2026-07-28T08:01:00.000Z'
      );
  `);

  return database;
}

/**
 * 创建覆盖 Task、Attempt、Checkpoint、Event、Outbox 与预算预留的最小事实集合。
 */
async function seedAgentFacts(): Promise<void> {
  await initDatabase();
  dbExecute(
    `INSERT INTO chat_agent_tasks (
      task_id, session_id, turn_id, agent_id, parent_agent_id, root_runtime_id,
      checkpoint_id, tool_call_id, contract_snapshot_json, contract_snapshot_hash,
      status, priority, record_state, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      'task-protected',
      'session-protected',
      'turn-protected',
      'child-protected',
      'primary',
      'runtime-root',
      'checkpoint-protected',
      'tool-call-protected',
      '{"contractSchemaVersion":1}',
      'a'.repeat(64),
      'created',
      'normal',
      'active',
      '2026-07-23T08:00:00.000Z',
      '2026-07-23T08:00:00.000Z'
    ]
  );
  dbExecute(
    `INSERT INTO chat_agent_attempts (
      attempt_id, task_id, attempt_number, parent_runtime_id, plan_hash,
      initial_runtime_id, current_runtime_id, runtime_sequence, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ['attempt-protected', 'task-protected', 1, 'runtime-parent', 'b'.repeat(64), 'runtime-initial', 'runtime-initial', 1, 'created', '2026-07-23T08:00:00.000Z']
  );
  dbExecute(
    `INSERT INTO chat_agent_delegation_checkpoints (
      checkpoint_id, session_id, turn_id, primary_agent_id, root_runtime_id,
      source_runtime_id, assistant_message_id, continuation_snapshot_json,
      continuation_snapshot_hash, status, version, terminal_results_json,
      record_state, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      'checkpoint-protected',
      'session-protected',
      'turn-protected',
      'primary',
      'runtime-root',
      'runtime-a',
      'assistant-protected',
      '{"checkpointSchemaVersion":1}',
      'c'.repeat(64),
      'waiting_children',
      1,
      '{}',
      'active',
      '2026-07-23T08:00:00.000Z',
      '2026-07-23T08:00:00.000Z'
    ]
  );
  dbExecute(
    `INSERT INTO chat_agent_events (
      event_id, aggregate_kind, aggregate_id, task_id, sequence,
      event_type, occurred_at, source, schema_version, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ['event-protected', 'task', 'task-protected', 'task-protected', 1, 'task.created', '2026-07-23T08:00:00.000Z', 'coordinator', 1, '{}']
  );
  dbExecute(
    `INSERT INTO chat_agent_outbox (
      outbox_id, dedupe_key, event_type, payload_json, payload_hash,
      schema_version, delivery_status, attempt_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      'outbox-protected',
      'delegation.created:checkpoint-protected',
      'delegation.created',
      '{"checkpointId":"checkpoint-protected","sessionId":"session-protected","turnId":"turn-protected"}',
      'd'.repeat(64),
      1,
      'pending',
      0,
      '2026-07-23T08:00:00.000Z',
      '2026-07-23T08:00:00.000Z'
    ]
  );
  dbExecute(
    `INSERT INTO chat_agent_budget_reservations (
      reservation_id, session_id, turn_id, checkpoint_id, task_id, kind,
      reserved_tokens, reserved_cost_usd, pricing_version, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      'budget-task-protected',
      'session-protected',
      'turn-protected',
      'checkpoint-protected',
      'task-protected',
      'task',
      512,
      0.01,
      'pricing-v1',
      'active',
      '2026-07-23T08:00:00.000Z',
      '2026-07-23T08:00:00.000Z'
    ]
  );
}

describeWithSqlite('agent task additive migration', (): void => {
  beforeEach((): void => {
    testState.userDataPath = mkdtempSync(join(tmpdir(), 'tibis-agent-task-'));
    const legacyDatabase = new Database(join(testState.userDataPath, 'tibis.db'));
    legacyDatabase.exec(`
      CREATE TABLE chat_sessions (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_message_at TEXT NOT NULL
      );
      CREATE TABLE chat_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        files_json TEXT,
        usage_json TEXT,
        created_at TEXT NOT NULL
      );
      INSERT INTO chat_sessions (id, type, title, created_at, updated_at, last_message_at)
      VALUES ('legacy-session', 'assistant', 'Legacy', '2026-07-22T00:00:00.000Z', '2026-07-22T00:00:00.000Z', '2026-07-22T00:00:00.000Z');
    `);
    legacyDatabase.close();
  });

  afterEach((): void => {
    closeDatabase();
    rmSync(testState.userDataPath, { recursive: true, force: true });
  });

  it('creates all agent fact tables and preserves legacy chat rows', async (): Promise<void> => {
    await initDatabase();

    const tableNames = dbSelect<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").map((row): string => row.name);
    const indexNames = dbSelect<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'index'").map((row): string => row.name);
    const attemptColumns = dbSelect<{ name: string }>('PRAGMA table_info(chat_agent_attempts)').map((row): string => row.name);
    const checkpointColumns = dbSelect<{ name: string }>('PRAGMA table_info(chat_agent_delegation_checkpoints)').map((row): string => row.name);
    const outboxColumns = dbSelect<{ name: string }>('PRAGMA table_info(chat_agent_outbox)').map((row): string => row.name);

    expect(tableNames).toEqual(
      expect.arrayContaining([
        'chat_agent_tasks',
        'chat_agent_attempts',
        'chat_agent_delegation_checkpoints',
        'chat_agent_events',
        'chat_agent_outbox',
        'chat_agent_budget_reservations',
        'chat_agent_changesets',
        'chat_agent_confirmations',
        'chat_agent_commit_journals'
      ])
    );
    expect(indexNames).toEqual(
      expect.arrayContaining([
        'idx_chat_agent_tasks_checkpoint_tool_call',
        'idx_chat_agent_tasks_session_record_updated',
        'idx_chat_agent_checkpoints_assistant_message',
        'idx_chat_agent_events_aggregate_sequence',
        'idx_chat_agent_outbox_delivery',
        'idx_chat_agent_budget_turn_status',
        'idx_chat_agent_budget_task'
      ])
    );
    expect(attemptColumns).toEqual(expect.arrayContaining(['usage_snapshot_json', 'usage_complete', 'usage_updated_at']));
    expect(checkpointColumns).toContain('cancellation_finalized_at');
    expect(outboxColumns).toContain('superseded_at');
    expect(dbSelect<{ title: string }>('SELECT title FROM chat_sessions WHERE id = ?', ['legacy-session'])).toEqual([{ title: 'Legacy' }]);
  });

  it('backfills legacy Attempt usage as an explicit incomplete lower-bound', (): void => {
    const database = new Database(':memory:');
    database.exec(`
      CREATE TABLE chat_agent_attempts (
        attempt_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        attempt_number INTEGER NOT NULL,
        parent_runtime_id TEXT NOT NULL,
        plan_hash TEXT NOT NULL,
        initial_runtime_id TEXT NOT NULL,
        current_runtime_id TEXT NOT NULL,
        runtime_sequence INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        error_json TEXT,
        created_at TEXT NOT NULL,
        UNIQUE (task_id, attempt_number)
      );
      INSERT INTO chat_agent_attempts (
        attempt_id, task_id, attempt_number, parent_runtime_id, plan_hash,
        initial_runtime_id, current_runtime_id, runtime_sequence, status,
        started_at, created_at
      ) VALUES (
        'attempt-legacy', 'task-legacy', 1, 'runtime-parent', '${'a'.repeat(64)}',
        'runtime-child', 'runtime-child', 1, 'running',
        '2026-07-27T00:00:01.000Z', '2026-07-27T00:00:00.000Z'
      );
    `);

    createAgentTables(database);

    const row = database
      .prepare(
        `SELECT usage_snapshot_json, usage_complete, usage_updated_at
         FROM chat_agent_attempts
         WHERE attempt_id = ?`
      )
      .get('attempt-legacy') as {
      usage_snapshot_json: string;
      usage_complete: number;
      usage_updated_at: string;
    };
    expect(JSON.parse(row.usage_snapshot_json)).toMatchObject({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      modelCalls: 0
    });
    expect(row.usage_complete).toBe(0);
    expect(row.usage_updated_at).toBe('2026-07-27T00:00:00.000Z');
    database.close();
  });

  it('backfills legacy Attempt usage from frozen pricing and immutable terminal facts', (): void => {
    const database = new Database(':memory:');
    createAgentTables(database);
    database.exec(`
      DROP TABLE chat_agent_attempts;
      CREATE TABLE chat_agent_attempts (
        attempt_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        attempt_number INTEGER NOT NULL,
        parent_runtime_id TEXT NOT NULL,
        plan_hash TEXT NOT NULL,
        initial_runtime_id TEXT NOT NULL,
        current_runtime_id TEXT NOT NULL,
        runtime_sequence INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        error_json TEXT,
        created_at TEXT NOT NULL,
        UNIQUE (task_id, attempt_number)
      );
    `);
    const plan = JSON.stringify({
      planSchemaVersion: 1,
      budget: {
        tokenLimit: 100,
        costLimitUsd: 0.01,
        pricingVersion: 'pricing-v7'
      }
    });
    const journalUsage = {
      inputTokens: 7,
      outputTokens: 3,
      totalTokens: 10,
      modelCalls: 1,
      toolRounds: 1,
      queueDurationMs: 2,
      executionDurationMs: 8,
      externalRequests: 0,
      monetaryCost: {
        currency: 'USD',
        pricingVersion: 'pricing-v7',
        estimated: 0.002,
        actual: 'unknown'
      }
    };
    const resultUsage = {
      ...journalUsage,
      inputTokens: 9,
      outputTokens: 3,
      totalTokens: 12,
      monetaryCost: {
        ...journalUsage.monetaryCost,
        estimated: 0.003
      }
    };
    const insertTask = database.prepare(
      `INSERT INTO chat_agent_tasks (
        task_id, session_id, turn_id, agent_id, parent_agent_id, root_runtime_id,
        checkpoint_id, tool_call_id, contract_snapshot_json, contract_snapshot_hash,
        execution_plan_snapshot_json, execution_plan_snapshot_hash, status, priority,
        current_attempt_id, result_json, result_hash, record_state,
        unfinished_journal_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const taskFacts = [
      ['task-known', 'running', 'attempt-known', null, null, 0],
      ['task-journal', 'committing', 'attempt-journal', null, null, 1],
      ['task-result', 'completed', 'attempt-result', JSON.stringify({ usage: resultUsage }), 'f'.repeat(64), 0]
    ] as const;
    taskFacts.forEach(([taskId, status, attemptId, resultJson, resultHash, journalCount]): void => {
      insertTask.run(
        taskId,
        `session-${taskId}`,
        `turn-${taskId}`,
        `child-${taskId}`,
        'primary',
        `runtime-root-${taskId}`,
        `checkpoint-${taskId}`,
        `tool-${taskId}`,
        '{}',
        'a'.repeat(64),
        plan,
        'b'.repeat(64),
        status,
        'normal',
        attemptId,
        resultJson,
        resultHash,
        'active',
        journalCount,
        '2026-07-27T00:00:00.000Z',
        '2026-07-27T00:00:01.000Z'
      );
    });
    const insertAttempt = database.prepare(
      `INSERT INTO chat_agent_attempts (
        attempt_id, task_id, attempt_number, parent_runtime_id, plan_hash,
        initial_runtime_id, current_runtime_id, runtime_sequence, status,
        started_at, finished_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    insertAttempt.run(
      'attempt-known',
      'task-known',
      1,
      'runtime-parent',
      'b'.repeat(64),
      'runtime-known',
      'runtime-known',
      1,
      'running',
      '2026-07-27T00:00:01.000Z',
      null,
      '2026-07-27T00:00:00.000Z'
    );
    insertAttempt.run(
      'attempt-journal',
      'task-journal',
      1,
      'runtime-parent',
      'b'.repeat(64),
      'runtime-journal',
      'runtime-journal',
      1,
      'running',
      '2026-07-27T00:00:01.000Z',
      null,
      '2026-07-27T00:00:00.000Z'
    );
    insertAttempt.run(
      'attempt-result',
      'task-result',
      1,
      'runtime-parent',
      'b'.repeat(64),
      'runtime-result',
      'runtime-result',
      1,
      'completed',
      '2026-07-27T00:00:01.000Z',
      '2026-07-27T00:00:02.000Z',
      '2026-07-27T00:00:00.000Z'
    );
    database
      .prepare(
        `INSERT INTO chat_agent_commit_journals (
          journal_id, task_id, attempt_id, changeset_id, confirmation_id,
          confirmation_version, plan_hash, intent_json, intent_hash, status,
          operation_progress_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        'journal-legacy',
        'task-journal',
        'attempt-journal',
        'changeset-legacy',
        'confirmation-legacy',
        1,
        'b'.repeat(64),
        JSON.stringify({ resultDraft: { usage: journalUsage } }),
        'c'.repeat(64),
        'created',
        '[]',
        '2026-07-27T00:00:01.000Z',
        '2026-07-27T00:00:01.000Z'
      );

    createAgentTables(database);

    const rows = database
      .prepare(
        `SELECT attempt_id, usage_snapshot_json, usage_complete
         FROM chat_agent_attempts
         ORDER BY attempt_id ASC`
      )
      .all() as Array<{ attempt_id: string; usage_snapshot_json: string; usage_complete: number }>;
    expect(rows).toEqual([
      {
        attempt_id: 'attempt-journal',
        usage_snapshot_json: JSON.stringify(journalUsage),
        usage_complete: 1
      },
      {
        attempt_id: 'attempt-known',
        usage_snapshot_json: JSON.stringify({
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          modelCalls: 0,
          toolRounds: 0,
          queueDurationMs: 0,
          executionDurationMs: 0,
          externalRequests: 0,
          monetaryCost: {
            currency: 'USD',
            pricingVersion: 'pricing-v7',
            estimated: 0,
            actual: 'unknown'
          }
        }),
        usage_complete: 0
      },
      {
        attempt_id: 'attempt-result',
        usage_snapshot_json: JSON.stringify(resultUsage),
        usage_complete: 1
      }
    ]);
    const store = createAgentDelegationStore(createStoreDatabase(database));
    expect(store.getAttempt('attempt-known')).toMatchObject({
      usageSnapshot: {
        totalTokens: 0,
        monetaryCost: {
          currency: 'USD',
          pricingVersion: 'pricing-v7',
          estimated: 0
        }
      },
      usageComplete: false
    });
    expect(store.getAttempt('attempt-journal')).toMatchObject({
      usageSnapshot: journalUsage,
      usageComplete: true
    });
    const unknownSentinel = {
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
    };
    const realLowerBound = {
      ...journalUsage,
      inputTokens: 4,
      outputTokens: 2,
      totalTokens: 6,
      monetaryCost: {
        ...journalUsage.monetaryCost,
        estimated: 0.001
      }
    };
    database
      .prepare(
        `UPDATE chat_agent_attempts
         SET usage_snapshot_json = ?, usage_complete = 0
         WHERE attempt_id = ?`
      )
      .run(JSON.stringify(unknownSentinel), 'attempt-known');
    database
      .prepare(
        `INSERT INTO chat_agent_attempts (
          attempt_id, task_id, attempt_number, parent_runtime_id, plan_hash,
          initial_runtime_id, current_runtime_id, runtime_sequence, status,
          usage_snapshot_json, usage_complete, usage_updated_at, started_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        'attempt-partial',
        'task-known',
        2,
        'runtime-parent',
        'b'.repeat(64),
        'runtime-partial',
        'runtime-partial',
        1,
        'running',
        JSON.stringify(realLowerBound),
        0,
        '2026-07-27T00:00:02.000Z',
        '2026-07-27T00:00:02.000Z',
        '2026-07-27T00:00:02.000Z'
      );

    createAgentTables(database);

    const recoveredStore = createAgentDelegationStore(createStoreDatabase(database));
    expect(recoveredStore.getAttempt('attempt-known')).toMatchObject({
      usageSnapshot: {
        monetaryCost: {
          currency: 'USD',
          pricingVersion: 'pricing-v7',
          estimated: 0
        }
      },
      usageComplete: false
    });
    expect(recoveredStore.getAttempt('attempt-partial')).toMatchObject({
      usageSnapshot: realLowerBound,
      usageComplete: false
    });
    database.close();
  });

  it('rejects duplicate Assistant Message identities without rewriting legacy Checkpoints', (): void => {
    const database = createDuplicateDatabase();

    expect((): void => createAgentTables(database)).toThrow('agent_checkpoint_assistant_message_duplicate');
    expect(
      database
        .prepare(
          `SELECT checkpoint_id, assistant_message_id
           FROM chat_agent_delegation_checkpoints
           ORDER BY checkpoint_id ASC`
        )
        .all()
    ).toEqual([
      {
        checkpoint_id: 'checkpoint-duplicate-a',
        assistant_message_id: 'assistant-duplicate'
      },
      {
        checkpoint_id: 'checkpoint-duplicate-b',
        assistant_message_id: 'assistant-duplicate'
      }
    ]);

    database.close();
  });

  it('enforces unique Assistant Message identities after a successful migration', async (): Promise<void> => {
    await initDatabase();

    dbExecute(
      `INSERT INTO chat_agent_delegation_checkpoints (
        checkpoint_id, session_id, turn_id, primary_agent_id, root_runtime_id,
        source_runtime_id, assistant_message_id, continuation_snapshot_json,
        continuation_snapshot_hash, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'checkpoint-unique-a',
        'session-unique',
        'turn-unique-a',
        'primary',
        'runtime-root',
        'runtime-source-a',
        'assistant-unique',
        '{}',
        'a'.repeat(64),
        'waiting_children',
        '2026-07-28T08:00:00.000Z',
        '2026-07-28T08:00:00.000Z'
      ]
    );

    expect((): void => {
      dbExecute(
        `INSERT INTO chat_agent_delegation_checkpoints (
          checkpoint_id, session_id, turn_id, primary_agent_id, root_runtime_id,
          source_runtime_id, assistant_message_id, continuation_snapshot_json,
          continuation_snapshot_hash, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          'checkpoint-unique-b',
          'session-unique',
          'turn-unique-b',
          'primary',
          'runtime-root',
          'runtime-source-b',
          'assistant-unique',
          '{}',
          'b'.repeat(64),
          'waiting_children',
          '2026-07-28T08:01:00.000Z',
          '2026-07-28T08:01:00.000Z'
        ]
      );
    }).toThrowError(/unique/i);
  });

  it('keeps the Agent table migration idempotent', async (): Promise<void> => {
    await initDatabase();
    closeDatabase();

    await expect(initDatabase()).resolves.toBeUndefined();
    expect(
      dbSelect<{ name: string }>(
        `SELECT name
         FROM sqlite_master
         WHERE type = 'index'
           AND name IN (
             'idx_chat_agent_checkpoints_assistant_message',
             'idx_chat_agent_tasks_session_record_updated'
           )
         ORDER BY name ASC`
      )
    ).toEqual([{ name: 'idx_chat_agent_checkpoints_assistant_message' }, { name: 'idx_chat_agent_tasks_session_record_updated' }]);
  });

  it('protects immutable write facts while allowing only their mutable projections', async (): Promise<void> => {
    await seedAgentFacts();
    dbExecute(
      `INSERT INTO chat_agent_changesets (
        changeset_id, task_id, attempt_id, agent_id, runtime_id, plan_hash,
        snapshot_json, snapshot_hash, base_revision, diff_hash, operation_set_hash,
        status, record_state, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'changeset-protected',
        'task-protected',
        'attempt-protected',
        'child-protected',
        'runtime-initial',
        'b'.repeat(64),
        '{"changesetSchemaVersion":1}',
        'e'.repeat(64),
        'f'.repeat(64),
        '1'.repeat(64),
        '2'.repeat(64),
        'prepared',
        'active',
        '2026-07-23T08:00:00.000Z',
        '2026-07-23T08:00:00.000Z'
      ]
    );
    dbExecute(
      `INSERT INTO chat_agent_confirmations (
        confirmation_id, changeset_id, request_json, request_hash, status,
        version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'confirmation-protected',
        'changeset-protected',
        '{"confirmationSchemaVersion":1}',
        '3'.repeat(64),
        'pending',
        1,
        '2026-07-23T08:00:00.000Z',
        '2026-07-23T08:00:00.000Z'
      ]
    );
    dbExecute(
      `INSERT INTO chat_agent_commit_journals (
        journal_id, task_id, attempt_id, changeset_id, confirmation_id,
        confirmation_version, plan_hash, intent_json, intent_hash, status,
        operation_progress_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'journal-protected',
        'task-protected',
        'attempt-protected',
        'changeset-protected',
        'confirmation-protected',
        1,
        'b'.repeat(64),
        '{"journalSchemaVersion":1}',
        '4'.repeat(64),
        'created',
        '[]',
        '2026-07-23T08:00:00.000Z',
        '2026-07-23T08:00:00.000Z'
      ]
    );

    expect((): void => {
      dbExecute('UPDATE chat_agent_changesets SET snapshot_hash = ? WHERE changeset_id = ?', ['9'.repeat(64), 'changeset-protected']);
    }).toThrowError(/agent_changeset_immutable/i);
    expect((): void => {
      dbExecute('UPDATE chat_agent_confirmations SET request_hash = ? WHERE confirmation_id = ?', ['9'.repeat(64), 'confirmation-protected']);
    }).toThrowError(/agent_confirmation_immutable/i);
    expect((): void => {
      dbExecute('UPDATE chat_agent_commit_journals SET intent_hash = ? WHERE journal_id = ?', ['9'.repeat(64), 'journal-protected']);
    }).toThrowError(/agent_commit_journal_immutable/i);

    expect(
      dbExecute('UPDATE chat_agent_changesets SET status = ?, updated_at = ? WHERE changeset_id = ?', [
        'awaiting_confirmation',
        '2026-07-23T08:01:00.000Z',
        'changeset-protected'
      ]).changes
    ).toBe(1);
    expect(
      dbExecute('UPDATE chat_agent_confirmations SET status = ?, version = ?, decision_json = ?, resolved_at = ?, updated_at = ? WHERE confirmation_id = ?', [
        'approved',
        2,
        '{"decision":"approved","version":2}',
        '2026-07-23T08:01:00.000Z',
        '2026-07-23T08:01:00.000Z',
        'confirmation-protected'
      ]).changes
    ).toBe(1);
    expect(
      dbExecute('UPDATE chat_agent_commit_journals SET status = ?, operation_progress_json = ?, updated_at = ? WHERE journal_id = ?', [
        'applying',
        '[]',
        '2026-07-23T08:01:00.000Z',
        'journal-protected'
      ]).changes
    ).toBe(1);

    for (const [tableName, idColumn, id] of [
      ['chat_agent_changesets', 'changeset_id', 'changeset-protected'],
      ['chat_agent_confirmations', 'confirmation_id', 'confirmation-protected'],
      ['chat_agent_commit_journals', 'journal_id', 'journal-protected']
    ] as const) {
      expect((): void => {
        dbExecute(`DELETE FROM ${tableName} WHERE ${idColumn} = ?`, [id]);
      }).toThrowError(/agent_fact_delete_forbidden/i);
    }
  });

  it('rejects event aggregate identity mismatches', async (): Promise<void> => {
    await initDatabase();

    expect((): void => {
      dbExecute(
        `INSERT INTO chat_agent_events (
          event_id, aggregate_kind, aggregate_id, checkpoint_id, sequence,
          event_type, occurred_at, source, schema_version, payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ['event-invalid-aggregate', 'task', 'task-1', 'checkpoint-1', 1, 'task.created', '2026-07-23T08:00:00.000Z', 'coordinator', 1, '{}']
      );
    }).toThrowError(/constraint/i);
  });

  it.each([
    ['execution plan', '{}', null, null, null],
    ['result', null, null, '{}', null]
  ])(
    'rejects a half-written %s JSON/hash pair',
    async (
      _name: string,
      executionPlanJson: string | null,
      executionPlanHash: string | null,
      resultJson: string | null,
      resultHash: string | null
    ): Promise<void> => {
      await initDatabase();

      expect((): void => {
        dbExecute(
          `INSERT INTO chat_agent_tasks (
            task_id, session_id, turn_id, agent_id, parent_agent_id, root_runtime_id,
            checkpoint_id, tool_call_id, contract_snapshot_json, contract_snapshot_hash,
            execution_plan_snapshot_json, execution_plan_snapshot_hash,
            status, priority, result_json, result_hash, record_state, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            `task-half-${_name}`,
            'session-1',
            'turn-1',
            'child-1',
            'primary',
            'runtime-root',
            `checkpoint-half-${_name}`,
            `tool-call-half-${_name}`,
            '{}',
            'a'.repeat(64),
            executionPlanJson,
            executionPlanHash,
            'created',
            'normal',
            resultJson,
            resultHash,
            'active',
            '2026-07-23T08:00:00.000Z',
            '2026-07-23T08:00:00.000Z'
          ]
        );
      }).toThrowError(/constraint/i);
    }
  );

  it('rejects updates to Task identity, contract snapshot, and created time', async (): Promise<void> => {
    await seedAgentFacts();
    const immutableUpdates = [
      ['task_id', 'task-rewritten'],
      ['session_id', 'session-rewritten'],
      ['turn_id', 'turn-rewritten'],
      ['agent_id', 'child-rewritten'],
      ['parent_agent_id', 'parent-rewritten'],
      ['root_runtime_id', 'runtime-rewritten'],
      ['checkpoint_id', 'checkpoint-rewritten'],
      ['tool_call_id', 'tool-call-rewritten'],
      ['contract_snapshot_json', '{}'],
      ['contract_snapshot_hash', 'e'.repeat(64)],
      ['created_at', '2026-07-23T08:01:00.000Z']
    ] as const;

    immutableUpdates.forEach(([column, value]): void => {
      expect((): void => {
        dbExecute(`UPDATE chat_agent_tasks SET ${column} = ? WHERE task_id = ?`, [value, 'task-protected']);
      }).toThrowError(/agent_task_immutable/i);
    });
  });

  it('allows first complete Task plan/result writes and rejects later replacement', async (): Promise<void> => {
    await seedAgentFacts();

    expect(
      dbExecute(
        `UPDATE chat_agent_tasks
         SET execution_plan_snapshot_json = ?, execution_plan_snapshot_hash = ?
         WHERE task_id = ?`,
        ['{"planSchemaVersion":1}', 'e'.repeat(64), 'task-protected']
      ).changes
    ).toBe(1);
    expect((): void => {
      dbExecute(
        `UPDATE chat_agent_tasks
         SET execution_plan_snapshot_json = ?, execution_plan_snapshot_hash = ?
         WHERE task_id = ?`,
        ['{"planSchemaVersion":2}', 'f'.repeat(64), 'task-protected']
      );
    }).toThrowError(/agent_task_plan_immutable/i);

    expect(
      dbExecute(`UPDATE chat_agent_tasks SET result_json = ?, result_hash = ? WHERE task_id = ?`, [
        '{"executionStatus":"completed"}',
        '1'.repeat(64),
        'task-protected'
      ]).changes
    ).toBe(1);
    expect((): void => {
      dbExecute(`UPDATE chat_agent_tasks SET result_json = ?, result_hash = ? WHERE task_id = ?`, [
        '{"executionStatus":"failed"}',
        '2'.repeat(64),
        'task-protected'
      ]);
    }).toThrowError(/agent_task_result_immutable/i);
  });

  it('rejects updates to Checkpoint identity, continuation, and created time', async (): Promise<void> => {
    await seedAgentFacts();
    const immutableUpdates = [
      ['checkpoint_id', 'checkpoint-rewritten'],
      ['session_id', 'session-rewritten'],
      ['turn_id', 'turn-rewritten'],
      ['primary_agent_id', 'primary-rewritten'],
      ['root_runtime_id', 'runtime-rewritten'],
      ['source_runtime_id', 'runtime-source-rewritten'],
      ['assistant_message_id', 'assistant-rewritten'],
      ['continuation_snapshot_json', '{}'],
      ['continuation_snapshot_hash', 'e'.repeat(64)],
      ['created_at', '2026-07-23T08:01:00.000Z']
    ] as const;

    immutableUpdates.forEach(([column, value]): void => {
      expect((): void => {
        dbExecute(`UPDATE chat_agent_delegation_checkpoints SET ${column} = ? WHERE checkpoint_id = ?`, [value, 'checkpoint-protected']);
      }).toThrowError(/agent_checkpoint_immutable/i);
    });
  });

  it('rejects every Event update', async (): Promise<void> => {
    await seedAgentFacts();

    expect((): void => {
      dbExecute(`UPDATE chat_agent_events SET payload_json = ? WHERE event_id = ?`, ['{"changed":true}', 'event-protected']);
    }).toThrowError(/agent_event_append_only/i);
  });

  it('protects Outbox immutable facts while allowing delivery projection updates', async (): Promise<void> => {
    await seedAgentFacts();
    const immutableUpdates = [
      ['outbox_id', 'outbox-rewritten'],
      ['dedupe_key', 'dedupe-rewritten'],
      ['event_type', 'delegation.rewritten'],
      ['payload_json', '{}'],
      ['payload_hash', 'e'.repeat(64)],
      ['schema_version', 2],
      ['created_at', '2026-07-23T08:01:00.000Z']
    ] as const;

    immutableUpdates.forEach(([column, value]): void => {
      expect((): void => {
        dbExecute(`UPDATE chat_agent_outbox SET ${column} = ? WHERE outbox_id = ?`, [value, 'outbox-protected']);
      }).toThrowError(/agent_outbox_immutable/i);
    });
    expect(
      dbExecute(
        `UPDATE chat_agent_outbox
         SET delivery_status = ?, attempt_count = ?, delivered_at = ?, updated_at = ?
         WHERE outbox_id = ?`,
        ['delivered', 1, '2026-07-23T08:01:00.000Z', '2026-07-23T08:01:00.000Z', 'outbox-protected']
      ).changes
    ).toBe(1);
  });

  it('protects Attempt execution identity while allowing runtime projection updates', async (): Promise<void> => {
    await seedAgentFacts();
    const immutableUpdates = [
      ['attempt_id', 'attempt-rewritten'],
      ['task_id', 'task-rewritten'],
      ['attempt_number', 2],
      ['parent_runtime_id', 'runtime-parent-rewritten'],
      ['plan_hash', 'e'.repeat(64)],
      ['initial_runtime_id', 'runtime-initial-rewritten'],
      ['created_at', '2026-07-23T08:01:00.000Z']
    ] as const;

    immutableUpdates.forEach(([column, value]): void => {
      expect((): void => {
        dbExecute(`UPDATE chat_agent_attempts SET ${column} = ? WHERE attempt_id = ?`, [value, 'attempt-protected']);
      }).toThrowError(/agent_attempt_immutable/i);
    });
    expect(
      dbExecute(
        `UPDATE chat_agent_attempts
         SET current_runtime_id = ?, runtime_sequence = ?, status = ?, started_at = ?
         WHERE attempt_id = ?`,
        ['runtime-replacement', 2, 'running', '2026-07-23T08:01:00.000Z', 'attempt-protected']
      ).changes
    ).toBe(1);
  });

  it('protects budget reservation facts while allowing settlement projection updates', async (): Promise<void> => {
    await seedAgentFacts();
    const immutableUpdates = [
      ['reservation_id', 'budget-rewritten'],
      ['session_id', 'session-rewritten'],
      ['turn_id', 'turn-rewritten'],
      ['checkpoint_id', 'checkpoint-rewritten'],
      ['task_id', 'task-rewritten'],
      ['kind', 'resume'],
      ['reserved_tokens', 1_024],
      ['reserved_cost_usd', 0.02],
      ['pricing_version', 'pricing-v2'],
      ['created_at', '2026-07-23T08:01:00.000Z']
    ] as const;

    immutableUpdates.forEach(([column, value]): void => {
      expect((): void => {
        dbExecute(`UPDATE chat_agent_budget_reservations SET ${column} = ? WHERE reservation_id = ?`, [value, 'budget-task-protected']);
      }).toThrowError(/agent_budget_immutable/i);
    });
    expect(
      dbExecute(
        `UPDATE chat_agent_budget_reservations
         SET used_tokens = ?, used_cost_usd = ?, status = ?, updated_at = ?
         WHERE reservation_id = ?`,
        [128, 0.005, 'settled', '2026-07-23T08:01:00.000Z', 'budget-task-protected']
      ).changes
    ).toBe(1);
  });

  it.each([
    'chat_agent_tasks',
    'chat_agent_attempts',
    'chat_agent_delegation_checkpoints',
    'chat_agent_events',
    'chat_agent_outbox',
    'chat_agent_budget_reservations'
  ])('rejects physical deletion from %s', async (tableName: string): Promise<void> => {
    await seedAgentFacts();

    expect((): void => {
      dbExecute(`DELETE FROM ${tableName}`);
    }).toThrowError(/agent_fact_delete_forbidden/i);
  });
});
