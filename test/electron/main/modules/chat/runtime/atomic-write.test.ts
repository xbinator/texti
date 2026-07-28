/**
 * @file atomic-write.test.ts
 * @description atomically 文件写入失败清理契约测试。
 */
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { writeFile as writeFileAtomically } from 'atomically';
import { describe, expect, it } from 'vitest';

/**
 * 等待 atomically 的失败清理在高并发测试负载下完成。
 * @param directory - 临时文件所在目录
 * @returns 清理后的目录项
 */
async function waitForTempCleanup(directory: string): Promise<string[]> {
  const deadlineAt = Date.now() + 1_000;
  let entries = await fs.readdir(directory);
  while (entries.some((entry: string): boolean => entry.includes('.tmp-')) && Date.now() < deadlineAt) {
    // Cleanup polling must observe atomically's asynchronous disposer in order.
    // eslint-disable-next-line no-await-in-loop
    await new Promise<void>((resolve): void => {
      setTimeout(resolve, 10);
    });
    // eslint-disable-next-line no-await-in-loop
    entries = await fs.readdir(directory);
  }
  return entries;
}

describe('atomic file write', (): void => {
  it('atomically replaces one existing UTF-8 file without leaving a temporary peer', async (): Promise<void> => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tibis-atomic-write-success-'));
    const targetPath = path.join(tempRoot, 'target.md');
    try {
      await fs.writeFile(targetPath, 'before', 'utf8');

      await writeFileAtomically(targetPath, 'after', { encoding: 'utf8' });

      expect(await fs.readFile(targetPath, 'utf8')).toBe('after');
      expect(await fs.readdir(tempRoot)).toEqual(['target.md']);
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('removes the temporary file when final replacement fails', async (): Promise<void> => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tibis-atomic-write-'));
    const targetPath = path.join(tempRoot, 'target.md');
    try {
      await fs.mkdir(targetPath);

      await expect(writeFileAtomically(targetPath, 'content', { encoding: 'utf8', timeout: 0 })).rejects.toBeInstanceOf(Error);

      const remainingEntries = await waitForTempCleanup(tempRoot);
      expect(remainingEntries).toEqual(['target.md']);
      expect(remainingEntries.some((entry: string): boolean => entry.includes('.tmp-'))).toBe(false);
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
});
