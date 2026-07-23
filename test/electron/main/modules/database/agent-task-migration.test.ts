/**
 * @file agent-task-migration.test.ts
 * @description 验证 Agent 委派事实表可增量创建且不破坏既有聊天数据。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDatabase, dbExecute, dbSelect, initDatabase } from '../../../../../electron/main/modules/database/service.mts';

const testState = vi.hoisted(() => ({
  userDataPath: ''
}));

vi.mock('electron', () => ({
  app: {
    getPath: (): string => testState.userDataPath
  }
}));

/** 仅在 ABI 与 better-sqlite3 一致的 Electron Node 进程中执行真实数据库测试。 */
const describeWithSqlite = 'electron' in process.versions ? describe : describe.skip;

/**
 * 创建覆盖 Task、Attempt、Checkpoint、Event 与 Outbox 的最小事实集合。
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

    expect(tableNames).toEqual(
      expect.arrayContaining(['chat_agent_tasks', 'chat_agent_attempts', 'chat_agent_delegation_checkpoints', 'chat_agent_events', 'chat_agent_outbox'])
    );
    expect(indexNames).toEqual(
      expect.arrayContaining(['idx_chat_agent_tasks_checkpoint_tool_call', 'idx_chat_agent_events_aggregate_sequence', 'idx_chat_agent_outbox_delivery'])
    );
    expect(dbSelect<{ title: string }>('SELECT title FROM chat_sessions WHERE id = ?', ['legacy-session'])).toEqual([{ title: 'Legacy' }]);
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

  it.each(['chat_agent_tasks', 'chat_agent_attempts', 'chat_agent_delegation_checkpoints', 'chat_agent_events', 'chat_agent_outbox'])(
    'rejects physical deletion from %s',
    async (tableName: string): Promise<void> => {
      await seedAgentFacts();

      expect((): void => {
        dbExecute(`DELETE FROM ${tableName}`);
      }).toThrowError(/agent_fact_delete_forbidden/i);
    }
  );
});
