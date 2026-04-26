import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WebViewState } from 'types/webview';
import { ipcMain, WebContentsView, BrowserWindow, shell } from 'electron';

// 获取当前文件的目录路径
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class WebViewManager {
  private views: Map<string, WebContentsView> = new Map();

  private tabIdMap: Map<number, string> = new Map();

  private activeTabId: string | null = null;

  create(tabId: string, url: string): void {
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

    this.attachListeners(view, tabId);
    view.webContents.setWindowOpenHandler(({ url: openUrl }) => {
      shell.openExternal(openUrl);
      return { action: 'deny' };
    });

    // 拒绝所有权限请求（摄像头、麦克风、通知等）
    view.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false);
    });

    const win = BrowserWindow.getAllWindows()[0];
    win.contentView.addChildView(view);
    view.webContents.loadURL(url);

    this.views.set(tabId, view);
    this.tabIdMap.set(view.webContents.id, tabId);
  }

  destroy(tabId: string): void {
    const view = this.views.get(tabId);
    if (!view) return;
    const win = BrowserWindow.getAllWindows()[0];
    win.contentView.removeChildView(view);
    view.webContents.close();
    this.tabIdMap.delete(view.webContents.id);
    this.views.delete(tabId);
    if (this.activeTabId === tabId) {
      this.activeTabId = null;
    }
  }

  navigate(tabId: string, url: string): void {
    const view = this.views.get(tabId);
    if (!view) return;
    view.webContents.loadURL(url);
  }

  goBack(tabId: string): void {
    const view = this.views.get(tabId);
    if (view?.webContents.navigationHistory.canGoBack()) {
      view.webContents.navigationHistory.goBack();
    }
  }

  goForward(tabId: string): void {
    const view = this.views.get(tabId);
    if (view?.webContents.navigationHistory.canGoForward()) {
      view.webContents.navigationHistory.goForward();
    }
  }

  reload(tabId: string): void {
    const view = this.views.get(tabId);
    view?.webContents.reload();
  }

  stop(tabId: string): void {
    const view = this.views.get(tabId);
    view?.webContents.stop();
  }

  show(tabId: string): void {
    if (this.activeTabId === tabId) return;
    if (this.activeTabId) {
      const prev = this.views.get(this.activeTabId);
      prev?.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    }
    this.activeTabId = tabId;
    const view = this.views.get(tabId);
    if (view) {
      view.setBounds(this.lastBounds || { x: 0, y: 0, width: 800, height: 600 });
    }
  }

  hide(tabId: string): void {
    const view = this.views.get(tabId);
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
    const view = this.views.get(tabId);

    if (!view) return;

    const { x, y, width, height } = bounds;

    view.setBounds({ x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) });
  }

  private attachListeners(view: WebContentsView, tabId: string): void {
    const send = (channel: string, ...args: unknown[]) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send(channel, tabId, ...args);
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

export function registerWebviewHandlers(): void {
  ipcMain.handle('webview:create', (_event, tabId: string, url: string) => {
    manager.create(tabId, url);
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
}
