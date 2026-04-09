import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  openFile: (options?: { filters?: Array<{ name: string; extensions: string[] }> }) => ipcRenderer.invoke('dialog:openFile', options),

  saveFile: (content: string, filePath?: string, options?: { filters?: Array<{ name: string; extensions: string[] }>; defaultPath?: string }) =>
    ipcRenderer.invoke('dialog:saveFile', content, filePath, options),

  writeFile: (filePath: string, content: string) => ipcRenderer.invoke('fs:writeFile', filePath, content),

  setWindowTitle: (title: string) => ipcRenderer.invoke('window:setTitle', title),

  dbExecute: (sql: string, params?: unknown[]) => ipcRenderer.invoke('db:execute', sql, params),

  dbSelect: <T>(sql: string, params?: unknown[]) => ipcRenderer.invoke('db:select', sql, params) as Promise<T[]>,

  storeGet: (key: string) => ipcRenderer.invoke('store:get', key),

  storeSet: (key: string, value: unknown) => ipcRenderer.invoke('store:set', key, value),

  storeDelete: (key: string) => ipcRenderer.invoke('store:delete', key),

  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url)
});
