/**
 * @file main-boundary.test.ts
 * @description ChatRuntime 主进程源码边界测试。
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

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

  it('keeps the Agent preload surface on the exact checkpoint lifecycle allowlist with no Child transcript API', async (): Promise<void> => {
    const [preloadSource, apiTypes] = await Promise.all([readSource('electron/preload/index.mts'), readSource('types/electron-api.d.ts')]);
    const agentMethods = [...preloadSource.matchAll(/\b(chatAgent[A-Za-z0-9]+):/g)].map((match): string => match[1] ?? '');

    expect([...new Set(agentMethods)].sort()).toEqual(
      ['chatAgentCancelCheckpoint', 'chatAgentListActive', 'chatAgentOnEvent', 'chatAgentResumePrimary'].sort()
    );
    expect(`${preloadSource}\n${apiTypes}`).not.toMatch(/chatAgent(?:Transcript|Send|Continue|Message)/);
  });

  it('initializes the database and interrupts unrecoverable checkpoints before opening IPC', async (): Promise<void> => {
    const mainSource = await readSource('electron/main/index.mts');
    const databaseIndex = mainSource.indexOf('await initDatabase()');
    const interruptIndex = mainSource.indexOf('chatAgentDelegationService.interruptUnrecoverableCheckpoints()');
    const ipcIndex = mainSource.indexOf('registerAllIpcHandlers()');

    expect(databaseIndex).toBeGreaterThan(-1);
    expect(interruptIndex).toBeGreaterThan(databaseIndex);
    expect(ipcIndex).toBeGreaterThan(interruptIndex);
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
});
