/**
 * @file file-reference-context.test.ts
 * @description Test coverage for file-reference model context building.
 */
import type { ChatMessageFileReferencePart } from 'types/chat';
import { describe, expect, it } from 'vitest';
import { buildModelReadyMessages } from '@/components/BChatSidebar/utils/fileReferenceContext';
import type { Message } from '@/components/BChatSidebar/utils/types';

/**
 * 创建标准文件引用片段 fixture
 * @param overrides - 部分属性覆盖
 * @returns 文件引用片段 fixture
 */
function createReferencePart(overrides: Partial<ChatMessageFileReferencePart> = {}): ChatMessageFileReferencePart {
  return {
    type: 'file-reference',
    documentId: 'doc-1',
    snapshotId: 'snapshot-1',
    fileName: 'draft.md',
    path: 'docs/draft.md',
    startLine: 12,
    endLine: 14,
    ...overrides
  };
}

/**
 * 创建用户消息 fixture
 * @param parts - 消息片段列表
 * @param content - 消息内容
 * @returns 用户消息 fixture
 */
function createUserMessage(parts: ChatMessageFileReferencePart[], content?: string): Message {
  const messageContent = content ?? 'Please review the file.';
  return {
    id: 'message-1',
    role: 'user',
    content: messageContent,
    parts: [{ type: 'text', text: messageContent }, ...parts],
    createdAt: '2026-04-25T00:00:01.000Z'
  };
}

describe('file reference context builder', () => {
  it('prepends reference index block for user messages with file references', () => {
    const refPart = createReferencePart();
    const sourceMessages = [createUserMessage([refPart], 'Please check this file.')];

    const [message] = buildModelReadyMessages(sourceMessages);

    expect(message.content).toContain('File References:');
    expect(message.content).toContain('[doc-1] docs/draft.md (lines 12-14)');
    expect(message.content).toContain('Please check this file.');
  });

  it('does not modify non-user messages', () => {
    const assistantMessage: Message = {
      id: 'assistant-1',
      role: 'assistant',
      content: 'Some response',
      parts: [{ type: 'text', text: 'Some response' }],
      createdAt: '2026-04-25T00:00:01.000Z'
    };

    const [message] = buildModelReadyMessages([assistantMessage]);

    expect(message.content).toBe('Some response');
  });

  it('returns original message when there are no file references', () => {
    const sourceMessages = [createUserMessage([], 'No references here.')];

    const [message] = buildModelReadyMessages(sourceMessages);

    expect(message.content).toBe('No references here.');
  });

  it('formats single line reference correctly', () => {
    const refPart = createReferencePart({ startLine: 5, endLine: 5 });
    const sourceMessages = [createUserMessage([refPart])];

    const [message] = buildModelReadyMessages(sourceMessages);

    expect(message.content).toContain('[doc-1] docs/draft.md (line 5)');
  });

  it('marks unsaved documents correctly', () => {
    const refPart = createReferencePart({ path: null });
    const sourceMessages = [createUserMessage([refPart])];

    const [message] = buildModelReadyMessages(sourceMessages);

    expect(message.content).toContain('(unsaved)');
  });

  it('handles multiple file references from different files', () => {
    const ref1 = createReferencePart({ documentId: 'doc-1', fileName: 'foo.ts', path: 'src/foo.ts', startLine: 3, endLine: 5 });
    const ref2 = createReferencePart({ documentId: 'doc-2', fileName: 'bar.ts', path: 'src/bar.ts', startLine: 10, endLine: 20 });
    const sourceMessages = [createUserMessage([ref1, ref2])];

    const [message] = buildModelReadyMessages(sourceMessages);

    expect(message.content).toContain('[doc-1] src/foo.ts (lines 3-5)');
    expect(message.content).toContain('[doc-2] src/bar.ts (lines 10-20)');
  });

  it('handles reference with no explicit line range', () => {
    const refPart = createReferencePart({ startLine: 0, endLine: 0 });
    const sourceMessages = [createUserMessage([refPart])];

    const [message] = buildModelReadyMessages(sourceMessages);

    expect(message.content).toContain('[doc-1] docs/draft.md');
    expect(message.content).not.toContain('line');
  });
});
