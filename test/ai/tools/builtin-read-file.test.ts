/**
 * @file builtin-read-file.test.ts
 * @description 内置 read_file 工具测试。
 */
import type { AIToolContext } from 'types/ai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBuiltinReadFileTool } from '@/ai/tools/builtin/read-file';
import { editorToolContextRegistry } from '@/ai/tools/editor-context';
import type { ReadWorkspaceFileOptions, ReadWorkspaceFileResult as NativeReadWorkspaceFileResult } from '@/shared/platform/native/types';

/** 编辑器上下文注册表（单例） */

/**
 * vi.mock 会被 hoist 到文件顶部，因此 mock 工厂函数中不能引用外部变量。
 * 使用 vi.hoisted() 确保 mock 函数在 hoist 前已初始化。
 */
const { getReferenceSnapshotByDocumentIdMock } = vi.hoisted(() => ({
  getReferenceSnapshotByDocumentIdMock: vi.fn()
}));

vi.mock('@/shared/storage', () => ({
  chatStorage: {
    getReferenceSnapshotByDocumentId: getReferenceSnapshotByDocumentIdMock
  }
}));

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

/**
 * 创建模拟的编辑器工具上下文 fixture。
 * @param documentId - 文档 ID
 * @param content - 文档内容
 * @param overrides - 覆盖属性
 * @returns 模拟的 AI 工具上下文
 */
function createMockContext(documentId: string, content: string, overrides: Partial<AIToolContext> = {}): AIToolContext {
  return {
    document: {
      id: documentId,
      title: 'test.md',
      path: '/project/test.md',
      getContent: () => content,
      ...overrides.document
    },
    editor: {
      getSelection: () => null,
      insertAtCursor: async () => {
        /* noop */
      },
      replaceSelection: async () => {
        /* noop */
      },
      replaceDocument: async () => {
        /* noop */
      },
      ...overrides.editor
    }
  };
}

describe('createBuiltinReadFileTool', () => {
  beforeEach(() => {
    getReferenceSnapshotByDocumentIdMock.mockReset();
  });

  afterEach(() => {
    // 清理注册的编辑器上下文，避免跨测试污染
    editorToolContextRegistry.unregister('doc-1');
    editorToolContextRegistry.unregister('doc-2');
  });

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

  describe('documentId branch', () => {
    it('reads from editor memory when document is open in editor', async () => {
      const docContent = 'line 1\nline 2\nline 3\nline 4\nline 5';
      const context = createMockContext('doc-1', docContent);
      editorToolContextRegistry.register('doc-1', context);

      const tool = createBuiltinReadFileTool();

      const result = await tool.execute({ documentId: 'doc-1' });

      expect(result.status).toBe('success');
      if (result.status !== 'success') throw new Error('Expected success');
      expect(result.data.content).toBe(docContent);
      expect(result.data.totalLines).toBe(5);
      expect(result.data.readLines).toBe(5);
      expect(result.data.hasMore).toBe(false);
      expect(result.data.nextOffset).toBeNull();
    });

    it('respects offset and limit params when reading from editor memory', async () => {
      const docContent = 'line 1\nline 2\nline 3\nline 4\nline 5';
      const context = createMockContext('doc-1', docContent);
      editorToolContextRegistry.register('doc-1', context);

      const tool = createBuiltinReadFileTool();

      const result = await tool.execute({ documentId: 'doc-1', offset: 2, limit: 2 });

      expect(result.status).toBe('success');
      if (result.status !== 'success') throw new Error('Expected success');
      expect(result.data.content).toBe('line 2\nline 3');
      expect(result.data.totalLines).toBe(5);
      expect(result.data.readLines).toBe(2);
      expect(result.data.hasMore).toBe(true);
      expect(result.data.nextOffset).toBe(4);
    });

    it('falls back to SQLite snapshot when document is not in editor', async () => {
      // 不注册 doc-1，使其从编辑器中不可用
      getReferenceSnapshotByDocumentIdMock.mockResolvedValueOnce({
        id: 'snap-1',
        documentId: 'doc-1',
        title: 'old-test.md',
        content: 'snapshot line 1\nsnapshot line 2',
        createdAt: '2026-05-01T00:00:00.000Z'
      });

      const tool = createBuiltinReadFileTool();

      const result = await tool.execute({ documentId: 'doc-1' });

      expect(getReferenceSnapshotByDocumentIdMock).toHaveBeenCalledWith('doc-1');
      expect(result.status).toBe('success');
      if (result.status !== 'success') throw new Error('Expected success');
      expect(result.data.path).toBe('[快照] old-test.md');
      expect(result.data.content).toBe('snapshot line 1\nsnapshot line 2');
      expect(result.data.totalLines).toBe(2);
    });

    it('returns EXECUTION_FAILED when document is not in editor and no snapshot exists', async () => {
      getReferenceSnapshotByDocumentIdMock.mockResolvedValueOnce(null);

      const tool = createBuiltinReadFileTool();

      const result = await tool.execute({ documentId: 'doc-1' });

      expect(result.status).toBe('failure');
      expect(result.error?.code).toBe('EXECUTION_FAILED');
      expect(result.error?.message).toBe('文档未在编辑器中打开，且无历史快照');
    });

    it('uses editor context path as result path label', async () => {
      const docContent = 'content';
      const context = createMockContext('doc-1', docContent, {
        document: { id: 'doc-1', title: 'saved.ts', path: '/project/src/saved.ts', getContent: () => docContent }
      });
      editorToolContextRegistry.register('doc-1', context);

      const tool = createBuiltinReadFileTool();

      const result = await tool.execute({ documentId: 'doc-1' });

      expect(result.status).toBe('success');
      if (result.status !== 'success') throw new Error('Expected success');
      expect(result.data.path).toBe('/project/src/saved.ts');
    });
  });
});
