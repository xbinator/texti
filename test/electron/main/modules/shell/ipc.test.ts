/**
 * @file ipc.test.ts
 * @description Shell IPC 同时转发 pipe 输出和 PTY 有序事件测试。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerShellCommandHandlers } from '../../../../../electron/main/modules/shell/ipc.mts';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
  analyzeShellCommandSafety: vi.fn(),
  run: vi.fn(),
  cancel: vi.fn()
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => Promise<unknown>): void => {
      mocks.handlers.set(channel, handler);
    })
  }
}));

vi.mock('../../../../../electron/main/modules/shell/runner.mjs', () => ({
  shellCommandRunner: { run: mocks.run, cancel: mocks.cancel }
}));

vi.mock('../../../../../electron/main/modules/shell/safety.mjs', () => ({
  analyzeShellCommandSafety: mocks.analyzeShellCommandSafety
}));

describe('Shell IPC events', (): void => {
  beforeEach((): void => {
    mocks.handlers.clear();
    mocks.analyzeShellCommandSafety.mockReset();
    mocks.analyzeShellCommandSafety.mockResolvedValue({
      status: 'allowed',
      shell: 'bash',
      findings: [],
      normalizedCommandPreview: 'echo ok',
      cwd: '/workspace'
    });
    mocks.run.mockReset();
    registerShellCommandHandlers();
  });

  it('forwards ordered PTY events on the invoking renderer sender', async (): Promise<void> => {
    const result = { commandId: 'command-1' };
    const send = vi.fn();
    mocks.run.mockImplementation(async (_request, _outputSink, eventSink): Promise<unknown> => {
      eventSink({ commandId: 'command-1', sequence: 1, createdAt: 'now', event: { type: 'terminal_update', content: 'screen' } });
      return result;
    });
    const handler = mocks.handlers.get('shell:run');
    if (!handler) throw new Error('shell:run handler missing');

    const received = await handler({ sender: { send } }, { commandId: 'command-1' });

    expect(send).toHaveBeenCalledWith('shell:run-event', expect.objectContaining({ commandId: 'command-1' }));
    expect(received).toBe(result);
  });

  it('rejects run requests when safety analysis blocks the command', async (): Promise<void> => {
    const send = vi.fn();
    mocks.analyzeShellCommandSafety.mockResolvedValue({
      status: 'blocked',
      shell: 'bash',
      findings: [{ severity: 'blocker', code: 'DESTRUCTIVE_DELETE', message: 'blocked' }],
      normalizedCommandPreview: 'rm -rf /workspace',
      cwd: '/workspace'
    });
    const handler = mocks.handlers.get('shell:run');
    if (!handler) throw new Error('shell:run handler missing');

    await expect(
      handler(
        { sender: { send } },
        { commandId: 'command-1', shell: 'bash', command: 'rm -rf /workspace', cwd: '/workspace', workspaceRoot: '/workspace', timeoutMs: 5_000 }
      )
    ).rejects.toThrow('安全分析');
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it('rejects run requests with unconfirmed safety findings', async (): Promise<void> => {
    const send = vi.fn();
    mocks.analyzeShellCommandSafety.mockResolvedValue({
      status: 'allowed',
      shell: 'bash',
      findings: [{ severity: 'warning', code: 'READ_OUTSIDE_WORKSPACE', message: 'needs confirmation' }],
      normalizedCommandPreview: 'cat /Users/test/.ssh/config',
      cwd: '/workspace'
    });
    const handler = mocks.handlers.get('shell:run');
    if (!handler) throw new Error('shell:run handler missing');

    await expect(
      handler(
        { sender: { send } },
        { commandId: 'command-1', shell: 'bash', command: 'cat /Users/test/.ssh/config', cwd: '/workspace', workspaceRoot: '/workspace', timeoutMs: 5_000 }
      )
    ).rejects.toThrow('未确认');
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it('runs requests with confirmed safety finding codes after re-analysis', async (): Promise<void> => {
    const result = { commandId: 'command-1' };
    const send = vi.fn();
    mocks.analyzeShellCommandSafety.mockResolvedValue({
      status: 'allowed',
      shell: 'bash',
      findings: [{ severity: 'warning', code: 'READ_OUTSIDE_WORKSPACE', message: 'needs confirmation' }],
      normalizedCommandPreview: 'cat /Users/test/.ssh/config',
      cwd: '/workspace'
    });
    mocks.run.mockResolvedValue(result);
    const handler = mocks.handlers.get('shell:run');
    if (!handler) throw new Error('shell:run handler missing');

    const received = await handler(
      { sender: { send } },
      {
        commandId: 'command-1',
        shell: 'bash',
        command: 'cat /Users/test/.ssh/config',
        cwd: '/workspace',
        workspaceRoot: '/workspace',
        timeoutMs: 5_000,
        confirmedSafetyFindingCodes: ['READ_OUTSIDE_WORKSPACE']
      }
    );

    expect(received).toBe(result);
    expect(mocks.run).toHaveBeenCalledOnce();
  });
});
