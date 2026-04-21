/**
 * @file useFileWatcher.test.ts
 * @description 验证页面级文件监听器只处理当前激活文件的外部修改。
 */

import { describe, expect, it, vi } from 'vitest';
import type { FileChangeEvent } from '@/shared/platform/native/types';

/**
 * 模拟 native.watchFile 调用。
 */
const watchFileMock = vi.fn<(filePath: string) => Promise<void>>().mockResolvedValue(undefined);

/**
 * 模拟 native.unwatchFile 调用。
 */
const unwatchFileMock = vi.fn<(filePath: string) => Promise<void>>().mockResolvedValue(undefined);

/**
 * native.onFileChanged 注册的回调。
 */
let fileChangedCallback: ((event: FileChangeEvent) => void) | null = null;

vi.mock('@/shared/platform', () => ({
  native: {
    watchFile: watchFileMock,
    unwatchFile: unwatchFileMock,
    onFileChanged: (callback: (event: FileChangeEvent) => void): (() => void) => {
      fileChangedCallback = callback;
      return vi.fn();
    }
  }
}));

vi.mock('@/utils/modal', () => ({
  Modal: {
    alert: vi.fn(),
    confirm: vi.fn()
  }
}));

describe('useFileWatcher', () => {
  it('ignores unlink events because global watcher owns missing state', async () => {
    const { Modal } = await import('@/utils/modal');
    const { useFileWatcher } = await import('@/views/editor/hooks/useFileWatcher');
    const deletedCallback = vi.fn();
    const watcher = useFileWatcher();

    watcher.setOnFileDeleted(deletedCallback);
    await watcher.switchWatchedFile('/tmp/current.md');
    fileChangedCallback?.({ type: 'unlink', filePath: '/tmp/current.md' });

    expect(Modal.alert).not.toHaveBeenCalled();
    expect(deletedCallback).not.toHaveBeenCalled();
    expect(unwatchFileMock).not.toHaveBeenCalled();
  });
});
