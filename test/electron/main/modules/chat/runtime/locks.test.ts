/**
 * @file locks.test.ts
 * @description ChatRuntime session 写入锁测试。
 */
import { describe, expect, it } from 'vitest';
import { assertSessionHistoryWritable, createRuntimeLockRegistry } from '../../../../../../electron/main/modules/chat/runtime/infrastructure/locks.mjs';

describe('chat runtime locks', (): void => {
  it('allows one writing runtime per session', (): void => {
    const locks = createRuntimeLockRegistry();

    expect(locks.acquireWritingLock({ sessionId: 's1', runtimeId: 'r1' }).ok).toBe(true);
    expect(locks.acquireWritingLock({ sessionId: 's1', runtimeId: 'r2' })).toEqual({
      ok: false,
      ownerRuntimeId: 'r1',
      reason: 'session_busy'
    });
  });

  it('allows different sessions to run independently', (): void => {
    const locks = createRuntimeLockRegistry();

    expect(locks.acquireWritingLock({ sessionId: 's1', runtimeId: 'r1' }).ok).toBe(true);
    expect(locks.acquireWritingLock({ sessionId: 's2', runtimeId: 'r2' }).ok).toBe(true);
  });

  it('releases only the owning runtime', (): void => {
    const locks = createRuntimeLockRegistry();

    locks.acquireWritingLock({ sessionId: 's1', runtimeId: 'r1' });
    expect(locks.releaseWritingLock({ sessionId: 's1', runtimeId: 'r2' })).toBe(false);
    expect(locks.releaseWritingLock({ sessionId: 's1', runtimeId: 'r1' })).toBe(true);
    expect(locks.acquireWritingLock({ sessionId: 's1', runtimeId: 'r3' }).ok).toBe(true);
  });

  it('holds a resource-scoped continuation fence after the ordinary writer releases', (): void => {
    const locks = createRuntimeLockRegistry();
    const fence = locks.acquireContinuationFence({
      scope: 'session:s1/history',
      checkpointId: 'checkpoint-1'
    });

    expect(fence).not.toBeNull();
    expect(locks.acquireWritingLock({ sessionId: 's1', runtimeId: 'runtime-next' })).toEqual({
      ok: false,
      ownerCheckpointId: 'checkpoint-1',
      reason: 'turn_waiting_children'
    });
    expect(locks.acquireWritingLock({ sessionId: 's2', runtimeId: 'runtime-other' })).toEqual({ ok: true });
    expect(
      locks.acquireContinuationWritingLock({
        sessionId: 's1',
        runtimeId: 'runtime-b',
        checkpointId: 'checkpoint-1'
      })
    ).toEqual({ ok: true });

    locks.releaseWritingLock({ sessionId: 's1', runtimeId: 'runtime-b' });
    fence?.release();
    expect(locks.acquireWritingLock({ sessionId: 's1', runtimeId: 'runtime-next' })).toEqual({ ok: true });
  });

  it('rejects a continuation writer that does not own the session history fence', (): void => {
    const locks = createRuntimeLockRegistry();
    locks.acquireContinuationFence({
      scope: 'session:s1/history',
      checkpointId: 'checkpoint-owner'
    });

    expect(
      locks.acquireContinuationWritingLock({
        sessionId: 's1',
        runtimeId: 'runtime-wrong',
        checkpointId: 'checkpoint-other'
      })
    ).toEqual({
      ok: false,
      ownerCheckpointId: 'checkpoint-owner',
      reason: 'turn_waiting_children'
    });
  });

  it('does not let duplicate fence handles release another acquisition', (): void => {
    const locks = createRuntimeLockRegistry();
    const owner = locks.acquireContinuationFence({
      scope: 'session:s1/history',
      checkpointId: 'checkpoint-1'
    });
    const duplicate = locks.acquireContinuationFence({
      scope: 'session:s1/history',
      checkpointId: 'checkpoint-1'
    });

    expect(owner).not.toBeNull();
    expect(duplicate).toBeNull();
    duplicate?.release();
    expect(locks.getContinuationFence('session:s1/history')).toEqual({
      scope: 'session:s1/history',
      checkpointId: 'checkpoint-1'
    });
  });

  it('normalizes and validates session history resource scopes', (): void => {
    const locks = createRuntimeLockRegistry();

    expect(
      locks.acquireContinuationFence({
        scope: ' session:s1/history ',
        checkpointId: 'checkpoint-1'
      })
    ).not.toBeNull();
    expect(
      locks.acquireContinuationFence({
        scope: 'session:s1/messages',
        checkpointId: 'checkpoint-2'
      })
    ).toBeNull();
  });

  it('allows history writes only for the explicit continuation fence owner', (): void => {
    const locks = createRuntimeLockRegistry();
    locks.acquireContinuationFence({
      scope: 'session:s1/history',
      checkpointId: 'checkpoint-owner'
    });

    expect((): void => assertSessionHistoryWritable('s1', undefined, locks)).toThrowError(expect.objectContaining({ code: 'TURN_WAITING_CHILDREN' }));
    expect((): void => assertSessionHistoryWritable('s1', 'checkpoint-other', locks)).toThrowError(expect.objectContaining({ code: 'TURN_WAITING_CHILDREN' }));
    expect((): void => assertSessionHistoryWritable('s1', 'checkpoint-owner', locks)).not.toThrow();
  });

  it('reserves without blocking history and activates deterministically after commit', (): void => {
    const locks = createRuntimeLockRegistry();
    const reservation = locks.reserveContinuationFence({
      scope: 'session:s1/history',
      checkpointId: 'checkpoint-owner'
    });

    expect(reservation).not.toBeNull();
    expect(locks.getContinuationFence('session:s1/history')).toBeUndefined();
    expect(locks.acquireWritingLock({ sessionId: 's1', runtimeId: 'runtime-a' })).toEqual({ ok: true });
    expect(
      locks.reserveContinuationFence({
        scope: 'session:s1/history',
        checkpointId: 'checkpoint-other'
      })
    ).toBeNull();
    locks.releaseWritingLock({ sessionId: 's1', runtimeId: 'runtime-a' });

    const fence = reservation?.activate();
    expect(fence).toMatchObject({
      scope: 'session:s1/history',
      checkpointId: 'checkpoint-owner'
    });
    expect(locks.acquireWritingLock({ sessionId: 's1', runtimeId: 'runtime-next' })).toMatchObject({
      ok: false,
      reason: 'turn_waiting_children',
      ownerCheckpointId: 'checkpoint-owner'
    });
  });
});
