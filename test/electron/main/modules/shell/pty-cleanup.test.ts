/**
 * @file pty-cleanup.test.ts
 * @description PTY runner exactly-once finalization、资源释放和清理失败测试。
 */
import type { PtyProcess, PtyProcessFactory } from '../../../../../electron/main/modules/shell/interaction/pty-process.mts';
import type { PtyTerminationStrategy } from '../../../../../electron/main/modules/shell/interaction/termination.mts';
import type { ShellRunEventEnvelope } from '../../../../../electron/main/modules/shell/types.mts';
import { describe, expect, it, vi } from 'vitest';
import { createPtyShellRunner } from '../../../../../electron/main/modules/shell/pty-runner.mts';

/** 可由测试主动触发的 PTY。 */
interface ControlledPty {
  /** PTY 进程端口。 */
  process: PtyProcess;
  /** 主动发送数据。 */
  emitData(data: string): void;
  /** 主动发送退出。 */
  emitExit(event: { exitCode: number; signal?: number }): void;
  /** 等待 PTY 监听器完成订阅。 */
  ready(): Promise<void>;
  /** data 订阅释放函数。 */
  disposeData: ReturnType<typeof vi.fn>;
  /** exit 订阅释放函数。 */
  disposeExit: ReturnType<typeof vi.fn>;
}

/**
 * 创建受控 PTY 测试端口。
 * @returns PTY 端口与事件控制器
 */
function createControlledPty(): ControlledPty {
  let dataListener: ((data: string) => void) | null = null;
  let exitListener: ((event: { exitCode: number; signal?: number }) => void) | null = null;
  let hasDataListener = false;
  let hasExitListener = false;
  const disposeData = vi.fn();
  const disposeExit = vi.fn();
  let resolveReady: (() => void) | null = null;
  const readyPromise = new Promise<void>((resolve): void => {
    resolveReady = resolve;
  });

  /** 标记监听器订阅状态，全部完成后释放 ready promise。 */
  function markReady(): void {
    if (hasDataListener && hasExitListener) {
      resolveReady?.();
      resolveReady = null;
    }
  }

  return {
    process: {
      pid: 4242,
      write: vi.fn(),
      kill: vi.fn(),
      onData(listener: (data: string) => void) {
        dataListener = listener;
        hasDataListener = true;
        markReady();
        return { dispose: disposeData };
      },
      onExit(listener: (event: { exitCode: number; signal?: number }) => void) {
        exitListener = listener;
        hasExitListener = true;
        markReady();
        return { dispose: disposeExit };
      }
    },
    emitData(data: string): void {
      dataListener?.(data);
    },
    emitExit(event: { exitCode: number; signal?: number }): void {
      exitListener?.(event);
    },
    ready(): Promise<void> {
      return readyPromise;
    },
    disposeData,
    disposeExit
  };
}

/**
 * 创建固定进程树存活状态的终止策略。
 * @param alive - 进程树是否始终存活
 * @returns 可观察的终止策略
 */
function createStrategy(alive: boolean): PtyTerminationStrategy {
  return {
    trackTree: vi.fn(),
    interruptTree: vi.fn(),
    terminateTree: vi.fn(),
    forceTree: vi.fn(),
    isTreeAlive: vi.fn((): boolean => alive),
    releaseTree: vi.fn()
  };
}

/** 创建统一的 PTY 运行请求。 */
const REQUEST = {
  commandId: 'pty-cleanup',
  shell: 'bash' as const,
  command: 'interactive',
  cwd: process.cwd(),
  workspaceRoot: process.cwd(),
  timeoutMs: 2_000,
  interactionMode: 'auto-default' as const
};

describe('PtyShellRunner cleanup', (): void => {
  it('emits finished exactly once, disposes subscriptions, and ignores later PTY events', async (): Promise<void> => {
    const controlled = createControlledPty();
    const ptyFactory: PtyProcessFactory = { spawn: (): PtyProcess => controlled.process };
    const strategy = createStrategy(false);
    const events: ShellRunEventEnvelope[] = [];
    const runner = createPtyShellRunner({ ptyFactory, terminationStrategy: strategy, gracePeriodMs: 10 });
    const runPromise = runner.run(REQUEST, (event: ShellRunEventEnvelope): void => {
      events.push(event);
    });

    await controlled.ready();
    controlled.emitExit({ exitCode: 0 });
    const result = await runPromise;
    controlled.emitExit({ exitCode: 1 });
    controlled.emitData('late output');
    await Promise.resolve();

    expect(result.termination).toEqual({ kind: 'exit', exitCode: 0 });
    expect(events.filter((event: ShellRunEventEnvelope): boolean => event.event.type === 'finished')).toHaveLength(1);
    expect(events.at(-1)?.event.type).toBe('finished');
    expect(controlled.disposeData).toHaveBeenCalledOnce();
    expect(controlled.disposeExit).toHaveBeenCalledOnce();
    expect(strategy.releaseTree).toHaveBeenCalledOnce();
    expect(runner.cancel(REQUEST.commandId)).toBe(false);
  });

  it('returns a distinct failure when force termination cannot empty the captured tree', async (): Promise<void> => {
    const controlled = createControlledPty();
    const ptyFactory: PtyProcessFactory = { spawn: (): PtyProcess => controlled.process };
    const strategy = createStrategy(true);
    const events: ShellRunEventEnvelope[] = [];
    const runner = createPtyShellRunner({ ptyFactory, terminationStrategy: strategy, gracePeriodMs: 10 });
    const runPromise = runner.run(REQUEST, (event: ShellRunEventEnvelope): void => {
      events.push(event);
    });

    await controlled.ready();
    controlled.emitData('Enter API token:');
    const result = await runPromise;

    expect(result.termination).toEqual({ kind: 'process_cleanup_failed', message: 'PTY 命令已终止，但仍有后代进程存活' });
    expect(strategy.interruptTree).toHaveBeenCalledOnce();
    expect(strategy.terminateTree).toHaveBeenCalledOnce();
    expect(strategy.forceTree).toHaveBeenCalledOnce();
    expect(events.filter((event: ShellRunEventEnvelope): boolean => event.event.type === 'finished')).toHaveLength(1);
    expect(events.at(-1)?.event.type).toBe('finished');
    expect(controlled.disposeData).toHaveBeenCalledOnce();
    expect(controlled.disposeExit).toHaveBeenCalledOnce();
  }, 2_000);

  it('distinguishes interaction timeout from command lifecycle timeout', async (): Promise<void> => {
    const interactionPty = createControlledPty();
    const interactionRunner = createPtyShellRunner({
      ptyFactory: { spawn: (): PtyProcess => interactionPty.process },
      terminationStrategy: createStrategy(false),
      gracePeriodMs: 5,
      autoDefaultOptions: { activeOutputWindowMs: 0, interactionTimeoutMs: 20 }
    });
    const interactionPromise = interactionRunner.run({ ...REQUEST, commandId: 'interaction-timeout', timeoutMs: 500 });
    await interactionPty.ready();
    interactionPty.emitData('Choose a custom action?');

    const toolPty = createControlledPty();
    const toolRunner = createPtyShellRunner({
      ptyFactory: { spawn: (): PtyProcess => toolPty.process },
      terminationStrategy: createStrategy(false),
      gracePeriodMs: 5
    });
    const toolPromise = toolRunner.run({ ...REQUEST, commandId: 'tool-timeout', timeoutMs: 20 });
    await toolPty.ready();

    await expect(interactionPromise).resolves.toMatchObject({ termination: { kind: 'interaction_timeout' }, timedOut: false });
    await expect(toolPromise).resolves.toMatchObject({ termination: { kind: 'tool_timeout' }, timedOut: true });
  }, 2_000);

  it('cleans captured descendants after the PTY leader exits normally', async (): Promise<void> => {
    const controlled = createControlledPty();
    let alive = true;
    const strategy: PtyTerminationStrategy = {
      trackTree: vi.fn(),
      interruptTree: vi.fn(),
      terminateTree: vi.fn(),
      forceTree: vi.fn((): void => {
        alive = false;
      }),
      isTreeAlive: vi.fn((): boolean => alive),
      releaseTree: vi.fn()
    };
    const runner = createPtyShellRunner({
      ptyFactory: { spawn: (): PtyProcess => controlled.process },
      terminationStrategy: strategy,
      gracePeriodMs: 5
    });
    const runPromise = runner.run({ ...REQUEST, commandId: 'leader-exit' });

    await controlled.ready();
    controlled.emitExit({ exitCode: 0 });
    const result = await runPromise;

    expect(strategy.terminateTree).toHaveBeenCalledOnce();
    expect(strategy.forceTree).toHaveBeenCalledOnce();
    expect(result.termination).toEqual({ kind: 'exit', exitCode: 0 });
  }, 2_000);

  it('coalesces rapid terminal snapshots and flushes the final screen before finished', async (): Promise<void> => {
    const controlled = createControlledPty();
    const events: ShellRunEventEnvelope[] = [];
    const runner = createPtyShellRunner({
      ptyFactory: { spawn: (): PtyProcess => controlled.process },
      terminationStrategy: createStrategy(false),
      gracePeriodMs: 5
    });
    const runPromise = runner.run({ ...REQUEST, commandId: 'terminal-throttle' }, (event: ShellRunEventEnvelope): void => {
      events.push(event);
    });

    await controlled.ready();
    for (let progress = 0; progress <= 20; progress += 1) controlled.emitData(`\rDownloading ${progress}%`);
    controlled.emitExit({ exitCode: 0 });
    await runPromise;

    const terminalEvents = events.filter((event: ShellRunEventEnvelope): boolean => event.event.type === 'terminal_update');
    expect(terminalEvents.length).toBeGreaterThan(0);
    expect(terminalEvents.length).toBeLessThanOrEqual(2);
    expect(terminalEvents.at(-1)?.event).toMatchObject({ type: 'terminal_update', content: expect.stringContaining('20%') });
    expect(events.at(-1)?.event.type).toBe('finished');
  });
});
