/**
 * @file workspace-read.test.ts
 * @description 工作区安全文件读取服务测试。
 */
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readWorkspaceFile } from '../../../electron/main/modules/file/workspace-read.mts';

/** 测试临时目录路径 */
let tempRoot = '';
/** 测试工作区目录路径 */
let workspaceRoot = '';

/**
 * 写入工作区内测试文件。
 * @param relativePath - 相对工作区路径
 * @param content - 文件内容
 * @returns 写入后的绝对路径
 */
async function writeWorkspaceFixture(relativePath: string, content: string): Promise<string> {
  const filePath = path.join(workspaceRoot, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf-8');
  return filePath;
}

/**
 * 断言工作区读取错误码。
 * @param action - 触发读取的函数
 * @param code - 期望错误码
 */
async function expectWorkspaceReadError(action: () => Promise<unknown>, code: string): Promise<void> {
  await expect(action()).rejects.toMatchObject({ code });
}

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(tmpdir(), 'tibis-workspace-read-'));
  workspaceRoot = path.join(tempRoot, 'workspace');
  await mkdir(workspaceRoot, { recursive: true });
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe('readWorkspaceFile', () => {
  it('reads a line slice from an allowed workspace text file', async () => {
    const filePath = await writeWorkspaceFixture('src/example.ts', ['line 1', 'line 2', 'line 3', 'line 4'].join('\n'));

    const result = await readWorkspaceFile({
      filePath: 'src/example.ts',
      workspaceRoot,
      offset: 2,
      limit: 2
    });

    expect(result).toEqual({
      content: 'line 2\nline 3',
      hasMore: true,
      nextOffset: 4,
      path: await realpath(filePath),
      totalLines: 4,
      readLines: 2
    });
  });

  it('reads remaining lines when limit is omitted', async () => {
    const filePath = await writeWorkspaceFixture('src/full.ts', ['line 1', 'line 2', 'line 3'].join('\n'));

    const result = await readWorkspaceFile({
      filePath: 'src/full.ts',
      workspaceRoot,
      offset: 2
    });

    expect(result).toEqual({
      content: 'line 2\nline 3',
      hasMore: false,
      nextOffset: null,
      path: await realpath(filePath),
      totalLines: 3,
      readLines: 2
    });
  });

  it('reads text files larger than 1MB when the extension is allowed', async () => {
    const largeContent = `${'a'.repeat(1024 * 1024 + 1)}\nend`;
    const filePath = await writeWorkspaceFixture('large.txt', largeContent);

    const result = await readWorkspaceFile({
      filePath: 'large.txt',
      workspaceRoot,
      offset: 2
    });

    expect(result).toEqual({
      content: 'end',
      hasMore: false,
      nextOffset: null,
      path: await realpath(filePath),
      totalLines: 2,
      readLines: 1
    });
  });

  it('rejects paths outside the workspace without prefix matching bypass', async () => {
    const siblingRoot = path.join(tempRoot, 'workspace-sibling');
    await mkdir(siblingRoot, { recursive: true });
    const outsideFile = path.join(siblingRoot, 'secret.ts');
    await writeFile(outsideFile, 'secret', 'utf-8');

    await expectWorkspaceReadError(
      () =>
        readWorkspaceFile({
          filePath: outsideFile,
          workspaceRoot
        }),
      'PATH_OUTSIDE_WORKSPACE'
    );
  });

  it('rejects blacklisted files before reading content', async () => {
    await writeWorkspaceFixture('.env', 'TOKEN=secret');

    await expectWorkspaceReadError(
      () =>
        readWorkspaceFile({
          filePath: '.env',
          workspaceRoot
        }),
      'PATH_BLACKLISTED'
    );
  });

  it('reads an allowed absolute file when no workspace root is provided', async () => {
    const filePath = await writeWorkspaceFixture('README.md', '# Tibis');

    const result = await readWorkspaceFile({
      filePath
    });

    expect(result).toEqual({
      content: '# Tibis',
      hasMore: false,
      nextOffset: null,
      path: await realpath(filePath),
      totalLines: 1,
      readLines: 1
    });
  });

  it('rejects relative paths when no workspace root is provided', async () => {
    await expectWorkspaceReadError(
      () =>
        readWorkspaceFile({
          filePath: 'README.md'
        }),
      'INVALID_INPUT'
    );
  });

  it('rejects files with unsupported extensions', async () => {
    await writeWorkspaceFixture('asset.png', 'not really an image');

    await expectWorkspaceReadError(
      () =>
        readWorkspaceFile({
          filePath: 'asset.png',
          workspaceRoot
        }),
      'EXTENSION_NOT_ALLOWED'
    );
  });
});
