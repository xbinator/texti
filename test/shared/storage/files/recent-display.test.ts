/**
 * @file recent-display.test.ts
 * @description 验证最近记录展示派生字段，避免页面层重复判断记录类型。
 */
import { describe, expect, it } from 'vitest';
import type { RecentRecord } from '@/shared/storage';
import { createRecentSearchText, getRecentDescriptionClass, isRecentDocumentPath, resolveRecentDescription, resolveRecentTitle } from '@/shared/storage';

/**
 * 创建文件最近记录。
 * @param overrides - 覆盖字段
 * @returns 文件最近记录
 */
function createFileRecord(overrides: Partial<Extract<RecentRecord, { type: 'file' }>> = {}): Extract<RecentRecord, { type: 'file' }> {
  return {
    type: 'file',
    id: 'file-1',
    url: '/editor/file-1',
    title: 'alpha.md',
    description: '/tmp/alpha.md',
    path: '/tmp/alpha.md',
    content: '',
    savedContent: '',
    name: 'alpha',
    ext: 'md',
    ...overrides
  };
}

/**
 * 创建聊天最近记录。
 * @param overrides - 覆盖字段
 * @returns 聊天最近记录
 */
function createChatRecord(overrides: Partial<Extract<RecentRecord, { type: 'chat' }>> = {}): Extract<RecentRecord, { type: 'chat' }> {
  return {
    type: 'chat',
    id: 'session-a',
    url: '/chat/session-a',
    title: '会话 A',
    description: '聊天会话',
    ...overrides
  };
}

describe('recent display helpers', (): void => {
  it('derives document title and unsaved description when display fields are missing', (): void => {
    const record = createFileRecord({
      title: '',
      description: undefined,
      path: null,
      name: 'draft',
      ext: 'md'
    });

    expect(resolveRecentTitle(record)).toBe('draft.md');
    expect(resolveRecentDescription(record)).toBe('未保存文件');
    expect(getRecentDescriptionClass(record)).toBe('is-unsaved');
  });

  it('creates search text from public record fields and document metadata only', (): void => {
    const record = createFileRecord({ content: 'hidden-body', name: 'visible-name' });
    const searchText = createRecentSearchText(record);

    expect(searchText).toContain('visible-name');
    expect(searchText).toContain('/tmp/alpha.md');
    expect(searchText).not.toContain('hidden-body');
  });

  it('matches document paths without matching chat records', (): void => {
    expect(isRecentDocumentPath(createFileRecord(), '/tmp/alpha.md')).toBe(true);
    expect(isRecentDocumentPath(createChatRecord(), '/tmp/alpha.md')).toBe(false);
  });
});
