/**
 * @file skill.test.ts
 * @description Skill Store 磁盘同步与最新资源解析测试。
 * @vitest-environment jsdom
 */
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { parseSkillMarkdown } from '@/ai/skill/parser';
import type { SkillScannerAPI } from '@/ai/skill/scanner';
import { RESOURCE_OPERATION_CACHE_LIMIT, useSkillStore } from '@/stores/ai/skill';

/** Skill 测试文件路径。 */
const SKILL_FILE_PATH = '/Users/test/.agents/skills/weather/SKILL.md';

/**
 * Skill 扫描器测试 API。
 */
interface SkillScannerAPIMock extends SkillScannerAPI {
  /** 读取文件 mock */
  readFile: Mock<SkillScannerAPI['readFile']>;
  /** 读取目录 mock */
  readWorkspaceDirectory: Mock<SkillScannerAPI['readWorkspaceDirectory']>;
}

/**
 * 可由测试控制完成时机的 Promise。
 */
interface Deferred<T> {
  /** 延迟 Promise */
  promise: Promise<T>;
  /** 完成 Promise */
  resolve: (value: T) => void;
}

/**
 * 创建可控 Promise。
 * @returns 可控 Promise
 */
function createDeferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = (): void => undefined;
  const promise = new Promise<T>((resolve: (value: T) => void): void => {
    resolvePromise = resolve;
  });

  return { promise, resolve: resolvePromise };
}

/**
 * 创建 Skill Markdown。
 * @param body - Skill 指令正文
 * @param name - Skill 名称
 * @returns 完整 Skill Markdown
 */
function createSkillMarkdown(body: string, name = 'weather'): string {
  return ['---', `name: ${name}`, 'description: Weather instructions', '---', body].join('\n');
}

/**
 * 创建 Skill Store 测试 API。
 * @param content - 初始文件内容
 * @returns 扫描器测试 API
 */
function createScannerAPI(content: string): SkillScannerAPIMock {
  return {
    readFile: vi.fn<SkillScannerAPI['readFile']>().mockResolvedValue({ content }),
    readWorkspaceDirectory: vi.fn<SkillScannerAPI['readWorkspaceDirectory']>().mockResolvedValue({
      entries: [{ name: 'weather', type: 'directory' }]
    })
  };
}

describe('skill store disk freshness', (): void => {
  beforeEach((): void => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  it('synchronizes external disk changes while preserving disabled state', async (): Promise<void> => {
    const api = createScannerAPI(createSkillMarkdown('old instructions'));
    const store = useSkillStore();
    await store.initialize('/Users/test', api);
    store.toggleSkill('weather');
    api.readFile.mockResolvedValue({ content: createSkillMarkdown('new instructions') });

    await store.syncFromDisk();

    expect(store.getSkillByName('weather')?.content).toBe('new instructions');
    expect(store.getSkillByName('weather')?.enabled).toBe(false);
  });

  it('only synchronizes dirty Skill resources for chat preflight', async (): Promise<void> => {
    const api = createScannerAPI(createSkillMarkdown('old instructions'));
    const store = useSkillStore();
    await store.initialize('/Users/test', api);
    api.readFile.mockClear();
    api.readFile.mockResolvedValue({ content: createSkillMarkdown('new instructions') });

    await store.syncDirtyFromDisk();
    expect(api.readFile).not.toHaveBeenCalled();

    store.markDirty();
    await store.syncDirtyFromDisk();

    expect(api.readFile).toHaveBeenCalledTimes(1);
    expect(store.getSkillByName('weather')?.content).toBe('new instructions');
  });

  it('resolves the latest enabled Skill directly from disk', async (): Promise<void> => {
    const api = createScannerAPI(createSkillMarkdown('old instructions'));
    const store = useSkillStore();
    await store.initialize('/Users/test', api);
    api.readFile.mockResolvedValue({ content: createSkillMarkdown('execution-time instructions') });

    const skill = await store.resolveLatestEnabledSkill('weather');

    expect(skill?.content).toBe('execution-time instructions');
    expect(store.getSkillByName('weather')?.content).toBe('execution-time instructions');
  });

  it('resolves the latest disabled Skill for an explicit reference', async (): Promise<void> => {
    const api = createScannerAPI(createSkillMarkdown('old instructions'));
    const store = useSkillStore();
    await store.initialize('/Users/test', api);
    store.toggleSkill('weather');
    api.readFile.mockResolvedValue({ content: createSkillMarkdown('explicit instructions') });

    const skill = await store.resolveLatestSkill('weather');

    expect(skill?.content).toBe('explicit instructions');
    expect(skill?.enabled).toBe(false);
  });

  it('does not let a slow execution read overwrite a newer watcher result', async (): Promise<void> => {
    const api = createScannerAPI(createSkillMarkdown('initial instructions'));
    const store = useSkillStore();
    await store.initialize('/Users/test', api);
    const staleRead = createDeferred<{ content: string }>();
    api.readFile.mockImplementationOnce((): Promise<{ content: string }> => staleRead.promise);

    const resolving = store.resolveLatestEnabledSkill('weather');
    await vi.waitFor((): void => {
      expect(api.readFile).toHaveBeenCalledTimes(2);
    });
    store.handleSkillChange('change', parseSkillMarkdown(createSkillMarkdown('watcher instructions'), SKILL_FILE_PATH, { source: 'global' }));
    staleRead.resolve({ content: createSkillMarkdown('stale execution instructions') });

    expect((await resolving)?.content).toBe('watcher instructions');
    expect(store.getSkillByName('weather')?.content).toBe('watcher instructions');
  });

  it('merges unrelated scan results when a watcher changes one Skill during the scan', async (): Promise<void> => {
    const api = createScannerAPI(createSkillMarkdown('initial instructions'));
    const store = useSkillStore();
    await store.initialize('/Users/test', api);
    const staleWeatherRead = createDeferred<{ content: string }>();
    api.readWorkspaceDirectory.mockResolvedValue({
      entries: [
        { name: 'weather', type: 'directory' },
        { name: 'travel', type: 'directory' }
      ]
    });
    api.readFile.mockImplementation((filePath: string): Promise<{ content: string }> => {
      if (filePath.includes('/weather/')) {
        return staleWeatherRead.promise;
      }

      return Promise.resolve({ content: createSkillMarkdown('travel instructions', 'travel') });
    });

    const syncing = store.syncFromDisk();
    await vi.waitFor((): void => {
      expect(api.readFile).toHaveBeenCalledTimes(3);
    });
    store.handleSkillChange('change', parseSkillMarkdown(createSkillMarkdown('watcher instructions'), SKILL_FILE_PATH, { source: 'global' }));
    staleWeatherRead.resolve({ content: createSkillMarkdown('stale scan instructions') });
    await syncing;

    expect(store.getSkillByName('weather')?.content).toBe('watcher instructions');
    expect(store.getSkillByName('travel')?.content).toBe('travel instructions');
    expect(store.initialized).toBe(true);
  });

  it('keeps the latest parse error visible after a full disk sync', async (): Promise<void> => {
    const api = createScannerAPI(createSkillMarkdown('initial instructions'));
    const store = useSkillStore();
    await store.initialize('/Users/test', api);
    api.readFile.mockResolvedValue({ content: 'invalid skill markdown' });

    await store.syncFromDisk();

    expect(store.getSkillByName('weather')?.parseError).toContain('Missing YAML frontmatter');
  });

  it('waits for initialization after the layout declares it pending', async (): Promise<void> => {
    const api = createScannerAPI(createSkillMarkdown('instructions'));
    const store = useSkillStore();
    store.beforeInitialize();
    let completed = false;
    const waiting = store.waitForInit().then((): void => {
      completed = true;
    });
    await Promise.resolve();

    expect(completed).toBe(false);
    await store.initialize('/Users/test', api);
    await waiting;
    expect(completed).toBe(true);
  });

  it('preserves a disabled preference when a Skill is removed and added again', async (): Promise<void> => {
    const api = createScannerAPI(createSkillMarkdown('instructions'));
    const store = useSkillStore();
    await store.initialize('/Users/test', api);
    store.toggleSkill('weather');
    api.readWorkspaceDirectory.mockResolvedValue({ entries: [] });
    await store.syncFromDisk();
    api.readWorkspaceDirectory.mockResolvedValue({ entries: [{ name: 'weather', type: 'directory' }] });

    await store.syncFromDisk();

    expect(store.getSkillByName('weather')?.enabled).toBe(false);
  });

  it('bounds retained per-path operation tombstones', (): void => {
    const store = useSkillStore();

    for (let index = 0; index <= RESOURCE_OPERATION_CACHE_LIMIT; index += 1) {
      const filePath = `/home/user/.agents/skills/skill-${index}/SKILL.md`;
      const skill = parseSkillMarkdown(createSkillMarkdown(`instructions-${index}`, `skill-${index}`), filePath, { source: 'global' });
      store.handleSkillChange('unlink', skill);
    }

    expect(store.getResourceOperationCount()).toBe(RESOURCE_OPERATION_CACHE_LIMIT);
  });
});
