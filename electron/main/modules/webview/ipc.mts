import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WebViewProtocolScreenshotRequest, WebViewState } from 'types/webview';
import { ipcMain, WebContentsView, BrowserWindow, session, shell, type IpcMainInvokeEvent } from 'electron';
import { captureWebviewProtocolScreenshot } from './capture.mjs';

// 获取当前文件的目录路径
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * `<webview>` 独立持久化分区。
 */
export const WEBVIEW_TAG_PARTITION = 'persist:tibis-webview';

/**
 * 清理 WebView 持久化分区时需要覆盖的浏览数据类型。
 */
const WEBVIEW_CLEAR_STORAGE_TYPES: NonNullable<Electron.ClearStorageDataOptions['storages']> = [
  'cookies',
  'localstorage',
  'indexdb',
  'serviceworkers',
  'cachestorage'
];

/**
 * 标准化待附加的 `<webview>` 地址。
 * @param rawUrl - 原始地址
 * @returns 标准化 URL
 */
export function normalizeAttachedWebviewUrl(rawUrl: string): string {
  const parsed = new URL(rawUrl);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Unsupported webview URL protocol');
  }
  return parsed.toString();
}

/**
 * 清理 `<webview>` 附加时的宿主配置。
 * @param preferences - 原始 webPreferences
 * @returns 受控 webPreferences
 */
export function sanitizeAttachedWebPreferences(preferences: Record<string, unknown>): Record<string, unknown> {
  return {
    ...preferences,
    preload: undefined,
    nodeIntegration: false,
    contextIsolation: true,
    partition: WEBVIEW_TAG_PARTITION,
    webSecurity: true
  };
}

/**
 * 判断错误是否为 Electron 导航被主动中断。
 * @param error - 原始加载错误
 * @returns 是否为可忽略的导航中断
 */
function isWebviewLoadAbortError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return message.includes('ERR_ABORTED') || message.includes('(-3)');
}

/**
 * 处理 WebContents 加载错误。
 * @param error - 原始加载错误
 * @param url - 目标地址
 */
function handleWebviewLoadError(error: unknown, url: string): void {
  if (isWebviewLoadAbortError(error)) {
    return;
  }

  console.error(`Failed to load WebView URL ${url}:`, error);
}

/**
 * 安全加载 WebContents 地址，避免导航中断成为未捕获 Promise。
 * @param webContents - WebContents 实例
 * @param url - 目标地址
 */
function loadWebContentsUrl(webContents: Electron.WebContents, url: string): void {
  webContents.loadURL(url).catch((error: unknown) => handleWebviewLoadError(error, url));
}

/** 主进程托管的 WebContentsView 及其宿主所有权。 */
interface ManagedWebView {
  /** 实际 WebContentsView。 */
  view: WebContentsView;
  /** 创建该 View 的宿主窗口。 */
  hostWindow: BrowserWindow;
  /** 创建请求所属 WebContents ID。 */
  ownerId: number;
}

class WebViewManager {
  /** 按标签页保存的托管 View。 */
  private views: Map<string, ManagedWebView> = new Map();

  /** WebContentsView ID 到标签页 ID 的反向索引。 */
  private tabIdMap: Map<number, string> = new Map();

  /** owner 到其创建标签页的索引。 */
  private tabIdsByOwner: Map<number, Set<string>> = new Map();

  private activeTabId: string | null = null;

  /**
   * 创建 owner 绑定的 WebContentsView。
   * @param ownerId - 创建请求所属 WebContents ID
   * @param hostWindow - View 实际挂载的窗口
   * @param tabId - 标签页 ID
   * @param url - 初始地址
   */
  create(ownerId: number, hostWindow: BrowserWindow, tabId: string, url: string): void {
    if (this.views.has(tabId)) {
      this.destroy(tabId);
    }

    const view = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, '../../../preload/webview.mjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });

    this.attachListeners(view, hostWindow, tabId);
    view.webContents.setWindowOpenHandler(({ url: openUrl }) => {
      shell.openExternal(openUrl);
      return { action: 'deny' };
    });

    // 拒绝所有权限请求（摄像头、麦克风、通知等）
    view.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false);
    });

    // 设置 WebContentsView 圆角
    view.setBorderRadius(8);

    hostWindow.contentView.addChildView(view);
    loadWebContentsUrl(view.webContents, url);

    this.views.set(tabId, { view, hostWindow, ownerId });
    this.tabIdMap.set(view.webContents.id, tabId);
    const ownerTabIds = this.tabIdsByOwner.get(ownerId) ?? new Set<string>();
    ownerTabIds.add(tabId);
    this.tabIdsByOwner.set(ownerId, ownerTabIds);
  }

  /**
   * 销毁指定标签页的 View。
   * @param tabId - 标签页 ID
   */
  destroy(tabId: string): void {
    const entry = this.views.get(tabId);
    if (!entry) return;
    const { view, hostWindow, ownerId } = entry;
    try {
      hostWindow.contentView.removeChildView(view);
    } catch {
      // 宿主窗口可能先于 renderer destroyed 事件关闭，仍需继续关闭 WebContents。
    }
    try {
      view.webContents.close();
    } catch {
      // WebContents 可能已由 Electron 宿主销毁，仍需继续清理内存索引。
    }
    this.tabIdMap.delete(view.webContents.id);
    this.views.delete(tabId);
    const ownerTabIds = this.tabIdsByOwner.get(ownerId);
    ownerTabIds?.delete(tabId);
    if (ownerTabIds?.size === 0) this.tabIdsByOwner.delete(ownerId);
    if (this.activeTabId === tabId) {
      this.activeTabId = null;
    }
  }

  /**
   * 销毁指定 owner 创建的全部 View。
   * @param ownerId - 已销毁 WebContents ID
   */
  destroyOwner(ownerId: number): void {
    const tabIds = [...(this.tabIdsByOwner.get(ownerId) ?? [])];
    tabIds.forEach((tabId: string): void => this.destroy(tabId));
    this.tabIdsByOwner.delete(ownerId);
  }

  navigate(tabId: string, url: string): void {
    const view = this.views.get(tabId)?.view;
    if (!view) return;
    loadWebContentsUrl(view.webContents, url);
  }

  goBack(tabId: string): void {
    const view = this.views.get(tabId)?.view;
    if (view?.webContents.navigationHistory.canGoBack()) {
      view.webContents.navigationHistory.goBack();
    }
  }

  goForward(tabId: string): void {
    const view = this.views.get(tabId)?.view;
    if (view?.webContents.navigationHistory.canGoForward()) {
      view.webContents.navigationHistory.goForward();
    }
  }

  reload(tabId: string): void {
    const view = this.views.get(tabId)?.view;
    view?.webContents.reload();
  }

  stop(tabId: string): void {
    const view = this.views.get(tabId)?.view;
    view?.webContents.stop();
  }

  show(tabId: string): void {
    if (this.activeTabId === tabId) return;
    if (this.activeTabId) {
      const prev = this.views.get(this.activeTabId)?.view;
      prev?.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    }
    this.activeTabId = tabId;
    const view = this.views.get(tabId)?.view;
    if (view) {
      view.setBounds(this.lastBounds || { x: 0, y: 0, width: 800, height: 600 });
    }
  }

  hide(tabId: string): void {
    const view = this.views.get(tabId)?.view;
    if (view) {
      this.lastBounds = view.getBounds();
      view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    }
    if (this.activeTabId === tabId) {
      this.activeTabId = null;
    }
  }

  private lastBounds: Electron.Rectangle | null = null;

  setBounds(tabId: string, bounds: Electron.Rectangle): void {
    const view = this.views.get(tabId)?.view;

    if (!view) return;

    const { x, y, width, height } = bounds;

    view.setBounds({ x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) });
  }

  private attachListeners(view: WebContentsView, hostWindow: BrowserWindow, tabId: string): void {
    const send = (channel: string, ...args: unknown[]) => {
      hostWindow.webContents.send(channel, tabId, ...args);
    };

    view.webContents.on('did-start-loading', () => {
      send('webview:state-changed', { isLoading: true, loadProgress: 0 } as WebViewState);
    });

    view.webContents.on('did-stop-loading', () => {
      send('webview:state-changed', { isLoading: false, loadProgress: 1 } as WebViewState);
    });

    view.webContents.on('did-finish-load', () => {
      send('webview:title-updated', view.webContents.getTitle());
      send('webview:navigation-state-changed', view.webContents.navigationHistory.canGoBack(), view.webContents.navigationHistory.canGoForward());
    });

    view.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
      console.error(`Failed to load: ${errorDescription} (${errorCode})`);
    });

    view.webContents.on('page-title-updated', (_event, title) => {
      send('webview:title-updated', title);
    });

    // 导航拦截（仅 http/https）
    view.webContents.on('will-navigate', (event, url) => {
      try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          event.preventDefault();
        }
      } catch {
        event.preventDefault();
      }
    });
  }
}

const manager = new WebViewManager();

/** 已注册销毁回收的宿主 WebContents ID。 */
const trackedWebviewOwners = new Set<number>();

/**
 * 注册宿主 WebContents 销毁回收。
 * @param event - WebView IPC 创建事件
 */
function trackWebviewOwner(event: IpcMainInvokeEvent): void {
  const ownerId = event.sender.id;
  if (trackedWebviewOwners.has(ownerId)) return;

  trackedWebviewOwners.add(ownerId);
  event.sender.once('destroyed', (): void => {
    trackedWebviewOwners.delete(ownerId);
    manager.destroyOwner(ownerId);
  });
}

export function registerWebviewHandlers(): void {
  ipcMain.handle('webview:create', (event: IpcMainInvokeEvent, tabId: string, url: string) => {
    const hostWindow = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getAllWindows()[0];
    if (!hostWindow) throw new Error('WebView host window is unavailable');
    trackWebviewOwner(event);
    manager.create(event.sender.id, hostWindow, tabId, url);
  });

  ipcMain.handle('webview:destroy', (_event, tabId: string) => {
    manager.destroy(tabId);
  });

  ipcMain.handle('webview:navigate', (_event, tabId: string, url: string) => {
    manager.navigate(tabId, url);
  });

  ipcMain.handle('webview:go-back', (_event, tabId: string) => {
    manager.goBack(tabId);
  });

  ipcMain.handle('webview:go-forward', (_event, tabId: string) => {
    manager.goForward(tabId);
  });

  ipcMain.handle('webview:reload', (_event, tabId: string) => {
    manager.reload(tabId);
  });

  ipcMain.handle('webview:stop', (_event, tabId: string) => {
    manager.stop(tabId);
  });

  ipcMain.handle('webview:set-bounds', (_event, tabId: string, bounds: Electron.Rectangle) => {
    manager.setBounds(tabId, bounds);
  });

  ipcMain.handle('webview:show', (_event, tabId: string) => {
    manager.show(tabId);
  });

  ipcMain.handle('webview:hide', (_event, tabId: string) => {
    manager.hide(tabId);
  });

  ipcMain.handle('webview:clear-cache', async () => {
    const webviewSession = session.fromPartition(WEBVIEW_TAG_PARTITION);
    await Promise.all([
      webviewSession.clearCache(),
      webviewSession.clearStorageData({
        storages: WEBVIEW_CLEAR_STORAGE_TYPES
      })
    ]);
  });

  ipcMain.handle('webview:capture-protocol-screenshot', async (event: IpcMainInvokeEvent, request: WebViewProtocolScreenshotRequest): Promise<ArrayBuffer> => {
    return captureWebviewProtocolScreenshot(request, {
      expectedHostWebContentsId: event.sender.id
    });
  });
}
