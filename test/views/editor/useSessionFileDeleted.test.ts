/**
 * @file useSessionFileDeleted.test.ts
 * @description 验证编辑器会话对外部文件删除事件的清理行为。
 */

import { nextTick, ref } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 模拟标记文件已丢失。
 */
const markMissingMock = vi.fn();

/**
 * 模拟清除文件丢失标记。
 */
const clearMissingMock = vi.fn();

/**
 * 模拟查询文件是否已丢失。
 */
const isMissingMock = vi.fn();

/**
 * 模拟路由跳转。
 */
const pushMock = vi.fn();

/**
 * 模拟直接写入已有路径。
 */
const writeFileMock = vi.fn();

/**
 * 模拟读取磁盘文件。
 */
const readFileMock = vi.fn();

/**
 * 模拟弹出保存对话框并写入文件。
 */
const saveFileMock = vi.fn();

/**
 * 模拟应用内确认弹窗。
 */
const confirmMock = vi.fn();

/**
 * 模拟全局文件监听注册。
 */
const registerWatchMock = vi.fn();

/**
 * 模拟全局文件监听路径更新。
 */
const updateWatchPathMock = vi.fn();

/**
 * 模拟全局文件监听注销。
 */
const unregisterWatchMock = vi.fn();

/**
 * 等待当前事件循环中的异步 watch 初始化完成。
 */
function flushAsyncTasks(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

vi.mock('vue-router', () => ({
  useRoute: () => ({
    fullPath: '/editor/doc_1',
    params: { id: 'doc_1' }
  }),
  useRouter: () => ({
    push: pushMock
  })
}));

vi.mock('@/router/cache', () => ({
  /**
   * 模拟当前路由对应的标签页信息。
   * @returns 固定的编辑器标签页信息
   */
  resolveRouteTabInfo: () => ({
    tabId: 'doc_1',
    cacheKey: 'editor:doc_1'
  })
}));

vi.mock('@/shared/platform', () => ({
  native: {
    readFile: readFileMock,
    writeFile: writeFileMock,
    saveFile: saveFileMock,
    renameFile: vi.fn(),
    trashFile: vi.fn(),
    showItemInFolder: vi.fn()
  }
}));

vi.mock('@/stores/files', () => ({
  useFilesStore: () => ({
    getFileById: vi.fn().mockResolvedValue({
      id: 'doc_1',
      name: 'note',
      content: 'content',
      ext: 'md',
      path: '/tmp/note.md',
      savedContent: 'content'
    }),
    addFile: vi.fn(),
    updateFile: vi.fn(),
    removeFile: vi.fn()
  })
}));

vi.mock('@/stores/tabs', () => ({
  useTabsStore: () => ({
    addTab: vi.fn(),
    removeTab: vi.fn(),
    markMissing: markMissingMock,
    clearMissing: clearMissingMock,
    isMissing: isMissingMock,
    clearDirty: vi.fn(),
    setDirty: vi.fn(),
    isDirty: vi.fn().mockReturnValue(false)
  })
}));

vi.mock('@/stores/editorFileWatch', () => ({
  useEditorFileWatchStore: () => ({
    register: registerWatchMock,
    updatePath: updateWatchPathMock,
    unregister: unregisterWatchMock
  })
}));

vi.mock('@/utils/modal', () => ({
  Modal: {
    input: vi.fn(),
    delete: vi.fn(),
    confirm: confirmMock,
    alert: vi.fn()
  }
}));

vi.mock('@/views/editor/hooks/useFileWatcher', () => ({
  useFileWatcher: () => ({
    switchWatchedFile: vi.fn(),
    clearWatchedFile: vi.fn(),
    setOnFileChanged: vi.fn(),
    setIsDirty: vi.fn(),
    finishReload: vi.fn()
  })
}));

describe('useSession external file deletion', () => {
  beforeEach(() => {
    markMissingMock.mockClear();
    clearMissingMock.mockClear();
    isMissingMock.mockReset();
    isMissingMock.mockReturnValue(false);
    pushMock.mockClear();
    readFileMock.mockReset();
    readFileMock.mockResolvedValue({
      content: 'content',
      name: 'note.md',
      ext: 'md'
    });
    writeFileMock.mockClear();
    saveFileMock.mockReset();
    confirmMock.mockReset();
    registerWatchMock.mockReset();
    updateWatchPathMock.mockReset();
    unregisterWatchMock.mockReset();
    registerWatchMock.mockResolvedValue(undefined);
    updateWatchPathMock.mockResolvedValue(undefined);
    unregisterWatchMock.mockResolvedValue(undefined);
  });

  it('registers the loaded file path with the global watcher', async () => {
    const { useSession } = await import('@/views/editor/hooks/useSession');

    useSession(ref('doc_1'));

    await nextTick();
    await flushAsyncTasks();

    expect(registerWatchMock).toHaveBeenCalledWith('doc_1', '/tmp/note.md');
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('restores the deleted file at its original path when saving a missing tab', async () => {
    const { useSession } = await import('@/views/editor/hooks/useSession');

    const session = useSession(ref('doc_1'));

    await nextTick();
    await Promise.resolve();
    readFileMock.mockReset();
    readFileMock.mockRejectedValue(new Error('missing'));
    isMissingMock.mockReturnValue(true);

    await session.actions.onSave();

    expect(writeFileMock).toHaveBeenCalledWith('/tmp/note.md', 'content');
    expect(saveFileMock).not.toHaveBeenCalled();
    expect(clearMissingMock).toHaveBeenCalledWith('doc_1');
  });

  it('asks before overwriting when the original path is occupied again', async () => {
    const { useSession } = await import('@/views/editor/hooks/useSession');
    confirmMock.mockResolvedValue([false]);

    const session = useSession(ref('doc_1'));

    await nextTick();
    await Promise.resolve();
    readFileMock.mockClear();
    isMissingMock.mockReturnValue(true);

    await session.actions.onSave();

    expect(confirmMock).toHaveBeenCalledWith('文件已存在', '原文件路径已重新出现同名文件。是否覆盖它？', {
      confirmText: '覆盖',
      cancelText: '取消'
    });
    expect(writeFileMock).toHaveBeenCalledWith('/tmp/note.md', 'content');
    expect(clearMissingMock).toHaveBeenCalledWith('doc_1');
  });

  it('falls back to save dialog when restoring the original path fails', async () => {
    const { useSession } = await import('@/views/editor/hooks/useSession');
    saveFileMock.mockResolvedValue('/tmp/recovered.md');
    writeFileMock.mockRejectedValue(new Error('parent missing'));

    const session = useSession(ref('doc_1'));

    await nextTick();
    await Promise.resolve();
    readFileMock.mockReset();
    readFileMock.mockRejectedValue(new Error('missing'));
    isMissingMock.mockReturnValue(true);

    await session.actions.onSave();

    expect(saveFileMock).toHaveBeenCalledWith('content', undefined, { defaultPath: '/tmp/note-recovered.md' });
    expect(clearMissingMock).toHaveBeenCalledWith('doc_1');
  });
});
