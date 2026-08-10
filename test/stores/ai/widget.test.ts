/**
 * @file widget.test.ts
 * @description 小组件 Store 测试。
 * @vitest-environment jsdom
 */
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { parseWidgetJson } from '@/ai/widget/parser';
import type { WidgetScannerAPI } from '@/ai/widget/scanner';
import { RESOURCE_OPERATION_CACHE_LIMIT, useWidgetStore } from '@/stores/ai/widget';
import { posix } from '@/utils/file/posix';

/**
 * 小组件扫描器测试 API。
 */
interface WidgetScannerAPIMock extends WidgetScannerAPI {
  /** 读取文件 mock */
  readFile: Mock<WidgetScannerAPI['readFile']>;
  /** 读取目录 mock */
  readWorkspaceDirectory: Mock<WidgetScannerAPI['readWorkspaceDirectory']>;
}

/**
 * 可由测试控制完成时机的 Promise。
 */
interface Deferred<T> {
  /** 延迟 Promise */
  promise: Promise<T>;
  /** 完成 Promise */
  resolve: (value: T) => void;
}

/**
 * 创建可控 Promise。
 * @returns 可控 Promise
 */
function createDeferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = (): void => undefined;
  const promise = new Promise<T>((resolve: (value: T) => void): void => {
    resolvePromise = resolve;
  });

  return { promise, resolve: resolvePromise };
}

/**
 * 创建小组件扫描器测试 API。
 * @returns 扫描器依赖 API
 */
function createScannerAPI(): WidgetScannerAPIMock {
  return {
    readFile: vi.fn<WidgetScannerAPI['readFile']>(),
    readWorkspaceDirectory: vi.fn<WidgetScannerAPI['readWorkspaceDirectory']>()
  };
}

describe('widget store', (): void => {
  beforeEach((): void => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  it('initializes widgets and persists disabled ids by directory id', async (): Promise<void> => {
    const api = createScannerAPI();
    api.readWorkspaceDirectory.mockResolvedValue({
      entries: [{ name: 'weather', type: 'directory' }]
    });
    api.readFile.mockResolvedValue({
      content: JSON.stringify({
        name: '天气',
        description: '查询指定城市天气'
      })
    });
    const store = useWidgetStore();

    await store.initialize('/Users/test', api);

    expect(store.initialized).toBe(true);
    expect(store.widgets[0]?.id).toBe('weather');
    expect(store.getWidgetById('weather')?.name).toBe('天气');

    store.toggleWidget('weather');
    expect(store.getWidgetById('weather')?.enabled).toBe(false);

    setActivePinia(createPinia());
    const nextStore = useWidgetStore();
    await nextStore.initialize('/Users/test', api);

    expect(nextStore.getWidgetById('weather')?.enabled).toBe(false);
  });

  it('only synchronizes dirty Widget resources for chat preflight', async (): Promise<void> => {
    const api = createScannerAPI();
    api.readWorkspaceDirectory.mockResolvedValue({
      entries: [{ name: 'weather', type: 'directory' }]
    });
    api.readFile.mockResolvedValue({
      content: JSON.stringify({
        name: '天气',
        description: '旧描述'
      })
    });
    const store = useWidgetStore();
    await store.initialize('/Users/test', api);
    api.readFile.mockClear();
    api.readFile.mockResolvedValue({
      content: JSON.stringify({
        name: '天气',
        description: '新描述'
      })
    });

    await store.syncDirtyFromDisk();
    expect(api.readFile).not.toHaveBeenCalled();

    store.markDirty();
    await store.syncDirtyFromDisk();

    expect(api.readFile).toHaveBeenCalledTimes(1);
    expect(store.getWidgetById('weather')?.description).toBe('新描述');
  });

  it('updates widgets from watched widget.json changes', (): void => {
    const store = useWidgetStore();
    const filePath = posix.join('/Users/test', '.tibis', 'widgets', 'weather', 'widget.json');
    const widget = parseWidgetJson(
      JSON.stringify({
        name: '天气',
        description: '查询指定城市天气'
      }),
      filePath
    );

    store.handleWidgetChange('add', widget);
    expect(store.getWidgetById('weather')?.description).toBe('查询指定城市天气');

    store.handleWidgetChange(
      'change',
      parseWidgetJson(
        JSON.stringify({
          name: '天气',
          description: '展示天气和出行建议'
        }),
        filePath
      )
    );
    expect(store.getWidgetById('weather')?.description).toBe('展示天气和出行建议');

    store.handleWidgetChange('unlink', { ...widget, filePath });
    expect(store.getWidgetById('weather')).toBeUndefined();
  });

  it('preserves disabled state when watched widget.json changes', (): void => {
    const store = useWidgetStore();
    const filePath = posix.join('/Users/test', '.tibis', 'widgets', 'weather', 'widget.json');
    const widget = parseWidgetJson(
      JSON.stringify({
        name: '天气',
        description: '查询指定城市天气'
      }),
      filePath
    );

    store.handleWidgetChange('add', widget);
    store.toggleWidget('weather');
    expect(store.getWidgetById('weather')?.enabled).toBe(false);

    store.handleWidgetChange(
      'change',
      parseWidgetJson(
        JSON.stringify({
          name: '天气',
          description: '展示天气和出行建议'
        }),
        filePath
      )
    );

    expect(store.getWidgetById('weather')?.description).toBe('展示天气和出行建议');
    expect(store.getWidgetById('weather')?.enabled).toBe(false);
  });

  it('keeps widgets visible when watched widget.json becomes invalid', (): void => {
    const store = useWidgetStore();
    const filePath = posix.join('/Users/test', '.tibis', 'widgets', 'weather', 'widget.json');
    const widget = parseWidgetJson(
      JSON.stringify({
        name: '天气',
        description: '查询指定城市天气'
      }),
      filePath
    );

    store.handleWidgetChange('add', widget);
    store.toggleWidget('weather');
    store.handleWidgetChange('change', parseWidgetJson('{broken', filePath));

    expect(store.getWidgetById('weather')?.parseError).toBeTruthy();
    expect(store.getWidgetById('weather')?.enabled).toBe(false);
  });

  it('synchronizes external disk changes while preserving disabled state', async (): Promise<void> => {
    const api = createScannerAPI();
    api.readWorkspaceDirectory.mockResolvedValue({ entries: [{ name: 'weather', type: 'directory' }] });
    api.readFile.mockResolvedValue({ content: JSON.stringify({ name: '天气', description: '旧描述' }) });
    const store = useWidgetStore();
    await store.initialize('/Users/test', api);
    store.toggleWidget('weather');
    api.readFile.mockResolvedValue({ content: JSON.stringify({ name: '天气', description: '磁盘新描述' }) });

    await store.syncFromDisk();

    expect(store.getWidgetById('weather')?.description).toBe('磁盘新描述');
    expect(store.getWidgetById('weather')?.enabled).toBe(false);
  });

  it('resolves the latest enabled Widget directly from disk', async (): Promise<void> => {
    const api = createScannerAPI();
    api.readWorkspaceDirectory.mockResolvedValue({ entries: [{ name: 'weather', type: 'directory' }] });
    api.readFile.mockResolvedValue({ content: JSON.stringify({ name: '天气', description: '旧描述' }) });
    const store = useWidgetStore();
    await store.initialize('/Users/test', api);
    api.readFile.mockResolvedValue({ content: JSON.stringify({ name: '天气', description: '执行时新描述' }) });

    const widget = await store.resolveLatestEnabledWidget('weather');

    expect(widget?.description).toBe('执行时新描述');
    expect(store.getWidgetById('weather')?.description).toBe('执行时新描述');
  });

  it('does not let a slow execution read overwrite a newer watcher result', async (): Promise<void> => {
    const api = createScannerAPI();
    api.readWorkspaceDirectory.mockResolvedValue({ entries: [{ name: 'weather', type: 'directory' }] });
    api.readFile.mockResolvedValue({ content: JSON.stringify({ name: '天气', description: '初始描述' }) });
    const store = useWidgetStore();
    await store.initialize('/Users/test', api);
    const staleRead = createDeferred<{ content: string }>();
    api.readFile.mockImplementationOnce((): Promise<{ content: string }> => staleRead.promise);

    const resolving = store.resolveLatestEnabledWidget('weather');
    await vi.waitFor((): void => {
      expect(api.readFile).toHaveBeenCalledTimes(2);
    });
    store.handleWidgetChange(
      'change',
      parseWidgetJson(JSON.stringify({ name: '天气', description: 'watcher 新描述' }), '/Users/test/.tibis/widgets/weather/widget.json')
    );
    staleRead.resolve({ content: JSON.stringify({ name: '天气', description: '过期执行描述' }) });

    expect((await resolving)?.description).toBe('watcher 新描述');
    expect(store.getWidgetById('weather')?.description).toBe('watcher 新描述');
  });

  it('merges unrelated scan results when a watcher changes one Widget during the scan', async (): Promise<void> => {
    const api = createScannerAPI();
    api.readWorkspaceDirectory.mockResolvedValue({ entries: [{ name: 'weather', type: 'directory' }] });
    api.readFile.mockResolvedValue({ content: JSON.stringify({ name: '天气', description: '初始描述' }) });
    const store = useWidgetStore();
    await store.initialize('/Users/test', api);
    const staleWeatherRead = createDeferred<{ content: string }>();
    api.readWorkspaceDirectory.mockResolvedValue({
      entries: [
        { name: 'weather', type: 'directory' },
        { name: 'travel', type: 'directory' }
      ]
    });
    api.readFile.mockImplementation((filePath: string): Promise<{ content: string }> => {
      if (filePath.includes('/weather/')) {
        return staleWeatherRead.promise;
      }

      return Promise.resolve({ content: JSON.stringify({ name: '出行', description: '出行描述' }) });
    });

    const syncing = store.syncFromDisk();
    await vi.waitFor((): void => {
      expect(api.readFile).toHaveBeenCalledTimes(3);
    });
    store.handleWidgetChange(
      'change',
      parseWidgetJson(JSON.stringify({ name: '天气', description: 'watcher 新描述' }), '/Users/test/.tibis/widgets/weather/widget.json')
    );
    staleWeatherRead.resolve({ content: JSON.stringify({ name: '天气', description: '过期扫描描述' }) });
    await syncing;

    expect(store.getWidgetById('weather')?.description).toBe('watcher 新描述');
    expect(store.getWidgetById('travel')?.description).toBe('出行描述');
    expect(store.initialized).toBe(true);
  });

  it('waits for initialization after the layout declares it pending', async (): Promise<void> => {
    const api = createScannerAPI();
    api.readWorkspaceDirectory.mockResolvedValue({ entries: [] });
    const store = useWidgetStore();
    store.beforeInitialize();
    let completed = false;
    const waiting = store.waitForInit().then((): void => {
      completed = true;
    });
    await Promise.resolve();

    expect(completed).toBe(false);
    await store.initialize('/Users/test', api);
    await waiting;
    expect(completed).toBe(true);
  });

  it('preserves a disabled preference when a Widget is removed and added again', async (): Promise<void> => {
    const api = createScannerAPI();
    api.readWorkspaceDirectory.mockResolvedValue({ entries: [{ name: 'weather', type: 'directory' }] });
    api.readFile.mockResolvedValue({ content: JSON.stringify({ name: '天气', description: '天气描述' }) });
    const store = useWidgetStore();
    await store.initialize('/Users/test', api);
    store.toggleWidget('weather');
    api.readWorkspaceDirectory.mockResolvedValue({ entries: [] });
    await store.syncFromDisk();
    api.readWorkspaceDirectory.mockResolvedValue({ entries: [{ name: 'weather', type: 'directory' }] });

    await store.syncFromDisk();

    expect(store.getWidgetById('weather')?.enabled).toBe(false);
  });

  it('bounds retained per-path operation tombstones', (): void => {
    const store = useWidgetStore();

    for (let index = 0; index <= RESOURCE_OPERATION_CACHE_LIMIT; index += 1) {
      const filePath = `/home/user/.tibis/widgets/widget-${index}/widget.json`;
      const widget = parseWidgetJson(JSON.stringify({ name: `Widget ${index}`, description: 'Bounded tombstone test' }), filePath);
      store.handleWidgetChange('unlink', widget);
    }

    expect(store.getResourceOperationCount()).toBe(RESOURCE_OPERATION_CACHE_LIMIT);
  });
});
