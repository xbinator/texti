/**
 * @file session-machine.test.ts
 * @description Chat Session 串行、继续和回退状态测试。
 */
import type { ChatRuntimeRecoverySnapshot } from 'types/chat-runtime';
import { describe, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import { sessionMachine } from '@/ai/chat/machine/sessionMachine';
import type { ChatSubmitInput } from '@/ai/chat/types';

/** Session 测试提交输入。 */
const SUBMIT_INPUT: ChatSubmitInput = {
  messageId: 'user-1',
  createdAt: '2026-07-11T00:00:00.000Z',
  content: 'first',
  parts: []
};

/** 创建 Runtime 恢复快照。 */
function createRecoverySnapshot(waiting = false): ChatRuntimeRecoverySnapshot {
  return {
    runtimeId: 'runtime-recovered',
    sessionId: 'session-1',
    turnId: 'turn-recovered',
    clientId: 'bchat',
    agentId: 'primary',
    rootRuntimeId: 'runtime-recovered',
    phase: 'streaming',
    createdAt: 1,
    pendingRequests: waiting
      ? [
          {
            type: 'confirmation',
            event: {
              runtimeId: 'runtime-recovered',
              sessionId: 'session-1',
              turnId: 'turn-recovered',
              clientId: 'bchat',
              agentId: 'primary',
              rootRuntimeId: 'runtime-recovered',
              confirmationId: 'confirmation-1',
              request: { toolName: 'write_file', title: '写入文件', description: '是否写入？', riskLevel: 'write' }
            }
          }
        ]
      : []
  };
}

describe('sessionMachine', (): void => {
  it('runs the normal lifecycle without imperative built-in action warnings', (): void => {
    const warn = vi.spyOn(console, 'warn').mockImplementation((): void => undefined);
    const actor = createActor(sessionMachine, { input: { sessionId: 'session-1' } });
    actor.start();

    actor.send({ type: 'session.submit', input: SUBMIT_INPUT });
    actor.send({ type: 'session.prepared' });
    actor.send({ type: 'session.userChoiceRequired' });
    actor.send({ type: 'session.interactionResolved' });
    actor.send({ type: 'session.completed' });

    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('Custom actions should not call'));
    warn.mockRestore();
    actor.stop();
  });

  it('serializes submits and resumes the same Turn after user choice', (): void => {
    const actor = createActor(sessionMachine, { input: { sessionId: 'session-1' } });
    actor.start();
    actor.send({ type: 'session.submit', input: SUBMIT_INPUT });
    const initialTurnRef = actor.getSnapshot().context.turnRef;

    expect(actor.getSnapshot().matches('preparing')).toBe(true);
    actor.send({ type: 'session.submit', input: { ...SUBMIT_INPUT, messageId: 'user-2', content: 'second' } });
    expect(actor.getSnapshot().context.intent).toMatchObject({ type: 'submit', input: { messageId: 'user-1' } });

    actor.send({ type: 'session.prepared' });
    expect(actor.getSnapshot().matches('running')).toBe(true);
    actor.send({ type: 'session.userChoiceRequired' });
    expect(actor.getSnapshot().matches('waitingForUser')).toBe(true);

    actor.send({
      type: 'session.userChoiceSubmitted',
      answer: { questionId: 'question-1', toolCallId: 'tool-1', answers: ['yes'] }
    });
    expect(actor.getSnapshot().matches('preparing')).toBe(true);
    expect(actor.getSnapshot().context.turnRef).toBe(initialTurnRef);
    actor.send({
      type: 'session.preparationFailed',
      error: { code: 'preparation_failed', message: 'provider unavailable' }
    });
    expect(actor.getSnapshot().matches('waitingForUser')).toBe(true);
  });

  it('restores a persisted user-choice continuation after actor restart', (): void => {
    const actor = createActor(sessionMachine, { input: { sessionId: 'session-1' } });
    actor.start();
    actor.send({
      type: 'session.userChoiceSubmitted',
      answer: { questionId: 'question-1', toolCallId: 'tool-1', answers: ['yes'] }
    });

    expect(actor.getSnapshot().matches('preparing')).toBe(true);
    expect(actor.getSnapshot().context.intent).toMatchObject({ type: 'continue' });
    expect(actor.getSnapshot().context.turnRef).toBeDefined();
  });

  it('hydrates a persisted pending interaction into the waiting Actor hierarchy', (): void => {
    const actor = createActor(sessionMachine, { input: { sessionId: 'session-1' } });
    actor.start();
    actor.send({
      type: 'session.recoverInteraction',
      interaction: {
        type: 'userChoice',
        status: 'pending',
        sessionId: 'session-1',
        messageId: 'assistant-question',
        runtimeId: 'runtime-question',
        agentId: 'primary',
        toolCallId: 'tool-call-question',
        questionId: 'question-1'
      }
    });

    const snapshot = actor.getSnapshot();
    const agentRef = snapshot.context.turnRef?.getSnapshot().context.primaryAgentRef;
    const agentSnapshot = agentRef?.getSnapshot();
    expect(snapshot.matches('waitingForUser')).toBe(true);
    expect(snapshot.context.pendingInteraction).toMatchObject({ questionId: 'question-1', status: 'pending' });
    expect(agentSnapshot?.matches('waiting')).toBe(true);
    expect(agentSnapshot?.context.interaction).toBe('userChoice');

    actor.send({
      type: 'session.userChoiceSubmitted',
      answer: { questionId: 'question-1', toolCallId: 'tool-call-question', answers: ['yes'] }
    });
    expect(actor.getSnapshot().context.pendingInteraction?.status).toBe('submitting');

    actor.send({ type: 'session.prepared' });
    expect(actor.getSnapshot().context.pendingInteraction?.status).toBe('resolved');
    actor.send({ type: 'session.userChoiceSubmissionFailed', error: { code: 'runtime_start_failed', message: 'retry later' } });
    expect(actor.getSnapshot().matches('waitingForUser')).toBe(true);
    expect(actor.getSnapshot().context.pendingInteraction?.status).toBe('pending');
    expect(agentRef?.getSnapshot().matches('waiting')).toBe(true);
  });

  it('resumes the same Runtime after a confirmation is resolved', (): void => {
    const actor = createActor(sessionMachine, { input: { sessionId: 'session-1' } });
    actor.start();
    actor.send({ type: 'session.submit', input: SUBMIT_INPUT });
    actor.send({ type: 'session.prepared' });
    actor.send({ type: 'session.userChoiceRequired' });
    actor.send({ type: 'session.interactionResolved' });

    expect(actor.getSnapshot().matches('running')).toBe(true);
    expect(actor.getSnapshot().context.turnRef?.getSnapshot().matches('running')).toBe(true);
  });

  it('restores idle after regenerate preparation failure', (): void => {
    const actor = createActor(sessionMachine, { input: { sessionId: 'session-1' } });
    actor.start();
    actor.send({ type: 'session.regenerate', targetMessageId: 'assistant-1' });
    actor.send({
      type: 'session.preparationFailed',
      error: { code: 'preparation_failed', message: 'model missing' }
    });

    expect(actor.getSnapshot().matches('idle')).toBe(true);
    expect(actor.getSnapshot().context.error?.message).toBe('model missing');
  });

  it('runs manual compaction through the normal preparing and running lifecycle', (): void => {
    const actor = createActor(sessionMachine, { input: { sessionId: 'session-1' } });
    actor.start();

    actor.send({ type: 'session.compact' });
    expect(actor.getSnapshot().matches('preparing')).toBe(true);
    expect(actor.getSnapshot().context.intent).toEqual({ type: 'compact' });
    expect(actor.getSnapshot().hasTag('busy')).toBe(true);

    actor.send({ type: 'session.prepared' });
    expect(actor.getSnapshot().matches('running')).toBe(true);
    expect(actor.getSnapshot().hasTag('abortable')).toBe(true);

    actor.send({ type: 'session.completed' });
    expect(actor.getSnapshot().matches('idle')).toBe(true);
  });

  it('cancels an active Turn before applying rollback', (): void => {
    const actor = createActor(sessionMachine, { input: { sessionId: 'session-1' } });
    actor.start();
    actor.send({ type: 'session.submit', input: SUBMIT_INPUT });
    actor.send({ type: 'session.prepared' });
    actor.send({ type: 'session.rollbackRequested', targetMessageId: 'user-1' });

    expect(actor.getSnapshot().matches({ rollingBack: 'cancellingActiveRuntime' })).toBe(true);
    actor.send({ type: 'session.runtimeCancelled' });
    expect(actor.getSnapshot().matches({ rollingBack: 'applyingRollback' })).toBe(true);
    actor.send({ type: 'session.rollbackCompleted' });
    expect(actor.getSnapshot().matches('idle')).toBe(true);
  });

  it('hydrates running and waiting turns from main-process runtime snapshots', (): void => {
    const runningActor = createActor(sessionMachine, { input: { sessionId: 'session-1' } });
    runningActor.start();
    runningActor.send({ type: 'session.recoverRuntime', snapshot: createRecoverySnapshot() });
    expect(runningActor.getSnapshot().matches('running')).toBe(true);
    expect(runningActor.getSnapshot().context.turnRef?.getSnapshot().context.primaryAgentRef?.getSnapshot().matches('running')).toBe(true);

    const waitingActor = createActor(sessionMachine, { input: { sessionId: 'session-1' } });
    waitingActor.start();
    waitingActor.send({ type: 'session.recoverRuntime', snapshot: createRecoverySnapshot(true) });
    expect(waitingActor.getSnapshot().matches('waitingForUser')).toBe(true);
    expect(waitingActor.getSnapshot().context.turnRef?.getSnapshot().context.primaryAgentRef?.getSnapshot().matches('waiting')).toBe(true);
  });

  it('keeps waiting children busy without accepting input and confirms persisted cancellation', (): void => {
    const actor = createActor(sessionMachine, { input: { sessionId: 'session-1' } });
    actor.start();
    actor.send({ type: 'session.submit', input: SUBMIT_INPUT });
    actor.send({ type: 'session.prepared' });
    const turn = actor.getSnapshot().context.turnRef;
    const runtimeId = 'runtime-a';
    turn?.getSnapshot().context.primaryAgentRef?.send({ type: 'runtime.started', runtimeId });
    actor.send({ type: 'session.waitingChildren', runtimeId, checkpointId: 'checkpoint-1' });

    expect(actor.getSnapshot().matches('waitingChildren')).toBe(true);
    expect(actor.getSnapshot().hasTag('busy')).toBe(true);
    expect(actor.getSnapshot().hasTag('abortable')).toBe(true);
    expect(actor.getSnapshot().hasTag('acceptsInput')).toBe(false);
    actor.send({ type: 'session.submit', input: { ...SUBMIT_INPUT, messageId: 'user-2' } });
    expect(actor.getSnapshot().matches('waitingChildren')).toBe(true);

    actor.send({ type: 'session.cancelRequested' });
    expect(actor.getSnapshot().matches('cancellingChildren')).toBe(true);
    actor.send({ type: 'session.checkpointCancelled', checkpointId: 'checkpoint-other' });
    expect(actor.getSnapshot().matches('cancellingChildren')).toBe(true);
    actor.send({ type: 'session.checkpointCancelled', checkpointId: 'checkpoint-1' });
    expect(actor.getSnapshot().matches('idle')).toBe(true);
  });

  it('accepts a persisted cancellation directly from waiting children', (): void => {
    const actor = createActor(sessionMachine, { input: { sessionId: 'session-1' } });
    actor.start();
    actor.send({ type: 'session.submit', input: SUBMIT_INPUT });
    actor.send({ type: 'session.prepared' });
    const runtimeId = 'runtime-a';
    actor.getSnapshot().context.turnRef?.getSnapshot().context.primaryAgentRef?.send({ type: 'runtime.started', runtimeId });
    actor.send({ type: 'session.waitingChildren', runtimeId, checkpointId: 'checkpoint-1' });

    actor.send({ type: 'session.checkpointCancelled', checkpointId: 'checkpoint-other' });
    expect(actor.getSnapshot().matches('waitingChildren')).toBe(true);
    actor.send({ type: 'session.checkpointCancelled', checkpointId: 'checkpoint-1' });
    expect(actor.getSnapshot().matches('idle')).toBe(true);
  });

  it('ignores a late Runtime A suspension after the matching Runtime B resumed', (): void => {
    const actor = createActor(sessionMachine, { input: { sessionId: 'session-1' } });
    actor.start();
    actor.send({ type: 'session.submit', input: SUBMIT_INPUT });
    actor.send({ type: 'session.prepared' });
    const agent = actor.getSnapshot().context.turnRef?.getSnapshot().context.primaryAgentRef;
    agent?.send({ type: 'runtime.started', runtimeId: 'runtime-a' });
    actor.send({ type: 'session.waitingChildren', runtimeId: 'runtime-a', checkpointId: 'checkpoint-1' });
    actor.send({ type: 'session.resumeStarted', runtimeId: 'runtime-b', checkpointId: 'checkpoint-1' });

    actor.send({ type: 'session.waitingChildren', runtimeId: 'runtime-a', checkpointId: 'checkpoint-1' });

    expect(actor.getSnapshot().matches('running')).toBe(true);
    expect(agent?.getSnapshot().context.runtimeId).toBe('runtime-b');
  });
});
