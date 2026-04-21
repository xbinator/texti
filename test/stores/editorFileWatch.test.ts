/**
 * @file editorFileWatch.test.ts
 * @description 验证编辑器全局文件监听 Store 的路径映射与文件丢失事件分发。
 */

import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileChangeEvent } from '@/shared/platform/native/types';

/**
 * 模拟 native.watchFile 调用。
 */
const watchFileMock = vi.fn<(filePath: string) => Promise<void>>();

/**
 * 模拟 native.unwatchFile 调用。
 */
const unwatchFileMock = vi.fn<(filePath: string) => Promise<void>>();

/**
 * 模拟 native.unwatchAll 调用。
 */
const unwatchAllMock = vi.fn<() => Promise<void>>();

/**
 * native.onFileChanged 注册的回调。
 */
let fileChangedCallback: ((event: FileChangeEvent) => void) | null = null;

/**
 * 模拟 native.onFileChanged 的取消订阅函数。
 */
const unsubscribeMock = vi.fn();

vi.mock('@/shared/platform', () => ({
  native: {
    watchFile: watchFileMock,
    unwatchFile: unwatchFileMock,
    unwatchAll: unwatchAllMock,
    onFileChanged: (callback: (event: FileChangeEvent) => void): (() => void) => {
      fileChangedCallback = callback;
      return unsubscribeMock;
    }
  }
}));

vi.mock('@/shared/storage/base', () => ({
  local: {
    getItem: () => null,
    setItem: vi.fn()
  }
}));

/**
 * 触发一次模拟的 native 文件变化事件。
 * @param event - 文件变化事件
 */
function emitFileChanged(event: FileChangeEvent): void {
  fileChangedCallback?.(event);
}

describe('useEditorFileWatchStore', () => {
  beforeEach(() => {
    vi.resetModules();
    setActivePinia(createPinia());
    watchFileMock.mockReset();
    unwatchFileMock.mockReset();
    unwatchAllMock.mockReset();
    unsubscribeMock.mockReset();
    fileChangedCallback = null;
    watchFileMock.mockResolvedValue(undefined);
    unwatchFileMock.mockResolvedValue(undefined);
    unwatchAllMock.mockResolvedValue(undefined);
  });

  it('marks every tab for the unlinked path as missing and ignores change events in phase one', async () => {
    const { useEditorFileWatchStore } = await import('@/stores/editorFileWatch');
    const { useTabsStore } = await import('@/stores/tabs');
    const watchStore = useEditorFileWatchStore();
    const tabsStore = useTabsStore();

    await watchStore.register('alpha', '/tmp/shared.md');
    await watchStore.register('beta', '/tmp/shared.md');

    emitFileChanged({ type: 'change', filePath: '/tmp/shared.md', content: 'next' });

    expect(tabsStore.isMissing('alpha')).toBe(false);
    expect(tabsStore.isMissing('beta')).toBe(false);

    emitFileChanged({ type: 'unlink', filePath: '/tmp/shared.md' });

    expect(tabsStore.isMissing('alpha')).toBe(true);
    expect(tabsStore.isMissing('beta')).toBe(true);
    expect(watchFileMock).toHaveBeenCalledTimes(1);
    expect(watchFileMock).toHaveBeenCalledWith('/tmp/shared.md');
  });

  it('keeps watching a path until the last file id is unregistered', async () => {
    const { useEditorFileWatchStore } = await import('@/stores/editorFileWatch');
    const watchStore = useEditorFileWatchStore();

    await watchStore.register('alpha', '/tmp/shared.md');
    await watchStore.register('beta', '/tmp/shared.md');
    await watchStore.unregister('alpha');

    expect(unwatchFileMock).not.toHaveBeenCalled();

    await watchStore.unregister('beta');

    expect(unwatchFileMock).toHaveBeenCalledTimes(1);
    expect(unwatchFileMock).toHaveBeenCalledWith('/tmp/shared.md');
  });

  it('keeps the old mapping when updating to a new path fails', async () => {
    const { useEditorFileWatchStore } = await import('@/stores/editorFileWatch');
    const watchStore = useEditorFileWatchStore();
    const error = new Error('watch failed');

    await watchStore.register('alpha', '/tmp/old.md');
    watchFileMock.mockRejectedValueOnce(error);

    await expect(watchStore.updatePath('alpha', '/tmp/new.md')).rejects.toThrow(error);

    emitFileChanged({ type: 'unlink', filePath: '/tmp/old.md' });

    expect(unwatchFileMock).not.toHaveBeenCalled();
  });

  it('unsubscribes native events and clears native watchers on dispose', async () => {
    const { useEditorFileWatchStore } = await import('@/stores/editorFileWatch');
    const watchStore = useEditorFileWatchStore();

    await watchStore.register('alpha', '/tmp/a.md');
    await watchStore.dispose();

    expect(unsubscribeMock).toHaveBeenCalledTimes(1);
    expect(unwatchAllMock).toHaveBeenCalledTimes(1);
  });
});
