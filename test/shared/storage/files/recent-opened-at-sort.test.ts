/**
 * @file recent-opened-at-sort.test.ts
 * @description 验证最近文件存储层的 openedAt 排序、touch 行为和时间字段合并规则。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoredFile } from '@/shared/storage/files/types';

interface LocalforageMock {
  config: ReturnType<typeof vi.fn>;
  getItem: ReturnType<typeof vi.fn>;
  setItem: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
}

const mockState = vi.hoisted(() => {
  return {
    files: [] as StoredFile[]
  };
});

const localforageMock = vi.hoisted<LocalforageMock>(() => {
  return {
    config: vi.fn(),
    getItem: vi.fn(async () => mockState.files),
    setItem: vi.fn(async (_key: string, value: StoredFile[]) => {
      mockState.files = value.map((file) => ({ ...file }));
      return value;
    }),
    clear: vi.fn(async () => {
      mockState.files = [];
    })
  };
});

vi.mock('localforage', () => ({
  default: localforageMock
}));

vi.mock('@/shared/platform/electron-api', () => ({
  hasElectronAPI: (): boolean => false,
  getElectronAPI: (): never => {
    throw new Error('Electron API is not available');
  }
}));

/**
 * 生成最小可用的存储文件记录。
 * @param file - 需要覆盖的字段
 * @returns 合并后的测试文件记录
 */
function createStoredFile(file: Partial<StoredFile>): StoredFile {
  return {
    id: 'default',
    path: '/default.md',
    content: 'content',
    name: 'default',
    ext: 'md',
    ...file
  };
}

describe('recentFilesStorage openedAt sort', () => {
  beforeEach(() => {
    vi.resetModules();
    mockState.files = [];
    localforageMock.config.mockClear();
    localforageMock.getItem.mockClear();
    localforageMock.setItem.mockClear();
    localforageMock.clear.mockClear();
  });

  it('sorts files by openedAt desc, then modifiedAt desc, then createdAt desc', async () => {
    mockState.files = [
      createStoredFile({ id: 'a', path: '/a.md', name: 'a', openedAt: 10, modifiedAt: 1, createdAt: 1 }),
      createStoredFile({ id: 'b', path: '/b.md', name: 'b', openedAt: 10, modifiedAt: 2, createdAt: 1 }),
      createStoredFile({ id: 'c', path: '/c.md', name: 'c', openedAt: 9, modifiedAt: 99, createdAt: 99 }),
      createStoredFile({ id: 'd', path: '/d.md', name: 'd' })
    ];

    const { recentFilesStorage } = await import('@/shared/storage/files/recent');
    const files = await recentFilesStorage.getAllRecentFiles();

    expect(files.map((file) => file.id)).toEqual(['b', 'a', 'c', 'd']);
  });

  it('preserves existing openedAt when updateRecentFile receives openedAt as 0', async () => {
    mockState.files = [
      createStoredFile({ id: 'a', path: '/a.md', name: 'a', openedAt: 123, savedAt: 10 })
    ];

    const { recentFilesStorage } = await import('@/shared/storage/files/recent');
    await recentFilesStorage.updateRecentFile('a', {
      openedAt: 0,
      savedAt: 456
    });

    expect(mockState.files[0]?.openedAt).toBe(123);
    expect(mockState.files[0]?.savedAt).toBe(456);
  });

  it('does not reorder files when only savedAt changes', async () => {
    mockState.files = [
      createStoredFile({ id: 'a', path: '/a.md', name: 'a', openedAt: 100, savedAt: 1 }),
      createStoredFile({ id: 'b', path: '/b.md', name: 'b', openedAt: 50, savedAt: 2 })
    ];

    const { recentFilesStorage } = await import('@/shared/storage/files/recent');

    await recentFilesStorage.updateRecentFile('b', {
      savedAt: 999
    });

    const files = await recentFilesStorage.getAllRecentFiles();

    expect(mockState.files.map((file) => file.id)).toEqual(['a', 'b']);
    expect(files.map((file) => file.id)).toEqual(['a', 'b']);
    expect(mockState.files[1]?.savedAt).toBe(999);
  });

  it('touches a file by updating openedAt and moving it to the front of persisted storage', async () => {
    mockState.files = [
      createStoredFile({ id: 'a', path: '/a.md', name: 'a', openedAt: 1 }),
      createStoredFile({ id: 'b', path: '/b.md', name: 'b', openedAt: 2 })
    ];

    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(999);
    const { recentFilesStorage } = await import('@/shared/storage/files/recent');

    const touched = await recentFilesStorage.touchRecentFile('a');

    expect(touched.id).toBe('a');
    expect(touched.openedAt).toBe(999);
    expect(mockState.files.map((file) => file.id)).toEqual(['a', 'b']);
    expect(mockState.files[0]?.openedAt).toBe(999);

    nowSpy.mockRestore();
  });
});
