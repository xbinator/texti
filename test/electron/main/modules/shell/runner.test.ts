/**
 * @file runner.test.ts
 * @description Shell runner 第二期兼容结果语义测试。
 */
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import type { PtyShellRunner } from '../../../../../electron/main/modules/shell/pty-runner.mts';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { createShellCommandRunner } from '../../../../../electron/main/modules/shell/runner.mts';

/**
 * 创建测试用可控子进程。
 * @returns 子进程与退出触发器
 */
function createChildProcess(): { child: ChildProcessWithoutNullStreams; finish: () => void } {
  const emitter = new EventEmitter() as ChildProcessWithoutNullStreams;
  Object.assign(emitter, {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    pid: 12345,
    kill: vi.fn()
  });
  return {
    child: emitter,
    finish: (): void => {
      emitter.emit('exit', 0, null);
    }
  };
}

describe('Shell command runner result compatibility', (): void => {
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
