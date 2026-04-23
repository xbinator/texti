/**
 * @file builtin-read-file.test.ts
 * @description 内置 read_file 工具测试。
 */
import { describe, expect, it } from 'vitest';
import { createBuiltinReadFileTool } from '@/ai/tools/builtin/read-file';
import type { ReadWorkspaceFileOptions, ReadWorkspaceFileResult as NativeReadWorkspaceFileResult } from '@/shared/platform/native/types';

/**
 * 创建可携带业务错误码的错误对象。
 * @param code - 业务错误码
 * @returns 错误对象
 */
function createCodedError(code: string): Error & { code: string } {
  const error = new Error(code) as Error & { code: string };
  error.code = code;
  return error;
}

describe('createBuiltinReadFileTool', () => {
  it('rejects empty file path input', async () => {
    const tool = createBuiltinReadFileTool({
      getWorkspaceRoot: () => '/workspace',
      readWorkspaceFile: async () => ({ path: '', content: '', totalLines: 0, readLines: 0, hasMore: false, nextOffset: null })
    });

    const result = await tool.execute({ path: '   ' });

    expect(result.status).toBe('failure');
    expect(result.error?.code).toBe('INVALID_INPUT');
  });

  it('rejects calls when no workspace root is configured', async () => {
    const tool = createBuiltinReadFileTool({
      getWorkspaceRoot: () => null,
      readWorkspaceFile: async () => ({ path: '', content: '', totalLines: 0, readLines: 0, hasMore: false, nextOffset: null })
    });

    const result = await tool.execute({ path: 'src/example.ts' });

    expect(result.status).toBe('failure');
    expect(result.error?.code).toBe('PERMISSION_DENIED');
  });

  it('confirms and reads an absolute path when no workspace root is configured', async () => {
    let confirmedTitle = '';
    let capturedOptions: ReadWorkspaceFileOptions | null = null;
    const tool = createBuiltinReadFileTool({
      confirm: {
        confirm: async (request) => {
          confirmedTitle = request.title;
          return true;
        }
      },
      getWorkspaceRoot: () => null,
      readWorkspaceFile: async (options: ReadWorkspaceFileOptions) => {
        capturedOptions = options;
        return {
          path: '/workspace\\README.md',
          content: '# Tibis',
          hasMore: false,
          nextOffset: null,
          totalLines: 1,
          readLines: 1
        };
      }
    });

    const result = await tool.execute({ path: '/workspace\\README.md' });

    expect(confirmedTitle).toBe('AI 想要读取本地文件');
    expect(capturedOptions).toEqual({
      filePath: '/workspace\\README.md',
      offset: 1
    });
    expect(result.status).toBe('success');
  });

  it('cancels absolute path reads when the user rejects confirmation', async () => {
    const tool = createBuiltinReadFileTool({
      confirm: {
        confirm: async () => false
      },
      getWorkspaceRoot: () => null,
      readWorkspaceFile: async () => ({ path: '', content: '', totalLines: 0, readLines: 0, hasMore: false, nextOffset: null })
    });

    const result = await tool.execute({ path: '/workspace\\README.md' });

    expect(result.status).toBe('cancelled');
    expect(result.error?.code).toBe('USER_CANCELLED');
  });

  it('normalizes default offset without adding a default limit', async () => {
    let capturedOptions: ReadWorkspaceFileOptions | null = null;
    const expectedResult: NativeReadWorkspaceFileResult = {
      path: '/workspace\\src\\example.ts',
      content: 'hello',
      hasMore: false,
      nextOffset: null,
      totalLines: 1,
      readLines: 1
    };
    const tool = createBuiltinReadFileTool({
      getWorkspaceRoot: () => '/workspace',
      readWorkspaceFile: async (options: ReadWorkspaceFileOptions) => {
        capturedOptions = options;
        return expectedResult;
      }
    });

    const result = await tool.execute({ path: 'src/example.ts' });

    expect(capturedOptions).toEqual({
      filePath: 'src/example.ts',
      workspaceRoot: '/workspace',
      offset: 1
    });
    expect(result).toEqual({
      toolName: 'read_file',
      status: 'success',
      data: expectedResult
    });
  });

  it('maps workspace permission errors to tool permission failures', async () => {
    const tool = createBuiltinReadFileTool({
      getWorkspaceRoot: () => '/workspace',
      readWorkspaceFile: async () => {
        throw createCodedError('PATH_BLACKLISTED');
      }
    });

    const result = await tool.execute({ path: '.env' });

    expect(result.status).toBe('failure');
    expect(result.error?.code).toBe('PERMISSION_DENIED');
  });

  it('maps unsupported platform errors to unsupported provider failures', async () => {
    const tool = createBuiltinReadFileTool({
      getWorkspaceRoot: () => '/workspace',
      readWorkspaceFile: async () => {
        throw createCodedError('UNSUPPORTED_PROVIDER');
      }
    });

    const result = await tool.execute({ path: 'src/example.ts' });

    expect(result.status).toBe('failure');
    expect(result.error?.code).toBe('UNSUPPORTED_PROVIDER');
  });
});
