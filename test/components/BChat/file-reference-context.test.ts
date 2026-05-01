/**
 * @file file-reference-context.test.ts
 * @description Test coverage for {{file-ref:...}} token to [file: ...] marker conversion.
 */
import type { ChatMessageFileReference } from 'types/chat';
import { describe, expect, it } from 'vitest';
import { convertFileRefTokensToMarkers, parseLineRange } from '@/components/BChatSidebar/utils/fileReferenceContext';
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
    path: '/project/docs/draft.md',
    snapshotId: 'snapshot-1',
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

describe('file reference marker converter', () => {
  describe('parseLineRange', () => {
    it('parses single lines and closed ranges using 1-based numbering', () => {
      expect(parseLineRange('12')).toEqual({ start: 12, end: 12 });
      expect(parseLineRange('12-18')).toEqual({ start: 12, end: 18 });
      expect(parseLineRange('0')).toBeNull();
      expect(parseLineRange('18-12')).toBeNull();
    });
  });

  describe('marker conversion', () => {
    it('replaces file-ref token with [file: ...] marker for files with path', () => {
      const sourceMessages = [createUserMessage([createReference()])];

      const [message] = convertFileRefTokensToMarkers(sourceMessages);

      expect(message.content).toContain('Please review ');
      expect(message.content).toContain('[file: /project/docs/draft.md#L12-L14]');
      expect(message.content).not.toContain('{{file-ref:ref-1}}');
    });

    it('replaces file-ref token with [file: id=...] marker for unsaved files (no path)', () => {
      const ref = createReference({ path: null, line: '3-5' });
      const sourceMessages = [createUserMessage([ref], 'Check {{file-ref:ref-1}}')];

      const [message] = convertFileRefTokensToMarkers(sourceMessages);

      expect(message.content).toContain('[file: id=doc-1 name="draft.md" @L3-L5]');
      expect(message.content).not.toContain('{{file-ref:ref-1}}');
    });

    it('omits line annotation for full-file references (line is empty)', () => {
      const ref = createReference({ line: '' });
      const sourceMessages = [createUserMessage([ref])];

      const [message] = convertFileRefTokensToMarkers(sourceMessages);

      expect(message.content).toContain('[file: /project/docs/draft.md]');
      expect(message.content).not.toContain('#L');
    });

    it('omits line annotation for unsaved full-file references', () => {
      const ref = createReference({ path: null, line: '' });
      const sourceMessages = [createUserMessage([ref], '{{file-ref:ref-1}}')];

      const [message] = convertFileRefTokensToMarkers(sourceMessages);

      expect(message.content).toContain('[file: id=doc-1 name="draft.md"]');
      expect(message.content).not.toContain('@L');
    });

    it('handles single-line references correctly', () => {
      const ref = createReference({ line: '3' });
      const sourceMessages = [createUserMessage([ref], 'Check {{file-ref:ref-1}}')];

      const [message] = convertFileRefTokensToMarkers(sourceMessages);

      expect(message.content).toContain('[file: /project/docs/draft.md#L3]');
    });

    it('preserves non-text parts (e.g. tool-call) when updating content', () => {
      const ref = createReference();
      const toolCallPart = { type: 'tool-call' as const, toolCallId: 'tc-1', toolName: 'read_file', input: { path: '/x' } };
      const msg: Message = {
        id: 'message-2',
        role: 'user',
        content: '{{file-ref:ref-1}}',
        parts: [{ type: 'text', text: '{{file-ref:ref-1}}' }, toolCallPart],
        references: [ref],
        createdAt: '2026-04-25T00:00:01.000Z'
      };

      const [message] = convertFileRefTokensToMarkers([msg]);

      expect(message.parts).toHaveLength(2);
      expect(message.parts?.[0]).toEqual({ type: 'text', text: '[file: /project/docs/draft.md#L12-L14]' });
      expect(message.parts?.[1]).toEqual(toolCallPart);
    });
  });

  describe('fallback: unchanged content', () => {
    it('returns original message when there are no tokens in content', () => {
      const sourceMessages = [createUserMessage([createReference()], 'No tokens here, just plain text.')];

      const [message] = convertFileRefTokensToMarkers(sourceMessages);

      expect(message.content).toBe('No tokens here, just plain text.');
    });

    it('returns original message when references array is empty', () => {
      const sourceMessages = [createUserMessage([], '{{file-ref:ref-1}}')];

      const [message] = convertFileRefTokensToMarkers(sourceMessages);

      expect(message.content).toBe('{{file-ref:ref-1}}');
    });

    it('preserves token when referenceId is not in references', () => {
      const sourceMessages = [createUserMessage([], 'Check {{file-ref:missing-id}}')];

      const [message] = convertFileRefTokensToMarkers(sourceMessages);

      expect(message.content).toBe('Check {{file-ref:missing-id}}');
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

      const [message] = convertFileRefTokensToMarkers([assistantMessage]);

      expect(message.content).toBe('Some response');
    });
  });

  describe('multiple references in one message', () => {
    it('replaces all tokens with individual markers', () => {
      const ref1 = createReference({ id: 'ref-1', line: '3', path: '/project/src/a.ts', fileName: 'a.ts' });
      const ref2 = createReference({ id: 'ref-2', line: '10', path: '/project/src/b.ts', fileName: 'b.ts' });
      const content = 'Check {{file-ref:ref-1}} and {{file-ref:ref-2}}';

      const sourceMessages = [createUserMessage([ref1, ref2], content)];

      const [message] = convertFileRefTokensToMarkers(sourceMessages);

      expect(message.content).not.toContain('{{file-ref:ref-1}}');
      expect(message.content).not.toContain('{{file-ref:ref-2}}');
      expect(message.content).toContain('[file: /project/src/a.ts#L3]');
      expect(message.content).toContain('[file: /project/src/b.ts#L10]');
    });

    it('handles mixed path and pathless references', () => {
      const ref1 = createReference({ id: 'ref-1', line: '3', path: '/project/src/foo.ts', fileName: 'foo.ts' });
      const ref2 = createReference({ id: 'ref-2', line: '5-8', path: null, fileName: 'unsaved.ts' });
      const content = '{{file-ref:ref-1}} vs {{file-ref:ref-2}}';

      const sourceMessages = [createUserMessage([ref1, ref2], content)];

      const [message] = convertFileRefTokensToMarkers(sourceMessages);

      expect(message.content).toContain('[file: /project/src/foo.ts#L3]');
      expect(message.content).toContain('[file: id=doc-1 name="unsaved.ts" @L5-L8]');
    });
  });
});
