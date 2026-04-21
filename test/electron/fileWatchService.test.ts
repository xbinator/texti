/**
 * @file fileWatchService.test.ts
 * @description 验证 Electron 主进程文件监听服务支持多路径独立监听。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * chokidar watcher 的最小测试替身。
 */
interface MockWatcher {
  /** 事件注册函数 */
  on: ReturnType<typeof vi.fn>;
  /** 关闭 watcher 的函数 */
  close: ReturnType<typeof vi.fn>;
}

/**
 * 按路径记录创建出的 watcher。
 */
const watchersByPath = new Map<string, MockWatcher>();

vi.mock('chokidar', () => ({
  default: {
    watch: (filePath: string): MockWatcher => {
      const watcher: MockWatcher = {
        on: vi.fn().mockReturnThis(),
        close: vi.fn().mockResolvedValue(undefined)
      };
      watchersByPath.set(filePath, watcher);
      return watcher;
    }
  }
}));

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => []
  }
}));

describe('fileWatchService', () => {
  beforeEach(() => {
    vi.resetModules();
    watchersByPath.clear();
  });

  it('keeps existing path watchers when watching another path', async () => {
    const { fileWatchService } = await import('../../electron/main/modules/file/service.mjs');

    await fileWatchService.watch('/tmp/a.md');
    await fileWatchService.watch('/tmp/b.md');

    expect(watchersByPath.get('/tmp/a.md')?.close).not.toHaveBeenCalled();
    expect(watchersByPath.get('/tmp/b.md')?.close).not.toHaveBeenCalled();
    expect(watchersByPath.size).toBe(2);
  });

  it('unwatches only the requested path', async () => {
    const { fileWatchService } = await import('../../electron/main/modules/file/service.mjs');

    await fileWatchService.watch('/tmp/a.md');
    await fileWatchService.watch('/tmp/b.md');
    await fileWatchService.unwatch('/tmp/a.md');

    expect(watchersByPath.get('/tmp/a.md')?.close).toHaveBeenCalledTimes(1);
    expect(watchersByPath.get('/tmp/b.md')?.close).not.toHaveBeenCalled();
  });
});
