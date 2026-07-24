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

  it('fails closed when the same Runtime ID is registered with a different address', (): void => {
    const actor = createActor(supervisorMachine);
    actor.start();
    actor.send({
      type: 'runtime.register',
      address: {
        sessionId: 'session-a',
        turnId: 'turn-a',
        agentId: 'primary',
        runtimeId: 'runtime-shared',
        rootRuntimeId: 'runtime-a'
      }
    });
    actor.send({
      type: 'runtime.register',
      address: {
        sessionId: 'session-b',
        turnId: 'turn-b',
        agentId: 'primary',
        runtimeId: 'runtime-shared',
        rootRuntimeId: 'runtime-b'
      }
    });

    expect(actor.getSnapshot().context.runtimeRoutes.get('runtime-shared')).toMatchObject({
      sessionId: 'session-a',
      turnId: 'turn-a',
      rootRuntimeId: 'runtime-a'
    });
    expect(actor.getSnapshot().context.routeConflicts.has('runtime-shared')).toBe(true);
  });

  it('clears route conflicts owned by a removed Session', (): void => {
    const actor = createActor(supervisorMachine);
    actor.start();
    actor.send({ type: 'supervisor.ensureSession', sessionId: 'session-a' });
    actor.send({
      type: 'runtime.register',
      address: {
        sessionId: 'session-a',
        turnId: 'turn-a',
        agentId: 'primary',
        runtimeId: 'runtime-shared',
        rootRuntimeId: 'runtime-a'
      }
    });
    actor.send({
      type: 'runtime.register',
      address: {
        sessionId: 'session-b',
        turnId: 'turn-b',
        agentId: 'primary',
        runtimeId: 'runtime-shared',
        rootRuntimeId: 'runtime-b'
      }
    });
    expect(actor.getSnapshot().context.routeConflicts.has('runtime-shared')).toBe(true);

    actor.send({ type: 'supervisor.removeSession', sessionId: 'session-a' });

    expect(actor.getSnapshot().context.runtimeRoutes.has('runtime-shared')).toBe(false);
    expect(actor.getSnapshot().context.routeConflicts.has('runtime-shared')).toBe(false);
  });

  it('does not route a non-primary Runtime address to the Primary Agent', (): void => {
    const actor = createActor(supervisorMachine);
    actor.start();
    actor.send({ type: 'supervisor.ensureSession', sessionId: 'session-a' });
    actor.send({ type: 'supervisor.sendToSession', sessionId: 'session-a', event: { type: 'session.submit', input: SUBMIT_INPUT } });
    const session = actor.getSnapshot().context.sessions.get('session-a');
    session?.send({ type: 'session.prepared' });
    const turn = session?.getSnapshot().context.turnRef;
    const primary = turn?.getSnapshot().context.primaryAgentRef;
    actor.send({
      type: 'runtime.register',
      address: {
        sessionId: 'session-a',
        turnId: turn?.getSnapshot().context.turnId as string,
        agentId: 'child-1',
        runtimeId: 'runtime-child',
        parentAgentId: 'primary',
        rootRuntimeId: 'runtime-primary'
      }
    });

    actor.send({ type: 'runtime.event', runtimeId: 'runtime-child', event: { type: 'runtime.started', runtimeId: 'runtime-child' } });

    expect(primary?.getSnapshot().matches('starting')).toBe(true);
    expect(primary?.getSnapshot().context.runtimeId).toBeUndefined();
  });
});
