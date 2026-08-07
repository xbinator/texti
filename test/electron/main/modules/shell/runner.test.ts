/**
 * @file runner.test.ts
 * @description Shell runner 普通管道终端投影、降级与兼容结果语义测试。
 */
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import type { TerminalSnapshotProjector } from '../../../../../electron/main/modules/shell/interaction/screen-projector.mts';
import type { PtyShellRunner } from '../../../../../electron/main/modules/shell/pty-runner.mts';
import type { ShellCommandOutputChunk, ShellCommandRunRequest, ShellRunEventEnvelope } from '../../../../../electron/main/modules/shell/types.mts';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { createShellCommandRunner } from '../../../../../electron/main/modules/shell/runner.mts';

/**
 * 可独立触发 exit 与 close 的测试子进程。
 */
interface ControlledChildProcess {
  /** 测试用子进程。 */
  child: ChildProcessWithoutNullStreams;
  /** 触发进程退出事件，但保持 stdio 生命周期未关闭。 */
  emitExit: (exitCode?: number | null, signal?: NodeJS.Signals | null) => void;
  /** 触发 stdio 已关闭事件。 */
  emitClose: (exitCode?: number | null, signal?: NodeJS.Signals | null) => void;
  /** 按 Node 正常生命周期依次触发 exit 与 close。 */
  finish: () => void;
}

/**
 * 创建测试用可控子进程。
 * @returns 子进程与退出触发器
 */
function createChildProcess(): ControlledChildProcess {
  const emitter = new EventEmitter() as ChildProcessWithoutNullStreams;
  Object.assign(emitter, {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    pid: 12345,
    kill: vi.fn()
  });
  const emitExit = (exitCode: number | null = 0, signal: NodeJS.Signals | null = null): void => {
    emitter.emit('exit', exitCode, signal);
  };
  const emitClose = (exitCode: number | null = 0, signal: NodeJS.Signals | null = null): void => {
    emitter.emit('close', exitCode, signal);
  };
  return {
    child: emitter,
    emitExit,
    emitClose,
    finish: (): void => {
      emitExit();
      emitClose();
    }
  };
}

/**
 * 创建普通 pipe runner 测试请求。
 * @param commandId - 命令标识
 * @returns 普通 pipe 请求
 */
function createPipeRequest(commandId: string): ShellCommandRunRequest {
  return {
    commandId,
    shell: 'bash',
    command: 'test command',
    cwd: process.cwd(),
    workspaceRoot: process.cwd(),
    timeoutMs: 5_000,
    interactionMode: 'none'
  };
}

/**
 * 等待异步工作区校验完成并注册子进程监听器。
 * @param child - 可控测试子进程
 */
async function waitForChildListeners(child: ChildProcessWithoutNullStreams): Promise<void> {
  await vi.waitFor((): void => {
    expect(child.stdout.listenerCount('data')).toBeGreaterThan(0);
  });
}

/**
 * 排空串行 projector 链产生的 Promise 微任务。
 * @param remaining - 剩余微任务轮数
 * @returns 微任务排空 Promise
 */
async function flushMicrotasks(remaining = 8): Promise<void> {
  if (remaining <= 0) return;
  await Promise.resolve();
  await flushMicrotasks(remaining - 1);
}

/**
 * 向可控子进程注入指定输出流数据。
 * @param child - 可控测试子进程
 * @param stream - 输出流类型
 * @param text - 原始输出文本
 */
function emitChildOutput(child: ChildProcessWithoutNullStreams, stream: 'stdout' | 'stderr', text: string): void {
  child[stream].emit('data', Buffer.from(text));
}

describe('Shell command runner result compatibility', (): void => {
  it('does not create a fixed deadline when timeoutMs is omitted', async (): Promise<void> => {
    const { child, finish } = createChildProcess();
    const runner = createShellCommandRunner({ spawnProcess: (): ChildProcessWithoutNullStreams => child });
    const resultPromise = runner.run({
      commandId: 'pipe-runtime-managed',
      shell: 'bash',
      command: 'long task',
      cwd: process.cwd(),
      workspaceRoot: process.cwd(),
      timeoutMs: undefined,
      interactionMode: 'none'
    });

    await new Promise<void>((resolve): void => {
      setTimeout(resolve, 20);
    });
    finish();
    const result = await resultPromise;

    expect(child.kill).not.toHaveBeenCalled();
    expect(result.termination).toEqual({ kind: 'exit', exitCode: 0 });
  });

  it('reports pipe output and an exit termination for a successful command', async (): Promise<void> => {
    const runner = createShellCommandRunner();
    const result = await runner.run({
      commandId: 'pipe-exit-0',
      shell: 'bash',
      command: 'printf ok',
      cwd: process.cwd(),
      workspaceRoot: process.cwd(),
      timeoutMs: 5_000,
      interactionMode: 'none'
    });

    expect(result).toMatchObject({
      outputMode: 'pipes',
      termination: { kind: 'exit', exitCode: 0 },
      exitCode: 0,
      signal: null,
      timedOut: false,
      stdout: 'ok'
    });
  });

  it('waits for close and preserves output emitted after exit', async (): Promise<void> => {
    const { child, emitExit, emitClose } = createChildProcess();
    const chunks: ShellCommandOutputChunk[] = [];
    const events: ShellRunEventEnvelope[] = [];
    const runner = createShellCommandRunner({ spawnProcess: (): ChildProcessWithoutNullStreams => child });
    let resolved = false;
    const resultPromise = runner.run(
      createPipeRequest('pipe-close-tail'),
      (chunk): void => {
        chunks.push(chunk);
      },
      (event): void => {
        events.push(event);
      }
    );
    const resolutionObserver = resultPromise.then((): void => {
      resolved = true;
    });

    await waitForChildListeners(child);
    emitChildOutput(child, 'stdout', 'before exit\n');
    emitExit();
    await flushMicrotasks();

    expect(resolved).toBe(false);
    expect(events.some((event): boolean => event.event.type === 'finished')).toBe(false);

    emitChildOutput(child, 'stdout', 'after exit\n');
    emitClose();
    const result = await resultPromise;
    await resolutionObserver;

    expect(chunks.map((chunk): string => chunk.text).join('')).toBe('before exit\nafter exit\n');
    expect(result.stdout).toBe('before exit\nafter exit\n');
    expect(result.terminalOutput).toContain('after exit');
    expect(events.at(-1)?.event.type).toBe('finished');
  });

  it('emits only the latest pipe screen after adjacent redraw chunks', async (): Promise<void> => {
    const { child, finish } = createChildProcess();
    const chunks: ShellCommandOutputChunk[] = [];
    const events: ShellRunEventEnvelope[] = [];
    const runner = createShellCommandRunner({ spawnProcess: (): ChildProcessWithoutNullStreams => child });
    const resultPromise = runner.run(
      createPipeRequest('pipe-spinner'),
      (chunk): void => {
        chunks.push(chunk);
      },
      (event): void => {
        events.push(event);
      }
    );

    await waitForChildListeners(child);
    emitChildOutput(child, 'stdout', '\u001b[1G\u001b[J');
    emitChildOutput(child, 'stdout', '⠋ Cloning repository…');
    emitChildOutput(child, 'stdout', '\u001b[1G\u001b[J');
    emitChildOutput(child, 'stdout', '⠙ Cloning repository…');
    finish();
    const result = await resultPromise;

    expect(chunks.map((chunk): string => chunk.text)).toEqual(['\u001b[1G\u001b[J', '⠋ Cloning repository…', '\u001b[1G\u001b[J', '⠙ Cloning repository…']);
    expect(chunks.every((chunk): boolean => !('terminalContent' in chunk))).toBe(true);
    expect(events.filter((event): boolean => event.event.type === 'terminal_update')).toEqual([
      expect.objectContaining({ event: { type: 'terminal_update', content: '⠙ Cloning repository…' } })
    ]);
    expect(events.at(-1)?.event.type).toBe('finished');
    expect(result.stdout).toBe('\u001b[1G\u001b[J⠋ Cloning repository…\u001b[1G\u001b[J⠙ Cloning repository…');
    expect(result.terminalOutput).toContain('⠙ Cloning repository…');
    expect(result.terminalOutput).not.toContain('⠋ Cloning repository…');
  });

  it('does not publish an erase-only frame across a refresh boundary', async (): Promise<void> => {
    const { child, finish } = createChildProcess();
    const events: ShellRunEventEnvelope[] = [];
    let screen = '';
    const projector: TerminalSnapshotProjector = {
      write: vi.fn(async (text: string): Promise<void> => {
        screen = text === '\u001b[1G\u001b[J' ? '' : text;
      }),
      snapshot: vi.fn(() => ({
        sequence: 1,
        content: screen,
        cursor: { row: 0, column: 0, visible: true },
        activity: { spinner: false, progress: false, compiling: false, streamingLogs: false },
        createdAt: Date.now()
      })),
      projectOutput: vi.fn(() => ({ content: screen, truncated: false })),
      dispose: vi.fn()
    };
    const runner = createShellCommandRunner({
      spawnProcess: (): ChildProcessWithoutNullStreams => child,
      screenProjectorFactory: (): TerminalSnapshotProjector => projector
    });
    const resultPromise = runner.run(createPipeRequest('pipe-erase-boundary'), undefined, (event): void => {
      events.push(event);
    });

    await waitForChildListeners(child);
    vi.useFakeTimers();
    try {
      emitChildOutput(child, 'stdout', 'stable frame');
      await flushMicrotasks();
      await vi.advanceTimersByTimeAsync(50);

      emitChildOutput(child, 'stdout', 'next spinner frame');
      await flushMicrotasks();
      await vi.advanceTimersByTimeAsync(45);
      emitChildOutput(child, 'stdout', '\u001b[1G\u001b[J');
      await flushMicrotasks();
      await vi.advanceTimersByTimeAsync(5);
      emitChildOutput(child, 'stdout', 'repainted frame');
      await flushMicrotasks();
      await vi.advanceTimersByTimeAsync(50);

      finish();
      const result = await resultPromise;
      const contents = events.flatMap((event): string[] => (event.event.type === 'terminal_update' ? [event.event.content] : []));

      expect(contents).not.toContain('');
      expect(contents.at(-1)).toBe('repainted frame');
      expect(result.terminalOutput).toBe('repainted frame');
    } finally {
      vi.useRealTimers();
    }
  });

  it('pauses pipe streams while projector backlog exceeds the high watermark', async (): Promise<void> => {
    const { child, finish } = createChildProcess();
    const writeResolvers: Array<() => void> = [];
    const projector: TerminalSnapshotProjector = {
      write: vi.fn(
        (): Promise<void> =>
          new Promise<void>((resolve): void => {
            writeResolvers.push(resolve);
          })
      ),
      snapshot: vi.fn(() => ({
        sequence: 1,
        content: 'projected',
        cursor: { row: 0, column: 0, visible: true },
        activity: { spinner: false, progress: false, compiling: false, streamingLogs: false },
        createdAt: Date.now()
      })),
      projectOutput: vi.fn(() => ({ content: 'projected', truncated: false })),
      dispose: vi.fn()
    };
    const runner = createShellCommandRunner({
      spawnProcess: (): ChildProcessWithoutNullStreams => child,
      screenProjectorFactory: (): TerminalSnapshotProjector => projector
    });
    const resultPromise = runner.run(createPipeRequest('pipe-projector-backpressure'));

    await waitForChildListeners(child);
    const stdoutPause = vi.spyOn(child.stdout, 'pause');
    const stderrPause = vi.spyOn(child.stderr, 'pause');
    const stdoutResume = vi.spyOn(child.stdout, 'resume');
    const stderrResume = vi.spyOn(child.stderr, 'resume');
    stdoutPause.mockClear();
    stderrPause.mockClear();
    stdoutResume.mockClear();
    stderrResume.mockClear();

    const firstChunk = 'a'.repeat(600_000);
    const secondChunk = 'b'.repeat(600_000);
    emitChildOutput(child, 'stdout', firstChunk);
    emitChildOutput(child, 'stderr', secondChunk);
    await flushMicrotasks();
    const pausedBoth = stdoutPause.mock.calls.length > 0 && stderrPause.mock.calls.length > 0;

    writeResolvers.shift()?.();
    await flushMicrotasks();
    writeResolvers.shift()?.();
    await flushMicrotasks();
    finish();
    await resultPromise;

    expect(pausedBoth).toBe(true);
    expect(stdoutResume).toHaveBeenCalled();
    expect(stderrResume).toHaveBeenCalled();
    expect(projector.write).toHaveBeenNthCalledWith(1, firstChunk);
    expect(projector.write).toHaveBeenNthCalledWith(2, secondChunk);
  });

  it('projects interleaved stdout and stderr in chunk sequence order', async (): Promise<void> => {
    const { child, finish } = createChildProcess();
    const chunks: ShellCommandOutputChunk[] = [];
    const events: ShellRunEventEnvelope[] = [];
    const runner = createShellCommandRunner({ spawnProcess: (): ChildProcessWithoutNullStreams => child });
    const resultPromise = runner.run(
      createPipeRequest('pipe-stream-order'),
      (chunk): void => {
        chunks.push(chunk);
      },
      (event): void => {
        events.push(event);
      }
    );

    await waitForChildListeners(child);
    emitChildOutput(child, 'stdout', 'first frame');
    emitChildOutput(child, 'stderr', '\u001b[1G\u001b[Jsecond frame');
    finish();
    const result = await resultPromise;

    expect(chunks.map((chunk): [number, ShellCommandOutputChunk['stream']] => [chunk.sequence, chunk.stream])).toEqual([
      [1, 'stdout'],
      [2, 'stderr']
    ]);
    const terminalUpdates = events.filter((event): boolean => event.event.type === 'terminal_update');
    expect(terminalUpdates).toEqual([expect.objectContaining({ event: { type: 'terminal_update', content: 'second frame' } })]);
    expect(result.terminalOutput).toContain('second frame');
  });

  it('falls back to raw pipe output when projector creation fails', async (): Promise<void> => {
    const { child, finish } = createChildProcess();
    const chunks: ShellCommandOutputChunk[] = [];
    const screenProjectorFactory = vi.fn((): TerminalSnapshotProjector => {
      throw new Error('projector unavailable');
    });
    const runner = createShellCommandRunner({
      spawnProcess: (): ChildProcessWithoutNullStreams => child,
      screenProjectorFactory
    });
    const resultPromise = runner.run(createPipeRequest('pipe-projector-create-failure'), (chunk): void => {
      chunks.push(chunk);
    });

    await waitForChildListeners(child);
    emitChildOutput(child, 'stdout', 'raw output');
    finish();
    const result = await resultPromise;

    expect(screenProjectorFactory).toHaveBeenCalledOnce();
    expect(screenProjectorFactory).toHaveBeenCalledWith({ columns: 100, rows: 30, convertEol: true });
    expect(chunks).toEqual([expect.objectContaining({ text: 'raw output' })]);
    expect(chunks[0]).not.toHaveProperty('terminalContent');
    expect(result).toMatchObject({ stdout: 'raw output', exitCode: 0, termination: { kind: 'exit', exitCode: 0 } });
    expect(result.terminalOutput).toBeUndefined();
  });

  it('falls back to raw pipe output when projector write fails', async (): Promise<void> => {
    const { child, finish } = createChildProcess();
    const chunks: ShellCommandOutputChunk[] = [];
    const dispose = vi.fn();
    const projector: TerminalSnapshotProjector = {
      write: vi.fn(async (): Promise<void> => Promise.reject(new Error('projector write failed'))),
      snapshot: vi.fn(() => ({
        sequence: 1,
        content: '',
        cursor: { row: 0, column: 0, visible: true },
        activity: { spinner: false, progress: false, compiling: false, streamingLogs: false },
        createdAt: Date.now()
      })),
      projectOutput: vi.fn(() => ({ content: '', truncated: false })),
      dispose
    };
    const runner = createShellCommandRunner({
      spawnProcess: (): ChildProcessWithoutNullStreams => child,
      screenProjectorFactory: (): TerminalSnapshotProjector => projector
    });
    const resultPromise = runner.run(createPipeRequest('pipe-projector-write-failure'), (chunk): void => {
      chunks.push(chunk);
    });

    await waitForChildListeners(child);
    emitChildOutput(child, 'stdout', 'raw after failure');
    finish();
    const result = await resultPromise;

    expect(projector.write).toHaveBeenCalledOnce();
    expect(chunks).toEqual([expect.objectContaining({ text: 'raw after failure' })]);
    expect(chunks[0]).not.toHaveProperty('terminalContent');
    expect(result).toMatchObject({ stdout: 'raw after failure', exitCode: 0, termination: { kind: 'exit', exitCode: 0 } });
    expect(result.terminalOutput).toBeUndefined();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('keeps a non-zero exit code as a normal exit termination', async (): Promise<void> => {
    const runner = createShellCommandRunner();
    const result = await runner.run({
      commandId: 'pipe-exit-7',
      shell: 'bash',
      command: 'exit 7',
      cwd: process.cwd(),
      workspaceRoot: process.cwd(),
      timeoutMs: 5_000,
      interactionMode: 'none'
    });

    expect(result).toMatchObject({
      outputMode: 'pipes',
      termination: { kind: 'exit', exitCode: 7 },
      exitCode: 7,
      timedOut: false
    });
  });

  it('dispatches auto-default requests to the PTY runner', async (): Promise<void> => {
    const run = vi.fn(async () => ({
      commandId: 'pty-route',
      shell: 'bash' as const,
      command: 'interactive',
      cwd: process.cwd(),
      exitCode: 0,
      signal: null,
      durationMs: 1,
      timedOut: false,
      truncated: false,
      outputMode: 'pty' as const,
      terminalOutput: 'done',
      termination: { kind: 'exit' as const, exitCode: 0 },
      autoInteraction: { enabled: true, answerCount: 1 }
    }));
    const ptyRunner: PtyShellRunner = { run, cancel: vi.fn((): boolean => false) };
    const runner = createShellCommandRunner({
      ptyRunner,
      getAutoDefaultCapability: () => ({
        enabled: true,
        reason: null,
        verificationVersion: 'v1',
        platform: process.platform,
        arch: process.arch
      })
    });

    const result = await runner.run({
      commandId: 'pty-route',
      shell: 'bash',
      command: 'interactive',
      cwd: process.cwd(),
      workspaceRoot: process.cwd(),
      timeoutMs: 5_000,
      interactionMode: 'auto-default'
    });

    expect(run).toHaveBeenCalledOnce();
    expect(result.outputMode).toBe('pty');
  });

  it('rejects a direct auto-default request when the main-process gate is disabled', async (): Promise<void> => {
    const run = vi.fn();
    const ptyRunner: PtyShellRunner = { run, cancel: vi.fn((): boolean => false) };
    const runner = createShellCommandRunner({
      ptyRunner,
      getAutoDefaultCapability: () => ({
        enabled: false,
        reason: 'FEATURE_DISABLED',
        verificationVersion: 'v1',
        platform: process.platform,
        arch: process.arch
      })
    });

    await expect(
      runner.run({
        commandId: 'pty-disabled',
        shell: 'bash',
        command: 'interactive',
        cwd: process.cwd(),
        workspaceRoot: process.cwd(),
        timeoutMs: 5_000,
        interactionMode: 'auto-default'
      })
    ).rejects.toThrow('auto-default');
    expect(run).not.toHaveBeenCalled();
  });

  it('rejects pipe commands when cwd resolves outside workspace through a symlink', async (): Promise<void> => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tibis-shell-runner-'));
    try {
      const workspaceRoot = path.join(tempRoot, 'workspace');
      const outsideRoot = path.join(tempRoot, 'outside');
      const linkedCwd = path.join(workspaceRoot, 'linked-cwd');
      await fs.mkdir(workspaceRoot);
      await fs.mkdir(outsideRoot);
      await fs.symlink(outsideRoot, linkedCwd);

      const runner = createShellCommandRunner();
      await expect(
        runner.run({
          commandId: 'pipe-symlink-cwd',
          shell: 'bash',
          command: 'pwd',
          cwd: linkedCwd,
          workspaceRoot,
          timeoutMs: 5_000,
          interactionMode: 'none'
        })
      ).rejects.toThrow('工作区');
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('rejects auto-default commands before dispatch when cwd resolves outside workspace through a symlink', async (): Promise<void> => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tibis-shell-runner-'));
    try {
      const workspaceRoot = path.join(tempRoot, 'workspace');
      const outsideRoot = path.join(tempRoot, 'outside');
      const linkedCwd = path.join(workspaceRoot, 'linked-cwd');
      await fs.mkdir(workspaceRoot);
      await fs.mkdir(outsideRoot);
      await fs.symlink(outsideRoot, linkedCwd);

      const run = vi.fn();
      const ptyRunner: PtyShellRunner = { run, cancel: vi.fn((): boolean => false) };
      const runner = createShellCommandRunner({
        ptyRunner,
        getAutoDefaultCapability: () => ({
          enabled: true,
          reason: null,
          verificationVersion: 'v1',
          platform: process.platform,
          arch: process.arch
        })
      });

      await expect(
        runner.run({
          commandId: 'pty-symlink-cwd',
          shell: 'bash',
          command: 'interactive',
          cwd: linkedCwd,
          workspaceRoot,
          timeoutMs: 5_000,
          interactionMode: 'auto-default'
        })
      ).rejects.toThrow('工作区');
      expect(run).not.toHaveBeenCalled();
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('does not pass code-injection environment variables to pipe commands', async (): Promise<void> => {
    const originalNodeOptions = process.env.NODE_OPTIONS;
    const originalPythonPath = process.env.PYTHONPATH;
    process.env.NODE_OPTIONS = '--require /Users/test/hook.js';
    process.env.PYTHONPATH = '/Users/test/python-hooks';
    try {
      const { child, finish } = createChildProcess();
      const spawnProcess = vi.fn((): ChildProcessWithoutNullStreams => {
        setTimeout(finish, 0);
        return child;
      });
      const runner = createShellCommandRunner({ spawnProcess });
      const resultPromise = runner.run({
        commandId: 'env-sanitize',
        shell: 'bash',
        command: 'echo ok',
        cwd: process.cwd(),
        workspaceRoot: process.cwd(),
        timeoutMs: 5_000,
        interactionMode: 'none'
      });
      await resultPromise;

      expect(spawnProcess).toHaveBeenCalledWith(
        'bash',
        ['--noprofile', '--norc', '-c', 'echo ok'],
        expect.objectContaining({
          env: expect.not.objectContaining({
            NODE_OPTIONS: '--require /Users/test/hook.js',
            PYTHONPATH: '/Users/test/python-hooks'
          })
        })
      );
    } finally {
      if (originalNodeOptions === undefined) delete process.env.NODE_OPTIONS;
      else process.env.NODE_OPTIONS = originalNodeOptions;
      if (originalPythonPath === undefined) delete process.env.PYTHONPATH;
      else process.env.PYTHONPATH = originalPythonPath;
    }
  });
});
