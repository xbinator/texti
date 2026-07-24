/**
 * @file agent-machine.test.ts
 * @description Chat Agent XState 生命周期测试。
 */
import { describe, expect, it } from 'vitest';
import { createActor } from 'xstate';
import { agentMachine } from '@/ai/chat/machine/agentMachine';
import {
  selectAgentCheckpointId,
  selectAgentRuntimeId,
  selectIsAbortable,
  selectIsBusy,
  selectIsWaitingForChildren,
  selectIsWaitingForUser
} from '@/ai/chat/machine/selectors';

/** Agent machine 固定测试输入。 */
const AGENT_INPUT = {
  address: {
    sessionId: 'session-1',
    turnId: 'turn-1',
    agentId: 'primary'
  }
};

describe('agentMachine', (): void => {
  it('moves through running, waiting and confirmed cancellation', (): void => {
    const actor = createActor(agentMachine, { input: AGENT_INPUT });
    actor.start();

    expect(actor.getSnapshot().matches('starting')).toBe(true);
    expect(selectIsBusy(actor.getSnapshot())).toBe(true);

    actor.send({ type: 'runtime.started', runtimeId: 'runtime-1' });
    expect(actor.getSnapshot().matches('running')).toBe(true);
    expect(selectAgentRuntimeId(actor.getSnapshot())).toBe('runtime-1');
    expect(selectIsAbortable(actor.getSnapshot())).toBe(true);

    actor.send({ type: 'runtime.completed', runtimeId: 'runtime-other' });
    expect(actor.getSnapshot().matches('running')).toBe(true);

    actor.send({ type: 'runtime.userChoiceRequired', runtimeId: 'runtime-1', interaction: 'userChoice' });
    expect(actor.getSnapshot().matches('waiting')).toBe(true);
    expect(selectIsWaitingForUser(actor.getSnapshot())).toBe(true);
    expect(actor.getSnapshot().context.interaction).toBe('userChoice');

    actor.send({ type: 'runtime.interactionResolved', runtimeId: 'runtime-other' });
    expect(actor.getSnapshot().matches('waiting')).toBe(true);
    actor.send({ type: 'runtime.interactionResolved', runtimeId: 'runtime-1' });
    expect(actor.getSnapshot().matches('running')).toBe(true);
    actor.send({ type: 'agent.cancel' });
    expect(actor.getSnapshot().matches('cancelling')).toBe(true);

    actor.send({ type: 'runtime.cancelled', runtimeId: 'runtime-other' });
    expect(actor.getSnapshot().matches('cancelling')).toBe(true);
    actor.send({ type: 'runtime.cancelled', runtimeId: 'runtime-1' });
    expect(actor.getSnapshot().matches('cancelled')).toBe(true);
  });

  it('records runtime failures and cancellation failures', (): void => {
    const runtimeFailureActor = createActor(agentMachine, { input: AGENT_INPUT });
    runtimeFailureActor.start();
    runtimeFailureActor.send({ type: 'runtime.started', runtimeId: 'runtime-1' });
    runtimeFailureActor.send({
      type: 'runtime.failed',
      runtimeId: 'runtime-1',
      error: { code: 'runtime_failed', message: 'provider failed' }
    });

    expect(runtimeFailureActor.getSnapshot().matches('failed')).toBe(true);
    expect(runtimeFailureActor.getSnapshot().context.error?.message).toBe('provider failed');

    const cancelFailureActor = createActor(agentMachine, { input: AGENT_INPUT });
    cancelFailureActor.start();
    cancelFailureActor.send({ type: 'runtime.started', runtimeId: 'runtime-2' });
    cancelFailureActor.send({ type: 'agent.cancel' });
    cancelFailureActor.send({
      type: 'runtime.cancelFailed',
      runtimeId: 'runtime-2',
      error: { code: 'cancel_failed', message: 'abort timed out' }
    });

    expect(cancelFailureActor.getSnapshot().matches('cancelFailed')).toBe(true);
    expect(selectAgentRuntimeId(cancelFailureActor.getSnapshot())).toBe('runtime-2');
  });

  it('waits for a matching checkpoint continuation and ignores late Runtime A events', (): void => {
    const actor = createActor(agentMachine, { input: AGENT_INPUT });
    actor.start();
    actor.send({ type: 'runtime.started', runtimeId: 'runtime-a' });
    actor.send({ type: 'runtime.suspended', runtimeId: 'runtime-a', checkpointId: 'checkpoint-1' });

    expect(actor.getSnapshot().matches('waitingChildren')).toBe(true);
    expect(selectIsBusy(actor.getSnapshot())).toBe(true);
    expect(selectIsAbortable(actor.getSnapshot())).toBe(true);
    expect(selectIsWaitingForChildren(actor.getSnapshot())).toBe(true);
    expect(selectIsWaitingForUser(actor.getSnapshot())).toBe(false);
    expect(selectAgentCheckpointId(actor.getSnapshot())).toBe('checkpoint-1');

    actor.send({ type: 'runtime.completed', runtimeId: 'runtime-a' });
    actor.send({
      type: 'runtime.failed',
      runtimeId: 'runtime-a',
      error: { code: 'runtime_failed', message: 'late failure' }
    });
    expect(actor.getSnapshot().matches('waitingChildren')).toBe(true);

    actor.send({ type: 'runtime.resumeStarted', checkpointId: 'checkpoint-other', runtimeId: 'runtime-b-other' });
    expect(actor.getSnapshot().matches('waitingChildren')).toBe(true);
    actor.send({ type: 'runtime.resumeStarted', checkpointId: 'checkpoint-1', runtimeId: 'runtime-b' });
    expect(actor.getSnapshot().matches('running')).toBe(true);
    expect(selectAgentRuntimeId(actor.getSnapshot())).toBe('runtime-b');
    actor.send({ type: 'runtime.completed', runtimeId: 'runtime-a' });
    expect(actor.getSnapshot().matches('running')).toBe(true);
  });

  it('only accepts persisted cancellation for the waiting checkpoint', (): void => {
    const actor = createActor(agentMachine, { input: AGENT_INPUT });
    actor.start();
    actor.send({ type: 'runtime.started', runtimeId: 'runtime-a' });
    actor.send({ type: 'runtime.suspended', runtimeId: 'runtime-a', checkpointId: 'checkpoint-1' });
    actor.send({ type: 'agent.cancel' });

    expect(actor.getSnapshot().matches('cancellingChildren')).toBe(true);
    actor.send({ type: 'checkpoint.cancelled', checkpointId: 'checkpoint-other' });
    expect(actor.getSnapshot().matches('cancellingChildren')).toBe(true);
    actor.send({ type: 'checkpoint.cancelled', checkpointId: 'checkpoint-1' });
    expect(actor.getSnapshot().matches('cancelled')).toBe(true);
  });

  it('accepts a matching persisted terminal event directly from waiting children', (): void => {
    const cancelledActor = createActor(agentMachine, { input: AGENT_INPUT });
    cancelledActor.start();
    cancelledActor.send({ type: 'runtime.started', runtimeId: 'runtime-a' });
    cancelledActor.send({ type: 'runtime.suspended', runtimeId: 'runtime-a', checkpointId: 'checkpoint-1' });

    cancelledActor.send({ type: 'checkpoint.cancelled', checkpointId: 'checkpoint-other' });
    expect(cancelledActor.getSnapshot().matches('waitingChildren')).toBe(true);
    cancelledActor.send({ type: 'checkpoint.cancelled', checkpointId: 'checkpoint-1' });
    expect(cancelledActor.getSnapshot().matches('cancelled')).toBe(true);

    const interruptedActor = createActor(agentMachine, { input: AGENT_INPUT });
    interruptedActor.start();
    interruptedActor.send({ type: 'runtime.started', runtimeId: 'runtime-a' });
    interruptedActor.send({ type: 'runtime.suspended', runtimeId: 'runtime-a', checkpointId: 'checkpoint-1' });
    interruptedActor.send({ type: 'checkpoint.interrupted', checkpointId: 'checkpoint-1' });
    expect(interruptedActor.getSnapshot().matches('interrupted')).toBe(true);
  });
});
