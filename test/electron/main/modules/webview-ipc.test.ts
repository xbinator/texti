/**
 * @file webview-ipc.test.ts
 * @description 验证 WebView 主进程 IPC 截图边界。
 */
import type { WebViewProtocolScreenshotRequest } from 'types/webview';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { captureWebviewProtocolScreenshot } from '../../../../electron/main/modules/webview/capture.mjs';
import { registerWebviewHandlers } from '../../../../electron/main/modules/webview/ipc.mts';

/**
 * 测试用 BrowserWindow 最小能力。
 */
interface TestBrowserWindow {
  /** 内容视图容器。 */
  contentView: {
    /** 添加子视图。 */
    addChildView: (_view: unknown) => void;
    /** 移除子视图。 */
    removeChildView: (_view: unknown) => void;
  };
  /** 宿主 WebContents。 */
  webContents: {
    /** 发送 IPC 消息。 */
    send: (_channel: string, ..._args: unknown[]) => void;
  };
}

const handleMock = vi.hoisted(() => vi.fn());
const captureWebviewProtocolScreenshotMock = vi.hoisted(() => vi.fn().mockResolvedValue(new ArrayBuffer(1)));
const webContentsViewMock = vi.hoisted(() => vi.fn());
const getAllWindowsMock = vi.hoisted(() => vi.fn<() => TestBrowserWindow[]>(() => []));
const fromWebContentsMock = vi.hoisted(() => vi.fn<(_sender: unknown) => TestBrowserWindow | null>(() => null));
const clearCacheMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const clearStorageDataMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('electron', () => ({
  ipcMain: {
    handle: handleMock
  },
  WebContentsView: webContentsViewMock,
  BrowserWindow: {
    getAllWindows: getAllWindowsMock,
    fromWebContents: fromWebContentsMock
  },
  session: {
    fromPartition: vi.fn(() => ({
      clearCache: clearCacheMock,
      clearStorageData: clearStorageDataMock
    }))
  },
  shell: {
    openExternal: vi.fn()
  }
}));

vi.mock('../../../../electron/main/modules/webview/capture.mjs', () => ({
  captureWebviewProtocolScreenshot: captureWebviewProtocolScreenshotMock
}));

/**
 * 测试用 IPC 调用事件。
 */
interface TestIpcInvokeEvent {
  /** 发起 IPC 的宿主 WebContents。 */
  sender: {
    /** 宿主 WebContents ID。 */
    id: number;
  };
}

/**
 * WebView 协议截图 IPC 处理函数。
 */
type CaptureProtocolScreenshotHandler = (event: TestIpcInvokeEvent, request: WebViewProtocolScreenshotRequest) => Promise<ArrayBuffer>;

/** WebView owner sender 最小能力。 */
interface TestOwnerSender {
  /** WebContents ID。 */
  id: number;
  /** 注册一次性销毁监听。 */
  once: (eventName: 'destroyed', listener: () => void) => void;
}

/**
 * WebView create IPC 处理函数。
 */
type CreateWebviewHandler = (event: { sender: TestOwnerSender }, tabId: string, url: string) => void;

/**
 * WebView navigate IPC 处理函数。
 */
type NavigateWebviewHandler = (_event: unknown, tabId: string, url: string) => void;

/**
 * 测试用 WebContents 最小能力。
 */
interface TestWebContents {
  /** WebContents ID。 */
  id: number;
  /** 加载 URL。 */
  loadURL: (_url: string) => Promise<void>;
  /** 设置新窗口处理器。 */
  setWindowOpenHandler: (_handler: (input: { url: string }) => { action: 'deny' }) => void;
  /** WebContents session。 */
  session: { setPermissionRequestHandler: (_handler: unknown) => void };
  /** 导航历史。 */
  navigationHistory: {
    canGoBack: () => boolean;
    canGoForward: () => boolean;
    goBack: () => void;
    goForward: () => void;
  };
  /** 监听事件。 */
  on: (_eventName: string, _listener: (...args: unknown[]) => void) => void;
  /** 读取标题。 */
  getTitle: () => string;
  /** 刷新页面。 */
  reload: () => void;
  /** 停止加载。 */
  stop: () => void;
  /** 关闭页面。 */
  close: () => void;
}

/**
 * 测试用 WebContentsView 最小能力。
 */
interface TestWebContentsView {
  /** WebContents。 */
  webContents: TestWebContents;
  /** 设置圆角。 */
  setBorderRadius: (_radius: number) => void;
  /** 设置 bounds。 */
  setBounds: (_bounds: Electron.Rectangle) => void;
  /** 读取 bounds。 */
  getBounds: () => Electron.Rectangle;
}

/**
 * 创建可观测 catch 注册的 loadURL 返回值。
 * @returns loadURL 返回值与 catch spy
 */
function createCatchableLoadResult(): { promise: Promise<void>; catchSpy: ReturnType<typeof vi.fn<(_handler: (error: unknown) => void) => Promise<void>>> } {
  const catchSpy = vi.fn<(_handler: (error: unknown) => void) => Promise<void>>(() => Promise.resolve());
  return { promise: { catch: catchSpy } as unknown as Promise<void>, catchSpy };
}

/**
 * 创建测试用 WebContentsView。
 * @param loadURL - loadURL 替身
 * @returns WebContentsView 替身
 */
function createTestWebContentsView(loadURL: TestWebContents['loadURL']): TestWebContentsView {
  return {
    webContents: {
      id: 42,
      loadURL,
      setWindowOpenHandler: vi.fn(),
      session: { setPermissionRequestHandler: vi.fn() },
      navigationHistory: {
        canGoBack: vi.fn(() => false),
        canGoForward: vi.fn(() => false),
        goBack: vi.fn(),
        goForward: vi.fn()
      },
      on: vi.fn(),
      getTitle: vi.fn(() => 'Example'),
      reload: vi.fn(),
      stop: vi.fn(),
      close: vi.fn()
    },
    setBorderRadius: vi.fn(),
    setBounds: vi.fn(),
    getBounds: vi.fn(() => ({ x: 0, y: 0, width: 800, height: 600 }))
  };
}

/**
 * 读取已注册的 WebView IPC handler。
 * @param channel - IPC channel
 * @returns IPC handler
 */
function getWebviewHandler<THandler>(channel: string): THandler {
  const entry = handleMock.mock.calls.find(([registeredChannel]) => registeredChannel === channel);
  const handler = entry?.[1];

  if (typeof handler !== 'function') {
    throw new Error(`${channel} handler should be registered`);
  }

  return handler as THandler;
}

/**
 * 读取已注册的协议截图 IPC handler。
 * @returns 协议截图 IPC handler
 */
function getCaptureProtocolScreenshotHandler(): CaptureProtocolScreenshotHandler {
  return getWebviewHandler<CaptureProtocolScreenshotHandler>('webview:capture-protocol-screenshot');
}

describe('registerWebviewHandlers', () => {
  beforeEach((): void => {
    handleMock.mockClear();
    webContentsViewMock.mockReset();
    getAllWindowsMock.mockReturnValue([]);
    fromWebContentsMock.mockReturnValue(null);
    captureWebviewProtocolScreenshotMock.mockClear();
    clearCacheMock.mockClear();
    clearStorageDataMock.mockClear();
  });

  it('limits protocol screenshots to the invoking host webContents', async (): Promise<void> => {
    registerWebviewHandlers();
    const handler = getCaptureProtocolScreenshotHandler();
    const request: WebViewProtocolScreenshotRequest = {
      webContentsId: 42,
      clip: {
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        scale: 1
      }
    };

    await handler({ sender: { id: 88 } }, request);

    expect(captureWebviewProtocolScreenshot).toHaveBeenCalledWith(request, {
      expectedHostWebContentsId: 88
    });
  });

  it('attaches rejection handlers to WebContentsView loadURL calls', (): void => {
    const loadResult = createCatchableLoadResult();
    const loadURL = vi.fn<(_url: string) => Promise<void>>(() => loadResult.promise);
    const view = createTestWebContentsView(loadURL);
    webContentsViewMock.mockImplementation(function WebContentsViewConstructor() {
      return view;
    });
    getAllWindowsMock.mockReturnValue([
      {
        contentView: {
          addChildView: vi.fn(),
          removeChildView: vi.fn()
        },
        webContents: {
          send: vi.fn()
        }
      }
    ]);
    const sender: TestOwnerSender = { id: 88, once: vi.fn() };
    registerWebviewHandlers();
    const createHandler = getWebviewHandler<CreateWebviewHandler>('webview:create');
    const navigateHandler = getWebviewHandler<NavigateWebviewHandler>('webview:navigate');
    const destroyHandler = getWebviewHandler<(_event: unknown, tabId: string) => void>('webview:destroy');

    createHandler({ sender }, 'tab-load', 'https://example.com/');
    expect(loadURL).toHaveBeenCalledWith('https://example.com/');
    expect(loadResult.catchSpy).toHaveBeenCalledTimes(1);

    loadResult.catchSpy.mockClear();
    navigateHandler({}, 'tab-load', 'https://example.org/');

    expect(loadURL).toHaveBeenCalledWith('https://example.org/');
    expect(loadResult.catchSpy).toHaveBeenCalledTimes(1);
    expect(() => loadResult.catchSpy.mock.calls[0]?.[0](new Error("ERR_ABORTED (-3) loading 'https://example.org/'"))).not.toThrow();
    destroyHandler({}, 'tab-load');
  });

  it('destroys every WebContentsView owned by a destroyed sender', (): void => {
    const loadResult = createCatchableLoadResult();
    const view = createTestWebContentsView(vi.fn(() => loadResult.promise));
    const hostWindow: TestBrowserWindow = {
      contentView: {
        addChildView: vi.fn(),
        removeChildView: vi.fn()
      },
      webContents: {
        send: vi.fn()
      }
    };
    let handleDestroyed = (): void => undefined;
    const sender: TestOwnerSender = {
      id: 91,
      once: (_eventName, listener): void => {
        handleDestroyed = listener;
      }
    };
    webContentsViewMock.mockImplementation(function WebContentsViewConstructor() {
      return view;
    });
    getAllWindowsMock.mockReturnValue([hostWindow]);
    fromWebContentsMock.mockReturnValue(hostWindow);
    registerWebviewHandlers();
    const createHandler = getWebviewHandler<CreateWebviewHandler>('webview:create');

    createHandler({ sender }, 'owned-tab', 'https://example.com/owned');
    handleDestroyed();

    expect(hostWindow.contentView.removeChildView).toHaveBeenCalledWith(view);
    expect(view.webContents.close).toHaveBeenCalledOnce();
  });

  it('still releases owner indexes when closing a WebContentsView throws', (): void => {
    const loadResult = createCatchableLoadResult();
    const view = createTestWebContentsView(vi.fn(() => loadResult.promise));
    view.webContents.close = vi.fn((): void => {
      throw new Error('already destroyed');
    });
    const hostWindow: TestBrowserWindow = {
      contentView: {
        addChildView: vi.fn(),
        removeChildView: vi.fn()
      },
      webContents: {
        send: vi.fn()
      }
    };
    let handleDestroyed = (): void => undefined;
    const sender: TestOwnerSender = {
      id: 92,
      once: (_eventName, listener): void => {
        handleDestroyed = listener;
      }
    };
    webContentsViewMock.mockImplementation(function WebContentsViewConstructor() {
      return view;
    });
    getAllWindowsMock.mockReturnValue([hostWindow]);
    fromWebContentsMock.mockReturnValue(hostWindow);
    registerWebviewHandlers();
    const createHandler = getWebviewHandler<CreateWebviewHandler>('webview:create');

    createHandler({ sender }, 'throwing-close-tab', 'https://example.com/owned');

    expect(handleDestroyed).not.toThrow();
    expect(hostWindow.contentView.removeChildView).toHaveBeenCalledWith(view);
  });

  it('closes every view after 100 owner lifecycle cycles', (): void => {
    const loadResult = createCatchableLoadResult();
    const view = createTestWebContentsView(vi.fn(() => loadResult.promise));
    const hostWindow: TestBrowserWindow = {
      contentView: {
        addChildView: vi.fn(),
        removeChildView: vi.fn()
      },
      webContents: {
        send: vi.fn()
      }
    };
    webContentsViewMock.mockImplementation(function WebContentsViewConstructor() {
      return view;
    });
    getAllWindowsMock.mockReturnValue([hostWindow]);
    fromWebContentsMock.mockReturnValue(hostWindow);
    registerWebviewHandlers();
    const createHandler = getWebviewHandler<CreateWebviewHandler>('webview:create');

    for (let cycle = 1; cycle <= 100; cycle += 1) {
      const ownerId = 10_000 + cycle;
      let handleDestroyed = (): void => undefined;
      const sender: TestOwnerSender = {
        id: ownerId,
        once: (_eventName, listener): void => {
          handleDestroyed = listener;
        }
      };
      createHandler({ sender }, `stress-tab-${ownerId}`, `https://example.com/${ownerId}`);
      handleDestroyed();
    }

    expect(hostWindow.contentView.removeChildView).toHaveBeenCalledTimes(100);
    expect(view.webContents.close).toHaveBeenCalledTimes(100);
  });

  it('clears WebView cache and persistent browsing storage', async (): Promise<void> => {
    registerWebviewHandlers();
    const handler = getWebviewHandler<() => Promise<void>>('webview:clear-cache');

    await handler();

    expect(clearCacheMock).toHaveBeenCalledTimes(1);
    expect(clearStorageDataMock).toHaveBeenCalledWith({
      storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage']
    });
  });
});
