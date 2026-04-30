/**
 * @file useDraftInput.test.ts
 * @description useDraftInput 图片草稿状态测试
 */
import type { ChatMessageFile, ChatMessageFileReference } from 'types/chat';
import { describe, expect, it, vi } from 'vitest';
import { useDraftInput } from '@/components/BChatSidebar/hooks/useDraftInput';
import type { Message } from '@/components/BChatSidebar/utils/types';

/**
 * 创建测试图片附件。
 * @returns 测试图片附件
 */
function createImageFile(): ChatMessageFile {
  return {
    id: 'image-1',
    name: 'diagram.png',
    type: 'image',
    mimeType: 'image/png',
    size: 1024,
    extension: 'png',
    url: 'data:image/png;base64,ZmFrZS1pbWFnZQ==',
    contentHash: 'hash-1'
  };
}

/**
 * 创建测试引用。
 * @returns 测试文件引用
 */
function createReference(): ChatMessageFileReference {
  return {
    id: 'ref-1',
    token: '{{file-ref:1}}',
    documentId: 'doc-1',
    fileName: 'guide.md',
    line: '1-3',
    path: '/docs/guide.md',
    snapshotId: 'snapshot-1'
  };
}

describe('useDraftInput', () => {
  it('tracks image drafts independently from text emptiness', () => {
    const focusInput = vi.fn();
    const draftInput = useDraftInput({ focusInput });

    expect(draftInput.isEmpty()).toBe(true);
    expect(draftInput.hasImages()).toBe(false);

    draftInput.addImages([createImageFile()]);

    expect(draftInput.isEmpty()).toBe(true);
    expect(draftInput.hasImages()).toBe(true);

    draftInput.removeImage('image-1');

    expect(draftInput.hasImages()).toBe(false);
  });

  it('restores image drafts and clears them together with references', () => {
    const focusInput = vi.fn();
    const draftInput = useDraftInput({ focusInput });
    const reference = createReference();
    const message: Message = {
      id: 'message-1',
      role: 'user',
      content: '请看这张图',
      parts: [{ type: 'text', text: '请看这张图' }],
      references: [reference],
      files: [createImageFile()],
      createdAt: '2026-05-01T00:00:00.000Z',
      finished: true
    };

    draftInput.restoreFromMessage(message);

    expect(draftInput.inputValue.value).toBe('请看这张图');
    expect(draftInput.draftReferences.value).toEqual([reference]);
    expect(draftInput.draftImages.value).toEqual([createImageFile()]);

    draftInput.clear();

    expect(draftInput.inputValue.value).toBe('');
    expect(draftInput.draftReferences.value).toEqual([]);
    expect(draftInput.draftImages.value).toEqual([]);
    expect(focusInput).toHaveBeenCalledTimes(1);
  });
});
