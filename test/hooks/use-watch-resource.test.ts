/**
 * @file use-watch-resource.test.ts
 * @description 通用资源监听 Hook 的异步挂载/卸载竞态测试。
 * @vitest-environment jsdom
 */
import { defineComponent } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWatchResource, type WatchResourceConfig } from '@/hooks/useWatchResource';

/** 可由测试显式完成的 Promise。 */
interface Deferred<T> {
  /** 未决 Promise。 */
  promise: Promise<T>;
  /** 完成 Promise。 */
  resolve: (value: T) => void;
}

/**
 * 创建可控 Promise。
 * @returns Deferred 控制器
 */
function createDeferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = (): void => undefined;
  const promise = new Promise<T>((resolve: (value: T) => void): void => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

const nativeMock = vi.hoisted(() => ({
  getHomeDir: vi.fn<() => Promise<string>>(),
  onSkillChanged: vi.fn<(_callback: (data: { type: string; filePath: string; content?: string }) => void) => () => void>(),
  removeChangeListener: vi.fn<() => void>(),
  unwatchDirectory: vi.fn<(path: string) => Promise<void>>(),
  watchDirectory: vi.fn<(path: string) => Promise<void>>()
}));

vi.mock('@/shared/platform', () => ({
  native: nativeMock
}));

/**
 * 创建最小 Hook 配置与可观察初始化回调。
 * @returns 资源监听配置
 */
function createConfig(): WatchResourceConfig<{ filePath: string }> {
  return {
    rootDir: '.agents',
    subDir: 'skills',
    logLabel: 'Skill',
    onBeforeInitialize: vi.fn(),
    onInitialize: vi.fn(async (): Promise<void> => undefined),
    onDirectoryChange: vi.fn(async (): Promise<void> => undefined),
    onAfterInitialize: vi.fn(),
    onChange: vi.fn(),
    onParseFile: (_content: string, filePath: string): { filePath: string } => ({ filePath }),
    onCreateUnlinkPayload: (filePath: string): { filePath: string } => ({ filePath }),
    onIsTargetFile: (): boolean => true
  };
}

/**
 * 挂载使用资源监听 Hook 的测试组件。
 * @param config - Hook 配置
 * @returns Vue 包装器
 */
function mountWatcher(config: WatchResourceConfig<{ filePath: string }>): ReturnType<typeof mount> {
  const component = defineComponent({
    name: 'WatchResourceFixture',
    setup(): Record<string, never> {
      useWatchResource(config);
      return {};
    },
    template: '<div />'
  });
  return mount(component);
}

describe('useWatchResource', (): void => {
  beforeEach((): void => {
    nativeMock.getHomeDir.mockReset();
    nativeMock.onSkillChanged.mockReset();
    nativeMock.removeChangeListener.mockReset();
    nativeMock.unwatchDirectory.mockReset();
    nativeMock.watchDirectory.mockReset();
    nativeMock.onSkillChanged.mockReturnValue(nativeMock.removeChangeListener);
    nativeMock.unwatchDirectory.mockResolvedValue(undefined);
  });

  it('does not register a directory watcher after unmount during home lookup', async (): Promise<void> => {
    const homeDir = createDeferred<string>();
    nativeMock.getHomeDir.mockReturnValue(homeDir.promise);
    nativeMock.watchDirectory.mockResolvedValue(undefined);
    const config = createConfig();
    const wrapper = mountWatcher(config);
    await vi.waitFor((): void => expect(nativeMock.getHomeDir).toHaveBeenCalledOnce());

    wrapper.unmount();
    homeDir.resolve('/home/user');
    await flushPromises();

    expect(nativeMock.removeChangeListener).toHaveBeenCalledOnce();
    expect(nativeMock.watchDirectory).not.toHaveBeenCalled();
    expect(config.onInitialize).not.toHaveBeenCalled();
  });

  it('immediately unregisters a watcher that resolves after component unmount', async (): Promise<void> => {
    const watchDirectory = createDeferred<void>();
    nativeMock.getHomeDir.mockResolvedValue('/home/user');
    nativeMock.watchDirectory.mockReturnValue(watchDirectory.promise);
    const config = createConfig();
    const wrapper = mountWatcher(config);
    await vi.waitFor((): void => expect(nativeMock.watchDirectory).toHaveBeenCalledOnce());

    wrapper.unmount();
    watchDirectory.resolve(undefined);
    await flushPromises();

    expect(nativeMock.removeChangeListener).toHaveBeenCalledOnce();
    expect(nativeMock.unwatchDirectory).toHaveBeenCalledOnce();
    expect(nativeMock.unwatchDirectory).toHaveBeenCalledWith('/home/user/.agents/skills');
    expect(config.onInitialize).not.toHaveBeenCalled();
  });
});
