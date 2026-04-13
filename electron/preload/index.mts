/**
 * Electron 预加载脚本
 * 在渲染进程（前端）加载前执行，负责安全地暴露主进程 API
 * 通过 contextBridge 将 electronAPI 注入到 window 对象
 */

import type { ElectronAPI } from 'types/electron-api';
import { contextBridge, ipcRenderer } from 'electron';

/**
 * 通过 contextBridge 暴露 Electron API 到渲染进程
 * 所有 IPC 调用都通过这里进行，确保安全隔离
 */
const electronAPI: ElectronAPI = {
  // ==================== 文件对话框操作 ====================

  /**
   * 打开文件对话框
   * @param options 文件过滤选项
   * @returns 选择的文件信息（路径、内容、文件名等）
   */
  openFile: (options) => ipcRenderer.invoke('dialog:openFile', options),

  /**
   * 保存文件对话框或直接保存到指定路径
   * @param content 文件内容
   * @param filePath 指定保存路径（可选，为空则显示对话框）
   * @param options 保存选项（过滤器、默认路径等）
   * @returns 保存的文件路径
   */
  saveFile: (content, filePath, options) => ipcRenderer.invoke('dialog:saveFile', content, filePath, options),

  /**
   * 直接写入文件（已知路径时使用）
   * @param filePath 文件路径
   * @param content 文件内容
   */
  writeFile: (filePath: string, content: string) => ipcRenderer.invoke('fs:writeFile', filePath, content),

  watchFile: (filePath: string) => ipcRenderer.invoke('fs:watchFile', filePath),

  unwatchFile: () => ipcRenderer.invoke('fs:unwatchFile'),

  onFileChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) => {
      callback(data);
    };
    ipcRenderer.on('file:changed', handler);
    return () => {
      ipcRenderer.removeListener('file:changed', handler);
    };
  },

  // ==================== 窗口控制操作 ====================

  /**
   * 设置窗口标题
   * @param title 窗口标题
   */
  setWindowTitle: (title: string) => ipcRenderer.invoke('window:setTitle', title),

  /**
   * 最小化窗口
   */
  windowMinimize: () => ipcRenderer.invoke('window:minimize'),

  /**
   * 最大化/恢复窗口
   */
  windowMaximize: () => ipcRenderer.invoke('window:maximize'),

  /**
   * 关闭窗口
   */
  windowClose: () => ipcRenderer.invoke('window:close'),

  /**
   * 查询窗口是否已最大化
   * @returns 是否最大化
   */
  windowIsMaximized: () => ipcRenderer.invoke('window:isMaximized'),

  /**
   * 查询窗口是否全屏
   * @returns 是否全屏
   */
  windowIsFullScreen: () => ipcRenderer.invoke('window:isFullScreen'),

  // ==================== 数据库操作 ====================

  /**
   * 执行数据库写操作（INSERT/UPDATE/DELETE）
   * @param sql SQL语句
   * @param params 参数数组
   * @returns 执行结果（影响行数、最后插入ID）
   */
  dbExecute: (sql: string, params?: unknown[]) => ipcRenderer.invoke('db:execute', sql, params),

  /**
   * 执行数据库查询操作（SELECT）
   * @param sql SQL查询语句
   * @param params 参数数组
   * @returns 查询结果数组
   */
  dbSelect: (sql: string, params?: unknown[]) => ipcRenderer.invoke('db:select', sql, params),

  // ==================== 安全存储操作 ====================

  /**
   * 从安全存储读取数据
   * @param key 存储键名
   * @returns 存储的值
   */
  storeGet: (key: string) => ipcRenderer.invoke('store:get', key),

  /**
   * 写入安全存储
   * @param key 存储键名
   * @param value 存储值
   */
  storeSet: (key: string, value: unknown) => ipcRenderer.invoke('store:set', key, value),

  /**
   * 删除安全存储中的数据
   * @param key 存储键名
   */
  storeDelete: (key: string) => ipcRenderer.invoke('store:delete', key),

  // ==================== 系统操作 ====================

  /**
   * 使用系统默认浏览器打开外部链接
   * @param url 要打开的 URL
   */
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),

  // ==================== AI 服务操作 ====================

  /**
   * 非流式文本生成
   * @param payload AI 创建参数与请求参数
   * @returns 生成的文本结果
   */
  aiInvoke: (createOptions, request) => ipcRenderer.invoke('ai:invoke', createOptions, request),

  /**
   * 流式文本生成
   * @param payload AI 创建参数与请求参数
   */
  aiStream: (createOptions, request) => ipcRenderer.invoke('ai:stream', createOptions, request),

  /**
   * 中止流式文本生成
   * @param requestId 请求唯一标识
   */
  aiStreamAbort: (requestId) => ipcRenderer.invoke('ai:stream:abort', requestId),

  // ==================== AI 流式事件监听 ====================
  onAiStreamChunk: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, chunk: string) => callback(chunk);

    ipcRenderer.on('ai:stream:chunk', handler);
    return () => {
      ipcRenderer.removeListener('ai:stream:chunk', handler);
    };
  },

  onAiStreamComplete: (callback) => {
    const handler = () => callback();

    ipcRenderer.on('ai:stream:complete', handler);
    return () => {
      ipcRenderer.removeListener('ai:stream:complete', handler);
    };
  },

  onAiStreamError: (callback) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handler = (_event: Electron.IpcRendererEvent, error: any) => callback(error);

    ipcRenderer.on('ai:stream:error', handler);
    return () => {
      ipcRenderer.removeListener('ai:stream:error', handler);
    };
  },

  // ==================== 日志操作 ====================
  logger: {
    debug: (...args) => ipcRenderer.send('logger:debug', ...args),
    info: (...args) => ipcRenderer.send('logger:info', ...args),
    warn: (...args) => ipcRenderer.send('logger:warn', ...args),
    error: (...args) => ipcRenderer.send('logger:error', ...args)
  }
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
