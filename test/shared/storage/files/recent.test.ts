/**
 * @file recent.test.ts
 * @description 验证最近记录存储对历史文件数据的迁移兼容行为。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRecentKey, recentFilesStorage } from '@/shared/storage/files/recent';
import { hashString } from '@/shared/utils/hash';

/** Electron Store 测试替身。 */
const mockElectronAPI = vi.hoisted(() => ({
  storeGet: vi.fn<(_key: string) => Promise<unknown>>(),
  storeSet: vi.fn<(_key: string, _value: unknown) => Promise<void>>()
}));

vi.mock('@/shared/platform/electron-api', () => ({
  getElectronAPI: () => mockElectronAPI
}));

describe('recentFilesStorage.getAllRecentFiles', () => {
  beforeEach((): void => {
    mockElectronAPI.storeGet.mockReset();
    mockElectronAPI.storeSet.mockReset();
    mockElectronAPI.storeSet.mockResolvedValue(undefined);
  });

  it('normalizes legacy file records that miss text fields', async (): Promise<void> => {
    mockElectronAPI.storeGet.mockResolvedValue([
      {
        id: 'legacy-file',
        path: '/Users/demo/Documents/Legacy.md',
        openedAt: 100
      }
    ]);

    const records = await recentFilesStorage.getAllRecentFiles();

    expect(records).toEqual([
      {
        type: 'file',
        id: 'legacy-file',
        path: '/Users/demo/Documents/Legacy.md',
        content: '',
        name: 'Legacy',
        ext: 'md',
        url: '/editor/legacy-file',
        title: 'Legacy.md',
        description: '/Users/demo/Documents/Legacy.md',
        openedAt: 100
      }
    ]);
    expect(mockElectronAPI.storeSet).toHaveBeenCalledWith('recent_files', records);
  });

  it('preserves widget records during normalization', async (): Promise<void> => {
    mockElectronAPI.storeGet.mockResolvedValue([
      {
        type: 'widget',
        id: 'widget-weather',
        path: '/Users/demo/.tibis/widgets/weather/widget.json',
        content: '{"name":"天气"}',
        name: 'weather',
        ext: 'json',
        openedAt: 200
      }
    ]);

    const records = await recentFilesStorage.getAllRecentFiles();

    expect(records[0]).toMatchObject({
      type: 'widget',
      id: 'widget-weather',
      path: '/Users/demo/.tibis/widgets/weather/widget.json',
      content: '{"name":"天气"}',
      name: 'weather',
      ext: 'json',
      url: '/widget/widget-weather',
      title: 'weather.json',
      description: '/Users/demo/.tibis/widgets/weather/widget.json',
      openedAt: 200
    });
    expect(mockElectronAPI.storeSet).toHaveBeenCalledWith('recent_files', records);
  });

  it('migrates unknown record types to files', async (): Promise<void> => {
    mockElectronAPI.storeGet.mockResolvedValue([
      {
        type: 'unknown',
        id: 'legacy-record',
        path: '/Users/demo/Legacy.md',
        content: '# Legacy',
        openedAt: 100
      }
    ]);

    const records = await recentFilesStorage.getAllRecentFiles();

    expect(records[0]).toMatchObject({
      type: 'file',
      id: 'legacy-record',
      path: '/Users/demo/Legacy.md',
      content: '# Legacy',
      name: 'Legacy',
      ext: 'md',
      url: '/editor/legacy-record',
      title: 'Legacy.md',
      description: '/Users/demo/Legacy.md'
    });
    expect(mockElectronAPI.storeSet).toHaveBeenCalledWith('recent_files', records);
  });

  it('drops invalid chat records that cannot resolve a session id', async (): Promise<void> => {
    mockElectronAPI.storeGet.mockResolvedValue([
      {
        type: 'chat',
        id: 'chat:',
        title: '损坏会话',
        createdAt: 1,
        openedAt: 2
      },
      {
        type: 'chat',
        id: 'session-a',
        url: '/chat/session-a',
        title: '会话 A',
        description: '聊天会话',
        createdAt: 3,
        openedAt: 4
      }
    ]);

    const records = await recentFilesStorage.getAllRecentFiles();

    expect(records).toEqual([
      {
        type: 'chat',
        id: 'session-a',
        url: '/chat/session-a',
        title: '会话 A',
        description: '聊天会话',
        createdAt: 3,
        openedAt: 4
      }
    ]);
    expect(mockElectronAPI.storeSet).toHaveBeenCalledWith('recent_files', records);
  });

  it('drops invalid webview records that cannot resolve an opening url', async (): Promise<void> => {
    mockElectronAPI.storeGet.mockResolvedValue([
      {
        type: 'webview',
        id: 'web-empty',
        title: '空地址',
        createdAt: 1,
        openedAt: 2
      },
      {
        type: 'webview',
        id: 'web-valid',
        url: 'https://example.com',
        title: 'Example Domain',
        createdAt: 3,
        openedAt: 4
      }
    ]);

    const records = await recentFilesStorage.getAllRecentFiles();

    expect(records).toEqual([
      {
        type: 'webview',
        id: 'web-valid',
        url: 'https://example.com',
        title: 'Example Domain',
        description: 'https://example.com',
        createdAt: 3,
        openedAt: 4
      }
    ]);
    expect(mockElectronAPI.storeSet).toHaveBeenCalledWith('recent_files', records);
  });
});

describe('recentFilesStorage.addWebviewRecord', () => {
  beforeEach((): void => {
    mockElectronAPI.storeGet.mockReset();
    mockElectronAPI.storeSet.mockReset();
    mockElectronAPI.storeSet.mockResolvedValue(undefined);
  });

  it('persists favicon when creating a webview record', async (): Promise<void> => {
    mockElectronAPI.storeGet.mockResolvedValue([]);

    const record = await recentFilesStorage.addWebviewRecord('https://example.com', 'Example Domain', {
      favicon: 'https://example.com/favicon.ico'
    });

    expect(record).toMatchObject({
      type: 'webview',
      id: hashString('https://example.com'),
      url: 'https://example.com',
      title: 'Example Domain',
      description: 'https://example.com',
      favicon: 'https://example.com/favicon.ico'
    });
    expect(mockElectronAPI.storeSet).toHaveBeenCalledWith('recent_files', [record]);
  });

  it('rejects blank webview urls without writing an invalid record', async (): Promise<void> => {
    mockElectronAPI.storeGet.mockResolvedValue([]);

    await expect(recentFilesStorage.addWebviewRecord('   ', 'Empty URL')).rejects.toThrow('Webview url is required');
    expect(mockElectronAPI.storeSet).not.toHaveBeenCalled();
  });

  it('preserves an existing favicon when a later update has no favicon', async (): Promise<void> => {
    mockElectronAPI.storeGet.mockResolvedValue([
      {
        type: 'webview',
        id: hashString('https://example.com'),
        url: 'https://example.com',
        title: 'Example Domain',
        favicon: 'https://example.com/favicon.ico',
        createdAt: 1,
        openedAt: 2
      }
    ]);

    const record = await recentFilesStorage.addWebviewRecord('https://example.com', 'Example Domain Updated');

    expect(record.favicon).toBe('https://example.com/favicon.ico');
  });
});

describe('recentFilesStorage.addChatRecord', () => {
  beforeEach((): void => {
    mockElectronAPI.storeGet.mockReset();
    mockElectronAPI.storeSet.mockReset();
    mockElectronAPI.storeSet.mockResolvedValue(undefined);
  });

  it('creates a chat record keyed by session id', async (): Promise<void> => {
    mockElectronAPI.storeGet.mockResolvedValue([]);

    const record = await recentFilesStorage.addChatRecord('session-a', '会话 A');

    expect(record).toMatchObject({
      type: 'chat',
      id: 'session-a',
      url: '/chat/session-a',
      title: '会话 A',
      description: '聊天会话'
    });
    expect(createRecentKey(record)).toBe('chat:session-a');
    expect(mockElectronAPI.storeSet).toHaveBeenCalledWith('recent_files', [record]);
  });

  it('updates an existing chat record title and openedAt', async (): Promise<void> => {
    mockElectronAPI.storeGet.mockResolvedValue([
      {
        type: 'chat',
        id: 'chat:session-a',
        sessionId: 'session-a',
        title: '旧标题',
        createdAt: 1,
        openedAt: 2
      }
    ]);

    const record = await recentFilesStorage.addChatRecord('session-a', '新标题');

    expect(record).toMatchObject({
      type: 'chat',
      id: 'session-a',
      url: '/chat/session-a',
      title: '新标题',
      description: '聊天会话',
      createdAt: 1
    });
    expect(record.openedAt).toBeGreaterThan(2);
    expect(mockElectronAPI.storeSet).toHaveBeenCalledWith('recent_files', [record]);
  });

  it('moves an updated existing chat record to the front of persisted records', async (): Promise<void> => {
    const fileRecord = {
      type: 'file',
      id: 'file-a',
      path: '/Users/demo/A.md',
      content: '',
      name: 'A',
      ext: 'md',
      url: '/editor/file-a',
      title: 'A.md',
      description: '/Users/demo/A.md',
      openedAt: 100
    };
    mockElectronAPI.storeGet.mockResolvedValue([
      fileRecord,
      {
        type: 'chat',
        id: 'chat:session-a',
        sessionId: 'session-a',
        title: '旧标题',
        createdAt: 1,
        openedAt: 2
      }
    ]);

    const record = await recentFilesStorage.addChatRecord('session-a', '新标题');

    expect(mockElectronAPI.storeSet).toHaveBeenCalledWith('recent_files', [record, fileRecord]);
  });

  it('rejects blank chat session ids without writing an invalid record', async (): Promise<void> => {
    mockElectronAPI.storeGet.mockResolvedValue([]);

    await expect(recentFilesStorage.addChatRecord('   ', '会话 A')).rejects.toThrow('Chat session id is required');
    expect(mockElectronAPI.storeSet).not.toHaveBeenCalled();
  });
});

describe('recentFilesStorage.updateChatRecordTitle', () => {
  beforeEach((): void => {
    mockElectronAPI.storeGet.mockReset();
    mockElectronAPI.storeSet.mockReset();
    mockElectronAPI.storeSet.mockResolvedValue(undefined);
  });

  it('updates an existing chat recent title without changing openedAt', async (): Promise<void> => {
    mockElectronAPI.storeGet.mockResolvedValue([
      {
        type: 'chat',
        id: 'chat:session-a',
        sessionId: 'session-a',
        title: '旧标题',
        createdAt: 1,
        openedAt: 2
      }
    ]);

    const record = await recentFilesStorage.updateChatRecordTitle('session-a', '新标题');

    expect(record).toMatchObject({
      type: 'chat',
      id: 'session-a',
      url: '/chat/session-a',
      title: '新标题',
      description: '聊天会话',
      createdAt: 1,
      openedAt: 2
    });
    expect(mockElectronAPI.storeSet).toHaveBeenCalledWith('recent_files', [record]);
  });

  it('returns null without writing when no chat recent record matches', async (): Promise<void> => {
    mockElectronAPI.storeGet.mockResolvedValue([]);

    const record = await recentFilesStorage.updateChatRecordTitle('session-a', '新标题');

    expect(record).toBeNull();
    expect(mockElectronAPI.storeSet).not.toHaveBeenCalled();
  });
});

describe('recentFilesStorage.removeRecentFile', () => {
  beforeEach((): void => {
    mockElectronAPI.storeGet.mockReset();
    mockElectronAPI.storeSet.mockReset();
    mockElectronAPI.storeSet.mockResolvedValue(undefined);
  });

  it('does not remove chat records that only match a bare file id', async (): Promise<void> => {
    const fileRecord = {
      type: 'file',
      id: 'shared-id',
      path: null,
      content: '',
      name: 'Untitled',
      ext: 'md',
      url: '/editor/shared-id',
      title: 'Untitled.md',
      description: '未保存文件',
      createdAt: 1,
      openedAt: 2
    };
    const chatRecord = {
      type: 'chat',
      id: 'shared-id',
      url: '/chat/shared-id',
      title: '同 ID 会话',
      description: '聊天会话',
      createdAt: 3,
      openedAt: 4
    };
    mockElectronAPI.storeGet.mockResolvedValue([fileRecord, chatRecord]);

    await recentFilesStorage.removeRecentFile('shared-id');

    expect(mockElectronAPI.storeSet).toHaveBeenLastCalledWith('recent_files', [chatRecord]);
  });

  it('removes chat records by their stable recent key', async (): Promise<void> => {
    const fileRecord = {
      type: 'file',
      id: 'shared-id',
      path: null,
      content: '',
      name: 'Untitled',
      ext: 'md',
      url: '/editor/shared-id',
      title: 'Untitled.md',
      description: '未保存文件',
      createdAt: 1,
      openedAt: 2
    };
    const chatRecord = {
      type: 'chat',
      id: 'shared-id',
      url: '/chat/shared-id',
      title: '同 ID 会话',
      description: '聊天会话',
      createdAt: 3,
      openedAt: 4
    };
    mockElectronAPI.storeGet.mockResolvedValue([fileRecord, chatRecord]);

    await recentFilesStorage.removeRecentFile('chat:shared-id');

    expect(mockElectronAPI.storeSet).toHaveBeenLastCalledWith('recent_files', [expect.objectContaining(fileRecord)]);
  });
});
