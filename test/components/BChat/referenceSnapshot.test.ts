/**
 * @file referenceSnapshot.test.ts
 * @description 文件引用快照持久化测试。
 */
import type { Message } from '@/components/BChatSidebar/utils/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const upsertReferenceSnapshots = vi.fn<(snapshots: Array<{ id: string; documentId: string; title: string; content: string; createdAt: string }>) => Promise<void>>();
const getReferenceSnapshotByDocumentId = vi.fn<(documentId: string) => Promise<{
  id: string;
  documentId: string;
  title: string;
  content: string;
  createdAt: string;
} | undefined>>();
const readFile = vi.fn<(filePath: string) => Promise<{ name: string; content: string }>>();

vi.mock('@/shared/storage', () => ({
  chatStorage: {
    upsertReferenceSnapshots,
    getReferenceSnapshotByDocumentId
  }
}));

vi.mock('@/shared/platform', () => ({
  native: {
    readFile
  }
}));

/**
 * 创建测试消息。
 * @returns 包含同文档多引用的用户消息
 */
function createMessage(): Message {
  return {
    id: 'message-1',
    role: 'user',
    content: '请看',
    createdAt: '2026-05-02T00:00:00.000Z',
    parts: [
      { type: 'text', text: '请看 ' },
      {
        type: 'file-reference',
        referenceId: 'ref-1',
        documentId: 'doc-1',
        snapshotId: '',
        fileName: 'foo.ts',
        path: '/workspace/foo.ts',
        startLine: 3,
        endLine: 5
      },
      {
        type: 'file-reference',
        referenceId: 'ref-2',
        documentId: 'doc-1',
        snapshotId: '',
        fileName: 'foo.ts',
        path: '/workspace/foo.ts',
        startLine: 20,
        endLine: 24
      }
    ]
  };
}

describe('persistReferenceSnapshots', () => {
  beforeEach(() => {
    vi.resetModules();
    upsertReferenceSnapshots.mockReset();
    getReferenceSnapshotByDocumentId.mockReset();
    readFile.mockReset();
  });

  it('reuses one snapshot for multiple file-reference parts from the same document', async () => {
    readFile.mockResolvedValue({
      name: 'foo.ts',
      content: 'line 1\nline 2\nline 3'
    });

    const { persistReferenceSnapshots } = await import('@/components/BChatSidebar/utils/referenceSnapshot');
    const message = createMessage();

    await persistReferenceSnapshots(message);

    const fileReferenceParts = message.parts.filter(
      (part): part is Extract<Message['parts'][number], { type: 'file-reference' }> => part.type === 'file-reference'
    );

    expect(readFile).toHaveBeenCalledTimes(1);
    expect(new Set(fileReferenceParts.map((part) => part.snapshotId)).size).toBe(1);
    expect(upsertReferenceSnapshots).toHaveBeenCalledTimes(1);
  });
});
