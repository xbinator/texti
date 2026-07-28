/**
 * @file use-chat-session-actor.test.ts
 * @description BChat 当前 Session Actor 动态订阅测试。
 * @vitest-environment jsdom
 */
import { effectScope, ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import { createChatActorSystem } from '@/ai/chat/actorSystem';
import { useChatSessionActor } from '@/components/BChat/hooks/useChatSessionActor';

describe('useChatSessionActor', (): void => {
  it('recovers a persisted interaction only while the Session is idle', (): void => {
    const actorSystem = createChatActorSystem();
    actorSystem.start();
    const activeSessionId = ref<string | null>('session-a');
    const scope = effectScope();
    const hook = scope.run(() => useChatSessionActor({ activeSessionId, actorSystem }));
    if (!hook) throw new Error('Session Actor hook was not created');

    hook.recoverInteraction({
      type: 'userChoice',
      status: 'pending',
      sessionId: 'session-a',
      messageId: 'assistant-question',
      runtimeId: 'runtime-question',
      agentId: 'primary',
      toolCallId: 'tool-call-question',
      questionId: 'question-1'
    });

    expect(hook.waitingForUser.value).toBe(true);
    expect(hook.pendingInteraction.value).toMatchObject({ questionId: 'question-1', status: 'pending' });

    scope.stop();
    actorSystem.stop();
  });

  it('switches subscriptions without stopping a background Session', async (): Promise<void> => {
    const actorSystem = createChatActorSystem();
    actorSystem.start();
    const activeSessionId = ref<string | null>('session-a');
    const onUIEvent = vi.fn();
    const scope = effectScope();
    const hook = scope.run(() => useChatSessionActor({ activeSessionId, actorSystem, onUIEvent }));
    if (!hook) throw new Error('Session Actor hook was not created');

    hook.submit({
      messageId: 'user-1',
      createdAt: '2026-07-11T00:00:00.000Z',
      content: 'hello',
      parts: []
    });
    const sessionA = actorSystem.getSession('session-a');
    expect(hook.loading.value).toBe(true);
    expect(sessionA?.getSnapshot().matches('preparing')).toBe(true);

    activeSessionId.value = 'session-b';
    await Promise.resolve();
    expect(actorSystem.getSession('session-a')).toBe(sessionA);
    expect(sessionA?.getSnapshot().status).toBe('active');
    expect(hook.loading.value).toBe(false);

    actorSystem.emitSessionEvent('session-a', {
      type: 'messageDeleted',
      event: {
        runtimeId: 'runtime-a',
        sessionId: 'session-a',
        turnId: 'turn-a',
        clientId: 'bchat',
        agentId: 'primary',
        rootRuntimeId: 'runtime-a',
        messageId: 'message-a'
      }
    });
    expect(onUIEvent).not.toHaveBeenCalled();

    scope.stop();
    expect(actorSystem.getSession('session-b')?.getSnapshot().status).toBe('active');
    actorSystem.stop();
  });

  it('starts a manual compaction intent without creating a submit intent', (): void => {
    const actorSystem = createChatActorSystem();
    actorSystem.start();
    const activeSessionId = ref<string | null>('session-a');
    const scope = effectScope();
    const hook = scope.run(() => useChatSessionActor({ activeSessionId, actorSystem }));
    if (!hook) throw new Error('Session Actor hook was not created');

    hook.compact();

    expect(hook.snapshot.value?.matches('preparing')).toBe(true);
    expect(hook.snapshot.value?.context.intent).toEqual({ type: 'compact' });

    scope.stop();
    actorSystem.stop();
  });
});
