/**
 * @file file-search.test.ts
 * @description ChatRuntime 文件搜索 helper 测试。
 */
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AIToolActivityReporter } from 'types/ai';
import { describe, expect, it, vi } from 'vitest';
import {
  getRuntimeRemainingTimeoutMs,
  parseGrepMatchLine,
  runBoundedSubprocess,
  runGlobSearch,
  runGrepSearch
} from '../../../../../../electron/main/modules/chat/runtime/tools/file-search.mjs';

/**
 * 创建搜索测试临时目录。
 * @returns 临时目录路径
 */
async function createSearchTempRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'tibis-file-search-'));
}

/**
 * 写入测试文件并自动创建父目录。
 * @param filePath - 文件路径
 * @param content - 文件内容
 */
async function writeTestFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
}

/**
 * 创建文件搜索活动上报器。
 * @returns 活动上报器与进展 mock
 */
function createSearchActivity(): { activity: AIToolActivityReporter; progress: ReturnType<typeof vi.fn<AIToolActivityReporter['progress']>> } {
  const progress = vi.fn<AIToolActivityReporter['progress']>();
  return {
    activity: {
      heartbeat: vi.fn(),
      progress,
      waitUser: vi.fn(),
      waitExternal: vi.fn(),
      resume: vi.fn()
    },
    progress
  };
}

describe('file-search helpers', (): void => {
  it('reports glob scan progress only when real work advances', async (): Promise<void> => {
    const root = await createSearchTempRoot();
    const { activity, progress } = createSearchActivity();
    try {
      await Promise.all(Array.from({ length: 65 }, (_value, index) => writeTestFile(path.join(root, `file-${index}.ts`), 'content')));

      const result = await runGlobSearch({
        rootPath: root,
        pattern: '**/*.ts',
        limit: 100,
        excludedDirs: ['.git'],
        activity
      });

      expect(result.count).toBe(65);
      expect(progress.mock.calls.map(([snapshot]) => snapshot)).toEqual([
        { phase: 'scanning', completed: 0, message: '正在扫描文件' },
        { phase: 'scanning', completed: 64, message: '已扫描 64 个文件，找到 64 项' },
        { phase: 'scanning', completed: 65, message: '已扫描 65 个文件，找到 65 项' },
        { phase: 'complete', completed: 65, message: '扫描完成，找到 65 项' }
      ]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('glob matches brace patterns and excludes .git directories', async (): Promise<void> => {
    const root = await createSearchTempRoot();
    try {
      await writeTestFile(path.join(root, 'src', 'alpha.ts'), 'alpha');
      await writeTestFile(path.join(root, 'src', 'beta.tsx'), 'beta');
      await writeTestFile(path.join(root, 'src', 'gamma.js'), 'gamma');
      await writeTestFile(path.join(root, '.git', 'hidden.ts'), 'hidden');

      const result = await runGlobSearch({
        rootPath: root,
        pattern: '**/*.{ts,tsx}',
        limit: 100,
        excludedDirs: ['.git']
      });

      expect(result.files.map((filePath) => path.relative(root, filePath)).sort()).toEqual(['src/alpha.ts', 'src/beta.tsx']);
      expect(result.count).toBe(2);
      expect(result.truncated).toBe(false);
      expect(result.incomplete).toBe(false);
      expect(result.warnings).toEqual([]);
      expect(result.warningsTruncated).toBe(false);
      expect(result.skippedWarningCount).toBe(0);
      expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('glob reports truncation after reading one extra result', async (): Promise<void> => {
    const root = await createSearchTempRoot();
    try {
      await Promise.all(Array.from({ length: 3 }, (_value, index) => writeTestFile(path.join(root, `file-${index}.ts`), 'content')));

      const result = await runGlobSearch({
        rootPath: root,
        pattern: '**/*.ts',
        limit: 2,
        excludedDirs: ['.git']
      });

      expect(result.files).toHaveLength(2);
      expect(result.count).toBe(2);
      expect(result.truncated).toBe(true);
      expect(result.incomplete).toBe(true);
      expect(result.warnings).toEqual([]);
      expect(result.warningsTruncated).toBe(false);
      expect(result.skippedWarningCount).toBe(0);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('glob returns partial results and warnings when a directory cannot be read', async (): Promise<void> => {
    const root = await createSearchTempRoot();
    const restrictedDirectory = path.join(root, 'restricted');
    try {
      await writeTestFile(path.join(root, 'src', 'alpha.ts'), 'alpha');
      await writeTestFile(path.join(restrictedDirectory, 'hidden.ts'), 'hidden');
      await fs.chmod(restrictedDirectory, 0);

      const result = await runGlobSearch({
        rootPath: root,
        pattern: '**/*.ts',
        limit: 100,
        excludedDirs: ['.git']
      });

      expect(result.files.map((filePath) => path.relative(root, filePath))).toEqual(['src/alpha.ts']);
      expect(result.count).toBe(1);
      expect(result.truncated).toBe(false);
      expect(result.incomplete).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toEqual(
        expect.objectContaining({
          path: restrictedDirectory,
          reason: expect.any(String)
        })
      );
      expect(result.warningsTruncated).toBe(false);
      expect(result.skippedWarningCount).toBe(0);
    } finally {
      await fs.chmod(restrictedDirectory, 0o700).catch(() => undefined);
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('parses grep output when file paths contain colons', (): void => {
    const parsed = parseGrepMatchLine('/tmp/project/path:with:colon/file.ts:12:const value = "a:b";');

    expect(parsed).toEqual({
      path: '/tmp/project/path:with:colon/file.ts',
      line: 12,
      text: 'const value = "a:b";'
    });
  });

  it('parses grep output when matched text contains numeric colon fragments', (): void => {
    const parsed = parseGrepMatchLine('/tmp/project/src/file.ts:3:foo:12:bar');

    expect(parsed).toEqual({
      path: '/tmp/project/src/file.ts',
      line: 3,
      text: 'foo:12:bar'
    });
  });

  it('grep parses paths that contain numeric colon fragments', async (): Promise<void> => {
    const root = await createSearchTempRoot();
    try {
      const filePath = path.join(root, 'src', 'file:12:name.txt');
      await writeTestFile(filePath, 'target\n');

      const result = await runGrepSearch({
        rootPath: root,
        pattern: 'target',
        include: '**/*.txt',
        limit: 100,
        batchSize: 64,
        excludedDirs: ['.git'],
        timeoutMs: 5_000,
        stdoutLimitBytes: 1024 * 1024,
        stderrLimitBytes: 64 * 1024,
        lineTextLimit: 2048
      });

      expect(result.matches).toEqual([
        {
          path: filePath,
          line: 1,
          text: 'target'
        }
      ]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('calculates remaining timeout for a whole grep search', (): void => {
    expect(getRuntimeRemainingTimeoutMs(120, 100)).toBe(20);
    expect(getRuntimeRemainingTimeoutMs(120, 120)).toBe(0);
    expect(getRuntimeRemainingTimeoutMs(120, 150)).toBe(0);
  });

  it('grep filters candidates with include and returns structured matches', async (): Promise<void> => {
    const root = await createSearchTempRoot();
    try {
      await writeTestFile(path.join(root, 'src', 'alpha.ts'), 'const target = 1;\n');
      await writeTestFile(path.join(root, 'src', 'beta.md'), 'target in markdown\n');
      await writeTestFile(path.join(root, '.git', 'ignored.ts'), 'const target = 2;\n');

      const result = await runGrepSearch({
        rootPath: root,
        pattern: 'target',
        include: '**/*.ts',
        limit: 100,
        batchSize: 1,
        excludedDirs: ['.git'],
        timeoutMs: 5_000,
        stdoutLimitBytes: 1024 * 1024,
        stderrLimitBytes: 64 * 1024,
        lineTextLimit: 2048
      });

      expect(result.matches).toEqual([
        {
          path: path.join(root, 'src', 'alpha.ts'),
          line: 1,
          text: 'const target = 1;'
        }
      ]);
      expect(result.count).toBe(1);
      expect(result.truncated).toBe(false);
      expect(result.incomplete).toBe(false);
      expect(result.warnings).toEqual([]);
      expect(result.warningsTruncated).toBe(false);
      expect(result.skippedWarningCount).toBe(0);
      expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('grep keeps readable matches and warns about unreadable files', async (): Promise<void> => {
    const root = await createSearchTempRoot();
    const restrictedFile = path.join(root, 'restricted.txt');
    try {
      await writeTestFile(path.join(root, 'good.txt'), 'target\n');
      await writeTestFile(restrictedFile, 'target\n');
      await fs.chmod(restrictedFile, 0);

      const result = await runGrepSearch({
        rootPath: root,
        pattern: 'target',
        include: '**/*.txt',
        limit: 100,
        batchSize: 64,
        excludedDirs: ['.git'],
        timeoutMs: 5_000,
        stdoutLimitBytes: 1024 * 1024,
        stderrLimitBytes: 64 * 1024,
        lineTextLimit: 2048
      });

      expect(result.matches).toEqual([
        {
          path: path.join(root, 'good.txt'),
          line: 1,
          text: 'target'
        }
      ]);
      expect(result.count).toBe(1);
      expect(result.truncated).toBe(false);
      expect(result.incomplete).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toEqual(
        expect.objectContaining({
          path: restrictedFile,
          reason: expect.any(String)
        })
      );
      expect(result.warningsTruncated).toBe(false);
      expect(result.skippedWarningCount).toBe(0);
    } finally {
      await fs.chmod(restrictedFile, 0o600).catch(() => undefined);
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('grep truncates high-volume output before hitting stdout cap', async (): Promise<void> => {
    const root = await createSearchTempRoot();
    try {
      const filePath = path.join(root, 'large.txt');
      await writeTestFile(filePath, Array.from({ length: 1000 }, (_value, index) => `target ${index}`).join('\n'));

      const result = await runGrepSearch({
        rootPath: root,
        pattern: 'target',
        include: '**/*.txt',
        limit: 5,
        batchSize: 64,
        excludedDirs: ['.git'],
        timeoutMs: 5_000,
        stdoutLimitBytes: 1024,
        stderrLimitBytes: 64 * 1024,
        lineTextLimit: 2048
      });

      expect(result.matches).toHaveLength(5);
      expect(result.truncated).toBe(true);
      expect(result.incomplete).toBe(true);
      expect(result.warnings).toEqual([]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('limits warning payload size for many unreadable directories', async (): Promise<void> => {
    const root = await createSearchTempRoot();
    const restrictedDirectories = Array.from({ length: 25 }, (_value, index) => path.join(root, `restricted-${index}`));
    try {
      await writeTestFile(path.join(root, 'src', 'alpha.ts'), 'alpha');
      await Promise.all(
        restrictedDirectories.map(async (directoryPath): Promise<void> => {
          await writeTestFile(path.join(directoryPath, 'hidden.ts'), 'hidden');
          await fs.chmod(directoryPath, 0);
        })
      );

      const result = await runGlobSearch({
        rootPath: root,
        pattern: '**/*.ts',
        limit: 100,
        excludedDirs: ['.git']
      });

      expect(result.files.map((filePath) => path.relative(root, filePath))).toEqual(['src/alpha.ts']);
      expect(result.incomplete).toBe(true);
      expect(result.warnings).toHaveLength(20);
      expect(result.warningsTruncated).toBe(true);
      expect(result.skippedWarningCount).toBe(5);
    } finally {
      await Promise.all(restrictedDirectories.map((directoryPath) => fs.chmod(directoryPath, 0o700).catch(() => undefined)));
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('bounded subprocess kills timed out child processes', async (): Promise<void> => {
    await expect(
      runBoundedSubprocess({
        command: process.execPath,
        args: ['-e', 'setTimeout(() => {}, 1000)'],
        timeoutMs: 10,
        stdoutLimitBytes: 1024,
        stderrLimitBytes: 1024
      })
    ).rejects.toMatchObject({ code: 'TOOL_TIMEOUT' });
  });

  it('bounded subprocess waits for killed children to close after timeout', async (): Promise<void> => {
    const root = await createSearchTempRoot();
    const markerPath = path.join(root, 'closed.txt');
    try {
      await expect(
        runBoundedSubprocess({
          command: process.execPath,
          args: [
            '-e',
            [
              'const fs = require("node:fs");',
              'const markerPath = process.argv[1];',
              'process.on("SIGTERM", () => setTimeout(() => { fs.writeFileSync(markerPath, "closed"); process.exit(0); }, 100));',
              'setInterval(() => {}, 1000);'
            ].join(' '),
            markerPath
          ],
          timeoutMs: 200,
          stdoutLimitBytes: 1024,
          stderrLimitBytes: 1024
        })
      ).rejects.toMatchObject({ code: 'TOOL_TIMEOUT' });

      await expect(fs.readFile(markerPath, 'utf8')).resolves.toBe('closed');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('bounded subprocess rejects output above stdout cap', async (): Promise<void> => {
    await expect(
      runBoundedSubprocess({
        command: process.execPath,
        args: ['-e', 'process.stdout.write("x".repeat(2048))'],
        timeoutMs: 5_000,
        stdoutLimitBytes: 32,
        stderrLimitBytes: 1024
      })
    ).rejects.toMatchObject({ code: 'EXECUTION_FAILED' });
  });
});
