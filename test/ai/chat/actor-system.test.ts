/**
 * @file actor-system.test.ts
 * @description 应用级 Chat Actor system 外观测试。
 */
import type { ChatAgentCheckpointSnapshot } from 'types/chat-agent';
import type { ChatRuntimeRecoverySnapshot } from 'types/chat-runtime';
import { describe, expect, it } from 'vitest';
import { createChatActorSystem, createResumeAddress } from '@/ai/chat/actorSystem';

describe('chat actor system', (): void => {
  it('derives the exact Runtime B lineage returned by Main', (): void => {
    const snapshot: ChatAgentCheckpointSnapshot = {
      checkpointId: 'checkpoint-1',
      sessionId: 'session-1',
      turnId: 'turn-1',
      primaryAgentId: 'primary',
      rootRuntimeId: 'runtime-a',
      sourceRuntimeId: 'runtime-a',
      status: 'resuming',
      version: 3,
      resumeRuntimeId: 'runtime-b',
      checkpointSequence: 5,
      createdAt: '2026-07-24T00:00:00.000Z',
      updatedAt: '2026-07-24T00:00:01.000Z'
    };

    expect(createResumeAddress(snapshot, 'runtime-b')).toEqual({
      sessionId: 'session-1',
      turnId: 'turn-1',
      agentId: 'primary',
      runtimeId: 'runtime-b',
      parentRuntimeId: 'runtime-a',
      rootRuntimeId: 'runtime-a',
      continuationOfRuntimeId: 'runtime-a'
    });
  });

  it('owns one Supervisor and exposes stable Session actors', (): void => {
    const system = createChatActorSystem();
    system.start();

    const firstSession = system.ensureSession('session-1');
    const secondRead = system.ensureSession('session-1');

    expect(secondRead).toBe(firstSession);
    expect(system.getSession('session-1')).toBe(firstSession);
    system.stop();
    expect(system.actor.getSnapshot().status).toBe('stopped');
  });

  it('recovers the persisted address and capabilities idempotently', (): void => {
    const system = createChatActorSystem();
    system.start();
    const snapshot: ChatRuntimeRecoverySnapshot = {
      runtimeId: 'runtime-1',
      sessionId: 'session-1',
      turnId: 'turn-1',
      clientId: 'bchat',
      agentId: 'primary',
      rootRuntimeId: 'runtime-1',
      phase: 'streaming',
      createdAt: 1,
      pendingRequests: []
    };
    const persistedCapabilities = {
      tools: [],
      descriptor: { rendererToolNames: ['read_current_document'], documentId: 'document-1' },
      documentId: 'document-1',
      getToolContext: (): undefined => undefined,
      handleBridgeRequest: async (): Promise<unknown> => undefined
    };

    system.recoverRuntime(snapshot, persistedCapabilities);
    const firstSession = system.getSession('session-1');
    const firstTurn = firstSession?.getSnapshot().context.turnRef;
    const frozenCapabilities = system.getRuntimeCapabilities('runtime-1');
    system.recoverRuntime(snapshot, { ...persistedCapabilities, documentId: 'document-current' });

    expect(system.getSession('session-1')).toBe(firstSession);
    expect(firstSession?.getSnapshot().context.turnRef).toBe(firstTurn);
    expect(firstTurn?.getSnapshot().context.turnId).toBe(snapshot.turnId);
    expect(system.actor.getSnapshot().context.runtimeRoutes.get('runtime-1')).toMatchObject({
      sessionId: 'session-1',
      turnId: snapshot.turnId,
      rootRuntimeId: snapshot.rootRuntimeId
    });
    expect(system.getRuntimeCapabilities('runtime-1')).toBe(frozenCapabilities);
    expect(system.getRuntimeCapabilities('runtime-1')?.documentId).toBe('document-1');
    system.stop();
  });

  it('rejects recovery when an existing runtime route has different lineage', (): void => {
    const system = createChatActorSystem();
    system.start();
    const snapshot: ChatRuntimeRecoverySnapshot = {
      runtimeId: 'runtime-1',
      sessionId: 'session-1',
      turnId: 'turn-1',
      clientId: 'bchat',
      agentId: 'primary',
      rootRuntimeId: 'runtime-1',
      phase: 'streaming',
      createdAt: 1,
      pendingRequests: []
    };
    const capabilities = {
      tools: [],
      getToolContext: (): undefined => undefined,
      handleBridgeRequest: async (): Promise<unknown> => undefined
    };
    system.recoverRuntime(snapshot, capabilities);

    expect(() => system.recoverRuntime({ ...snapshot, rootRuntimeId: 'runtime-other' }, capabilities)).toThrow(/protocol_error/);
    system.stop();
  });

  it('rejects recovery into a session that already owns a different active turn', (): void => {
    const system = createChatActorSystem();
    system.start();
    const session = system.ensureSession('session-1');
    session.send({
      type: 'session.submit',
      input: { messageId: 'user-1', createdAt: '2026-07-23T00:00:00.000Z', content: 'hello', parts: [] }
    });
    const activeTurnId = session.getSnapshot().context.turnRef?.getSnapshot().context.turnId;
    const snapshot: ChatRuntimeRecoverySnapshot = {
      runtimeId: 'runtime-recovered',
      sessionId: 'session-1',
      turnId: 'turn-recovered',
      clientId: 'bchat',
      agentId: 'primary',
      rootRuntimeId: 'runtime-recovered',
      phase: 'streaming',
      createdAt: 1,
      pendingRequests: []
    };

    expect(() =>
      system.recoverRuntime(snapshot, {
        tools: [],
        getToolContext: (): undefined => undefined,
        handleBridgeRequest: async (): Promise<unknown> => undefined
      })
    ).toThrow(/protocol_error/);
    expect(session.getSnapshot().context.turnRef?.getSnapshot().context.turnId).toBe(activeTurnId);
    expect(system.actor.getSnapshot().context.runtimeRoutes.has(snapshot.runtimeId)).toBe(false);
    system.stop();
  });

  it('does not let an idempotent route hide a conflicting active turn', (): void => {
    const system = createChatActorSystem();
    system.start();
    const snapshot: ChatRuntimeRecoverySnapshot = {
      runtimeId: 'runtime-recovered',
      sessionId: 'session-1',
      turnId: 'turn-recovered',
      clientId: 'bchat',
      agentId: 'primary',
      rootRuntimeId: 'runtime-recovered',
      phase: 'streaming',
      createdAt: 1,
      pendingRequests: []
    };
    const capabilities = {
      tools: [],
      getToolContext: (): undefined => undefined,
      handleBridgeRequest: async (): Promise<unknown> => undefined
    };
    system.registerRuntime(
      {
        runtimeId: snapshot.runtimeId,
        sessionId: snapshot.sessionId,
        turnId: snapshot.turnId,
        agentId: snapshot.agentId,
        rootRuntimeId: snapshot.rootRuntimeId
      },
      capabilities
    );
    const session = system.ensureSession(snapshot.sessionId);
    session.send({
      type: 'session.submit',
      input: { messageId: 'user-1', createdAt: '2026-07-23T00:00:00.000Z', content: 'hello', parts: [] }
    });

    expect(() => system.recoverRuntime(snapshot, capabilities)).toThrow(/protocol_error/);
    system.stop();
  });

  it('removes a deleted Session together with Runtime capabilities and UI subscriptions', (): void => {
    const system = createChatActorSystem();
    system.start();
    system.ensureSession('session-deleted');
    system.registerRuntime(
      {
        sessionId: 'session-deleted',
        turnId: 'turn-deleted',
        agentId: 'primary',
        runtimeId: 'runtime-deleted',
        rootRuntimeId: 'runtime-deleted'
      },
      {
        tools: [],
        getToolContext: (): undefined => undefined,
        handleBridgeRequest: async (): Promise<unknown> => undefined
      }
    );
    system.subscribeSessionEvents('session-deleted', (): void => undefined);

    system.removeSession('session-deleted');

    expect(system.getSession('session-deleted')).toBeUndefined();
    expect(system.actor.getSnapshot().context.runtimeRoutes.has('runtime-deleted')).toBe(false);
    expect(system.getRuntimeCapabilities('runtime-deleted')).toBeUndefined();
    expect(system.hasSessionUISubscribers('session-deleted')).toBe(false);
    system.stop();
  });

  it('does not resurrect an idle Session from a terminal delegation event', (): void => {
    const system = createChatActorSystem();
    system.start();
    const terminal: ChatAgentCheckpointSnapshot = {
      checkpointId: 'checkpoint-1',
      sessionId: 'session-1',
      turnId: 'turn-1',
      primaryAgentId: 'primary',
      rootRuntimeId: 'runtime-a',
      sourceRuntimeId: 'runtime-a',
      status: 'completed',
      version: 4,
      checkpointSequence: 6,
      createdAt: '2026-07-24T00:00:00.000Z',
      updatedAt: '2026-07-24T00:00:02.000Z'
    };

    system.recoverDelegation(terminal);

    expect(system.getSession('session-1')?.getSnapshot().matches('idle')).toBe(true);
    expect(system.getSession('session-1')?.getSnapshot().context.turnRef).toBeUndefined();
    system.stop();
  });

  it('closes a waiting Session when a settled completion is recovered', (): void => {
    const system = createChatActorSystem();
    system.start();
    const waiting: ChatAgentCheckpointSnapshot = {
      checkpointId: 'checkpoint-1',
      sessionId: 'session-1',
      turnId: 'turn-1',
      primaryAgentId: 'primary',
      rootRuntimeId: 'runtime-a',
      sourceRuntimeId: 'runtime-a',
      status: 'waiting_children',
      version: 1,
      checkpointSequence: 3,
      createdAt: '2026-07-24T00:00:00.000Z',
      updatedAt: '2026-07-24T00:00:01.000Z'
    };
    system.recoverDelegation(waiting);
    system.recoverDelegation({
      ...waiting,
      status: 'completed',
      version: 4,
      checkpointSequence: 6,
      resumeRuntimeId: 'runtime-b'
    });

    expect(system.getSession('session-1')?.getSnapshot().matches('idle')).toBe(true);
    expect(system.getSession('session-1')?.getSnapshot().context.turnRef).toBeUndefined();
    system.stop();
  });
});
