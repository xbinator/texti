/**
 * @file settings-tool.test.ts
 * @description ChatRuntime 主进程设置工具的动态主题预设测试。
 */
import type { MainToolBridgeRequest, MainToolsDependencies } from '../../../../../../electron/main/modules/chat/runtime/tools/types.mjs';
import type { ActiveChatRuntime, ChatRuntimeMainToolExecutionInput } from '../../../../../../electron/main/modules/chat/runtime/types.mjs';
import type { AIToolExecutionResult } from 'types/ai';
import type { ChatRuntimeBridgeResult, ChatRuntimeConfirmationDecision } from 'types/chat-runtime';
import { describe, expect, it, vi } from 'vitest';
import { executeSettingsTool } from '../../../../../../electron/main/modules/chat/runtime/tools/SettingsTool/index.mjs';

/** 测试 runtime 状态。 */
const runtime: ActiveChatRuntime = {
  runtimeId: 'runtime-1',
  sessionId: 'session-1',
  turnId: 'turn-1',
  clientId: 'client-1',
  agentId: 'primary',
  rootRuntimeId: 'runtime-1',
  status: 'running',
  phase: 'streaming',
  abortController: new AbortController(),
  createdAt: 0
};

/** 测试主题预设选项。 */
const themePresetOptions = [
  { id: 'default', label: '默认「Graphite」', description: '白/浅灰/黑灰' },
  { id: 'custom-solarized', label: 'Solarized', description: 'Solarized custom palette' }
];

/**
 * 设置工具测试依赖。
 */
interface SettingsTestDependencies {
  /** 主进程工具依赖。 */
  deps: MainToolsDependencies;
  /** renderer bridge mock。 */
  requestBridge: MainToolsDependencies['requestBridge'];
  /** 用户确认 mock。 */
  requestConfirmation: MainToolsDependencies['requestConfirmation'];
}

/**
 * 创建设置工具执行输入。
 * @param toolName - 工具名称
 * @param input - 工具参数
 * @returns 主进程工具输入
 */
function createInput(toolName: string, input: unknown): ChatRuntimeMainToolExecutionInput {
  return {
    runtime,
    toolCallId: `tool-call-${toolName}`,
    toolName,
    input
  };
}

/**
 * 创建带动态主题列表的测试依赖。
 * @param options - renderer 返回的主题预设选项
 * @returns 设置工具依赖和 mock
 */
function createDeps(options: unknown = themePresetOptions): SettingsTestDependencies {
  const requestBridge = vi.fn(async (input: MainToolBridgeRequest): Promise<ChatRuntimeBridgeResult> => {
    if (input.kind === 'apply-setting') {
      return {
        status: 'success',
        data: {
          applied: true,
          key: 'themePreset',
          previousValue: 'default',
          currentValue: 'custom-solarized'
        }
      };
    }

    return {
      status: 'success',
      data: {
        settings: { theme: 'dark', themePreset: 'custom-solarized' },
        themePresetOptions: options
      }
    };
  });
  const requestConfirmation = vi.fn(async (): Promise<ChatRuntimeConfirmationDecision> => ({ approved: true }));

  return {
    deps: {
      now: (): string => '2026-08-10T00:00:00.000Z',
      requestBridge,
      requestConfirmation
    },
    requestBridge,
    requestConfirmation
  };
}

/**
 * 读取成功工具结果数据。
 * @param result - 工具执行结果
 * @returns 成功结果数据
 */
function readSuccessData(result: AIToolExecutionResult): unknown {
  if (result.status !== 'success') {
    throw new Error(`Expected success result, received ${result.status}`);
  }

  return result.data;
}

describe('settings main tool', (): void => {
  it('returns live theme options when themePreset is requested', async (): Promise<void> => {
    const { deps } = createDeps();

    const result = await executeSettingsTool(createInput('get_settings', { keys: ['themePreset'] }), deps);

    expect(readSuccessData(result)).toEqual({
      settings: { themePreset: 'custom-solarized' },
      themePresetOptions
    });
  });

  it('returns live theme options when all settings are requested', async (): Promise<void> => {
    const { deps } = createDeps();

    const result = await executeSettingsTool(createInput('get_settings', {}), deps);

    expect(readSuccessData(result)).toMatchObject({ themePresetOptions });
  });

  it('omits theme options when themePreset is not requested', async (): Promise<void> => {
    const { deps } = createDeps();

    const result = await executeSettingsTool(createInput('get_settings', { keys: ['theme'] }), deps);

    expect(readSuccessData(result)).toEqual({ settings: { theme: 'dark' } });
  });

  it('accepts a custom theme listed by the renderer registry', async (): Promise<void> => {
    const { deps, requestBridge, requestConfirmation } = createDeps();

    const result = await executeSettingsTool(createInput('update_settings', { key: 'themePreset', value: 'custom-solarized' }), deps);

    expect(result.status).toBe('success');
    expect(requestConfirmation).toHaveBeenCalledOnce();
    expect(requestBridge).toHaveBeenCalledWith(expect.objectContaining({ kind: 'apply-setting' }));
  });

  it('rejects an unknown theme before requesting confirmation', async (): Promise<void> => {
    const { deps, requestConfirmation } = createDeps();

    const result = await executeSettingsTool(createInput('update_settings', { key: 'themePreset', value: 'missing-theme' }), deps);

    expect(result).toMatchObject({
      status: 'failure',
      error: { code: 'INVALID_INPUT' }
    });
    expect(requestConfirmation).not.toHaveBeenCalled();
  });

  it('rejects theme options without a description', async (): Promise<void> => {
    const { deps } = createDeps([{ id: 'default', label: '默认「Graphite」' }]);

    const result = await executeSettingsTool(createInput('get_settings', { keys: ['themePreset'] }), deps);

    expect(result).toMatchObject({
      status: 'failure',
      error: { code: 'INVALID_INPUT' }
    });
  });
});
