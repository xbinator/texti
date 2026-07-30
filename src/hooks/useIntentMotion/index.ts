/**
 * @file index.ts
 * @description 管理由显式动作触发、可被状态冲突主动取消的动画生命周期。
 */
import { computed, onScopeDispose, ref, type ComputedRef } from 'vue';

/**
 * 显式动作动画控制器配置。
 */
export interface UseIntentMotionOptions {
  /** 动画持续时间，单位毫秒 */
  duration?: number;
}

/**
 * 显式动作动画控制器返回值。
 */
export interface UseIntentMotionReturn<State> {
  /** 当前是否应应用动画样式 */
  motionEnabled: ComputedRef<boolean>;
  /** 开始一次以指定状态为目标的动画事务 */
  startMotion: (targetState: State) => void;
  /** 同步实际状态，并在目标冲突时取消动画 */
  syncState: (currentState: State) => void;
  /** 立即取消当前动画事务 */
  cancelMotion: () => void;
}

/** 显式动作动画默认持续时间。 */
const DEFAULT_MOTION_DURATION = 360;

/**
 * 创建不依赖具体组件或动画实现的显式动作控制器。
 * @param options - 动画控制选项
 * @returns 动画启用状态与生命周期控制方法
 */
export function useIntentMotion<State>(options: UseIntentMotionOptions = {}): UseIntentMotionReturn<State> {
  const duration = options.duration ?? DEFAULT_MOTION_DURATION;
  const motionActive = ref(false);
  const motionEnabled = computed<boolean>((): boolean => motionActive.value);
  /** 当前显式动作的目标状态；对象包装允许 State 合法包含 null 或 undefined。 */
  let activeTarget: { value: State } | null = null;
  /** 当前动画清理定时器。 */
  let motionTimer: number | null = null;

  /**
   * 仅清理动画定时器，供重启动画和完整取消共同复用。
   */
  function clearTimer(): void {
    if (motionTimer === null) {
      return;
    }

    window.clearTimeout(motionTimer);
    motionTimer = null;
  }

  /**
   * 立即取消当前显式动作动画事务。
   */
  function cancelMotion(): void {
    clearTimer();
    activeTarget = null;
    motionActive.value = false;
  }

  /**
   * 开始一次以指定状态为目标的动画事务。
   * @param targetState - 本次动作希望达到的最终状态
   */
  function startMotion(targetState: State): void {
    clearTimer();
    activeTarget = { value: targetState };
    motionActive.value = true;
    motionTimer = window.setTimeout(cancelMotion, duration);
  }

  /**
   * 同步真实状态；与动作目标冲突代表状态变化来自其他路径。
   * @param currentState - 当前真实状态
   */
  function syncState(currentState: State): void {
    if (activeTarget !== null && !Object.is(currentState, activeTarget.value)) {
      cancelMotion();
    }
  }

  onScopeDispose(cancelMotion);

  return {
    motionEnabled,
    startMotion,
    syncState,
    cancelMotion
  };
}
