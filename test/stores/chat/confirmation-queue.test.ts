/**
 * @file confirmation-queue.test.ts
 * @description Renderer application-level confirmation queue 的排序、选中与单调投影测试。
 * @vitest-environment jsdom
 */
import type { ChatAgentConfirmationSnapshot } from 'types/chat-agent';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { useChatConfirmationQueueStore } from '@/stores/chat/confirmationQueue';

/**
 * 创建 Renderer allowlist confirmation 快照。
 * @param confirmationId - confirmation 身份
 * @param riskLevel - 风险等级
 * @param createdAt - 请求时间
 * @param patch - 可覆盖字段
 * @returns confirmation 快照
 */
function confirmation(
  confirmationId: string,
  riskLevel: 'write' | 'dangerous',
  createdAt: string,
  patch: Partial<ChatAgentConfirmationSnapshot> = {}
): ChatAgentConfirmationSnapshot {
  return {
    confirmationId,
    sessionId: 'session-1',
    turnId: 'turn-1',
    taskId: `task-${confirmationId}`,
    attemptId: `attempt-${confirmationId}`,
    agentId: `agent-${confirmationId}`,
    runtimeId: `runtime-${confirmationId}`,
    toolCallId: `tool-call-${confirmationId}`,
    changesetId: `changeset-${confirmationId}`,
    status: 'pending',
    version: 1,
    riskLevel,
    displayPaths: [`${confirmationId}.md`],
    resourceScopes: [`file:/workspace/${confirmationId}.md`],
    unifiedDiff: `--- a/${confirmationId}.md\n+++ b/${confirmationId}.md`,
    baseRevision: 'a'.repeat(64),
    diffHash: 'b'.repeat(64),
    operationSetHash: 'c'.repeat(64),
    planHash: 'd'.repeat(64),
    createdAt,
    updatedAt: createdAt,
    ...patch
  };
}

describe('chat confirmation queue store', (): void => {
  beforeEach((): void => {
    setActivePinia(createPinia());
  });

  it('orders dangerous before write before read and keeps explicit selection as a projection', (): void => {
    const store = useChatConfirmationQueueStore();
    store.addRuntime({
      source: 'runtime',
      confirmationId: 'read-1',
      ownerId: 'owner-1',
      request: {
        toolName: 'read_file',
        title: '读取',
        description: '读取文件',
        riskLevel: 'read'
      },
      createdAt: '2026-07-27T00:00:00.000Z'
    });
    store.applySnapshot([
      confirmation('write-2', 'write', '2026-07-27T00:00:02.000Z'),
      confirmation('danger-1', 'dangerous', '2026-07-27T00:00:03.000Z'),
      confirmation('write-1', 'write', '2026-07-27T00:00:01.000Z')
    ]);

    expect(store.current?.confirmationId).toBe('danger-1');
    expect(store.pending.map((item): string => item.confirmationId)).toEqual(['danger-1', 'write-1', 'write-2', 'read-1']);
    store.select('write-2');
    expect(store.current?.confirmationId).toBe('write-2');
    expect(store.pending).toHaveLength(4);
  });

  it('ignores stale Agent events and removes only a terminal authoritative version', (): void => {
    const store = useChatConfirmationQueueStore();
    const pending = confirmation('write-1', 'write', '2026-07-27T00:00:00.000Z', {
      version: 2,
      updatedAt: '2026-07-27T00:00:02.000Z'
    });
    store.applyAgent(pending);
    store.applyAgent({ ...pending, version: 1, updatedAt: '2026-07-27T00:00:03.000Z' });

    expect(store.current).toMatchObject({ confirmationId: 'write-1', snapshot: { version: 2 } });

    store.applyAgent({ ...pending, status: 'approved', version: 3, updatedAt: '2026-07-27T00:00:04.000Z' });
    expect(store.current).toBeNull();
    store.applyAgent({ ...pending, status: 'pending', version: 2, updatedAt: '2026-07-27T00:00:05.000Z' });
    expect(store.current).toBeNull();
  });

  it('keeps Runtime ownership isolated from Agent snapshots and owner disposal', (): void => {
    const store = useChatConfirmationQueueStore();
    store.addRuntime({
      source: 'runtime',
      confirmationId: 'runtime-1',
      ownerId: 'owner-1',
      request: {
        toolName: 'write_file',
        title: '写入',
        description: '写入文件',
        riskLevel: 'write'
      },
      createdAt: '2026-07-27T00:00:00.000Z'
    });
    store.applySnapshot([confirmation('agent-1', 'dangerous', '2026-07-27T00:00:01.000Z')]);

    expect(store.removeRuntime('runtime-1', 'owner-2')).toBe(false);
    expect(store.removeOwner('owner-1')).toEqual(['runtime-1']);
    expect(store.pending.map((item): string => item.confirmationId)).toEqual(['agent-1']);
  });
});
