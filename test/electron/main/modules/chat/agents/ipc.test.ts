/**
 * @file ipc.test.ts
 * @description Chat Agent application IPC 的窄输入、allowlist 输出与结构化错误测试。
 */
import * as path from 'node:path';
import type {
  ChatAgentCheckpointSnapshot,
  ChatAgentCancelTaskResult,
  ChatAgentConfirmationSnapshot,
  ChatAgentHandlerResult,
  ChatAgentResumeResult,
  ChatAgentTaskSummarySnapshot
} from 'types/chat-agent';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerChatAgentHandlers } from '../../../../../../electron/main/modules/chat/agents/ipc.mjs';

/** 公开 IPC 中禁止出现的秘密形态。 */
const PUBLIC_SECRET_PATTERN =
  /(?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|cookie)\s*[:=]|\b(?:sk|rk)-[A-Za-z0-9_-]{16,}\b/i;

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
  listActive: vi.fn(),
  listConfirmations: vi.fn(),
  resolveConfirmation: vi.fn(),
  resumePrimary: vi.fn(),
  cancelCheckpoint: vi.fn(),
  cancelTask: vi.fn(),
  listTasks: vi.fn(),
  getTask: vi.fn()
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => Promise<unknown>): void => {
      mocks.handlers.set(channel, handler);
    })
  }
}));

vi.mock('../../../../../../electron/main/modules/chat/agents/service.mjs', () => ({
  chatAgentDelegationService: {
    listActive: mocks.listActive,
    listConfirmations: mocks.listConfirmations,
    resolveConfirmation: mocks.resolveConfirmation,
    resumePrimary: mocks.resumePrimary,
    cancelCheckpoint: mocks.cancelCheckpoint,
    cancelTask: mocks.cancelTask,
    listTasks: mocks.listTasks,
    getTask: mocks.getTask
  }
}));

/** 创建不含内部 continuation、结果与 artifact 的公开 Checkpoint。 */
function createSnapshot(): ChatAgentCheckpointSnapshot {
  return {
    checkpointId: 'checkpoint-1',
    sessionId: 'session-1',
    turnId: 'turn-1',
    primaryAgentId: 'primary',
    rootRuntimeId: 'runtime-a',
    sourceRuntimeId: 'runtime-a',
    status: 'ready_to_resume',
    version: 2,
    checkpointSequence: 4,
    createdAt: '2026-07-24T00:00:00.000Z',
    updatedAt: '2026-07-24T00:00:01.000Z'
  };
}

/**
 * 创建公开 confirmation 投影。
 * @returns 不含私有 overlay 引用的确认快照
 */
function createConfirmation(): ChatAgentConfirmationSnapshot {
  return {
    confirmationId: 'confirmation-1',
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
  };
}

/**
 * 递归断言 IPC 成功信封不含内部键、秘密或绝对路径。
 * @param value - 待检查公开值
 * @param location - 当前递归位置
 */
function expectPublicSafe(value: unknown, location = '$'): void {
  if (typeof value === 'string') {
    expect(value, `${location} must not contain a secret-shaped value`).not.toMatch(PUBLIC_SECRET_PATTERN);
    expect(path.posix.isAbsolute(value), `${location} must not contain a POSIX absolute path`).toBe(false);
    expect(path.win32.isAbsolute(value), `${location} must not contain a Windows absolute path`).toBe(false);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index): void => expectPublicSafe(entry, `${location}[${index}]`));
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  Object.entries(value).forEach(([key, entry]): void => {
    expect(key, `${location}.${key} must be public`).not.toMatch(
      /modelSnapshot|permissionSnapshot|executionPlanSnapshot|targetPath|overlay|journalId|rollbackReference|continuation|raw.*tool|tool.*(?:input|output)/i
    );
    expectPublicSafe(entry, `${location}.${key}`);
  });
}

describe('chat agent IPC', (): void => {
  beforeEach((): void => {
    mocks.handlers.clear();
    mocks.listActive.mockReset();
    mocks.listConfirmations.mockReset();
    mocks.resolveConfirmation.mockReset();
    mocks.resumePrimary.mockReset();
    mocks.cancelCheckpoint.mockReset();
    mocks.cancelTask.mockReset();
    mocks.listTasks.mockReset();
    mocks.getTask.mockReset();
  });

  it('registers strict Session-bound Task list and get queries', async (): Promise<void> => {
    const task = {
      recordState: 'active',
      taskId: 'task-1',
      sessionId: 'session-1',
      turnId: 'turn-1',
      checkpointId: 'checkpoint-1',
      assistantMessageId: 'assistant-1',
      toolCallId: 'tool-call-1',
      agentId: 'child-1',
      projectionSchemaVersion: 1,
      taskSequence: 1,
      task: 'Inspect context',
      mode: 'read',
      required: true,
      priority: 'normal',
      status: 'running',
      queuePhase: 'start',
      createdAt: '2026-07-28T00:00:00.000Z',
      updatedAt: '2026-07-28T00:00:01.000Z'
    } satisfies ChatAgentTaskSummarySnapshot;
    mocks.listTasks.mockReturnValue({ tasks: [task] });
    mocks.getTask.mockReturnValue(task);
    registerChatAgentHandlers();

    const listHandler = mocks.handlers.get('chat:agent:list-tasks');
    const getHandler = mocks.handlers.get('chat:agent:get-task');
    if (!listHandler || !getHandler) throw new Error('Task query handlers were not registered');

    expect(await listHandler({}, { sessionId: 'session-1' })).toEqual({ ok: true, data: { tasks: [task] } });
    expect(mocks.listTasks).toHaveBeenCalledWith({ sessionId: 'session-1', limit: 50 });
    expect(await getHandler({}, { sessionId: 'session-1', taskId: 'task-1' })).toEqual({ ok: true, data: task });
    expect(mocks.getTask).toHaveBeenCalledWith({ sessionId: 'session-1', taskId: 'task-1' });
    mocks.getTask.mockReturnValue(null);
    expect(await getHandler({}, { sessionId: 'session-1', taskId: 'task-missing' })).toEqual({ ok: true, data: null });

    await Promise.all(
      [
        { sessionId: 'session-1', unknown: true },
        { sessionId: 'session-\n1' },
        { sessionId: 'session-\u00851' },
        { sessionId: 'x'.repeat(161) },
        { sessionId: 'session-1', limit: 0 },
        { sessionId: 'session-1', limit: Number.MAX_SAFE_INTEGER + 1 },
        { sessionId: 'session-1', cursor: 'x'.repeat(4097) }
      ].map(async (input): Promise<void> => {
        expect(await listHandler({}, input)).toMatchObject({ ok: false, code: 'INVALID_INPUT' });
      })
    );

    const nonEnumerable = { sessionId: 'session-1', taskId: 'task-1' };
    Object.defineProperty(nonEnumerable, 'hidden', { value: true, enumerable: false });
    mocks.getTask.mockClear();
    expect(await getHandler({}, { sessionId: 'session-1', taskId: 'task-1', unknown: true })).toMatchObject({ ok: false, code: 'INVALID_INPUT' });
    expect(await getHandler({}, { sessionId: 'session-1', taskId: 'task-\u00851' })).toMatchObject({ ok: false, code: 'INVALID_INPUT' });
    expect(await getHandler({}, { sessionId: 'session-1', taskId: 'x'.repeat(161) })).toMatchObject({ ok: false, code: 'INVALID_INPUT' });
    expect(await getHandler({}, { sessionId: 'session-1', taskId: 'task-1' }, 'extra')).toMatchObject({ ok: false, code: 'INVALID_INPUT' });
    expect(await getHandler({}, nonEnumerable)).toMatchObject({ ok: false, code: 'INVALID_INPUT' });
    expect(await getHandler({}, { sessionId: 'session-1', taskId: 'task-1', [Symbol('hidden')]: true })).toMatchObject({
      ok: false,
      code: 'INVALID_INPUT'
    });
    expect(mocks.getTask).not.toHaveBeenCalled();
  });

  it('registers one asynchronous strict cancel-task command', async (): Promise<void> => {
    const task = {
      recordState: 'active',
      taskId: 'task-1',
      sessionId: 'session-1',
      turnId: 'turn-1',
      checkpointId: 'checkpoint-1',
      assistantMessageId: 'assistant-1',
      toolCallId: 'tool-call-1',
      agentId: 'child-1',
      projectionSchemaVersion: 1,
      taskSequence: 4,
      task: 'Inspect context',
      mode: 'read',
      required: true,
      priority: 'normal',
      status: 'cancelling',
      cancellation: {
        requestKind: 'single_task',
        requestedAt: '2026-07-28T00:00:02.000Z'
      },
      createdAt: '2026-07-28T00:00:00.000Z',
      updatedAt: '2026-07-28T00:00:02.000Z'
    } satisfies ChatAgentTaskSummarySnapshot;
    const result: ChatAgentCancelTaskResult = {
      disposition: 'cancel_requested',
      task
    };
    mocks.cancelTask.mockResolvedValue(result);
    registerChatAgentHandlers();
    const handler = mocks.handlers.get('chat:agent:cancel-task');
    if (!handler) throw new Error('cancel-task handler was not registered');

    expect(await handler({}, { sessionId: 'session-1', taskId: 'task-1' })).toEqual({ ok: true, data: result });
    expect(mocks.cancelTask).toHaveBeenCalledWith({ sessionId: 'session-1', taskId: 'task-1' });

    await Promise.all(
      [
        null,
        [],
        { sessionId: 'session-1' },
        { taskId: 'task-1' },
        { sessionId: 'session-1', taskId: 'task-1', reason: 'forged' },
        { sessionId: ' session-1', taskId: 'task-1' },
        { sessionId: 'session-1', taskId: 'task-\n1' }
      ].map(async (input): Promise<void> => {
        expect(await handler({}, input)).toMatchObject({ ok: false, code: 'INVALID_INPUT' });
      })
    );
    expect(await handler({}, { sessionId: 'session-1', taskId: 'task-1' }, 'extra')).toMatchObject({ ok: false, code: 'INVALID_INPUT' });
  });

  it('keeps Task query and cancellation success envelopes recursively public-safe', async (): Promise<void> => {
    const task = {
      recordState: 'active',
      taskId: 'task-safe',
      sessionId: 'session-safe',
      turnId: 'turn-safe',
      checkpointId: 'checkpoint-safe',
      assistantMessageId: 'assistant-safe',
      toolCallId: 'tool-call-safe',
      agentId: 'child-safe',
      projectionSchemaVersion: 1,
      taskSequence: 2,
      task: 'Inspect public context',
      mode: 'read',
      required: false,
      priority: 'normal',
      status: 'running',
      queuePhase: 'start',
      createdAt: '2026-07-28T00:00:00.000Z',
      updatedAt: '2026-07-28T00:00:01.000Z'
    } satisfies ChatAgentTaskSummarySnapshot;
    mocks.listTasks.mockReturnValue({ tasks: [task] });
    mocks.getTask.mockReturnValue(task);
    mocks.cancelTask.mockResolvedValue({ disposition: 'cancel_requested', task });
    registerChatAgentHandlers();
    const listHandler = mocks.handlers.get('chat:agent:list-tasks');
    const getHandler = mocks.handlers.get('chat:agent:get-task');
    const cancelHandler = mocks.handlers.get('chat:agent:cancel-task');
    if (!listHandler || !getHandler || !cancelHandler) throw new Error('Task handlers were not registered');

    const results = await Promise.all([
      listHandler({}, { sessionId: 'session-safe' }),
      getHandler({}, { sessionId: 'session-safe', taskId: 'task-safe' }),
      cancelHandler({}, { sessionId: 'session-safe', taskId: 'task-safe' })
    ]);

    results.forEach((result): void => expectPublicSafe(result));
  });

  it('preserves a stable projector protocol code in the error envelope', async (): Promise<void> => {
    mocks.listTasks.mockImplementation((): never => {
      throw Object.assign(new Error('agent_task_projection_invalid'), { code: 'PROTOCOL_ERROR' });
    });
    registerChatAgentHandlers();
    const handler = mocks.handlers.get('chat:agent:list-tasks');
    if (!handler) throw new Error('Task list handler was not registered');

    expect(await handler({}, { sessionId: 'session-1' })).toEqual({
      ok: false,
      error: 'agent_task_projection_invalid',
      code: 'PROTOCOL_ERROR'
    });
  });

  it('registers narrow confirmation list and CAS resolution handlers', async (): Promise<void> => {
    const pending = createConfirmation();
    const approved = { ...pending, status: 'approved' as const, version: 2, updatedAt: '2026-07-27T00:00:01.000Z' };
    mocks.listConfirmations.mockReturnValue([pending]);
    mocks.resolveConfirmation.mockReturnValue(approved);
    registerChatAgentHandlers();

    const listHandler = mocks.handlers.get('chat:agent:list-confirmations');
    const resolveHandler = mocks.handlers.get('chat:agent:resolve-confirmation');
    if (!listHandler || !resolveHandler) throw new Error('Confirmation handlers were not registered');

    expect(await listHandler({})).toEqual({ ok: true, data: [pending] });
    expect(await resolveHandler({}, { confirmationId: 'confirmation-1', expectedVersion: 1, decision: 'approved' })).toEqual({
      ok: true,
      data: approved
    });
    expect(mocks.resolveConfirmation).toHaveBeenCalledWith({
      confirmationId: 'confirmation-1',
      expectedVersion: 1,
      decision: 'approved'
    });
  });

  it.each(['diffHash', 'baseRevision', 'resourceScopes', 'taskId', 'planHash', 'rememberScope'])(
    'rejects renderer-controlled confirmation field %s',
    async (field: string): Promise<void> => {
      registerChatAgentHandlers();
      const handler = mocks.handlers.get('chat:agent:resolve-confirmation');
      if (!handler) throw new Error('Confirmation resolve handler was not registered');

      expect(
        await handler(
          {},
          {
            confirmationId: 'confirmation-1',
            expectedVersion: 1,
            decision: 'approved',
            [field]: field === 'resourceScopes' ? [] : 'forged'
          }
        )
      ).toMatchObject({ ok: false, code: 'INVALID_INPUT' });
      expect(mocks.resolveConfirmation).not.toHaveBeenCalled();
    }
  );

  it('rejects invalid confirmation decisions, versions and list payloads', async (): Promise<void> => {
    registerChatAgentHandlers();
    const listHandler = mocks.handlers.get('chat:agent:list-confirmations');
    const resolveHandler = mocks.handlers.get('chat:agent:resolve-confirmation');
    if (!listHandler || !resolveHandler) throw new Error('Confirmation handlers were not registered');

    expect(await listHandler({}, { sessionId: 'session-1' })).toMatchObject({ ok: false, code: 'INVALID_INPUT' });
    expect(await resolveHandler({}, { confirmationId: 'confirmation-1', expectedVersion: 0, decision: 'approved' })).toMatchObject({
      ok: false,
      code: 'INVALID_INPUT'
    });
    expect(await resolveHandler({}, { confirmationId: 'confirmation-1', expectedVersion: 1, decision: 'always' })).toMatchObject({
      ok: false,
      code: 'INVALID_INPUT'
    });
  });

  it('registers list, resume and cancel handlers with allowlisted results', async (): Promise<void> => {
    const snapshot = createSnapshot();
    const resumeResult: ChatAgentResumeResult = {
      status: 'started',
      checkpoint: { ...snapshot, status: 'resuming', version: 3, resumeRuntimeId: 'runtime-b', checkpointSequence: 5 },
      address: {
        sessionId: 'session-1',
        turnId: 'turn-1',
        agentId: 'primary',
        runtimeId: 'runtime-b',
        rootRuntimeId: 'runtime-a',
        parentRuntimeId: 'runtime-a',
        continuationOfRuntimeId: 'runtime-a'
      }
    };
    mocks.listActive.mockReturnValue([snapshot]);
    mocks.resumePrimary.mockResolvedValue(resumeResult);
    mocks.cancelCheckpoint.mockReturnValue({ ...snapshot, status: 'cancelled', version: 4, checkpointSequence: 6 });
    registerChatAgentHandlers();

    const listHandler = mocks.handlers.get('chat:agent:list-active');
    const resumeHandler = mocks.handlers.get('chat:agent:resume-primary');
    const cancelHandler = mocks.handlers.get('chat:agent:cancel-checkpoint');
    if (!listHandler || !resumeHandler || !cancelHandler) throw new Error('Chat Agent handlers were not registered');

    expect(await listHandler({})).toEqual({ ok: true, data: [snapshot] });
    expect(await resumeHandler({}, { checkpointId: 'checkpoint-1', expectedVersion: 2, resumeRuntimeId: 'runtime-b' })).toEqual({
      ok: true,
      data: resumeResult
    });
    expect(mocks.resumePrimary).toHaveBeenCalledWith({
      checkpointId: 'checkpoint-1',
      expectedVersion: 2,
      resumeRuntimeId: 'runtime-b'
    });
    expect(await cancelHandler({}, { checkpointId: 'checkpoint-1' })).toMatchObject({
      ok: true,
      data: { status: 'cancelled' }
    });
    expect(mocks.cancelCheckpoint).toHaveBeenCalledWith({ checkpointId: 'checkpoint-1' });
  });

  it.each(['model', 'messages', 'tools', 'capabilities', 'result'])('rejects renderer-controlled %s on resume', async (field: string): Promise<void> => {
    registerChatAgentHandlers();
    const handler = mocks.handlers.get('chat:agent:resume-primary');
    if (!handler) throw new Error('resume handler was not registered');

    const result = (await handler(
      {},
      {
        checkpointId: 'checkpoint-1',
        expectedVersion: 2,
        resumeRuntimeId: 'runtime-b',
        [field]: field === 'messages' || field === 'tools' ? [] : {}
      }
    )) as ChatAgentHandlerResult<ChatAgentResumeResult>;

    expect(result).toMatchObject({ ok: false, code: 'INVALID_INPUT' });
    expect(mocks.resumePrimary).not.toHaveBeenCalled();
  });

  it('rejects malformed identities and non-safe CAS versions before service dispatch', async (): Promise<void> => {
    registerChatAgentHandlers();
    const handler = mocks.handlers.get('chat:agent:resume-primary');
    if (!handler) throw new Error('resume handler was not registered');

    expect(await handler({}, { checkpointId: 'checkpoint-\n1', expectedVersion: 2, resumeRuntimeId: 'runtime-b' })).toMatchObject({
      ok: false,
      code: 'INVALID_INPUT'
    });
    expect(await handler({}, { checkpointId: 'checkpoint-1', expectedVersion: Number.MAX_SAFE_INTEGER + 1, resumeRuntimeId: 'runtime-b' })).toMatchObject({
      ok: false,
      code: 'INVALID_INPUT'
    });
    expect(mocks.resumePrimary).not.toHaveBeenCalled();
  });

  it('rejects unexpected listActive payloads', async (): Promise<void> => {
    registerChatAgentHandlers();
    const handler = mocks.handlers.get('chat:agent:list-active');
    if (!handler) throw new Error('list handler was not registered');

    expect(await handler({}, { includeResults: true })).toMatchObject({ ok: false, code: 'INVALID_INPUT' });
    expect(mocks.listActive).not.toHaveBeenCalled();
  });

  it('rejects renderer cancellation reasons and extra positional arguments', async (): Promise<void> => {
    registerChatAgentHandlers();
    const resumeHandler = mocks.handlers.get('chat:agent:resume-primary');
    const cancelHandler = mocks.handlers.get('chat:agent:cancel-checkpoint');
    if (!resumeHandler || !cancelHandler) throw new Error('resume and cancel handlers were not registered');

    expect(await cancelHandler({}, { checkpointId: 'checkpoint-1', reason: 'renderer_reason' })).toMatchObject({
      ok: false,
      code: 'INVALID_INPUT'
    });
    expect(await cancelHandler({}, { checkpointId: 'checkpoint-1' }, { unexpected: true })).toMatchObject({
      ok: false,
      code: 'INVALID_INPUT'
    });
    expect(await resumeHandler({}, { checkpointId: 'checkpoint-1', expectedVersion: 2, resumeRuntimeId: 'runtime-b' }, 'extra')).toMatchObject({
      ok: false,
      code: 'INVALID_INPUT'
    });
    expect(mocks.cancelCheckpoint).not.toHaveBeenCalled();
    expect(mocks.resumePrimary).not.toHaveBeenCalled();
  });
});
