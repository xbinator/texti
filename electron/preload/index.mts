/**
 * Electron 预加载脚本
 * 在渲染进程（前端）加载前执行，负责安全地暴露主进程 API
 * 通过 contextBridge 将 electronAPI 注入到 window 对象
 */

import type {
  AIServiceError,
  AIStreamFinishChunk,
  AIStreamToolCallChunk,
  AIStreamToolInputDeltaChunk,
  AIStreamToolInputEndChunk,
  AIStreamToolInputStartChunk,
  AIStreamToolResultChunk
} from 'types/ai';
import type { ChatAgentApplicationEvent } from 'types/chat-agent';
import type {
  ChatRuntimeBridgeRequestEvent,
  ChatRuntimeConfirmationRequestEvent,
  ChatRuntimeContextUsageEvent,
  ChatRuntimeEventMap,
  ChatRuntimeHandlerResult,
  ChatRuntimeMessageDeletedEvent,
  ChatRuntimeMessageEvent,
  ChatRuntimeRecoverySnapshot,
  ChatRuntimeToolCancelledEvent,
  ChatRuntimeToolRequestEvent
} from 'types/chat-runtime';
import type { ElectronAPI, ElectronShellCommandOutputChunk, ElectronShellRunEventEnvelope, FileChangeEvent } from 'types/electron-api';
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { getAutoDefaultCapability } from '../main/modules/shell/interaction/capability.mjs';
import { formatPreloadErrorMessage, shouldIgnorePreloadError } from './error-collector.mjs';
import webviewAPI from './webview.mjs';

/**
 * 发送带来源标识的日志到主进程
 * IPC 失败时静默处理，与主进程写入失败策略保持一致
 * @param scope - 进程来源标识
 * @param level - 日志级别
 * @param message - 日志消息
 */
async function writeScopedLog(scope: 'renderer' | 'preload', level: 'ERROR' | 'WARN' | 'INFO', message: string) {
  return ipcRenderer.invoke('logger:write', { scope, level, message }).catch(() => {
    // 静默处理，避免未捕获的 Promise rejection 污染控制台
  });
}

// ============================================================
// Preload 层错误收集
// ============================================================

/**
 * 初始化 Preload 层错误收集
 * 在 contextBridge 暴露之前调用，捕获 preload 自身错误
 */
function initPreloadErrorCollector(): void {
  window.onerror = (message, source, lineno, colno, error) => {
    const errorObj = error || new Error(String(message));
    if (shouldIgnorePreloadError(errorObj)) {
      return false;
    }

    const context = {
      source: source ? source.replace(/.*\//, '') : 'N/A',
      lineno,
      colno,
      type: 'preload.onerror'
    };
    writeScopedLog('preload', 'ERROR', formatPreloadErrorMessage(errorObj, context));
    return false;
  };

  window.onunhandledrejection = (event) => {
    const error = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
    if (shouldIgnorePreloadError(error)) {
      return;
    }

    writeScopedLog('preload', 'ERROR', formatPreloadErrorMessage(error, { type: 'unhandledrejection' }));
  };
}

// 初始化 Preload 错误收集
initPreloadErrorCollector();

/**
 * 通过 contextBridge 暴露 Electron API 到渲染进程
 * 所有 IPC 调用都通过这里进行，确保安全隔离
 */
const electronAPI: ElectronAPI = {
  readFile: (filePath: string) => ipcRenderer.invoke('fs:readFile', filePath),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  readWorkspaceFile: (options) => ipcRenderer.invoke('fs:readWorkspaceTextFile', options),
  readWorkspaceDirectory: (options) => ipcRenderer.invoke('fs:readWorkspaceDirectory', options),
  getPathStatus: (targetPath: string) => ipcRenderer.invoke('fs:getPathStatus', targetPath),

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
   * 保存二进制文件对话框或直接保存到指定路径。
   * @param content - 文件二进制内容
   * @param filePath - 指定保存路径
   * @param options - 保存选项
   * @returns 保存后的文件路径
   */
  saveBinaryFile: (content, filePath, options) => ipcRenderer.invoke('dialog:saveBinaryFile', content, filePath, options),

  /**
   * 将 PNG 图片写入系统剪贴板。
   * @param content - PNG 图片二进制内容
   */
  copyImageToClipboard: (content) => ipcRenderer.invoke('image:copyToClipboard', content),

  /**
   * 导出 PDF。
   * @param options - 导出选项，包含完整 HTML 文档与默认保存路径
   * @returns 成功保存后的文件路径
   */
  exportPdf: (options) => ipcRenderer.invoke('export:pdf', options),

  /**
   * 直接写入文件（已知路径时使用）
   * @param filePath 文件路径
   * @param content 文件内容
   */
  writeFile: (filePath: string, content: string) => ipcRenderer.invoke('fs:writeFile', filePath, content),

  /**
   * 仅在目标路径不存在时原子创建文本文件。
   * @param filePath 文件路径
   * @param content 文件内容
   */
  createFile: (filePath: string, content: string) => ipcRenderer.invoke('fs:createFile', filePath, content),

  renameFile: (oldPath: string, newPath: string) => ipcRenderer.invoke('fs:renameFile', oldPath, newPath),

  ensureDir: (dirPath: string) => ipcRenderer.invoke('fs:ensureDir', dirPath),

  acquireDirectoryInstallLock: (targetPath: string) => ipcRenderer.invoke('fs:acquireDirectoryInstallLock', targetPath),

  releaseDirectoryInstallLock: (token: string) => ipcRenderer.invoke('fs:releaseDirectoryInstallLock', token),

  trashFile: (filePath: string) => ipcRenderer.invoke('ui:trashFile', filePath),

  showItemInFolder: (filePath: string) => ipcRenderer.invoke('ui:showItemInFolder', filePath),

  getRelativePath: (filePath: string) => ipcRenderer.invoke('ui:getRelativePath', filePath),

  getCwd: () => ipcRenderer.invoke('ui:getCwd') as Promise<string>,
  getHomeDir: () => ipcRenderer.invoke('ui:getHomeDir') as Promise<string>,

  watchFile: (filePath: string) => ipcRenderer.invoke('fs:watchFile', filePath),

  unwatchFile: (filePath: string) => ipcRenderer.invoke('fs:unwatchFile', filePath),

  unwatchAll: () => ipcRenderer.invoke('fs:unwatchAll'),

  onFileChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: FileChangeEvent) => {
      callback(data);
    };
    ipcRenderer.on('file:changed', handler);
    return () => {
      ipcRenderer.removeListener('file:changed', handler);
    };
  },

  watchDirectory: (dirPath: string, globPattern?: string) => ipcRenderer.invoke('fs:watchDirectory', dirPath, globPattern),

  unwatchDirectory: (dirPath: string, globPattern?: string) => ipcRenderer.invoke('fs:unwatchDirectory', dirPath, globPattern),

  onSkillChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { type: string; filePath: string; content?: string }) => {
      callback(data);
    };
    ipcRenderer.on('skill:changed', handler);
    return () => {
      ipcRenderer.removeListener('skill:changed', handler);
    };
  },

  /**
   * 监听通过系统"打开方式"传入的文件路径。
   * @param callback - 文件路径回调
   * @returns 取消监听函数
   */
  onOpenFile: (callback) => {
    /**
     * 拉取主进程缓存的待打开文件路径并逐个回调给渲染进程。
     */
    const consumePendingOpenFiles = async (): Promise<void> => {
      const filePaths = (await ipcRenderer.invoke('app:consume-open-files')) as unknown;
      if (!Array.isArray(filePaths)) return;

      filePaths.filter((filePath): filePath is string => typeof filePath === 'string' && filePath.length > 0).forEach(callback);
    };

    /**
     * 安全消费待打开文件，避免异步失败冒泡到 preload 全局。
     */
    const consumePendingOpenFilesSafely = (): void => {
      consumePendingOpenFiles().catch(() => undefined);
    };

    const handler = () => {
      consumePendingOpenFilesSafely();
    };
    ipcRenderer.on('app:open-file', handler);
    consumePendingOpenFilesSafely();
    return () => {
      ipcRenderer.removeListener('app:open-file', handler);
    };
  },

  // ==================== 窗口控制操作 ====================

  /**
   * 设置窗口标题
   * @param title 窗口标题
   */
  setWindowTitle: (title: string) => ipcRenderer.invoke('ui:setTitle', title),

  /**
   * 最小化窗口
   */
  windowMinimize: () => ipcRenderer.invoke('ui:minimize'),

  /**
   * 最大化/恢复窗口
   */
  windowMaximize: () => ipcRenderer.invoke('ui:maximize'),

  /**
   * 关闭窗口
   */
  windowClose: () => ipcRenderer.invoke('ui:close'),

  /**
   * 查询窗口是否已最大化
   * @returns 是否最大化
   */
  windowIsMaximized: () => ipcRenderer.invoke('ui:isMaximized'),

  /**
   * 查询窗口是否全屏
   * @returns 是否全屏
   */
  windowIsFullScreen: () => ipcRenderer.invoke('ui:isFullScreen'),

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

  // ==================== 聊天会话操作 ====================

  chatSessionList: (type, pagination?) => ipcRenderer.invoke('chat:session:list', type, pagination),
  chatSessionCreate: (session) => ipcRenderer.invoke('chat:session:create', session),
  chatSessionGet: (sessionId) => ipcRenderer.invoke('chat:session:get', sessionId),
  chatSessionBranch: (sourceSessionId, targetMessageId) => ipcRenderer.invoke('chat:session:branch', sourceSessionId, targetMessageId),
  chatSessionUpdateTitle: (sessionId, title) => ipcRenderer.invoke('chat:session:updateTitle', sessionId, title),
  chatSessionUpdateModel: (sessionId, model) => ipcRenderer.invoke('chat:session:updateModel', sessionId, model),
  chatSessionDelete: (sessionId) => ipcRenderer.invoke('chat:session:delete', sessionId),
  chatSessionUsageGet: (sessionId) => ipcRenderer.invoke('chat:session:usage:get', sessionId),

  // ==================== 聊天消息操作 ====================

  chatMessageList: (sessionId, cursor?) => ipcRenderer.invoke('chat:message:list', sessionId, cursor),
  chatMessageAdd: (message) => ipcRenderer.invoke('chat:message:add', message),
  chatMessageUpdate: (message) => ipcRenderer.invoke('chat:message:update', message),
  chatMessageSetAll: (sessionId, messages) => ipcRenderer.invoke('chat:message:setAll', sessionId, messages),

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
  openExternal: (url: string) => ipcRenderer.invoke('ui:openExternal', url),

  /**
   * 按平台打开图片预览。
   * @param request - 图片预览请求
   * @returns 图片预览结果
   */
  previewImage: (request) => ipcRenderer.invoke('ui:previewImage', request),

  /**
   * 检查 GitHub Release 是否有新版本。
   * @returns 更新检查结果
   */
  checkForUpdate: () => ipcRenderer.invoke('updater:checkForUpdate'),

  /**
   * 获取 Tibis 工作区根目录。
   * @returns 工作区根目录信息，不可用时返回 null
   */
  getTibisWorkspaceRoot: () => ipcRenderer.invoke('workspace:get-root'),

  /**
   * 执行平台托管 request。
   * @param request - 请求输入
   * @returns 请求响应
   */
  request: (request) => ipcRenderer.invoke('request:send', request),

  /**
   * 分析 Shell 命令安全性。
   * @param request - 安全分析请求
   * @returns 安全分析报告
   */
  analyzeShellCommand: (request) => ipcRenderer.invoke('shell:analyze', request),

  /**
   * 同步读取与主进程相同环境中的 auto-default capability。
   * @returns 平台、架构和验证版本绑定的能力结果
   */
  getShellAutoDefaultCapability: () => getAutoDefaultCapability(),

  /**
   * 运行 Shell 命令。
   * @param request - 命令运行请求
   * @returns 命令执行结果
   */
  runShellCommand: (request) => ipcRenderer.invoke('shell:run', request),

  /**
   * 取消 Shell 命令。
   * @param commandId - 命令 ID
   * @returns 是否取消成功
   */
  cancelShellCommand: (commandId) => ipcRenderer.invoke('shell:cancel', commandId),

  /**
   * 监听 Shell 命令输出。
   * @param callback - 输出片段回调
   * @returns 取消监听函数
   */
  onShellCommandOutput: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, chunk: ElectronShellCommandOutputChunk) => callback(chunk);

    ipcRenderer.on('shell:output', handler);
    return () => {
      ipcRenderer.removeListener('shell:output', handler);
    };
  },

  /**
   * 监听 Shell PTY 有序运行事件。
   * @param callback - 运行事件回调
   * @returns 取消监听函数
   */
  onShellRunEvent: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, runEvent: ElectronShellRunEventEnvelope) => callback(runEvent);
    ipcRenderer.on('shell:run-event', handler);
    return () => {
      ipcRenderer.removeListener('shell:run-event', handler);
    };
  },

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

  // ==================== Chat runtime 操作 ====================

  /**
   * 查询主进程当前活跃 ChatRuntime 快照。
   * @returns 可用于 renderer 恢复的 Runtime 列表
   */
  chatRuntimeListActive: (): Promise<ChatRuntimeHandlerResult<ChatRuntimeRecoverySnapshot[]>> => ipcRenderer.invoke('chat:runtime:list-active'),

  /**
   * 估算空闲会话当前持久化消息的上下文用量。
   * @param input - 会话与当前模型上下文窗口
   * @returns 上下文用量快照
   */
  chatRuntimeEstimateContext: (input) => ipcRenderer.invoke('chat:runtime:estimate-context', input),

  /**
   * 通过主进程 ChatRuntime 发送一轮对话。
   * @param input - 本轮发送内容与 renderer 快照
   * @returns runtime 启动结果
   */
  chatRuntimeSend: (input) => ipcRenderer.invoke('chat:runtime:send', input),

  /**
   * 通过主进程 ChatRuntime 继续一轮暂停对话。
   * @param input - 续轮输入
   * @returns runtime 启动结果
   */
  chatRuntimeContinue: (input) => ipcRenderer.invoke('chat:runtime:continue', input),

  /**
   * 通过主进程 ChatRuntime 手动压缩当前会话上下文。
   * @param input - 压缩运行时输入
   * @returns runtime 启动结果
   */
  chatRuntimeCompact: (input) => ipcRenderer.invoke('chat:runtime:compact', input),

  /**
   * 通过主进程 ChatRuntime 提交用户选择答案并续跑。
   * @param input - 用户选择提交输入
   * @returns runtime 启动结果
   */
  chatRuntimeSubmitUserChoice: (input) => ipcRenderer.invoke('chat:runtime:submit-user-choice', input),

  /**
   * 提交 ChatRuntime 确认决策。
   * @param input - 确认决策输入
   * @returns 提交结果
   */
  chatRuntimeSubmitConfirmation: (input) => ipcRenderer.invoke('chat:runtime:submit-confirmation', input),

  /**
   * 提交 ChatRuntime bridge 响应。
   * @param input - bridge 响应输入
   * @returns 提交结果
   */
  chatRuntimeSubmitBridgeResponse: (input) => ipcRenderer.invoke('chat:runtime:bridge-response', input),

  /**
   * 通过主进程 ChatRuntime 自动生成并持久化会话标题。
   * @param input - 自动命名输入
   * @returns 自动命名结果
   */
  chatRuntimeAutoName: (input) => ipcRenderer.invoke('chat:runtime:auto-name', input),

  /**
   * 中止正在运行的 ChatRuntime。
   * @param input - runtime 中止参数
   * @returns 中止结果
   */
  chatRuntimeAbort: (input) => ipcRenderer.invoke('chat:runtime:abort', input),

  /**
   * 提交 renderer 本地工具执行结果。
   * @param input - 工具执行结果
   * @returns 提交结果
   */
  chatRuntimeSubmitToolResult: (input) => ipcRenderer.invoke('chat:runtime:tool-result', input),

  /**
   * 提交 renderer 侧产生的消息片段更新。
   * @param input - 消息片段更新输入
   * @returns 提交结果
   */
  chatRuntimeSubmitMessagePart: (input) => ipcRenderer.invoke('chat:runtime:message-part', input),

  /**
   * 监听 ChatRuntime 创建消息事件。
   * @param callback - 事件回调
   * @returns 取消监听函数
   */
  chatRuntimeOnMessageCreated: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: ChatRuntimeMessageEvent) => callback(payload);

    ipcRenderer.on('chat:runtime:message-created', handler);
    return () => {
      ipcRenderer.removeListener('chat:runtime:message-created', handler);
    };
  },

  /**
   * 监听 ChatRuntime 更新消息事件。
   * @param callback - 事件回调
   * @returns 取消监听函数
   */
  chatRuntimeOnMessageUpdated: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: ChatRuntimeMessageEvent) => callback(payload);

    ipcRenderer.on('chat:runtime:message-updated', handler);
    return () => {
      ipcRenderer.removeListener('chat:runtime:message-updated', handler);
    };
  },

  /**
   * 监听 ChatRuntime 删除消息事件。
   * @param callback - 事件回调
   * @returns 取消监听函数
   */
  chatRuntimeOnMessageDeleted: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: ChatRuntimeMessageDeletedEvent) => callback(payload);

    ipcRenderer.on('chat:runtime:message-deleted', handler);
    return () => {
      ipcRenderer.removeListener('chat:runtime:message-deleted', handler);
    };
  },

  /**
   * 监听 ChatRuntime 上下文用量更新事件。
   * @param callback - 事件回调
   * @returns 取消监听函数
   */
  chatRuntimeOnContextUsageUpdated: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: ChatRuntimeContextUsageEvent) => callback(payload);

    ipcRenderer.on('chat:runtime:context-usage-updated', handler);
    return () => {
      ipcRenderer.removeListener('chat:runtime:context-usage-updated', handler);
    };
  },

  /**
   * 监听 ChatRuntime 工具执行请求事件。
   * @param callback - 事件回调
   * @returns 取消监听函数
   */
  chatRuntimeOnToolRequest: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: ChatRuntimeToolRequestEvent) => callback(payload);

    ipcRenderer.on('chat:runtime:tool-request', handler);
    return () => {
      ipcRenderer.removeListener('chat:runtime:tool-request', handler);
    };
  },

  /**
   * 监听 ChatRuntime renderer 工具取消事件。
   * @param callback - 事件回调
   * @returns 取消监听函数
   */
  chatRuntimeOnToolCancelled: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: ChatRuntimeToolCancelledEvent) => callback(payload);

    ipcRenderer.on('chat:runtime:tool-cancelled', handler);
    return () => {
      ipcRenderer.removeListener('chat:runtime:tool-cancelled', handler);
    };
  },

  /**
   * 监听 ChatRuntime 确认请求事件。
   * @param callback - 事件回调
   * @returns 取消监听函数
   */
  chatRuntimeOnConfirmationRequested: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: ChatRuntimeConfirmationRequestEvent) => callback(payload);

    ipcRenderer.on('chat:runtime:confirmation-requested', handler);
    return () => {
      ipcRenderer.removeListener('chat:runtime:confirmation-requested', handler);
    };
  },

  /**
   * 监听 ChatRuntime bridge 请求事件。
   * @param callback - 事件回调
   * @returns 取消监听函数
   */
  chatRuntimeOnBridgeRequested: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: ChatRuntimeBridgeRequestEvent) => callback(payload);

    ipcRenderer.on('chat:runtime:bridge-requested', handler);
    return () => {
      ipcRenderer.removeListener('chat:runtime:bridge-requested', handler);
    };
  },

  /**
   * 监听 ChatRuntime 错误事件。
   * @param callback - 事件回调
   * @returns 取消监听函数
   */
  chatRuntimeOnError: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: ChatRuntimeEventMap['chat:runtime:error']) => callback(payload);

    ipcRenderer.on('chat:runtime:error', handler);
    return () => {
      ipcRenderer.removeListener('chat:runtime:error', handler);
    };
  },

  /**
   * 监听 ChatRuntime 完成事件。
   * @param callback - 事件回调
   * @returns 取消监听函数
   */
  chatRuntimeOnComplete: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: ChatRuntimeEventMap['chat:runtime:complete']) => callback(payload);

    ipcRenderer.on('chat:runtime:complete', handler);
    return () => {
      ipcRenderer.removeListener('chat:runtime:complete', handler);
    };
  },

  // ==================== Chat Agent 委派操作 ====================

  /** 查询公开的活跃 Checkpoint 投影。 */
  chatAgentListActive: () => ipcRenderer.invoke('chat:agent:list-active'),

  /** 查询公开的 pending confirmation 投影。 */
  chatAgentListConfirmations: () => ipcRenderer.invoke('chat:agent:list-confirmations'),

  /** 请求 Main 使用 version CAS 决议 confirmation。 */
  chatAgentResolveConfirmation: (input) => ipcRenderer.invoke('chat:agent:resolve-confirmation', input),

  /** 请求 Main CAS 启动 Primary Runtime B。 */
  chatAgentResumePrimary: (input) => ipcRenderer.invoke('chat:agent:resume-primary', input),

  /** 请求 Checkpoint cooperative cancellation。 */
  chatAgentCancelCheckpoint: (input) => ipcRenderer.invoke('chat:agent:cancel-checkpoint', input),

  /** 监听持久化 Checkpoint application event。 */
  chatAgentOnEvent: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: ChatAgentApplicationEvent): void => callback(payload);
    ipcRenderer.on('chat:agent:event', handler);
    return (): void => {
      ipcRenderer.removeListener('chat:agent:event', handler);
    };
  },

  // ==================== MCP runtime 操作 ====================

  /**
   * 查询 MCP server 运行态状态
   * @param serverIds server ID 列表
   */
  getMcpStatus: (serverIds) => ipcRenderer.invoke('tools:mcp:get-status', serverIds),

  /**
   * 读取 MCP discovery cache
   * @param serverId 可选 server ID
   */
  getMcpDiscoveryCache: (serverId) => ipcRenderer.invoke('tools:mcp:get-discovery-cache', serverId),

  /**
   * 刷新 MCP discovery
   * @param server MCP server 配置
   */
  refreshMcpDiscovery: (server) => ipcRenderer.invoke('tools:mcp:refresh-discovery', server),

  /**
   * 连接 MCP server 并刷新 discovery
   * @param server MCP server 配置
   */
  connectMcpServer: (server) => ipcRenderer.invoke('tools:mcp:connect', server),

  /**
   * 断开 MCP server
   * @param serverId MCP server ID
   */
  disconnectMcpServer: (serverId) => ipcRenderer.invoke('tools:mcp:disconnect', serverId),

  /**
   * 重启 MCP server 并刷新 discovery
   * @param server MCP server 配置
   */
  restartMcpServer: (server) => ipcRenderer.invoke('tools:mcp:restart', server),

  /**
   * 启动 OAuth 认证流程
   * @param server MCP server 配置
   */
  startMcpOAuth: (server) => ipcRenderer.invoke('tools:mcp:oauth:start', server),

  /**
   * 清除 OAuth 凭据
   * @param serverId MCP server ID
   */
  clearMcpOAuth: (serverId) => ipcRenderer.invoke('tools:mcp:oauth:clear', serverId),

  /**
   * 监听 MCP 工具列表变更通知
   * @param callback 变更回调
   */
  onMcpToolsChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { serverId: string }) => callback(data.serverId);
    ipcRenderer.on('tools:mcp:tools-changed', handler);
    return () => {
      ipcRenderer.removeListener('tools:mcp:tools-changed', handler);
    };
  },

  /**
   * 监听 OAuth 授权 URL 打开请求
   * @param callback URL 回调
   */
  onMcpOAuthOpenUrl: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, url: string) => callback(url);
    ipcRenderer.on('tools:mcp:oauth:open-url', handler);
    return () => {
      ipcRenderer.removeListener('tools:mcp:oauth:open-url', handler);
    };
  },

  // ==================== AI 流式事件监听 ====================
  onAiStreamText: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, text: string) => callback(text);

    ipcRenderer.on('ai:stream:text', handler);
    return () => {
      ipcRenderer.removeListener('ai:stream:text', handler);
    };
  },

  onAiStreamThinking: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, thinking: string) => callback(thinking);

    ipcRenderer.on('ai:stream:thinking', handler);
    return () => {
      ipcRenderer.removeListener('ai:stream:thinking', handler);
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
    const handler = (_event: Electron.IpcRendererEvent, error: AIServiceError) => callback(error);

    ipcRenderer.on('ai:stream:error', handler);
    return () => {
      ipcRenderer.removeListener('ai:stream:error', handler);
    };
  },

  onAiStreamFinish: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: AIStreamFinishChunk) => callback(payload);

    ipcRenderer.on('ai:stream:finish', handler);
    return () => {
      ipcRenderer.removeListener('ai:stream:finish', handler);
    };
  },

  onAiStreamToolInputStart: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: AIStreamToolInputStartChunk) => callback(payload);

    ipcRenderer.on('ai:stream:tool-input-start', handler);
    return () => {
      ipcRenderer.removeListener('ai:stream:tool-input-start', handler);
    };
  },

  onAiStreamToolInputDelta: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: AIStreamToolInputDeltaChunk) => callback(payload);

    ipcRenderer.on('ai:stream:tool-input-delta', handler);
    return () => {
      ipcRenderer.removeListener('ai:stream:tool-input-delta', handler);
    };
  },

  onAiStreamToolInputEnd: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: AIStreamToolInputEndChunk) => callback(payload);

    ipcRenderer.on('ai:stream:tool-input-end', handler);
    return () => {
      ipcRenderer.removeListener('ai:stream:tool-input-end', handler);
    };
  },

  onAiStreamToolCall: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: AIStreamToolCallChunk) => callback(payload);

    ipcRenderer.on('ai:stream:tool-call', handler);
    return () => {
      ipcRenderer.removeListener('ai:stream:tool-call', handler);
    };
  },

  onAiStreamToolResult: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: AIStreamToolResultChunk) => callback(payload);

    ipcRenderer.on('ai:stream:tool-result', handler);
    return () => {
      ipcRenderer.removeListener('ai:stream:tool-result', handler);
    };
  },

  // ==================== 日志操作 ====================
  // 控制台日志（保留原有实现，不删除）
  consoleLogger: {
    debug: (...args) => ipcRenderer.send('logger:debug', ...args),
    info: (...args) => ipcRenderer.send('logger:info', ...args),
    warn: (...args) => ipcRenderer.send('logger:warn', ...args),
    error: (...args) => ipcRenderer.send('logger:error', ...args)
  },

  // 文件日志收集（新增）
  logger: {
    error: (message: string) => writeScopedLog('renderer', 'ERROR', message),
    warn: (message: string) => writeScopedLog('renderer', 'WARN', message),
    info: (message: string) => writeScopedLog('renderer', 'INFO', message),

    getLogs: (options: Parameters<ElectronAPI['logger']['getLogs']>[0]) => ipcRenderer.invoke('logger:getLogs', options),

    getLogFiles: () => ipcRenderer.invoke('logger:getFiles'),

    openLogFolder: () => ipcRenderer.invoke('logger:openFolder')
  },

  // ==================== 菜单操作 ====================
  onMenuAction: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, action: string) => callback(action);
    ipcRenderer.on('ui:menuAction', handler);
    return () => {
      ipcRenderer.removeListener('ui:menuAction', handler);
    };
  },

  updateMenuItem: (id: string, properties: { checked?: boolean }) => {
    ipcRenderer.send('ui:updateMenuItem', id, properties);
  },

  syncRecentFiles: (files) => ipcRenderer.invoke('ui:syncRecentFiles', files),

  // WebView 操作
  webview: webviewAPI,

  // ==================== 图片压缩 ====================

  /**
   * 压缩图片，使用 sharp 在后台进行压缩。
   * @param buffer - 原始图片二进制数据
   * @param mimeType - 图片 MIME 类型
   * @returns 压缩结果（压缩后 ArrayBuffer + 是否实际压缩）
   */
  compressImage: async (buffer, mimeType) => {
    const result = await ipcRenderer.invoke('image:compress', { buffer, mimeType });
    if (result.buffer instanceof ArrayBuffer) {
      return result;
    }
    // 主进程返回的 Buffer 经结构化克隆后变为 Uint8Array
    // 取其底层 .buffer 并 slice 出有效字节范围
    if (result.buffer instanceof Uint8Array) {
      const { byteOffset, byteLength } = result.buffer;

      result.buffer = result.buffer.buffer.slice(byteOffset, byteOffset + byteLength);
      return result;
    }
    // 兜底：无法识别的类型，回退到原始 buffer（调用方已有 fallback）
    result.buffer = buffer;
    return result;
  }
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
