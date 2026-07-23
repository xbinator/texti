/**
 * @file supervisor-machine.test.ts
 * @description 多会话 Supervisor Actor 路由测试。
 */
import { describe, expect, it } from 'vitest';
import { createActor } from 'xstate';
import { supervisorMachine } from '@/ai/chat/machine/supervisorMachine';
import type { ChatSubmitInput } from '@/ai/chat/types';

/** Supervisor 测试提交输入。 */
const SUBMIT_INPUT: ChatSubmitInput = {
  messageId: 'user-1',
  createdAt: '2026-07-11T00:00:00.000Z',
  content: 'hello',
  parts: []
};

describe('supervisorMachine', (): void => {
  it('runs sessions independently and routes Runtime events to the addressed Agent', (): void => {
    const actor = createActor(supervisorMachine);
    actor.start();
    actor.send({ type: 'supervisor.ensureSession', sessionId: 'session-a' });
    actor.send({ type: 'supervisor.ensureSession', sessionId: 'session-b' });
    actor.send({ type: 'supervisor.sendToSession', sessionId: 'session-a', event: { type: 'session.submit', input: SUBMIT_INPUT } });
    actor.send({ type: 'supervisor.sendToSession', sessionId: 'session-b', event: { type: 'session.submit', input: SUBMIT_INPUT } });

    const sessionA = actor.getSnapshot().context.sessions.get('session-a');
    const sessionB = actor.getSnapshot().context.sessions.get('session-b');
    expect(sessionA?.getSnapshot().matches('preparing')).toBe(true);
    expect(sessionB?.getSnapshot().matches('preparing')).toBe(true);

    sessionA?.send({ type: 'session.prepared' });
    const turnRef = sessionA?.getSnapshot().context.turnRef;
    const primaryAgent = turnRef?.getSnapshot().context.primaryAgentRef;
    const turnId = turnRef?.getSnapshot().context.turnId;
    expect(turnId).toBeTruthy();
    actor.send({
      type: 'runtime.register',
      address: {
        sessionId: 'session-a',
        turnId: turnId as string,
        agentId: 'primary',
        runtimeId: 'runtime-a',
        rootRuntimeId: 'runtime-a'
      }
    });
    actor.send({ type: 'runtime.event', runtimeId: 'runtime-a', event: { type: 'runtime.started', runtimeId: 'runtime-a' } });

    expect(primaryAgent?.getSnapshot().matches('running')).toBe(true);
    actor.send({ type: 'runtime.event', runtimeId: 'unknown', event: { type: 'runtime.completed', runtimeId: 'unknown' } });
    expect(primaryAgent?.getSnapshot().matches('running')).toBe(true);
  });

  it('stops and removes a Session subtree', (): void => {
    const actor = createActor(supervisorMachine);
    actor.start();
    actor.send({ type: 'supervisor.ensureSession', sessionId: 'session-a' });
    const sessionRef = actor.getSnapshot().context.sessions.get('session-a');

    actor.send({ type: 'supervisor.removeSession', sessionId: 'session-a' });

    expect(actor.getSnapshot().context.sessions.has('session-a')).toBe(false);
    expect(sessionRef?.getSnapshot().status).toBe('stopped');
  });
});
