/**
 * @file confirmation-controller.test.ts
 * @description BChat 确认控制器测试。
 */
import { ref } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AIToolConfirmationRequest } from '@/ai/tools/confirmation';
import type { RuntimeConfirmationBinding, RuntimeConfirmationRequest } from '@/components/BChat/utils/confirmationController';
import { createChatConfirmationController, expireSessionConfirmations } from '@/components/BChat/utils/confirmationController';
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

/**
 * 创建 Runtime confirmation 绑定。
 * @param patch - 可覆盖的绑定字段
 * @returns 不可变 Runtime 绑定
 */
function createBinding(patch: Partial<RuntimeConfirmationBinding> = {}): RuntimeConfirmationBinding {
  return {
    sessionId: 'session-1',
    runtimeId: 'runtime-1',
    toolCallId: 'tool-call-1',
    ...patch
  };
}

describe('createChatConfirmationController', (): void => {
  beforeEach((): void => {
    setActivePinia(createPinia());
  });

  it('adds default remember scopes for non-dangerous confirmations', async (): Promise<void> => {
    const controller = createChatConfirmationController(ref('session-1'));

    const confirmationPromise = controller.createAdapter(createBinding()).confirm({ ...createRequest('write_file'), riskLevel: 'write' });

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
    const controller = createChatConfirmationController(ref('session-1'));

    const confirmationPromise = controller.createAdapter(createBinding()).confirm({ ...createRequest('run_shell_command'), riskLevel: 'dangerous' });

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
    const controller = createChatConfirmationController(ref('session-1'));

    const confirmationPromise = controller.createAdapter(createBinding()).confirm({
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
    const controller = createChatConfirmationController(ref('session-1'));
    const adapter = controller.createAdapter(createBinding());
    const firstPromise = adapter.confirm(createRequest('read_file'));
    const firstConfirmationId = controller.currentConfirmationId.value;
    let firstSettled = false;
    firstPromise.then(() => {
      firstSettled = true;
    });

    const secondPromise = adapter.confirm({ ...createRequest('run_shell_command'), riskLevel: 'dangerous' });
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

  it('keeps a Runtime confirmation alive across controller disposal and session-matched takeover', async (): Promise<void> => {
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
    const controller = createChatConfirmationController(ref('session-1'));
    const runtimeConfirmation = controller.createAdapter(createBinding()).confirm(createRequest('read_file'));
    const runtimeConfirmationId = controller.currentConfirmationId.value;

    controller.dispose();
    const resumedController = createChatConfirmationController(ref('session-1'));
    expect(resumedController.currentConfirmationId.value).toBe(runtimeConfirmationId);
    resumedController.approveConfirmation(runtimeConfirmationId ?? '');

    await expect(runtimeConfirmation).resolves.toEqual({ approved: true });
    expect(store.pending.map((item): string => item.confirmationId)).toEqual(['agent-confirmation-1']);
  });

  it('projects only confirmations owned by the active session', async (): Promise<void> => {
    const controllerA = createChatConfirmationController(ref('session-a'));
    const controllerB = createChatConfirmationController(ref('session-b'));
    const decision = controllerA.createAdapter(createBinding({ sessionId: 'session-a', runtimeId: 'runtime-a' })).confirm(createRequest('read_file'));

    expect(controllerA.currentConfirmationRequest.value?.toolName).toBe('read_file');
    expect(controllerB.currentConfirmation.value).toBeNull();

    controllerA.cancelConfirmation(controllerA.currentConfirmationId.value ?? '');
    await expect(decision).resolves.toEqual({ approved: false });
  });

  it('rejects only Runtime confirmation flights owned by a deleted Session', async (): Promise<void> => {
    const controllerA = createChatConfirmationController(ref('session-a'));
    const controllerB = createChatConfirmationController(ref('session-b'));
    const decisionA = controllerA.createAdapter(createBinding({ sessionId: 'session-a', runtimeId: 'runtime-a' })).confirm(createRequest('read_file'));
    const decisionB = controllerB.createAdapter(createBinding({ sessionId: 'session-b', runtimeId: 'runtime-b' })).confirm(createRequest('write_file'));
    let sessionBSettled = false;
    decisionB.then((): void => {
      sessionBSettled = true;
    });

    expireSessionConfirmations('session-a');
    await expect(decisionA).resolves.toEqual({ approved: false });
    await Promise.resolve();

    expect(sessionBSettled).toBe(false);
    expect(controllerA.currentConfirmation.value).toBeNull();
    expect(controllerB.currentConfirmation.value).not.toBeNull();
    controllerB.cancelConfirmation(controllerB.currentConfirmationId.value ?? '');
    await expect(decisionB).resolves.toEqual({ approved: false });
  });

  it('deduplicates a replayed Main confirmation identity into one decision flight', async (): Promise<void> => {
    const controller = createChatConfirmationController(ref('session-1'));
    const binding = createBinding();
    const request = createRequest('write_file');

    const first = controller.requestConfirmation(request, binding, 'main-confirmation-1');
    const replay = controller.requestConfirmation(request, binding, 'main-confirmation-1');

    expect(first.created).toBe(true);
    expect(replay.created).toBe(false);
    expect(replay.decision).toBe(first.decision);
    controller.approveConfirmation('main-confirmation-1');
    await expect(first.decision).resolves.toEqual({ approved: true });
  });

  it('rejects a replay that changes the immutable Main confirmation request', async (): Promise<void> => {
    const controller = createChatConfirmationController(ref('session-1'));
    const binding = createBinding();
    const first = controller.requestConfirmation(createRequest('read_file'), binding, 'main-confirmation-1');

    expect(
      (): RuntimeConfirmationRequest => controller.requestConfirmation({ ...createRequest('write_file'), riskLevel: 'write' }, binding, 'main-confirmation-1')
    ).toThrow('confirmation_identity_conflict');

    controller.cancelConfirmation('main-confirmation-1');
    await expect(first.decision).resolves.toEqual({ approved: false });
  });

  it('does not retain a flight when the serializable queue identity conflicts', async (): Promise<void> => {
    const store = useChatConfirmationQueueStore();
    const controller = createChatConfirmationController(ref('session-1'));
    const binding = createBinding();
    const request = createRequest('read_file');

    store.addRuntime({
      source: 'runtime',
      confirmationId: 'conflicting-confirmation',
      sessionId: 'session-other',
      runtimeId: 'runtime-other',
      request,
      createdAt: '2026-07-31T00:00:00.000Z'
    });

    expect((): RuntimeConfirmationRequest => controller.requestConfirmation(request, binding, 'conflicting-confirmation')).toThrow(
      'confirmation_identity_conflict'
    );
    store.removeRuntime('conflicting-confirmation');

    const retry = controller.requestConfirmation(request, binding, 'conflicting-confirmation');
    expect(retry.created).toBe(true);
    controller.cancelConfirmation('conflicting-confirmation');
    await expect(retry.decision).resolves.toEqual({ approved: false });
  });
});
