/**
 * @file file-reference-context.test.ts
 * @description Test coverage for snapshot-backed file-reference model context building,
 *              including inline token replacement and same-file multi-reference deduplication.
 */
import type { ChatMessageFileReference, ChatReferenceSnapshot } from 'types/chat';
import { describe, expect, it } from 'vitest';
import { buildModelReadyMessages, parseLineRange } from '@/components/BChatSidebar/utils/fileReferenceContext';
import type { Message } from '@/components/BChatSidebar/utils/types';

/**
 * 创建标准文件引用 fixture
 * @param overrides - 部分属性覆盖
 * @returns 文件引用 fixture
 */
function createReference(overrides: Partial<ChatMessageFileReference> = {}): ChatMessageFileReference {
  return {
    id: 'ref-1',
    token: '{{file-ref:ref-1}}',
    documentId: 'doc-1',
    fileName: 'draft.md',
    line: '12-14',
    path: 'docs/draft.md',
    snapshotId: 'snapshot-1',
    ...overrides
  };
}

/**
 * 创建标准快照 fixture
 * @param content - 快照内容
 * @param overrides - 部分属性覆盖
 * @returns 快照 fixture
 */
function createSnapshot(content: string, overrides: Partial<ChatReferenceSnapshot> = {}): ChatReferenceSnapshot {
  return {
    id: 'snapshot-1',
    documentId: 'doc-1',
    title: 'draft.md',
    content,
    createdAt: '2026-04-25T00:00:00.000Z',
    ...overrides
  };
}

/**
 * 创建用户消息 fixture
 * @param references - 消息关联的文件引用
 * @param content - 消息内容，默认包含 ref-1 的 token
 * @returns 用户消息 fixture
 */
function createUserMessage(references: ChatMessageFileReference[], content?: string): Message {
  const messageContent = content ?? 'Please review {{file-ref:ref-1}}.';
  return {
    id: 'message-1',
    role: 'user',
    content: messageContent,
    parts: [{ type: 'text', text: messageContent }],
    references,
    createdAt: '2026-04-25T00:00:01.000Z'
  };
}

/**
 * 生成指定行数的多行文本，每行格式为 "line N"
 * @param count - 行数
 * @returns 多行文本
 */
function generateLines(count: number): string {
  return Array.from({ length: count }, (_, i) => `line ${i + 1}`).join('\n');
}

describe('file reference context builder', () => {
  describe('parseLineRange', () => {
    it('parses single lines and closed ranges using 1-based numbering', () => {
      expect(parseLineRange('12')).toEqual({ start: 12, end: 12 });
      expect(parseLineRange('12-18')).toEqual({ start: 12, end: 18 });
      expect(parseLineRange('0')).toBeNull();
      expect(parseLineRange('18-12')).toBeNull();
    });
  });

  describe('inline token replacement', () => {
    it('replaces file-ref token inline with full snapshot content for small documents', () => {
      const sourceMessages = [createUserMessage([createReference()])];
      const snapshotsById = new Map<string, ChatReferenceSnapshot>([['snapshot-1', createSnapshot('alpha\nbeta\ngamma')]]);

      const [message] = buildModelReadyMessages(sourceMessages, snapshotsById);

      expect(message.content).toContain('Please review ');
      expect(message.content).toContain('引用行：12-14');
      expect(message.content).toContain('全文内容');
      expect(message.content).toContain('alpha\nbeta\ngamma');
      expect(message.content).not.toContain('{{file-ref:ref-1}}');
    });

    it('keeps the visible message unchanged when the snapshot cannot be found', () => {
      const sourceMessages = [createUserMessage([createReference()])];
      const [message] = buildModelReadyMessages(sourceMessages, new Map());

      expect(message.content).toBe('Please review {{file-ref:ref-1}}.');
      expect(message.parts).toEqual([{ type: 'text', text: 'Please review {{file-ref:ref-1}}.' }]);
    });

    it('does not modify non-user messages', () => {
      const assistantMessage: Message = {
        id: 'assistant-1',
        role: 'assistant',
        content: 'Some response',
        parts: [{ type: 'text', text: 'Some response' }],
        references: [createReference()],
        createdAt: '2026-04-25T00:00:01.000Z'
      };

      const [message] = buildModelReadyMessages([assistantMessage], new Map([['snapshot-1', createSnapshot('data')]]));

      expect(message.content).toBe('Some response');
    });
  });

  describe('same-file multi-reference deduplication', () => {
    it('replaces first token with full block (own line only) and subsequent tokens with brief annotation', () => {
      const ref1 = createReference({ id: 'ref-1', line: '3', snapshotId: 'snapshot-1', token: '{{file-ref:ref-1}}' });
      const ref2 = createReference({ id: 'ref-2', line: '10', snapshotId: 'snapshot-1', token: '{{file-ref:ref-2}}' });
      const content = 'Check {{file-ref:ref-1}} and {{file-ref:ref-2}}';

      const sourceMessages = [createUserMessage([ref1, ref2], content)];
      const snapshotsById = new Map<string, ChatReferenceSnapshot>([['snapshot-1', createSnapshot('alpha\nbeta\ngamma\ndelta')]]);

      const [message] = buildModelReadyMessages(sourceMessages, snapshotsById);

      // 两个 token 均被替换
      expect(message.content).not.toContain('{{file-ref:ref-1}}');
      expect(message.content).not.toContain('{{file-ref:ref-2}}');

      // 首次完整块仅包含自身行号，不含合并行号
      expect(message.content).toContain('引用行：3');
      expect(message.content).not.toContain('引用行：3、10');

      // 完整块出现一次
      const fullBlockCount = (message.content.match(/全文内容/g) ?? []).length;
      expect(fullBlockCount).toBe(1);

      // 后续 token 输出简洁标注
      expect(message.content).toContain('[引用：draft.md 第10行]');
    });

    it('gives each different file its own full block', () => {
      const ref1 = createReference({ id: 'ref-1', snapshotId: 'snapshot-1', line: '3', token: '{{file-ref:ref-1}}' });
      const ref2 = createReference({
        id: 'ref-2',
        snapshotId: 'snapshot-2',
        line: '5',
        token: '{{file-ref:ref-2}}',
        fileName: 'other.md',
        path: 'docs/other.md'
      });
      const content = '{{file-ref:ref-1}} vs {{file-ref:ref-2}}';

      const sourceMessages = [createUserMessage([ref1, ref2], content)];
      const snapshotsById = new Map<string, ChatReferenceSnapshot>([
        ['snapshot-1', createSnapshot('alpha\nbeta\ngamma')],
        ['snapshot-2', createSnapshot('one\ntwo\nthree\nfour\nfive', { id: 'snapshot-2', documentId: 'doc-2', title: 'other.md' })]
      ]);

      const [message] = buildModelReadyMessages(sourceMessages, snapshotsById);

      // 两个文件各有一个完整块
      const fullBlockCount = (message.content.match(/全文内容/g) ?? []).length;
      expect(fullBlockCount).toBe(2);

      // 各自的引用行独立
      expect(message.content).toContain('引用行：3');
      expect(message.content).toContain('引用行：5');

      // 无简洁标注
      expect(message.content).not.toContain('[引用：');
    });
  });

  describe('fallback: unchanged content', () => {
    it('returns original message when there are no tokens in content', () => {
      const sourceMessages = [createUserMessage([createReference()], 'No tokens here, just plain text.')];
      const snapshotsById = new Map<string, ChatReferenceSnapshot>([['snapshot-1', createSnapshot('data')]]);

      const [message] = buildModelReadyMessages(sourceMessages, snapshotsById);

      expect(message.content).toBe('No tokens here, just plain text.');
    });

    it('returns original message when references array is empty', () => {
      const sourceMessages = [createUserMessage([], '{{file-ref:ref-1}}')];

      const [message] = buildModelReadyMessages(sourceMessages, new Map());

      expect(message.content).toBe('{{file-ref:ref-1}}');
    });

    it('preserves token when referenceId is not in references', () => {
      const sourceMessages = [createUserMessage([], 'Check {{file-ref:missing-id}}')];

      const [message] = buildModelReadyMessages(sourceMessages, new Map());

      expect(message.content).toBe('Check {{file-ref:missing-id}}');
    });

    it('preserves token when snapshotId is empty string', () => {
      const ref = createReference({ snapshotId: '', token: '{{file-ref:ref-1}}' });
      const sourceMessages = [createUserMessage([ref])];
      const snapshotsById = new Map<string, ChatReferenceSnapshot>([['snapshot-1', createSnapshot('data')]]);

      const [message] = buildModelReadyMessages(sourceMessages, snapshotsById);

      expect(message.content).toContain('{{file-ref:ref-1}}');
      expect(message.content).not.toContain('全文内容');
    });

    it('preserves token when snapshotId is valid but not in the map', () => {
      const ref = createReference({ snapshotId: 'missing-snapshot' });
      const sourceMessages = [createUserMessage([ref])];
      // Map 中不含 missing-snapshot
      const snapshotsById = new Map<string, ChatReferenceSnapshot>([['snapshot-1', createSnapshot('data')]]);

      const [message] = buildModelReadyMessages(sourceMessages, snapshotsById);

      expect(message.content).toContain('{{file-ref:ref-1}}');
      expect(message.content).not.toContain('全文内容');
    });
  });

  describe('regression: content tier strategy', () => {
    it('uses full-content for ≤200 lines, excerpt for ≤800 lines, overview+excerpt for >800 lines', () => {
      // 小文件：≤200 行 → 全文内容
      const smallContent = generateLines(10);
      const smallSnapshot = createSnapshot(smallContent, { id: 'snap-s' });
      const smallMsg = buildModelReadyMessages(
        [createUserMessage([createReference({ id: 's1', snapshotId: 'snap-s', line: '5', token: '{{file-ref:s1}}' })], 'Check {{file-ref:s1}}')],
        new Map([['snap-s', smallSnapshot]])
      )[0];
      expect(smallMsg.content).toContain('全文内容');
      expect(smallMsg.content).not.toContain('附近片段');
      expect(smallMsg.content).not.toContain('文档标题');

      // 中等文件：201-800 行 → 附近片段
      const mediumContent = generateLines(300);
      const mediumSnapshot = createSnapshot(mediumContent, { id: 'snap-m' });
      const mediumMsg = buildModelReadyMessages(
        [createUserMessage([createReference({ id: 'm1', snapshotId: 'snap-m', line: '150', token: '{{file-ref:m1}}' })], 'Check {{file-ref:m1}}')],
        new Map([['snap-m', mediumSnapshot]])
      )[0];
      expect(mediumMsg.content).not.toContain('全文内容');
      expect(mediumMsg.content).toContain('附近片段');
      expect(mediumMsg.content).not.toContain('文档标题');

      // 大文件：>800 行 → 文档概述 + 附近片段
      const largeContent = generateLines(900);
      const largeSnapshot = createSnapshot(largeContent, { id: 'snap-l' });
      const largeMsg = buildModelReadyMessages(
        [createUserMessage([createReference({ id: 'l1', snapshotId: 'snap-l', line: '450', token: '{{file-ref:l1}}' })], 'Check {{file-ref:l1}}')],
        new Map([['snap-l', largeSnapshot]])
      )[0];
      expect(largeMsg.content).toContain('文档标题');
      expect(largeMsg.content).toContain('附近片段');
      expect(largeMsg.content).not.toContain('全文内容');
    });

    it('excerpts nearby lines based on the reference line range', () => {
      const content = generateLines(500);
      // 引用第 250 行，附近片段应包含 ±120 行（第 130-370 行）
      const snapshot = createSnapshot(content, { id: 'snap-x' });
      const [message] = buildModelReadyMessages(
        [createUserMessage([createReference({ id: 'x1', snapshotId: 'snap-x', line: '250', token: '{{file-ref:x1}}' })], '{{file-ref:x1}}')],
        new Map([['snap-x', snapshot]])
      );

      // 附近片段应从第 130 行开始，到第 370 行结束
      expect(message.content).toContain('line 130');
      expect(message.content).toContain('line 370');
      // 第 129 行和 371 行不在片段内
      expect(message.content).not.toContain('line 129\nline 130');
      expect(message.content).not.toContain('line 370\nline 371');
    });
  });

  describe('brief annotation format', () => {
    it('outputs reference line in brief annotation', () => {
      const ref1 = createReference({ id: 'ref-1', line: '3', token: '{{file-ref:ref-1}}' });
      const ref2 = createReference({ id: 'ref-2', line: '3-5', snapshotId: 'snapshot-1', token: '{{file-ref:ref-2}}' });
      const content = '{{file-ref:ref-1}} then {{file-ref:ref-2}}';

      const sourceMessages = [createUserMessage([ref1, ref2], content)];
      const snapshotsById = new Map<string, ChatReferenceSnapshot>([['snapshot-1', createSnapshot('a\nb\nc\nd\ne')]]);

      const [message] = buildModelReadyMessages(sourceMessages, snapshotsById);

      // 第二个 token 的简洁标注应包含其自身行号
      expect(message.content).toContain('[引用：draft.md 第3-5行]');
    });

    it('omits line label when line is empty', () => {
      const ref1 = createReference({ id: 'ref-1', line: '3', token: '{{file-ref:ref-1}}' });
      const ref2 = createReference({ id: 'ref-2', line: '', snapshotId: 'snapshot-1', token: '{{file-ref:ref-2}}' });
      const content = '{{file-ref:ref-1}} then {{file-ref:ref-2}}';

      const sourceMessages = [createUserMessage([ref1, ref2], content)];
      const snapshotsById = new Map<string, ChatReferenceSnapshot>([['snapshot-1', createSnapshot('a\nb\nc')]]);

      const [message] = buildModelReadyMessages(sourceMessages, snapshotsById);

      expect(message.content).toContain('[引用：draft.md]');
      expect(message.content).not.toContain('[引用：draft.md 第');
    });

    it('uses fileName instead of full path in brief annotation', () => {
      const ref1 = createReference({
        id: 'ref-1',
        line: '3',
        token: '{{file-ref:ref-1}}',
        path: '/Users/alice/projects/myapp/src/foo.ts',
        fileName: 'foo.ts'
      });
      const ref2 = createReference({
        id: 'ref-2',
        line: '10',
        snapshotId: 'snapshot-1',
        token: '{{file-ref:ref-2}}',
        path: '/Users/alice/projects/myapp/src/foo.ts',
        fileName: 'foo.ts'
      });
      const content = '{{file-ref:ref-1}} and {{file-ref:ref-2}}';

      const sourceMessages = [createUserMessage([ref1, ref2], content)];
      const snapshotsById = new Map<string, ChatReferenceSnapshot>([['snapshot-1', createSnapshot('a\nb\nc')]]);

      const [message] = buildModelReadyMessages(sourceMessages, snapshotsById);

      // 简洁标注不暴露完整路径
      expect(message.content).toContain('[引用：foo.ts 第10行]');
      expect(message.content).not.toContain('[引用：/Users/');
    });
  });
});
