/**
 * @file watch.test.ts
 * @description Workspace 目录监听匹配规则测试。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDirectoryWatchOptions, FileWatchService, isDirectoryWatchMatch } from '../../../../../electron/main/modules/workspace/watch.mts';

/** 测试 watcher 事件回调。 */
type WatchListener = (...args: string[]) => void | Promise<void>;

/** 测试 watcher。 */
interface WatcherFixture {
  /** 注册事件。 */
  on: (eventName: string, listener: WatchListener) => WatcherFixture;
  /** 关闭 watcher。 */
  close: () => Promise<void>;
  /** 已注册事件。 */
  listeners: Map<string, WatchListener>;
}

/** chokidar.watch 替身。 */
const watchMock = vi.hoisted(() => vi.fn());

vi.mock('chokidar', () => ({
  default: {
    watch: watchMock
  }
}));

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: (): [] => []
  }
}));

/**
 * 创建可检查事件与关闭状态的 watcher。
 * @returns watcher fixture
 */
function createWatcher(): WatcherFixture {
  const listeners = new Map<string, WatchListener>();
  const watcher: WatcherFixture = {
    listeners,
    on(eventName: string, listener: WatchListener): WatcherFixture {
      listeners.set(eventName, listener);
      return watcher;
    },
    close: vi.fn(async (): Promise<void> => undefined)
  };
  return watcher;
}

beforeEach((): void => {
  watchMock.mockReset();
});

describe('isDirectoryWatchMatch', (): void => {
  it('matches only direct children when watching a whole directory', (): void => {
    const rootPath = '/Users/test/.tibis/widgets';

    expect(isDirectoryWatchMatch('/Users/test/.tibis/widgets/weather', undefined, rootPath)).toBe(true);
    expect(isDirectoryWatchMatch('/Users/test/.tibis/widgets/weather/widget.json', undefined, rootPath)).toBe(false);
    expect(isDirectoryWatchMatch('/Users/test/.tibis/widgets/.draft/widget.json', undefined, rootPath)).toBe(false);
  });

  it('limits directory watchers to the watched root directory', (): void => {
    expect(createDirectoryWatchOptions().depth).toBe(0);
  });

  it('matches regular Skill files', (): void => {
    expect(isDirectoryWatchMatch('/Users/test/.agents/skills/demo/SKILL.md', '**/SKILL.md')).toBe(true);
    expect(isDirectoryWatchMatch('C:\\Users\\test\\.agents\\skills\\demo\\SKILL.md', '**/SKILL.md')).toBe(true);
  });

  it('ignores Skill files inside temporary installer directories', (): void => {
    expect(isDirectoryWatchMatch('/Users/test/.agents/skills/.tmp-abcd1234/SKILL.md', '**/SKILL.md')).toBe(false);
    expect(isDirectoryWatchMatch('C:\\Users\\test\\.agents\\skills\\.bak-abcd1234\\SKILL.md', '**/SKILL.md')).toBe(false);
  });

  it('ignores hidden Skill directories under the watched root', (): void => {
    const rootPath = '/Users/test/.agents/skills';

    expect(isDirectoryWatchMatch('/Users/test/.agents/skills/demo/SKILL.md', '**/SKILL.md', rootPath)).toBe(true);
    expect(isDirectoryWatchMatch('/Users/test/.agents/skills/.draft/SKILL.md', '**/SKILL.md', rootPath)).toBe(false);
  });
});

describe('FileWatchService ownership', (): void => {
  it('keeps a shared watcher until its final owner is released', async (): Promise<void> => {
    const watcher = createWatcher();
    watchMock.mockReturnValue(watcher);
    const service = new FileWatchService();

    await service.watch('/workspace/shared.md', 1);
    await service.watch('/workspace/shared.md', 2);
    await service.releaseOwner(1);

    expect(watchMock).toHaveBeenCalledOnce();
    expect(watcher.close).not.toHaveBeenCalled();

    await service.releaseOwner(2);
    expect(watcher.close).toHaveBeenCalledOnce();
  });

  it('releases directory owners without parsing colons from their glob pattern', async (): Promise<void> => {
    const watcher = createWatcher();
    watchMock.mockReturnValue(watcher);
    const service = new FileWatchService();

    await service.watchDirectory('/workspace/skills', '**/skill:name.md', 41);
    await service.releaseOwner(41);

    expect(watcher.close).toHaveBeenCalledOnce();
  });

  it('clears pending unlink timers during global shutdown', async (): Promise<void> => {
    vi.useFakeTimers();
    const watcher = createWatcher();
    watchMock.mockReturnValue(watcher);
    const service = new FileWatchService();
    await service.watch('/workspace/file.md', 1);

    watcher.listeners.get('unlink')?.('/workspace/file.md');
    expect(vi.getTimerCount()).toBe(1);

    await service.unwatchAll();

    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it('closes every watcher after 100 owner lifecycle cycles', async (): Promise<void> => {
    const watchers: WatcherFixture[] = [];
    watchMock.mockImplementation((): WatcherFixture => {
      const watcher = createWatcher();
      watchers.push(watcher);
      return watcher;
    });
    const service = new FileWatchService();

    for (let ownerId = 1; ownerId <= 100; ownerId += 1) {
      // eslint-disable-next-line no-await-in-loop -- 压力验证 owner 注册与销毁的完整周期。
      await service.watch(`/workspace/stress-${ownerId}.md`, ownerId);
      // eslint-disable-next-line no-await-in-loop -- 释放结果是下一轮的前置条件。
      await service.releaseOwner(ownerId);
    }

    expect(watchers).toHaveLength(100);
    watchers.forEach((watcher: WatcherFixture): void => expect(watcher.close).toHaveBeenCalledOnce());
    await service.unwatchAll();
  });
});
