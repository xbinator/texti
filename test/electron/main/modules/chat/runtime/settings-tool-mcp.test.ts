/**
 * @file settings-tool-mcp.test.ts
 * @description ChatRuntime MCP 设置主进程工具返回值测试。
 */
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { MainToolsDependencies } from '../../../../../../electron/main/modules/chat/runtime/tools/types.mjs';
import type { ActiveChatRuntime } from '../../../../../../electron/main/modules/chat/runtime/types.mjs';
import type { AIToolExecutionResult } from 'types/ai';
import { describe, expect, it, vi } from 'vitest';
import { RUNTIME_SETTINGS_FILE_NAME } from '../../../../../../electron/main/modules/chat/runtime/tools/constants.mjs';
import { createMainToolExecutor } from '../../../../../../electron/main/modules/chat/runtime/tools/index.mjs';

/** 测试工作区根目录 mock。 */
const workspaceRootMock = vi.hoisted(() => ({
  rootPath: ''
}));

vi.mock('../../../../../../electron/main/modules/workspace/root.mjs', () => ({
  ensureTibisWorkspaceRoot: async (): Promise<{ rootPath: string; created: boolean }> => ({
    rootPath: workspaceRootMock.rootPath,
    created: false
  })
}));

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

/**
 * 创建主进程工具测试依赖。
 * @returns 主进程工具依赖
 */
function createDeps(): MainToolsDependencies {
  return {
    now: (): string => '2026-08-05T00:00:00.000Z',
    async requestBridge(): Promise<{ status: 'success'; data: Record<string, unknown> }> {
      return { status: 'success', data: {} };
    },
    async requestConfirmation(): Promise<{ approved: true }> {
      return { approved: true };
    }
  };
}

/**
 * 读取成功工具结果载荷。
 * @param result - 工具执行结果
 * @returns 成功载荷
 */
function readSuccessData(result: AIToolExecutionResult): unknown {
  if (result.status !== 'success') {
    throw new Error(`Expected success result, received ${result.status}`);
  }

  return result.data;
}

describe('get_mcp_settings main tool', (): void => {
  it('redacts editor JSON from returned MCP settings', async (): Promise<void> => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tibis-mcp-settings-tool-'));
    workspaceRootMock.rootPath = tempRoot;

    try {
      await fs.writeFile(
        path.join(tempRoot, RUNTIME_SETTINGS_FILE_NAME),
        JSON.stringify({
          version: 1,
          providers: [],
          mcp: {
            servers: [
              {
                id: 'coffee-server',
                name: 'Coffee Server',
                enabled: true,
                editorJsonText: '{ "mcpServers": { "coffee": { "command": "npx" } } }',
                transport: 'stdio',
                command: 'npx',
                args: ['coffee-server'],
                env: {},
                headers: {},
                toolAllowlist: [],
                connectTimeoutMs: 20_000,
                toolCallTimeoutMs: 30_000
              }
            ]
          }
        }),
        'utf8'
      );

      const executeMainTool = createMainToolExecutor(createDeps());
      const result = await executeMainTool({
        runtime,
        toolCallId: 'tool-call-get-mcp-settings-1',
        toolName: 'get_mcp_settings',
        input: {}
      });

      const data = readSuccessData(result);

      expect(JSON.stringify(data)).not.toContain('editorJsonText');
      expect(JSON.stringify(data)).toContain('coffee-server');
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
      workspaceRootMock.rootPath = '';
    }
  });
});
