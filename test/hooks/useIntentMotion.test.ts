/**
 * @file useIntentMotion.test.ts
 * @description 显式动作动画控制器的泛型状态与生命周期测试。
 * @vitest-environment jsdom
 */
import { effectScope, type EffectScope } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useIntentMotion, type UseIntentMotionReturn } from '@/hooks/useIntentMotion';

/**
 * 动画控制器测试夹具。
 */
interface MotionFixture<State> {
  /** 动画控制器 */
  motion: UseIntentMotionReturn<State>;
  /** 控制器所属 Vue scope */
  scope: EffectScope;
}

/**
 * 在独立 Vue scope 中创建泛型动画控制器。
 * @returns scope 与动画控制器
 */
function createMotion<State>(): MotionFixture<State> {
  const scope = effectScope();
  const motion = scope.run((): UseIntentMotionReturn<State> => useIntentMotion<State>({ duration: 360 }));

  if (!motion) {
    throw new Error('Failed to create intent motion controller');
  }

  return { motion, scope };
}

describe('useIntentMotion', (): void => {
  afterEach((): void => {
    vi.useRealTimers();
  });

  it('keeps matching boolean state inside the explicit motion transaction', (): void => {
    vi.useFakeTimers();
    const { motion, scope } = createMotion<boolean>();

    motion.startMotion(true);
    motion.syncState(true);

    expect(motion.motionEnabled.value).toBe(true);

    scope.stop();
  });

  it('cancels motion for a conflicting non-panel enum state', (): void => {
    vi.useFakeTimers();
    const { motion, scope } = createMotion<'collapsed' | 'expanded'>();

    motion.startMotion('expanded');
    motion.syncState('collapsed');

    expect(motion.motionEnabled.value).toBe(false);

    scope.stop();
  });

  it('disables motion after the configured duration', async (): Promise<void> => {
    vi.useFakeTimers();
    const { motion, scope } = createMotion<boolean>();

    motion.startMotion(false);
    expect(motion.motionEnabled.value).toBe(true);

    await vi.advanceTimersByTimeAsync(360);

    expect(motion.motionEnabled.value).toBe(false);

    scope.stop();
  });

  it('cancels the pending transaction when its Vue scope is disposed', (): void => {
    vi.useFakeTimers();
    const { motion, scope } = createMotion<boolean>();

    motion.startMotion(true);
    scope.stop();

    expect(motion.motionEnabled.value).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
