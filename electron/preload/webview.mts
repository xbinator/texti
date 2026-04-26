import type { WebViewAPI, WebViewState } from '../../types/electron-api';
import { ipcRenderer } from 'electron';

const webview: WebViewAPI = {
  create: (tabId, url) => ipcRenderer.invoke('webview:create', tabId, url),
  destroy: (tabId) => ipcRenderer.invoke('webview:destroy', tabId),
  navigate: (tabId, url) => ipcRenderer.invoke('webview:navigate', tabId, url),
  goBack: (tabId) => ipcRenderer.invoke('webview:go-back', tabId),
  goForward: (tabId) => ipcRenderer.invoke('webview:go-forward', tabId),
  reload: (tabId) => ipcRenderer.invoke('webview:reload', tabId),
  stop: (tabId) => ipcRenderer.invoke('webview:stop', tabId),
  setBounds: (tabId, bounds) => ipcRenderer.invoke('webview:set-bounds', tabId, bounds),
  show: (tabId) => ipcRenderer.invoke('webview:show', tabId),
  hide: (tabId) => ipcRenderer.invoke('webview:hide', tabId),

  onStateChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, tabId: string, state: WebViewState) => {
      callback(tabId, state);
    };
    ipcRenderer.on('webview:state-changed', handler);
    return () => ipcRenderer.removeListener('webview:state-changed', handler);
  },

  onTitleUpdated: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, tabId: string, title: string) => {
      callback(tabId, title);
    };
    ipcRenderer.on('webview:title-updated', handler);
    return () => ipcRenderer.removeListener('webview:title-updated', handler);
  },

  onNavigationStateChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, tabId: string, canGoBack: boolean, canGoForward: boolean) => {
      callback(tabId, canGoBack, canGoForward);
    };
    ipcRenderer.on('webview:navigation-state-changed', handler);
    return () => ipcRenderer.removeListener('webview:navigation-state-changed', handler);
  },

  onOpenInNewTab: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, url: string) => {
      callback(url);
    };
    ipcRenderer.on('webview:open-in-new-tab', handler);
    return () => ipcRenderer.removeListener('webview:open-in-new-tab', handler);
  }
};

export default webview;
