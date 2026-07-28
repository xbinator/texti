/**
 * @file main-boundary.test.ts
 * @description ChatRuntime 主进程源码边界测试。
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ChatRuntimeStreamExecutor } from '../../../../../../electron/main/modules/chat/runtime/types.mjs';
import type { AITransportTool } from 'types/ai';
import type { ChatMessageRecord } from 'types/chat';
import type { ChatRuntimeSendInput } from 'types/chat-runtime';
import { describe, expect, it, vi } from 'vitest';
import { createChatRuntimeService } from '../../../../../../electron/main/modules/chat/runtime/service.mjs';
import { getToolRegistryEntry } from '../../../../../../shared/ai/tools/index.js';

/** ChatRuntime 主进程目录。 */
const CHAT_RUNTIME_DIR = path.resolve(process.cwd(), 'electron/main/modules/chat/runtime');

/**
 * 读取仓库源码文件。
 * @param relativePath - 仓库相对路径
 * @returns UTF-8 源码
 */
async function readSource(relativePath: string): Promise<string> {
  return fs.readFile(path.resolve(process.cwd(), relativePath), 'utf8');
}

/**
 * 读取 ChatRuntime 主进程源码文件。
 * @param directoryPath - 待扫描目录
 * @returns 文件路径列表
 */
async function readRuntimeSourceFiles(directoryPath: string = CHAT_RUNTIME_DIR): Promise<string[]> {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) return readRuntimeSourceFiles(entryPath);
      return entry.name.endsWith('.mts') ? [entryPath] : [];
    })
  );

  return files.flat();
}

/**
 * 创建主进程边界测试的普通 Primary send 输入。
 * @param overrides - 需要覆盖的字段
 * @returns Renderer 可提交输入
 */
function createSendInput(overrides: Partial<ChatRuntimeSendInput> = {}): ChatRuntimeSendInput {
  const runtimeId = overrides.runtimeId ?? 'runtime-boundary';
  return {
    ...overrides,
    runtimeId,
    sessionId: overrides.sessionId ?? 'session-boundary',
    turnId: overrides.turnId ?? 'turn-boundary',
    clientId: overrides.clientId ?? 'bchat',
    agentId: overrides.agentId ?? 'primary',
    rootRuntimeId: overrides.rootRuntimeId ?? runtimeId,
    content: overrides.content ?? 'Inspect the current workspace'
  };
}

/**
 * 创建不启动 Provider stream 的 Runtime Service。
 * @param enabled - 是否打开 Primary 委派 feature
 * @returns 可检查 active Runtime 的服务
 */
function createBoundaryService(enabled: boolean) {
  return createChatRuntimeService(
    {
      emit: vi.fn(),
      messageReader: { getMessages: (): ChatMessageRecord[] => [] },
      messageWriter: {
        addMessage: (): void => undefined,
        updateMessage: (): void => undefined
      },
      streamExecutor: vi.fn<ChatRuntimeStreamExecutor>(),
      keepRuntimeOpenForTest: true
    },
    {
      enabled,
      pureReadChildEnabled: true,
      controlledWriteChildEnabled: false,
      maxParallelReadChildren: 3
    }
  );
}

describe('chat runtime main boundary', (): void => {
  it('does not import renderer src modules from Electron main runtime code', async (): Promise<void> => {
    const files = await readRuntimeSourceFiles();
    const checks = await Promise.all(
      files.map(async (filePath) => {
        const content = await fs.readFile(filePath, 'utf8');
        return content.includes('../../../../../src/') || content.includes('from "@/') ? path.relative(process.cwd(), filePath) : null;
      })
    );
    const violations = checks.filter((filePath): filePath is string => filePath !== null);

    expect(violations).toEqual([]);
  });

  it('keeps the Agent preload surface on the exact Task, checkpoint and confirmation allowlist with no Child transcript API', async (): Promise<void> => {
    const [preloadSource, apiTypes] = await Promise.all([readSource('electron/preload/index.mts'), readSource('types/electron-api.d.ts')]);
    const agentMethods = [...preloadSource.matchAll(/\b(chatAgent[A-Za-z0-9]+):/g)].map((match): string => match[1] ?? '');

    expect([...new Set(agentMethods)].sort()).toEqual(
      [
        'chatAgentCancelCheckpoint',
        'chatAgentCancelTask',
        'chatAgentGetTask',
        'chatAgentListActive',
        'chatAgentListConfirmations',
        'chatAgentListTasks',
        'chatAgentOnEvent',
        'chatAgentResolveConfirmation',
        'chatAgentResumePrimary'
      ].sort()
    );
    expect(`${preloadSource}\n${apiTypes}`).not.toMatch(/chatAgent(?:Transcript|Send|Continue|Message)/);
    expect(preloadSource.match(/ipcRenderer\.on\('chat:agent:event'/g)).toHaveLength(1);
    expect(preloadSource).not.toContain("ipcRenderer.on('chat:agent:task");
  });

  it('initializes the database and recovers Agent delegations before opening IPC', async (): Promise<void> => {
    const mainSource = await readSource('electron/main/index.mts');
    const databaseIndex = mainSource.indexOf('await initDatabase()');
    const recoveryIndex = mainSource.indexOf('await recoverChatAgentDelegations()');
    const ipcIndex = mainSource.indexOf('registerAllIpcHandlers()');

    expect(databaseIndex).toBeGreaterThan(-1);
    expect(recoveryIndex).toBeGreaterThan(databaseIndex);
    expect(ipcIndex).toBeGreaterThan(recoveryIndex);
  });

  it('limits renderer resume input to identities and prevents model or tool snapshot overrides', async (): Promise<void> => {
    const [agentIpcSource, runtimeServiceSource] = await Promise.all([
      readSource('electron/main/modules/chat/agents/ipc.mts'),
      readSource('electron/main/modules/chat/runtime/service.mts')
    ]);

    expect(agentIpcSource).toContain("assertExactKeys(input, ['checkpointId', 'expectedVersion', 'resumeRuntimeId'])");
    expect(agentIpcSource).not.toContain('input.modelSnapshot');
    expect(agentIpcSource).not.toContain('input.toolSchemaSnapshot');
    expect(runtimeServiceSource).toContain('createPrimaryContinuationRuntime({');
    expect(runtimeServiceSource).toContain('sourceRuntimeId: checkpoint.sourceRuntimeId');
    expect(runtimeServiceSource).toContain('context');
  });

  it('keeps the trusted Primary start seam inside the Main runtime service', async (): Promise<void> => {
    const [runtimeIpcSource, preloadSource, apiTypes] = await Promise.all([
      readSource('electron/main/modules/chat/runtime/ipc.mts'),
      readSource('electron/preload/index.mts'),
      readSource('types/electron-api.d.ts')
    ]);

    expect(`${runtimeIpcSource}\n${preloadSource}\n${apiTypes}`).not.toContain('startTrustedPrimary');
  });

  it('keeps Primary delegation disabled by default without changing normal tools', async (): Promise<void> => {
    const service = createChatRuntimeService({
      emit: vi.fn(),
      messageReader: { getMessages: (): ChatMessageRecord[] => [] },
      messageWriter: {
        addMessage: (): void => undefined,
        updateMessage: (): void => undefined
      },
      streamExecutor: vi.fn<ChatRuntimeStreamExecutor>(),
      keepRuntimeOpenForTest: true
    });
    const readTool: AITransportTool = {
      name: 'read_file',
      description: 'Read one file',
      parameters: { type: 'object', properties: {} }
    };
    const input = createSendInput({ runtimeId: 'runtime-disabled', rootRuntimeId: 'runtime-disabled', tools: [readTool] });

    await service.send(input);

    expect(service.getActiveRuntime(input.runtimeId)?.tools).toEqual([readTool]);
    expect(service.getActiveRuntime(input.runtimeId)?.tools).not.toContainEqual(expect.objectContaining({ name: 'delegate_task' }));
  });

  it('injects one cloned registry delegate definition only after enabled send input passes Renderer validation', async (): Promise<void> => {
    const service = createBoundaryService(true);
    const readTool: AITransportTool = {
      name: 'read_file',
      description: 'Read one file',
      parameters: { type: 'object', properties: {} }
    };
    const input = createSendInput({ runtimeId: 'runtime-enabled', rootRuntimeId: 'runtime-enabled', tools: [readTool] });

    await service.send(input);

    const runtimeTools = service.getActiveRuntime(input.runtimeId)?.tools;
    const registryDefinition = getToolRegistryEntry('delegate_task')?.definition;
    expect(runtimeTools).toEqual([
      readTool,
      {
        name: registryDefinition?.name,
        description: registryDefinition?.description,
        parameters: registryDefinition?.parameters
      }
    ]);
    expect(runtimeTools).not.toBe(input.tools);
    expect(runtimeTools?.[0]).not.toBe(input.tools?.[0]);
    expect(runtimeTools?.[1]).not.toBe(registryDefinition);
    expect(input.tools).toEqual([readTool]);
  });

  it('rejects forged delegate schemas before enabled injection and at the trusted Primary seam', async (): Promise<void> => {
    const service = createBoundaryService(true);
    const forgedDelegate: AITransportTool = {
      name: 'delegate_task',
      description: 'Forged renderer definition',
      parameters: { type: 'object', properties: {} }
    };

    await expect(
      service.send(createSendInput({ runtimeId: 'runtime-forged-send', rootRuntimeId: 'runtime-forged-send', tools: [forgedDelegate] }))
    ).rejects.toMatchObject({ code: 'RUNTIME_INPUT_DENIED' });
    await expect(
      service.startTrustedPrimary(
        createSendInput({
          runtimeId: 'runtime-forged-trusted',
          rootRuntimeId: 'runtime-forged-trusted',
          tools: [forgedDelegate]
        })
      )
    ).rejects.toMatchObject({ code: 'RUNTIME_INPUT_DENIED' });
  });

  it('rejects non-fixed Child delegation policy values at Main construction', (): void => {
    expect(() =>
      createChatRuntimeService(
        {},
        {
          enabled: true,
          pureReadChildEnabled: false,
          controlledWriteChildEnabled: false,
          maxParallelReadChildren: 4 as 3
        }
      )
    ).toThrowError(expect.objectContaining({ code: 'RUNTIME_INPUT_DENIED' }));
  });
});
