/**
 * @file reference.test.ts
 * @description 文件引用 token 解析测试。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FILE_REFERENCE_MESSAGE_TOKEN_PATTERN,
  buildFileReferenceToken,
  extractFileReferenceLines,
  findFileReferenceTokens,
  parseFileReferenceToken
} from '@/utils/file/reference';

const recentRecordsMock = vi.hoisted<{ value: unknown[] }>(() => ({
  value: []
}));

vi.mock('@/shared/storage', () => ({
  isDocumentRecord: (record: unknown): boolean =>
    typeof record === 'object' && record !== null && 'type' in record && (record.type === 'file' || record.type === 'widget'),
  recentFilesStorage: {
    getAllRecentFiles: vi.fn(async () => recentRecordsMock.value),
    getRecentFile: vi.fn(async (id: string) =>
      recentRecordsMock.value.find((record) => typeof record === 'object' && record !== null && 'id' in record && record.id === id)
    )
  }
}));

beforeEach((): void => {
  recentRecordsMock.value = [];
});

describe('parseFileReferenceToken', (): void => {
  it('parses whole-file references with raw paths that include spaces', (): void => {
    const parsed = parseFileReferenceToken('@/home/user/Desktop/Markdown 语法全量渲染测试.md');

    expect(parsed).toEqual(
      expect.objectContaining({
        rawPath: '/home/user/Desktop/Markdown 语法全量渲染测试.md',
        filePath: '/home/user/Desktop/Markdown 语法全量渲染测试.md',
        fileName: 'Markdown 语法全量渲染测试.md',
        startLine: 0,
        endLine: 0
      })
    );
  });

  it('parses single-line references as one-line ranges', (): void => {
    const parsed = parseFileReferenceToken('@src/foo.ts#L644');

    expect(parsed).toEqual(
      expect.objectContaining({
        rawPath: 'src/foo.ts',
        filePath: 'src/foo.ts',
        fileName: 'foo.ts',
        startLine: 644,
        endLine: 644,
        lineText: '644'
      })
    );
  });

  it('parses source line ranges with new dash separator', (): void => {
    const parsed = parseFileReferenceToken('@src/foo.ts#L644-685');

    expect(parsed).toEqual(
      expect.objectContaining({
        rawPath: 'src/foo.ts',
        startLine: 644,
        endLine: 685,
        lineText: '644-685'
      })
    );
  });

  it('parses legacy source line ranges with L-prefixed end bound for backward compatibility', (): void => {
    const parsed = parseFileReferenceToken('@src/foo.ts#L644-L685');

    expect(parsed).toEqual(
      expect.objectContaining({
        rawPath: 'src/foo.ts',
        startLine: 644,
        endLine: 685,
        lineText: '644-685'
      })
    );
  });

  it('does not parse legacy hash-prefixed references', (): void => {
    expect(parseFileReferenceToken('#src/foo.ts')).toBeNull();
  });
});

describe('findFileReferenceTokens', (): void => {
  it('returns file references with source offsets', (): void => {
    const content = 'fix {{@src/foo.ts#L10-20}} please';
    const tokens = findFileReferenceTokens(content);

    expect(tokens).toEqual([
      {
        token: '{{@src/foo.ts#L10-20}}',
        start: 4,
        end: content.length - 7,
        reference: expect.objectContaining({
          rawPath: 'src/foo.ts',
          startLine: 10,
          endLine: 20,
          fileName: 'foo.ts'
        })
      }
    ]);
  });

  it('still parses legacy L-prefixed line range tokens from saved messages', (): void => {
    const content = 'fix {{@src/foo.ts#L10-L20}} please';
    const tokens = findFileReferenceTokens(content);

    expect(tokens).toEqual([
      expect.objectContaining({
        token: '{{@src/foo.ts#L10-L20}}',
        reference: expect.objectContaining({
          rawPath: 'src/foo.ts',
          startLine: 10,
          endLine: 20
        })
      })
    ]);
  });

  it('returns unencoded file references with spaces from message text', (): void => {
    const content = '读一下 {{@/home/user/Desktop/Markdown 语法全量渲染测试.md}}';
    const tokens = findFileReferenceTokens(content);

    expect(tokens).toEqual([
      {
        token: '{{@/home/user/Desktop/Markdown 语法全量渲染测试.md}}',
        start: 4,
        end: content.length,
        reference: expect.objectContaining({
          rawPath: '/home/user/Desktop/Markdown 语法全量渲染测试.md',
          fileName: 'Markdown 语法全量渲染测试.md',
          startLine: 0,
          endLine: 0
        })
      }
    ]);
  });

  it('matches file references in message text with the shared pattern', (): void => {
    const content = '引用 {{@/home/user/Desktop/Markdown 语法全量渲染测试.md#L3-L8}} 继续';
    const matches = [...content.matchAll(FILE_REFERENCE_MESSAGE_TOKEN_PATTERN)];

    expect(matches).toHaveLength(1);
    expect(matches[0]?.[1]).toBe('@/home/user/Desktop/Markdown 语法全量渲染测试.md#L3-L8');
  });

  it('ignores legacy message references', (): void => {
    expect(findFileReferenceTokens('fix {{#src/foo.ts}}')).toEqual([]);
  });

  it('ignores multiline message references to match editor chip behavior', (): void => {
    expect(findFileReferenceTokens('fix {{@src/foo.ts\n#L1}}')).toEqual([]);
  });
});

describe('buildFileReferenceToken', (): void => {
  it('builds readable whole-file and line-range references', (): void => {
    expect(buildFileReferenceToken('/tmp/My Note.md')).toBe('{{@/tmp/My Note.md}}');
    expect(buildFileReferenceToken('/tmp/My Note.md', 644)).toBe('{{@/tmp/My Note.md#L644}}');
    expect(buildFileReferenceToken('/tmp/My Note.md', 644, 685)).toBe('{{@/tmp/My Note.md#L644-685}}');
  });
});

describe('extractFileReferenceLines', (): void => {
  it('extracts full content for a matched saved file reference', async (): Promise<void> => {
    const token = findFileReferenceTokens('读 {{@/tmp/My Note.md}}')[0];
    if (!token) {
      throw new Error('Expected file reference token');
    }

    recentRecordsMock.value = [
      {
        type: 'file',
        id: 'file-1',
        path: '/tmp/My Note.md',
        content: 'line 1\nline 2',
        name: 'My Note',
        ext: 'md'
      }
    ];

    const reference = await extractFileReferenceLines(token);

    expect(reference).toEqual({
      token: '{{@/tmp/My Note.md}}',
      path: '/tmp/My Note.md',
      startLine: 0,
      endLine: 0,
      selectedContent: 'line 1\nline 2',
      fullContent: 'line 1\nline 2'
    });
  });
});
