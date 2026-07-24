/**
 * @file ipc.test.ts
 * @description Chat Agent application IPC 的窄输入、allowlist 输出与结构化错误测试。
 */
import type { ChatAgentCheckpointSnapshot, ChatAgentHandlerResult, ChatAgentResumeResult } from 'types/chat-agent';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerChatAgentHandlers } from '../../../../../../electron/main/modules/chat/agents/ipc.mjs';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
  listActive: vi.fn(),
  resumePrimary: vi.fn(),
  cancelCheckpoint: vi.fn()
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
    resumePrimary: mocks.resumePrimary,
    cancelCheckpoint: mocks.cancelCheckpoint
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

describe('chat agent IPC', (): void => {
  beforeEach((): void => {
    mocks.handlers.clear();
    mocks.listActive.mockReset();
    mocks.resumePrimary.mockReset();
    mocks.cancelCheckpoint.mockReset();
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
