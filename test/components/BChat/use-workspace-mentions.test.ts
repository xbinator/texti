/**
 * @file use-workspace-mentions.test.ts
 * @description 验证手动会话工作区的聊天文件提及候选扫描。
 */
import { nextTick, ref } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearWorkspaceMentionCache, useWorkspaceMentions } from '@/components/BChat/hooks/useWorkspaceMentions';
import type { Native, ReadWorkspaceDirectoryEntry, ReadWorkspaceDirectoryResult, ReadWorkspaceFileResult } from '@/shared/platform/native/types';

/** 原生工作区目录读取能力测试替身。 */
const mocks = vi.hoisted(() => ({
  /** 读取工作区目录。 */
  readWorkspaceDirectory: vi.fn<Native['readWorkspaceDirectory']>(),
  /** 读取工作区文件。 */
  readWorkspaceFile: vi.fn<Native['readWorkspaceFile']>()
}));

vi.mock('@/shared/platform', () => ({
  native: {
    readWorkspaceDirectory: mocks.readWorkspaceDirectory,
    readWorkspaceFile: mocks.readWorkspaceFile
  }
}));

/**
 * 创建目录读取结果。
 * @param directoryPath - 当前目录绝对路径
 * @param entries - 目录子项
 * @returns 目录读取结果
 */
function createDirectoryResult(directoryPath: string, entries: ReadWorkspaceDirectoryEntry[]): ReadWorkspaceDirectoryResult {
  return {
    path: directoryPath,
    entries
  };
}

/**
 * 创建文件子项。
 * @param name - 文件名
 * @param filePath - 文件绝对路径
 * @returns 文件子项
 */
function createFileEntry(name: string, filePath: string): ReadWorkspaceDirectoryEntry {
  return {
    name,
    path: filePath,
    type: 'file'
  };
}

/**
 * 创建目录子项。
 * @param name - 目录名
 * @param directoryPath - 目录绝对路径
 * @returns 目录子项
 */
function createDirectoryEntry(name: string, directoryPath: string): ReadWorkspaceDirectoryEntry {
  return {
    name,
    path: directoryPath,
    type: 'directory'
  };
}

/**
 * 等待异步扫描和 Vue 响应式更新完成。
 * @returns 等待 Promise
 */
async function flushWorkspaceScan(): Promise<void> {
  await nextTick();
  await Promise.resolve();
  await Promise.resolve();
  await nextTick();
}

describe('useWorkspaceMentions', (): void => {
  beforeEach((): void => {
    clearWorkspaceMentionCache();
    mocks.readWorkspaceDirectory.mockReset();
    mocks.readWorkspaceFile.mockReset();
    mocks.readWorkspaceFile.mockRejectedValue(new Error('file not found'));
  });

  it('recursively collects workspace files as POSIX relative candidates and skips excluded directories', async (): Promise<void> => {
    mocks.readWorkspaceDirectory.mockImplementation(async (options): Promise<ReadWorkspaceDirectoryResult> => {
      if (options.directoryPath === '.') {
        return createDirectoryResult('/workspace', [
          createDirectoryEntry('src', '/workspace/src'),
          createDirectoryEntry('.git', '/workspace/.git'),
          createFileEntry('README.md', '/workspace/README.md')
        ]);
      }

      if (options.directoryPath === 'src') {
        return createDirectoryResult('/workspace/src', [
          createFileEntry('App.vue', '/workspace/src/App.vue'),
          createDirectoryEntry('node_modules', '/workspace/src/node_modules'),
          createFileEntry('main.ts', '/workspace/src/main.ts')
        ]);
      }

      throw new Error(`Unexpected directory: ${options.directoryPath}`);
    });

    const scanner = useWorkspaceMentions({
      workspaceRoot: ref('/workspace'),
      enabled: ref(true)
    });
    await scanner.refresh();

    expect(scanner.fileMentions.value.map((file) => file.path).sort()).toEqual(['README.md', 'src/App.vue', 'src/main.ts']);
    expect(scanner.fileMentions.value.find((file) => file.path === 'src/App.vue')).toEqual({
      id: 'src/App.vue',
      name: 'App.vue',
      path: 'src/App.vue',
      ext: 'vue'
    });
    expect(mocks.readWorkspaceDirectory).toHaveBeenCalledWith({ directoryPath: '.', workspaceRoot: '/workspace' });
    expect(mocks.readWorkspaceDirectory).toHaveBeenCalledWith({ directoryPath: 'src', workspaceRoot: '/workspace' });
    expect(mocks.readWorkspaceDirectory).not.toHaveBeenCalledWith({ directoryPath: '.git', workspaceRoot: '/workspace' });
    expect(mocks.readWorkspaceDirectory).not.toHaveBeenCalledWith({ directoryPath: 'src/node_modules', workspaceRoot: '/workspace' });
  });

  it('respects gitignore rules including negated file patterns', async (): Promise<void> => {
    mocks.readWorkspaceFile.mockImplementation(async (options): Promise<ReadWorkspaceFileResult> => {
      if (options.filePath === '.gitignore') {
        return {
          path: '/workspace/.gitignore',
          content: 'dist/\n*.log\n!important.log\n',
          totalLines: 3,
          readLines: 3,
          hasMore: false,
          nextOffset: null
        };
      }

      throw new Error(`Unexpected file: ${options.filePath}`);
    });
    mocks.readWorkspaceDirectory.mockImplementation(async (options): Promise<ReadWorkspaceDirectoryResult> => {
      if (options.directoryPath === '.') {
        return createDirectoryResult('/workspace', [
          createFileEntry('.gitignore', '/workspace/.gitignore'),
          createDirectoryEntry('dist', '/workspace/dist'),
          createFileEntry('debug.log', '/workspace/debug.log'),
          createFileEntry('important.log', '/workspace/important.log'),
          createFileEntry('README.md', '/workspace/README.md')
        ]);
      }

      throw new Error(`Unexpected directory: ${options.directoryPath}`);
    });

    const scanner = useWorkspaceMentions({
      workspaceRoot: ref('/workspace'),
      enabled: ref(true)
    });
    await scanner.refresh();

    expect(scanner.fileMentions.value.map((file) => file.path).sort()).toEqual(['README.md', 'important.log']);
    expect(mocks.readWorkspaceFile).toHaveBeenCalledWith({ filePath: '.gitignore', workspaceRoot: '/workspace', limit: 1000 });
    expect(mocks.readWorkspaceDirectory).not.toHaveBeenCalledWith({ directoryPath: 'dist', workspaceRoot: '/workspace' });
  });

  it('does not apply directory-only gitignore rules to same-name files', async (): Promise<void> => {
    mocks.readWorkspaceFile.mockResolvedValue({
      path: '/workspace/.gitignore',
      content: 'build/\n',
      totalLines: 1,
      readLines: 1,
      hasMore: false,
      nextOffset: null
    });
    mocks.readWorkspaceDirectory.mockImplementation(async (options): Promise<ReadWorkspaceDirectoryResult> => {
      if (options.directoryPath === '.') {
        return createDirectoryResult('/workspace', [
          createFileEntry('.gitignore', '/workspace/.gitignore'),
          createFileEntry('build', '/workspace/build'),
          createDirectoryEntry('src', '/workspace/src')
        ]);
      }

      if (options.directoryPath === 'src') {
        return createDirectoryResult('/workspace/src', [
          createDirectoryEntry('build', '/workspace/src/build'),
          createFileEntry('main.ts', '/workspace/src/main.ts')
        ]);
      }

      throw new Error(`Unexpected directory: ${options.directoryPath}`);
    });

    const scanner = useWorkspaceMentions({
      workspaceRoot: ref('/workspace'),
      enabled: ref(true)
    });
    await scanner.refresh();

    expect(scanner.fileMentions.value.map((file) => file.path)).toEqual(['build', 'src/main.ts']);
    expect(mocks.readWorkspaceDirectory).not.toHaveBeenCalledWith({ directoryPath: 'src/build', workspaceRoot: '/workspace' });
  });

  it('scans an ignored directory when a later negated rule can re-include a descendant file', async (): Promise<void> => {
    mocks.readWorkspaceFile.mockResolvedValue({
      path: '/workspace/.gitignore',
      content: 'generated/\n!generated/keep.ts\n',
      totalLines: 2,
      readLines: 2,
      hasMore: false,
      nextOffset: null
    });
    mocks.readWorkspaceDirectory.mockImplementation(async (options): Promise<ReadWorkspaceDirectoryResult> => {
      if (options.directoryPath === '.') {
        return createDirectoryResult('/workspace', [
          createFileEntry('.gitignore', '/workspace/.gitignore'),
          createDirectoryEntry('generated', '/workspace/generated')
        ]);
      }

      if (options.directoryPath === 'generated') {
        return createDirectoryResult('/workspace/generated', [
          createFileEntry('drop.ts', '/workspace/generated/drop.ts'),
          createFileEntry('keep.ts', '/workspace/generated/keep.ts')
        ]);
      }

      throw new Error(`Unexpected directory: ${options.directoryPath}`);
    });

    const scanner = useWorkspaceMentions({
      workspaceRoot: ref('/workspace'),
      enabled: ref(true)
    });
    await scanner.refresh();

    expect(scanner.fileMentions.value.map((file) => file.path)).toEqual(['generated/keep.ts']);
  });

  it('applies nested gitignore rules only within their directory scope', async (): Promise<void> => {
    mocks.readWorkspaceFile.mockImplementation(async (options): Promise<ReadWorkspaceFileResult> => {
      if (options.filePath === 'src/.gitignore') {
        return {
          path: '/workspace/src/.gitignore',
          content: '*.gen.ts\n!keep.gen.ts\n',
          totalLines: 2,
          readLines: 2,
          hasMore: false,
          nextOffset: null
        };
      }

      throw new Error(`Unexpected file: ${options.filePath}`);
    });
    mocks.readWorkspaceDirectory.mockImplementation(async (options): Promise<ReadWorkspaceDirectoryResult> => {
      if (options.directoryPath === '.') {
        return createDirectoryResult('/workspace', [createFileEntry('drop.gen.ts', '/workspace/drop.gen.ts'), createDirectoryEntry('src', '/workspace/src')]);
      }

      if (options.directoryPath === 'src') {
        return createDirectoryResult('/workspace/src', [
          createFileEntry('.gitignore', '/workspace/src/.gitignore'),
          createFileEntry('drop.gen.ts', '/workspace/src/drop.gen.ts'),
          createFileEntry('keep.gen.ts', '/workspace/src/keep.gen.ts')
        ]);
      }

      throw new Error(`Unexpected directory: ${options.directoryPath}`);
    });

    const scanner = useWorkspaceMentions({
      workspaceRoot: ref('/workspace'),
      enabled: ref(true)
    });
    await scanner.refresh();

    expect(scanner.fileMentions.value.map((file) => file.path)).toEqual(['drop.gen.ts', 'src/keep.gen.ts']);
  });

  it('skips hidden entries and binary media files while keeping text config files', async (): Promise<void> => {
    mocks.readWorkspaceDirectory.mockImplementation(async (options): Promise<ReadWorkspaceDirectoryResult> => {
      if (options.directoryPath === '.') {
        return createDirectoryResult('/workspace', [
          createDirectoryEntry('.cache', '/workspace/.cache'),
          createFileEntry('.env', '/workspace/.env'),
          createFileEntry('logo.png', '/workspace/logo.png'),
          createFileEntry('archive.zip', '/workspace/archive.zip'),
          createFileEntry('package.json', '/workspace/package.json')
        ]);
      }

      throw new Error(`Unexpected directory: ${options.directoryPath}`);
    });

    const scanner = useWorkspaceMentions({
      workspaceRoot: ref('/workspace'),
      enabled: ref(true)
    });
    await scanner.refresh();

    expect(scanner.fileMentions.value.map((file) => file.path)).toEqual(['package.json']);
    expect(mocks.readWorkspaceDirectory).not.toHaveBeenCalledWith({ directoryPath: '.cache', workspaceRoot: '/workspace' });
  });

  it('returns shallow files before nested files so large workspaces show useful results early', async (): Promise<void> => {
    mocks.readWorkspaceDirectory.mockImplementation(async (options): Promise<ReadWorkspaceDirectoryResult> => {
      if (options.directoryPath === '.') {
        return createDirectoryResult('/workspace', [createDirectoryEntry('src', '/workspace/src'), createFileEntry('README.md', '/workspace/README.md')]);
      }

      if (options.directoryPath === 'src') {
        return createDirectoryResult('/workspace/src', [createFileEntry('main.ts', '/workspace/src/main.ts')]);
      }

      throw new Error(`Unexpected directory: ${options.directoryPath}`);
    });

    const scanner = useWorkspaceMentions({
      workspaceRoot: ref('/workspace'),
      enabled: ref(true)
    });
    await scanner.refresh();

    expect(scanner.fileMentions.value.map((file) => file.path)).toEqual(['README.md', 'src/main.ts']);
  });

  it('reuses cached candidates across scanners for the same workspace scan options', async (): Promise<void> => {
    mocks.readWorkspaceDirectory.mockResolvedValue(createDirectoryResult('/workspace', [createFileEntry('README.md', '/workspace/README.md')]));

    const scanner = useWorkspaceMentions({
      workspaceRoot: ref('/workspace'),
      enabled: ref(true)
    });
    await scanner.refresh();
    expect(scanner.fileMentions.value.map((file) => file.path)).toEqual(['README.md']);

    mocks.readWorkspaceDirectory.mockClear();
    mocks.readWorkspaceFile.mockClear();
    const secondScanner = useWorkspaceMentions({
      workspaceRoot: ref('/workspace'),
      enabled: ref(true)
    });
    await flushWorkspaceScan();

    expect(secondScanner.fileMentions.value.map((file) => file.path)).toEqual(['README.md']);
    expect(mocks.readWorkspaceDirectory).not.toHaveBeenCalled();
    expect(mocks.readWorkspaceFile).not.toHaveBeenCalled();
  });

  it('bypasses cached candidates when explicitly refreshed', async (): Promise<void> => {
    mocks.readWorkspaceDirectory.mockResolvedValue(createDirectoryResult('/workspace', [createFileEntry('README.md', '/workspace/README.md')]));

    const scanner = useWorkspaceMentions({
      workspaceRoot: ref('/workspace'),
      enabled: ref(true)
    });
    await scanner.refresh();
    expect(scanner.fileMentions.value.map((file) => file.path)).toEqual(['README.md']);

    mocks.readWorkspaceDirectory.mockResolvedValue(createDirectoryResult('/workspace', [createFileEntry('CHANGELOG.md', '/workspace/CHANGELOG.md')]));
    await scanner.refresh();

    expect(scanner.fileMentions.value.map((file) => file.path)).toEqual(['CHANGELOG.md']);
  });

  it('does not scan when manual workspace mentions are disabled', async (): Promise<void> => {
    const scanner = useWorkspaceMentions({
      workspaceRoot: ref('/workspace'),
      enabled: ref(false)
    });
    await flushWorkspaceScan();

    expect(scanner.fileMentions.value).toEqual([]);
    expect(scanner.loading.value).toBe(false);
    expect(mocks.readWorkspaceDirectory).not.toHaveBeenCalled();
  });

  it('clears candidates and stores an error when the root directory cannot be read', async (): Promise<void> => {
    mocks.readWorkspaceDirectory.mockRejectedValue(new Error('permission denied'));

    const scanner = useWorkspaceMentions({
      workspaceRoot: ref('/workspace'),
      enabled: ref(true)
    });
    await scanner.refresh();

    expect(scanner.fileMentions.value).toEqual([]);
    expect(scanner.loading.value).toBe(false);
    expect(scanner.error.value?.message).toBe('permission denied');
  });

  it('normalizes synchronous root read failures without leaving loading active', async (): Promise<void> => {
    mocks.readWorkspaceDirectory.mockImplementation((): Promise<ReadWorkspaceDirectoryResult> => {
      throw new Error('sync permission denied');
    });

    const scanner = useWorkspaceMentions({
      workspaceRoot: ref('/workspace'),
      enabled: ref(true)
    });
    await expect(scanner.refresh()).resolves.toBeUndefined();

    expect(scanner.fileMentions.value).toEqual([]);
    expect(scanner.loading.value).toBe(false);
    expect(scanner.error.value?.message).toBe('sync permission denied');
  });

  it('keeps already collected files when a child directory cannot be read', async (): Promise<void> => {
    mocks.readWorkspaceDirectory.mockImplementation(async (options): Promise<ReadWorkspaceDirectoryResult> => {
      if (options.directoryPath === '.') {
        return createDirectoryResult('/workspace', [createFileEntry('README.md', '/workspace/README.md'), createDirectoryEntry('locked', '/workspace/locked')]);
      }

      throw new Error('locked directory');
    });

    const scanner = useWorkspaceMentions({
      workspaceRoot: ref('/workspace'),
      enabled: ref(true)
    });
    await scanner.refresh();

    expect(scanner.fileMentions.value.map((file) => file.path)).toEqual(['README.md']);
    expect(scanner.error.value).toBeNull();
  });

  it('stops collecting after the configured file limit', async (): Promise<void> => {
    mocks.readWorkspaceDirectory.mockResolvedValue(
      createDirectoryResult('/workspace', [
        createFileEntry('a.ts', '/workspace/a.ts'),
        createFileEntry('b.ts', '/workspace/b.ts'),
        createFileEntry('c.ts', '/workspace/c.ts')
      ])
    );

    const scanner = useWorkspaceMentions({
      workspaceRoot: ref('/workspace'),
      enabled: ref(true),
      limit: 2
    });
    await scanner.refresh();

    expect(scanner.fileMentions.value.map((file) => file.path)).toEqual(['a.ts', 'b.ts']);
  });

  it('does not let a stale scan overwrite the latest workspace candidates', async (): Promise<void> => {
    let resolveFirstScan: ((value: ReadWorkspaceDirectoryResult) => void) | undefined;
    const firstScan = new Promise<ReadWorkspaceDirectoryResult>((resolve: (value: ReadWorkspaceDirectoryResult) => void): void => {
      resolveFirstScan = resolve;
    });
    mocks.readWorkspaceDirectory.mockImplementation((options): Promise<ReadWorkspaceDirectoryResult> => {
      if (options.workspaceRoot === '/workspace-a') return firstScan;
      return Promise.resolve(createDirectoryResult('/workspace-b', [createFileEntry('second.md', '/workspace-b/second.md')]));
    });
    const workspaceRoot = ref('/workspace-a');
    const scanner = useWorkspaceMentions({
      workspaceRoot,
      enabled: ref(true)
    });
    await nextTick();

    workspaceRoot.value = '/workspace-b';
    await scanner.refresh();
    expect(scanner.fileMentions.value.map((file) => file.path)).toEqual(['second.md']);

    resolveFirstScan?.(createDirectoryResult('/workspace-a', [createFileEntry('first.md', '/workspace-a/first.md')]));
    await flushWorkspaceScan();

    expect(scanner.fileMentions.value.map((file) => file.path)).toEqual(['second.md']);
  });
});
