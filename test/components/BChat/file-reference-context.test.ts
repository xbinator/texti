/**
 * @file file-reference-context.test.ts
 * @description Regression coverage for snapshot-backed file-reference model context building.
 */
import { describe, expect, it } from 'vitest';
import type { ChatMessageFileReference, ChatReferenceSnapshot } from 'types/chat';
import type { Message } from '@/components/BChat/types';
import { buildModelReadyMessages, parseLineRange } from '@/components/BChat/utils/fileReferenceContext';

/**
 * Creates a normalized file reference fixture.
 * @param overrides - Partial fixture overrides.
 * @returns File reference fixture.
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
 * Creates a normalized snapshot fixture.
 * @param content - Snapshot content.
 * @returns Snapshot fixture.
 */
function createSnapshot(content: string): ChatReferenceSnapshot {
  return {
    id: 'snapshot-1',
    documentId: 'doc-1',
    title: 'draft.md',
    content,
    createdAt: '2026-04-25T00:00:00.000Z'
  };
}

/**
 * Creates a user message containing a visible file-reference token.
 * @param references - References attached to the message.
 * @returns User message fixture.
 */
function createUserMessage(references: ChatMessageFileReference[]): Message {
  return {
    id: 'message-1',
    role: 'user',
    content: 'Please review {{file-ref:ref-1}}.',
    parts: [{ type: 'text', text: 'Please review {{file-ref:ref-1}}.' }],
    references,
    createdAt: '2026-04-25T00:00:01.000Z'
  };
}

describe('file reference context builder', () => {
  it('parses single lines and closed ranges using 1-based numbering', () => {
    expect(parseLineRange('12')).toEqual({ start: 12, end: 12 });
    expect(parseLineRange('12-18')).toEqual({ start: 12, end: 18 });
    expect(parseLineRange('0')).toBeNull();
    expect(parseLineRange('18-12')).toBeNull();
  });

  it('appends full snapshot content for small documents', () => {
    const sourceMessages = [createUserMessage([createReference()])];
    const snapshotsById = new Map<string, ChatReferenceSnapshot>([['snapshot-1', createSnapshot('alpha\nbeta\ngamma')]]);

    const [message] = buildModelReadyMessages(sourceMessages, snapshotsById);

    expect(message.content).toContain('Please review {{file-ref:ref-1}}.');
    expect(message.content).toContain('全文内容');
    expect(message.content).toContain('alpha\nbeta\ngamma');
  });

  it('keeps the visible message unchanged when the snapshot cannot be found', () => {
    const sourceMessages = [createUserMessage([createReference()])];
    const [message] = buildModelReadyMessages(sourceMessages, new Map());

    expect(message.content).toBe('Please review {{file-ref:ref-1}}.');
    expect(message.parts).toEqual([{ type: 'text', text: 'Please review {{file-ref:ref-1}}.' }]);
  });
});
