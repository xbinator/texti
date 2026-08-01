/**
 * @file builtin-shell-tool.test.ts
 * @description ShellTool 自动默认交互契约与终止结果映射测试。
 */
import type { AIToolExecutionResult } from 'types/ai';
import type { ElectronShellCommandRunResult, ElectronShellCommandTermination } from 'types/electron-api';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBuiltinShellCommandTool } from '@/ai/tools/builtin/ShellTool';
import type { AIToolConfirmationAdapter } from '@/ai/tools/confirmation';

/** 已通过当前 v1 验证的自动交互能力。 */
const ENABLED_CAPABILITY = {
  enabled: true as const,
  reason: null,
  verificationVersion: 'v1',
  platform: 'darwin',
  arch: 'arm64'
};

/** 尚未通过 release gate 的自动交互能力。 */
const DISABLED_CAPABILITY = {
  enabled: false as const,
  reason: 'FEATURE_DISABLED' as const,
  verificationVersion: 'v1',
  platform: 'darwin',
  arch: 'arm64'
};

const mocks = vi.hoisted(() => ({
  analyzeShellCommand: vi.fn(),
  runShellCommand: vi.fn(),
  cancelShellCommand: vi.fn()
}));

vi.mock('@/shared/platform', () => ({
  native: {
    analyzeShellCommand: mocks.analyzeShellCommand,
    runShellCommand: mocks.runShellCommand,
    cancelShellCommand: mocks.cancelShellCommand
  }
}));

/** 无风险的 Shell 安全报告。 */
const SAFE_REPORT = {
  status: 'allowed' as const,
  shell: 'bash' as const,
  findings: [],
  normalizedCommandPreview: 'echo ok',
  cwd: '/workspace'
};

/**
 * 创建指定 termination 的 Shell 运行结果。
 * @param termination - 权威终止语义
 * @returns Shell 运行结果
 */
function createRunResult(termination: ElectronShellCommandTermination): ElectronShellCommandRunResult {
  const exitCode = termination.kind === 'exit' ? termination.exitCode : null;
  const signal = termination.kind === 'signal' ? termination.signal : null;
  return {
    commandId: 'tool-call-1',
    shell: 'bash',
    command: 'echo ok',
    cwd: '/workspace',
    exitCode,
    signal,
    durationMs: 10,
    timedOut: termination.kind === 'tool_timeout',
    truncated: false,
    outputMode: 'pipes',
    stdout: 'ok\n',
    stderr: '',
    termination
  };
}

/**
 * 创建无需确认的 Shell 工具。
 * @returns Shell 工具执行器
 */
function createTool(
  getAutoDefaultCapability: () => typeof ENABLED_CAPABILITY | typeof DISABLED_CAPABILITY = (): typeof ENABLED_CAPABILITY => ENABLED_CAPABILITY,
  confirm: AIToolConfirmationAdapter['confirm'] = vi.fn(async (): Promise<boolean> => true)
): ReturnType<typeof createBuiltinShellCommandTool> {
  return createBuiltinShellCommandTool({
    getWorkspaceRoot: (): string => '/workspace',
    getAutoDefaultCapability,
    confirm: {
      confirm
    }
  });
}

describe('builtin ShellTool interaction contract', (): void => {
  beforeEach((): void => {
    mocks.analyzeShellCommand.mockReset();
    mocks.runShellCommand.mockReset();
    mocks.cancelShellCommand.mockReset();
    mocks.analyzeShellCommand.mockResolvedValue(SAFE_REPORT);
    mocks.cancelShellCommand.mockResolvedValue(true);
    mocks.runShellCommand.mockResolvedValue(createRunResult({ kind: 'exit', exitCode: 0 }));
  });

  it('defaults interactionMode to none and exposes the two model choices', async (): Promise<void> => {
    const tool = createTool();

    await tool.execute({ shell: 'bash', command: 'echo ok', commandId: 'tool-call-1' });

    expect(mocks.runShellCommand).toHaveBeenCalledWith(expect.objectContaining({ interactionMode: 'none' }));
    expect(tool.definition.parameters.properties?.interactionMode).toMatchObject({ enum: ['none', 'auto-default'] });
  });

  it('skips confirmation when safety report has no findings', async (): Promise<void> => {
    const confirm = vi.fn(async (): Promise<boolean> => true);
    const tool = createTool((): typeof ENABLED_CAPABILITY => ENABLED_CAPABILITY, confirm);

    await tool.execute({ shell: 'bash', command: 'echo ok', commandId: 'tool-call-1' });

    expect(confirm).not.toHaveBeenCalled();
    expect(mocks.runShellCommand).toHaveBeenCalledTimes(1);
  });

  it('requests confirmation when safety report has warnings', async (): Promise<void> => {
    const confirm = vi.fn(async (): Promise<boolean> => true);
    const tool = createTool((): typeof ENABLED_CAPABILITY => ENABLED_CAPABILITY, confirm);
    mocks.analyzeShellCommand.mockResolvedValue({
      ...SAFE_REPORT,
      findings: [{ severity: 'warning', code: 'READ_OUTSIDE_WORKSPACE', message: '命令可能读取工作区外路径: /home/user' }]
    });

    await tool.execute({ shell: 'bash', command: 'find /home/user -name widget.json', commandId: 'tool-call-1', toolCallId: 'tool-call-1' });

    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ toolCallId: 'tool-call-1', toolName: 'run_shell_command', riskLevel: 'dangerous' }));
    expect(mocks.runShellCommand).toHaveBeenCalledWith(expect.objectContaining({ confirmedSafetyFindingCodes: ['READ_OUTSIDE_WORKSPACE'] }));
    expect(mocks.runShellCommand).toHaveBeenCalledTimes(1);
  });

  it('returns a continuable failure when warning confirmation is denied', async (): Promise<void> => {
    const confirm = vi.fn(async (): Promise<{ approved: false }> => ({ approved: false }));
    const tool = createTool((): typeof ENABLED_CAPABILITY => ENABLED_CAPABILITY, confirm);
    mocks.analyzeShellCommand.mockResolvedValue({
      ...SAFE_REPORT,
      findings: [{ severity: 'warning', code: 'READ_OUTSIDE_WORKSPACE', message: '命令可能读取工作区外路径: /home/user' }]
    });

    const result = await tool.execute({ shell: 'bash', command: 'find /home/user -name widget.json', commandId: 'tool-call-1' });

    expect(result).toMatchObject({ status: 'failure', error: { code: 'USER_CANCELLED' } });
    expect(mocks.runShellCommand).not.toHaveBeenCalled();
  });

  it('forwards auto-default and rejects unsupported interaction modes', async (): Promise<void> => {
    const tool = createTool();

    await tool.execute({ shell: 'bash', command: 'echo ok', commandId: 'tool-call-1', interactionMode: 'auto-default' });
    const invalid = await tool.execute({ shell: 'bash', command: 'echo ok', interactionMode: 'custom-answer' });

    expect(mocks.runShellCommand).toHaveBeenCalledWith(expect.objectContaining({ interactionMode: 'auto-default' }));
    expect(invalid).toMatchObject({ status: 'failure', error: { code: 'INVALID_INPUT' } });
  });

  it('hides auto-default and rejects stale-schema requests when the capability gate is disabled', async (): Promise<void> => {
    const tool = createTool((): typeof DISABLED_CAPABILITY => DISABLED_CAPABILITY);

    const result = await tool.execute({ shell: 'bash', command: 'echo ok', commandId: 'tool-call-1', interactionMode: 'auto-default' });

    expect(tool.definition.parameters.properties?.interactionMode).toBeUndefined();
    expect(result).toMatchObject({ status: 'failure', error: { code: 'ACTION_NOT_SUPPORTED' } });
    expect(mocks.runShellCommand).not.toHaveBeenCalled();
  });

  it('rechecks the capability at execution time after an enabled schema was cached', async (): Promise<void> => {
    let capability: typeof ENABLED_CAPABILITY | typeof DISABLED_CAPABILITY = ENABLED_CAPABILITY;
    const tool = createTool((): typeof ENABLED_CAPABILITY | typeof DISABLED_CAPABILITY => capability);
    capability = DISABLED_CAPABILITY;

    const result = await tool.execute({ shell: 'bash', command: 'echo ok', commandId: 'tool-call-1', interactionMode: 'auto-default' });

    expect(tool.definition.parameters.properties?.interactionMode).toMatchObject({ enum: ['none', 'auto-default'] });
    expect(result).toMatchObject({ status: 'failure', error: { code: 'ACTION_NOT_SUPPORTED' } });
    expect(mocks.runShellCommand).not.toHaveBeenCalled();
  });

  it('fails closed when capability discovery throws', async (): Promise<void> => {
    const tool = createTool((): never => {
      throw new Error('Electron API unavailable');
    });

    const result = await tool.execute({ shell: 'bash', command: 'echo ok', interactionMode: 'auto-default' });

    expect(tool.definition.parameters.properties?.interactionMode).toBeUndefined();
    expect(result).toMatchObject({ status: 'failure', error: { code: 'ACTION_NOT_SUPPORTED' } });
    expect(mocks.runShellCommand).not.toHaveBeenCalled();
  });

  it.each<{
    termination: ElectronShellCommandTermination;
    expected: Pick<AIToolExecutionResult, 'status'> & { code?: string };
  }>([
    { termination: { kind: 'exit', exitCode: 0 }, expected: { status: 'success' } },
    { termination: { kind: 'exit', exitCode: 1 }, expected: { status: 'success' } },
    { termination: { kind: 'signal', signal: 'SIGTERM' }, expected: { status: 'success' } },
    { termination: { kind: 'cancelled' }, expected: { status: 'cancelled' } },
    { termination: { kind: 'tool_timeout' }, expected: { status: 'failure', code: 'TOOL_TIMEOUT' } },
    { termination: { kind: 'interaction_timeout' }, expected: { status: 'failure', code: 'INTERACTION_TIMEOUT' } },
    { termination: { kind: 'answer_limit' }, expected: { status: 'failure', code: 'INTERACTION_LIMIT_EXCEEDED' } },
    { termination: { kind: 'unsupported_prompt', reason: 'secret' }, expected: { status: 'failure', code: 'UNSUPPORTED_INTERACTION' } },
    { termination: { kind: 'process_cleanup_failed', message: 'descendant remained alive' }, expected: { status: 'failure', code: 'PROCESS_CLEANUP_FAILED' } },
    { termination: { kind: 'spawn_error', message: 'PTY unavailable' }, expected: { status: 'failure', code: 'EXECUTION_FAILED' } }
  ])('maps $termination.kind to the expected tool result', async ({ termination, expected }): Promise<void> => {
    mocks.runShellCommand.mockResolvedValue(createRunResult(termination));
    const result = await createTool().execute({ shell: 'bash', command: 'echo ok', commandId: 'tool-call-1' });

    expect(result.status).toBe(expected.status);
    if (expected.code) {
      expect(result).toMatchObject({ error: { code: expected.code } });
      expect(result).toMatchObject({ error: { details: { termination, durationMs: 10 } } });
    }
  });
});
