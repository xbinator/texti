/**
 * @file confirmation-controller.test.ts
 * @description BChat 确认控制器测试。
 */
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AIToolConfirmationRequest } from '@/ai/tools/confirmation';
import { createChatConfirmationController } from '@/components/BChat/utils/confirmationController';
import { useChatConfirmationQueueStore } from '@/stores/chat/confirmationQueue';

/**
 * 创建测试确认请求。
 * @param toolName - 工具名称
 * @returns 确认请求
 */
function createRequest(toolName: string): AIToolConfirmationRequest {
  return {
    toolCallId: `tool-call-${toolName}`,
    toolName,
    title: `确认 ${toolName}`,
    description: `是否执行 ${toolName}`,
    riskLevel: 'read'
  };
}

describe('createChatConfirmationController', (): void => {
  beforeEach((): void => {
    setActivePinia(createPinia());
  });

  it('adds default remember scopes for non-dangerous confirmations', async (): Promise<void> => {
    const controller = createChatConfirmationController();

    const confirmationPromise = controller.requestConfirmation({ ...createRequest('write_file'), riskLevel: 'write' });

    expect(controller.currentConfirmationRequest.value).toEqual(
      expect.objectContaining({
        allowRemember: true,
        rememberScopes: ['session', 'always']
      })
    );

    controller.cancelConfirmation(controller.currentConfirmationId.value ?? '');
    await expect(confirmationPromise).resolves.toEqual({ approved: false });
  });

  it('does not add remember scopes for dangerous confirmations', async (): Promise<void> => {
    const controller = createChatConfirmationController();

    const confirmationPromise = controller.requestConfirmation({ ...createRequest('run_shell_command'), riskLevel: 'dangerous' });

    expect(controller.currentConfirmationRequest.value).toEqual(
      expect.objectContaining({
        allowRemember: false,
        rememberScopes: undefined
      })
    );

    controller.cancelConfirmation(controller.currentConfirmationId.value ?? '');
    await expect(confirmationPromise).resolves.toEqual({ approved: false });
  });

  it('preserves explicitly narrowed remember scopes', async (): Promise<void> => {
    const controller = createChatConfirmationController();

    const confirmationPromise = controller.requestConfirmation({
      ...createRequest('read_file'),
      allowRemember: true,
      rememberScopes: ['session']
    });

    expect(controller.currentConfirmationRequest.value).toEqual(
      expect.objectContaining({
        allowRemember: true,
        rememberScopes: ['session']
      })
    );

    controller.cancelConfirmation(controller.currentConfirmationId.value ?? '');
    await expect(confirmationPromise).resolves.toEqual({ approved: false });
  });

  it('prioritizes higher-risk confirmations without cancelling an earlier waiter', async (): Promise<void> => {
    const controller = createChatConfirmationController();
    const firstPromise = controller.requestConfirmation(createRequest('read_file'));
    const firstConfirmationId = controller.currentConfirmationId.value;
    let firstSettled = false;
    firstPromise.then(() => {
      firstSettled = true;
    });

    const secondPromise = controller.requestConfirmation({ ...createRequest('run_shell_command'), riskLevel: 'dangerous' });
    await Promise.resolve();

    expect(firstSettled).toBe(false);
    expect(controller.currentConfirmationRequest.value?.toolName).toBe('run_shell_command');
    expect(controller.currentConfirmationId.value).not.toBe(firstConfirmationId);

    controller.cancelConfirmation(controller.currentConfirmationId.value ?? '');
    await expect(secondPromise).resolves.toEqual({ approved: false });
    expect(firstSettled).toBe(false);
    expect(controller.currentConfirmationRequest.value?.toolName).toBe('read_file');
    expect(controller.currentConfirmationId.value).toBe(firstConfirmationId);

    controller.approveConfirmation(firstConfirmationId ?? '');
    await expect(firstPromise).resolves.toEqual({ approved: true });
  });

  it('disposes only Runtime confirmations owned by the controller', async (): Promise<void> => {
    const store = useChatConfirmationQueueStore();
    store.applySnapshot([
      {
        confirmationId: 'agent-confirmation-1',
        sessionId: 'session-1',
        turnId: 'turn-1',
        taskId: 'task-1',
        attemptId: 'attempt-1',
        agentId: 'child-1',
        runtimeId: 'runtime-1',
        toolCallId: 'tool-call-1',
        changesetId: 'changeset-1',
        status: 'pending',
        version: 1,
        riskLevel: 'write',
        displayPaths: ['notes.md'],
        resourceScopes: ['file:/workspace/notes.md'],
        unifiedDiff: '--- a/notes.md\n+++ b/notes.md',
        baseRevision: 'a'.repeat(64),
        diffHash: 'b'.repeat(64),
        operationSetHash: 'c'.repeat(64),
        planHash: 'd'.repeat(64),
        createdAt: '2026-07-27T00:00:00.000Z',
        updatedAt: '2026-07-27T00:00:00.000Z'
      }
    ]);
    const controller = createChatConfirmationController();
    const runtimeConfirmation = controller.requestConfirmation(createRequest('read_file'));

    controller.dispose();

    await expect(runtimeConfirmation).resolves.toEqual({ approved: false });
    expect(store.pending.map((item): string => item.confirmationId)).toEqual(['agent-confirmation-1']);
  });
});
