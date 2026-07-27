/**
 * @file confirmation-store.test.ts
 * @description Main-owned Child Agent confirmation queue 的持久化、CAS、恢复与完整性测试。
 */
import type { AgentConfirmationRecord, AgentConfirmationRequestSnapshot, ChatAgentApplicationEvent } from 'types/chat-agent';
import { describe, expect, it, vi } from 'vitest';
import { createAgentConfirmationQueue, type AgentConfirmationQueueStore } from '../../../../../../electron/main/modules/chat/agents/confirmation-store.mjs';
import { hashAgentPayload, hashAgentText } from '../../../../../../electron/main/modules/chat/agents/contracts.mjs';
import { AgentStoreProtocolError, type CreateAgentConfirmationInput } from '../../../../../../electron/main/modules/chat/agents/types.mjs';

/** 测试使用的完整 unified diff。 */
const UNIFIED_DIFF = ['--- a/notes.md', '+++ b/notes.md', '@@ -1 +1 @@', '-before', '+after', ''].join('\n');

/**
 * 创建与 unified diff 完整绑定的 confirmation 请求。
 * @param patch - 可覆盖的请求字段
 * @returns 不可变 confirmation 请求
 */
function createRequest(patch: Partial<AgentConfirmationRequestSnapshot> = {}): AgentConfirmationRequestSnapshot {
  const baseRevision = 'a'.repeat(64);
  const operationSetHash = 'b'.repeat(64);
  return {
    confirmationSchemaVersion: 1,
    confirmationId: 'confirmation-1',
    sessionId: 'session-1',
    turnId: 'turn-1',
    taskId: 'task-1',
    attemptId: 'attempt-1',
    agentId: 'child-1',
    runtimeId: 'runtime-1',
    toolCallId: 'tool-call-1',
    changesetId: 'changeset-1',
    planHash: 'c'.repeat(64),
    baseRevision,
    diffHash: hashAgentPayload({
      schemaVersion: 1,
      baseRevision,
      operationSetHash,
      diffContentHash: hashAgentText(UNIFIED_DIFF)
    }),
    operationSetHash,
    resourceScopes: ['file:/workspace/notes.md'],
    displayPaths: ['notes.md'],
    unifiedDiffReference: '/private/overlay/confirmation-1.diff',
    riskLevel: 'write',
    createdAt: '2026-07-27T00:00:00.000Z',
    ...patch
  };
}

/**
 * 创建 confirmation Store API 输入。
 * @param request - confirmation 请求
 * @returns 持久化输入
 */
function createInput(request = createRequest()): CreateAgentConfirmationInput {
  return {
    request,
    requestHash: hashAgentPayload({
      schemaVersion: request.confirmationSchemaVersion,
      request
    }),
    occurredAt: request.createdAt
  };
}

/**
 * 创建模拟真实 CAS 行为的同步持久化 Store。
 * @returns Store port 与内部记录
 */
function createStore(): {
  /** confirmation queue 使用的窄 Store。 */
  store: AgentConfirmationQueueStore;
  /** 按 ID 保存的持久化记录。 */
  records: Map<string, AgentConfirmationRecord>;
} {
  const records = new Map<string, AgentConfirmationRecord>();
  const store: AgentConfirmationQueueStore = {
    createConfirmation(input: CreateAgentConfirmationInput): AgentConfirmationRecord {
      const existing = records.get(input.request.confirmationId);
      if (existing) return existing;
      const record: AgentConfirmationRecord = {
        confirmationId: input.request.confirmationId,
        changesetId: input.request.changesetId,
        request: structuredClone(input.request),
        requestHash: input.requestHash,
        status: 'pending',
        version: 1,
        createdAt: input.request.createdAt,
        updatedAt: input.occurredAt
      };
      records.set(record.confirmationId, record);
      return record;
    },
    resolveConfirmation(input): AgentConfirmationRecord {
      const current = records.get(input.confirmationId);
      if (!current) throw new AgentStoreProtocolError('confirmation_not_found');
      if (current.status === input.decision && current.decision === input.decision && current.version === input.expectedVersion + 1) {
        return current;
      }
      if (current.status !== 'pending' || current.version !== input.expectedVersion) {
        throw new AgentStoreProtocolError('confirmation_version_conflict', 'Confirmation CAS version conflicts', 'confirmation');
      }
      const resolved: AgentConfirmationRecord = {
        ...current,
        status: input.decision,
        version: current.version + 1,
        decision: input.decision,
        updatedAt: input.occurredAt
      };
      records.set(resolved.confirmationId, resolved);
      return resolved;
    },
    revokeConfirmation(confirmationId: string, _reason: string, occurredAt: string): AgentConfirmationRecord {
      const current = records.get(confirmationId);
      if (!current) throw new AgentStoreProtocolError('confirmation_not_found');
      if (current.status === 'revoked') return current;
      if (current.status !== 'pending') throw new AgentStoreProtocolError('confirmation_revoke_conflict');
      const revoked: AgentConfirmationRecord = {
        ...current,
        status: 'revoked',
        version: current.version + 1,
        updatedAt: occurredAt
      };
      records.set(revoked.confirmationId, revoked);
      return revoked;
    },
    listPendingConfirmations(): AgentConfirmationRecord[] {
      return [...records.values()].filter((record): boolean => record.status === 'pending');
    }
  };
  return { store, records };
}

describe('AgentConfirmationQueue', (): void => {
  it('persists before waiting and resolves one waiter through version CAS', async (): Promise<void> => {
    const fixture = createStore();
    const publish = vi.fn<(event: ChatAgentApplicationEvent) => void>();
    const queue = createAgentConfirmationQueue({
      store: fixture.store,
      readUnifiedDiff: (): string => UNIFIED_DIFF,
      publish,
      now: (): string => '2026-07-27T00:01:00.000Z'
    });

    const waiting = queue.request(createInput());

    expect(fixture.store.listPendingConfirmations()).toHaveLength(1);
    expect(queue.listPending()).toEqual([
      expect.objectContaining({
        confirmationId: 'confirmation-1',
        status: 'pending',
        version: 1,
        unifiedDiff: UNIFIED_DIFF
      })
    ]);
    const approved = queue.resolve({
      confirmationId: 'confirmation-1',
      expectedVersion: 1,
      decision: 'approved'
    });

    expect(approved).toMatchObject({ status: 'approved', version: 2 });
    await expect(waiting).resolves.toEqual({ decision: 'approved', version: 2 });
    expect(publish).toHaveBeenCalledTimes(2);

    expect(
      queue.resolve({
        confirmationId: 'confirmation-1',
        expectedVersion: 1,
        decision: 'approved'
      })
    ).toEqual(approved);
    expect(publish).toHaveBeenCalledTimes(2);
    expect((): void => {
      queue.resolve({
        confirmationId: 'confirmation-1',
        expectedVersion: 1,
        decision: 'rejected'
      });
    }).toThrowError(expect.objectContaining({ reason: 'confirmation_version_conflict' }));
  });

  it('keeps pending facts when Renderer publishing fails and recovers every snapshot', async (): Promise<void> => {
    const fixture = createStore();
    fixture.store.createConfirmation(createInput(createRequest()));
    fixture.store.createConfirmation(
      createInput(
        createRequest({
          confirmationId: 'confirmation-2',
          taskId: 'task-2',
          changesetId: 'changeset-2',
          unifiedDiffReference: '/private/overlay/confirmation-2.diff',
          createdAt: '2026-07-27T00:00:01.000Z'
        })
      )
    );
    const publish = vi.fn<(event: ChatAgentApplicationEvent) => void>(() => {
      throw new Error('no Renderer subscribers');
    });
    const queue = createAgentConfirmationQueue({
      store: fixture.store,
      readUnifiedDiff: (): string => UNIFIED_DIFF,
      publish,
      now: (): string => '2026-07-27T00:01:00.000Z'
    });

    expect((): void => queue.recover()).not.toThrow();
    expect(queue.listPending().map((snapshot): string => snapshot.confirmationId)).toEqual(['confirmation-1', 'confirmation-2']);
    expect(publish).toHaveBeenCalledTimes(2);

    const waiting = queue.request(createInput(createRequest({ confirmationId: 'confirmation-1' })));
    expect((): void => {
      queue.resolve({ confirmationId: 'confirmation-1', expectedVersion: 1, decision: 'rejected' });
    }).not.toThrow();
    await expect(waiting).resolves.toEqual({ decision: 'rejected', version: 2 });
  });

  it('revokes only matching Task waiters and rejects tampered diff projections', async (): Promise<void> => {
    const fixture = createStore();
    const queue = createAgentConfirmationQueue({
      store: fixture.store,
      readUnifiedDiff: (reference: string): string => (reference.includes('tampered') ? `${UNIFIED_DIFF}tampered` : UNIFIED_DIFF),
      publish: vi.fn(),
      now: (): string => '2026-07-27T00:02:00.000Z'
    });
    const taskOne = queue.request(createInput(createRequest()));
    queue.request(
      createInput(
        createRequest({
          confirmationId: 'confirmation-2',
          taskId: 'task-2',
          changesetId: 'changeset-2',
          unifiedDiffReference: '/private/overlay/confirmation-2.diff'
        })
      )
    );

    expect(queue.revokeTask('task-1', 'task_cancelled')).toEqual([expect.objectContaining({ confirmationId: 'confirmation-1', status: 'revoked' })]);
    await expect(taskOne).resolves.toEqual({ decision: 'rejected', version: 2 });
    expect(queue.listPending().map((snapshot): string => snapshot.confirmationId)).toEqual(['confirmation-2']);

    const tampered = createRequest({
      confirmationId: 'confirmation-3',
      taskId: 'task-3',
      changesetId: 'changeset-3',
      unifiedDiffReference: '/private/overlay/tampered.diff'
    });
    fixture.store.createConfirmation(createInput(tampered));
    expect((): void => {
      queue.listPending();
    }).toThrowError(expect.objectContaining({ reason: 'confirmation_diff_integrity_invalid' }));
  });
});
