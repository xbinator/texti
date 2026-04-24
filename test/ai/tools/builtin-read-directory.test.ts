/**
 * @file builtin-read-directory.test.ts
 * @description 内置 read_directory 工具测试。
 */
import { describe, expect, it } from 'vitest';
import { createBuiltinReadDirectoryTool, READ_DIRECTORY_TOOL_NAME } from '@/ai/tools/builtin/read-file';
import type { ReadWorkspaceDirectoryOptions, ReadWorkspaceDirectoryResult } from '@/shared/platform/native/types';

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

describe('read_directory tool', () => {
  it('exports the shared tool name', () => {
    expect(READ_DIRECTORY_TOOL_NAME).toBe('read_directory');
  });

  it('rejects empty directory path input', async () => {
    const tool = createBuiltinReadDirectoryTool({
      getWorkspaceRoot: () => '/workspace',
      readWorkspaceDirectory: async () => ({ path: '', entries: [] })
    });

    const result = await tool.execute({ path: '   ' });

    expect(result.status).toBe('failure');
    expect(result.error?.code).toBe('INVALID_INPUT');
  });

  it('rejects relative directory paths when no workspace root is configured', async () => {
    const tool = createBuiltinReadDirectoryTool({
      getWorkspaceRoot: () => null,
      readWorkspaceDirectory: async () => ({ path: '', entries: [] })
    });

    const result = await tool.execute({ path: 'docs' });

    expect(result.status).toBe('failure');
    expect(result.error?.code).toBe('PERMISSION_DENIED');
    expect(result.error?.message).toBe('未配置工作区根目录时只能读取绝对路径');
  });

  it('confirms and reads an absolute directory path when no workspace root is configured', async () => {
    let confirmedTitle = '';
    let capturedOptions: ReadWorkspaceDirectoryOptions | null = null;
    const expectedResult: ReadWorkspaceDirectoryResult = {
      path: '/Users/demo/project/docs',
      entries: [{ name: 'README.md', path: '/Users/demo/project/docs/README.md', type: 'file' }]
    };
    const tool = createBuiltinReadDirectoryTool({
      confirm: {
        confirm: async (request) => {
          confirmedTitle = request.title;
          return true;
        }
      },
      getWorkspaceRoot: () => null,
      readWorkspaceDirectory: async (options: ReadWorkspaceDirectoryOptions) => {
        capturedOptions = options;
        return expectedResult;
      }
    });

    const result = await tool.execute({ path: '/Users/demo/project/docs' });

    expect(confirmedTitle).toBe('AI 想要读取本地目录');
    expect(capturedOptions).toEqual({
      directoryPath: '/Users/demo/project/docs'
    });
    expect(result).toEqual({
      toolName: READ_DIRECTORY_TOOL_NAME,
      status: 'success',
      data: expectedResult
    });
  });

  it('cancels absolute directory reads when the user rejects confirmation', async () => {
    const tool = createBuiltinReadDirectoryTool({
      confirm: {
        confirm: async () => false
      },
      getWorkspaceRoot: () => null,
      readWorkspaceDirectory: async () => ({ path: '', entries: [] })
    });

    const result = await tool.execute({ path: '/Users/demo/project/docs' });

    expect(result.status).toBe('cancelled');
    expect(result.error?.code).toBe('USER_CANCELLED');
  });

  it('lists direct children inside the workspace', async () => {
    let capturedOptions: ReadWorkspaceDirectoryOptions | null = null;
    const expectedResult: ReadWorkspaceDirectoryResult = {
      path: '/workspace\\src',
      entries: [
        { name: 'ai', path: '/workspace\\src\\ai', type: 'directory' },
        { name: 'main.ts', path: '/workspace\\src\\main.ts', type: 'file' }
      ]
    };
    const tool = createBuiltinReadDirectoryTool({
      getWorkspaceRoot: () => '/workspace',
      readWorkspaceDirectory: async (options: ReadWorkspaceDirectoryOptions) => {
        capturedOptions = options;
        return expectedResult;
      }
    });

    const result = await tool.execute({ path: 'src' });

    expect(capturedOptions).toEqual({
      directoryPath: 'src',
      workspaceRoot: '/workspace'
    });
    expect(result).toEqual({
      toolName: READ_DIRECTORY_TOOL_NAME,
      status: 'success',
      data: expectedResult
    });
  });

  it('maps workspace permission errors to tool permission failures', async () => {
    const tool = createBuiltinReadDirectoryTool({
      getWorkspaceRoot: () => '/workspace',
      readWorkspaceDirectory: async () => {
        throw createCodedError('PATH_BLACKLISTED');
      }
    });

    const result = await tool.execute({ path: '.git' });

    expect(result.status).toBe('failure');
    expect(result.error?.code).toBe('PERMISSION_DENIED');
  });

  it('maps unsupported platform errors to unsupported provider failures', async () => {
    const tool = createBuiltinReadDirectoryTool({
      getWorkspaceRoot: () => '/workspace',
      readWorkspaceDirectory: async () => {
        throw createCodedError('UNSUPPORTED_PROVIDER');
      }
    });

    const result = await tool.execute({ path: 'src' });

    expect(result.status).toBe('failure');
    expect(result.error?.code).toBe('UNSUPPORTED_PROVIDER');
  });
});
