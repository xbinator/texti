import type {
  AICreateOptions,
  AIRequestOptions,
  AIUsage,
  AIServiceError,
  AIInvokeResult,
  AIStreamFinishChunk,
  AIStreamToolCallChunk,
  AIStreamToolInputDeltaChunk,
  AIStreamToolInputEndChunk,
  AIStreamToolInputStartChunk,
  AIStreamToolResultChunk,
  MCPDiscoveryRefreshResult,
  MCPServerConfig,
  MCPServerDiscoveryCache,
  MCPStatusResponse
} from './ai';
import type {
  ChatMessageHistoryCursor,
  ChatMessageRecord,
  ChatSession,
  ChatSessionModelMetadata,
  ChatSessionType,
  PaginatedSessionsResult,
  SessionPaginationParams
} from './chat';
import type {
  ChatRuntimeAbortInput,
  ChatRuntimeAbortResult,
  ChatRuntimeAutoNameInput,
  ChatRuntimeAutoNameResult,
  ChatRuntimeBridgeRequestEvent,
  ChatRuntimeBridgeResponseInput,
  ChatRuntimeCompactInput,
  ChatRuntimeConfirmationRequestEvent,
  ChatRuntimeContinueInput,
  ChatRuntimeContextUsageEvent,
  ChatRuntimeContextUsageSnapshot,
  ChatRuntimeEstimateContextInput,
  ChatRuntimeEventMap,
  ChatRuntimeHandlerResult,
  ChatRuntimeMessageDeletedEvent,
  ChatRuntimeMessageEvent,
  ChatRuntimeRecoverySnapshot,
  ChatRuntimeSendInput,
  ChatRuntimeStartResult,
  ChatRuntimeSubmitConfirmationInput,
  ChatRuntimeSubmitMessagePartInput,
  ChatRuntimeSubmitUserChoiceInput,
  ChatRuntimeSubmitToolResultInput,
  ChatRuntimeToolCancelledEvent,
  ChatRuntimeToolRequestEvent
} from './chat-runtime';
import type { RequestInput, RequestResponse } from './request';
import type { WebViewProtocolScreenshotRequest } from './webview';

/** Chat IPC handler 统一返回类型 */
export type ChatHandlerResult<T> = { ok: true; data: T } | { ok: false; error: string; code: string };

/**
 * Electron API 类型定义
 * 为 window.electronAPI 提供类型支持
 */

export interface ElectronDialogFilter {
  name: string;
  extensions: string[];
}

export interface ElectronOpenFileOptions {
  filters?: ElectronDialogFilter[];
}

export interface ElectronSaveFileOptions {
  filters?: ElectronDialogFilter[];
  defaultPath?: string;
}

/**
 * Electron PDF 导出参数。
 */
export interface ElectronExportPdfOptions {
  /** 已准备好的完整 HTML 文档 */
  html: string;
  /** 保存对话框过滤器 */
  filters?: ElectronDialogFilter[];
  /** 默认保存路径 */
  defaultPath?: string;
}

export interface ElectronFileResult {
  canceled: boolean;
  filePath: string | null;
  content: string;
  fileName: string;
  ext: string;
}

export interface ElectronReadFileResult {
  content: string;
  fileName: string;
  ext: string;
}

/**
 * Electron 文件路径状态。
 */
export interface ElectronFilePathStatus {
  /** 路径是否存在。 */
  exists: boolean;
  /** 路径是否为普通文件。 */
  isFile: boolean;
  /** 路径是否为目录。 */
  isDirectory: boolean;
}

/**
 * Electron 工作区文件读取参数。
 */
export interface ElectronReadWorkspaceFileOptions {
  /** 文件路径，支持相对工作区路径或绝对路径 */
  filePath: string;
  /** 工作区根目录，缺省时仅允许读取绝对路径 */
  workspaceRoot?: string;
  /** 起始行号，默认 1 */
  offset?: number;
  /** 读取行数，默认 200，最大 1000 */
  limit?: number;
}

/**
 * Electron 工作区文件读取结果。
 */
export interface ElectronReadWorkspaceFileResult {
  /** 规范化后的真实文件路径 */
  path: string;
  /** 截取后的文本内容 */
  content: string;
  /** 文件总行数 */
  totalLines: number;
  /** 实际读取行数 */
  readLines: number;
  /** 是否还有后续内容 */
  hasMore: boolean;
  /** 下一次滚动读取的起始行号，没有后续内容时为 null */
  nextOffset: number | null;
}

/**
 * Electron 工作区目录读取参数。
 */
export interface ElectronReadWorkspaceDirectoryOptions {
  /** 目录路径，支持相对工作区路径或绝对路径 */
  directoryPath: string;
  /** 工作区根目录，缺省时仅允许读取绝对路径 */
  workspaceRoot?: string;
}

/**
 * Electron 工作区目录子项。
 */
export interface ElectronReadWorkspaceDirectoryEntry {
  /** 子项名称。 */
  name: string;
  /** 子项绝对路径。 */
  path: string;
  /** 子项类型。 */
  type: 'file' | 'directory';
}

/**
 * Electron 工作区目录读取结果。
 */
export interface ElectronReadWorkspaceDirectoryResult {
  /** 规范化后的真实目录路径 */
  path: string;
  /** 当前目录下的直接子项 */
  entries: ElectronReadWorkspaceDirectoryEntry[];
}

/** Shell 命令支持的 shell 类型。 */
export type ElectronShellCommandShell = 'bash' | 'powershell';

/** Shell 命令交互模式。 */
export type ElectronShellInteractionMode = 'none' | 'auto-default';

/** Shell auto-default 版本化 capability。 */
export interface ElectronShellAutoDefaultCapability {
  /** 当前构建是否允许自动默认交互。 */
  enabled: boolean;
  /** 未开放原因。 */
  reason: 'FEATURE_DISABLED' | 'VERIFICATION_MISMATCH' | null;
  /** 当前要求的验证版本。 */
  verificationVersion: string;
  /** 当前平台。 */
  platform: string;
  /** 当前 CPU 架构。 */
  arch: string;
}

/** Shell 命令权威终止语义。 */
export type ElectronShellCommandTermination =
  | { kind: 'exit'; exitCode: number }
  | { kind: 'signal'; signal: string }
  | { kind: 'cancelled' }
  | { kind: 'tool_timeout' }
  | { kind: 'interaction_timeout' }
  | { kind: 'answer_limit' }
  | { kind: 'unsupported_prompt'; reason: 'text' | 'path' | 'account' | 'secret' }
  | { kind: 'process_cleanup_failed'; message: string }
  | { kind: 'spawn_error'; message: string };

/**
 * Electron Shell 命令安全发现项。
 */
export interface ElectronShellCommandSafetyFinding {
  /** 严重级别。 */
  severity: 'info' | 'warning' | 'blocker';
  /** 机器可读编码。 */
  code: string;
  /** 展示消息。 */
  message: string;
  /** 触发规则的命令片段。 */
  nodeText?: string;
}

/**
 * Electron Shell 命令安全报告。
 */
export interface ElectronShellCommandSafetyReport {
  /** 分析状态。 */
  status: 'allowed' | 'blocked';
  /** Shell 类型。 */
  shell: ElectronShellCommandShell | 'unknown';
  /** 安全发现项。 */
  findings: ElectronShellCommandSafetyFinding[];
  /** 归一化命令预览。 */
  normalizedCommandPreview: string;
  /** 归一化执行目录。 */
  cwd: string;
}

/**
 * Electron Shell 命令安全分析请求。
 */
export interface ElectronShellCommandSafetyRequest {
  /** Shell 类型。 */
  shell?: unknown;
  /** 命令文本。 */
  command?: unknown;
  /** 执行目录。 */
  cwd?: unknown;
  /** 工作区根目录。 */
  workspaceRoot?: unknown;
}

/**
 * Electron Shell 命令执行请求。
 */
export interface ElectronShellCommandRunRequest {
  /** 命令唯一标识。 */
  commandId: string;
  /** Shell 类型。 */
  shell: ElectronShellCommandShell;
  /** 命令文本。 */
  command: string;
  /** 执行目录。 */
  cwd: string;
  /** 工作区根目录。 */
  workspaceRoot: string;
  /** 超时时间，单位毫秒。 */
  timeoutMs: number;
  /** 最终输出最大字符数。 */
  maxOutputChars?: number;
  /** 交互模式，缺省时使用普通管道模式。 */
  interactionMode?: ElectronShellInteractionMode;
  /** Renderer 已完成用户确认的安全发现项编码。 */
  confirmedSafetyFindingCodes?: string[];
}

/**
 * Electron Shell 命令输出片段。
 */
export interface ElectronShellCommandOutputChunk {
  /** 命令唯一标识。 */
  commandId: string;
  /** 输出流。 */
  stream: 'stdout' | 'stderr';
  /** 输出文本。 */
  text: string;
  /** 递增序号。 */
  sequence: number;
  /** 创建时间。 */
  createdAt: string;
}

/** Shell PTY 有序运行事件。 */
export type ElectronShellRunEvent =
  | { type: 'terminal_update'; content: string }
  | { type: 'auto_answer'; count: number }
  | { type: 'finished'; result: ElectronShellCommandRunResult };

/** Shell PTY 事件信封。 */
export interface ElectronShellRunEventEnvelope {
  /** 命令唯一标识。 */
  commandId: string;
  /** 单命令递增序号。 */
  sequence: number;
  /** ISO 创建时间。 */
  createdAt: string;
  /** 事件载荷。 */
  event: ElectronShellRunEvent;
}

/**
 * Electron Shell 命令执行结果。
 */
export interface ElectronShellCommandRunResult {
  /** 命令唯一标识。 */
  commandId: string;
  /** Shell 类型。 */
  shell: ElectronShellCommandShell;
  /** 命令文本。 */
  command: string;
  /** 执行目录。 */
  cwd: string;
  /** 退出码。 */
  exitCode: number | null;
  /** 退出信号。 */
  signal: string | null;
  /** 执行耗时。 */
  durationMs: number;
  /** 是否超时。 */
  timedOut: boolean;
  /** 是否截断。 */
  truncated: boolean;
  /** 输出采集模式。 */
  outputMode: 'pipes' | 'pty';
  /** 管道模式 stdout。 */
  stdout?: string;
  /** 管道模式 stderr。 */
  stderr?: string;
  /** PTY 模式去除终端控制序列后的有界纯文本输出。 */
  terminalOutput?: string;
  /** 权威终止语义。 */
  termination: ElectronShellCommandTermination;
  /** 自动交互元数据，仅 auto-default 模式存在。 */
  autoInteraction?: {
    /** 是否启用自动交互。 */
    enabled: boolean;
    /** 累计自动回答次数。 */
    answerCount: number;
    /** 自动交互停止原因。 */
    stopReason?:
      | 'completed'
      | 'tool_timeout'
      | 'interaction_timeout'
      | 'answer_limit'
      | 'process_exit'
      | 'unsupported_prompt'
      | 'cancelled';
  };
}

export interface DbExecuteResult {
  changes: number;
  lastInsertRowid: number;
}

export interface FileChangeEvent {
  type: 'change' | 'unlink' | 'add';
  filePath: string;
  content?: string;
}

export interface WebViewState {
  url: string; // 当前加载的 URL
  title: string; // 页面标题
  isLoading: boolean; // 是否正在加载
  canGoBack: boolean; // 是否可以后退
  canGoForward: boolean; // 是否可以前进
  loadProgress: number; // 加载进度 0-1
}

export interface WebViewAPI {
  create: (tabId: string, url: string) => Promise<void>; // 创建 WebContentsView
  destroy: (tabId: string) => Promise<void>; // 销毁 WebContentsView
  navigate: (tabId: string, url: string) => Promise<void>; // 导航到 URL
  goBack: (tabId: string) => Promise<void>; // 后退
  goForward: (tabId: string) => Promise<void>; // 前进
  reload: (tabId: string) => Promise<void>; // 刷新
  stop: (tabId: string) => Promise<void>; // 停止加载
  setBounds: (tabId: string, bounds: { x: number; y: number; width: number; height: number }) => Promise<void>; // 设置边界
  show: (tabId: string) => Promise<void>; // 显示
  hide: (tabId: string) => Promise<void>; // 隐藏
  clearCache: () => Promise<void>; // 清理 WebView 持久化分区缓存与站点数据
  captureProtocolScreenshot: (request: WebViewProtocolScreenshotRequest) => Promise<ArrayBuffer>; // 通过 CDP 截取 WebView 页面区域
  onStateChanged: (callback: (tabId: string, state: WebViewState) => void) => () => void; // 加载状态变化
  onTitleUpdated: (callback: (tabId: string, title: string) => void) => () => void; // 标题更新
  onNavigationStateChanged: (callback: (tabId: string, canGoBack: boolean, canGoForward: boolean) => void) => () => void; // 导航状态变化
  onOpenInNewTab: (callback: (url: string) => void) => () => void; // 在新标签页打开
  onAttachRejected: (callback: (payload: { src: string; reason: string }) => void) => () => void; // `<webview>` 附加被拒绝
}

/**
 * 最近文件的最小输入信息。
 */
export interface RecentFileShortcutInput {
  /** 文件唯一标识 */
  id: string;
  /** 文件名 */
  name: string;
  /** 文件扩展名 */
  ext: string;
  /** 文件路径，未保存文件为空 */
  path: string | null;
}

/**
 * 图片压缩请求参数
 */
export interface ElectronImageCompressRequest {
  /** 原始图片二进制数据 */
  buffer: ArrayBuffer;
  /** 图片 MIME 类型 */
  mimeType: string;
}

/**
 * 图片压缩结果
 */
export interface ElectronImageCompressResult {
  /** 压缩后的二进制数据 */
  buffer: ArrayBuffer;
  /** 是否实际执行了压缩 */
  compressed: boolean;
}

/**
 * Electron 图片预览请求参数。
 */
export interface ElectronImagePreviewRequest {
  /** 图片地址、本地路径或 data URL */
  src: string;
  /** 展示文件名 */
  name?: string;
  /** 图片 MIME 类型 */
  mimeType?: string;
}

/**
 * Electron 图片预览结果。
 */
export interface ElectronImagePreviewResult {
  /** 是否已由 Electron 侧完成预览打开 */
  opened: boolean;
  /** 实际使用的预览模式 */
  mode: 'native' | 'window' | 'unsupported';
}

/**
 * Tibis 工作区根目录信息。
 */
export interface ElectronTibisWorkspaceRoot {
  /** 绝对根目录路径，作为安全边界。 */
  rootPath: string;
  /** 本次请求是否创建了目录。 */
  created: boolean;
}

/**
 * 发现新版本时的更新检查结果。
 */
export interface ElectronUpdateAvailableResult {
  /** 是否存在可用更新。 */
  available: true;
  /** 当前应用版本。 */
  currentVersion: string;
  /** GitHub Release 最新版本。 */
  latestVersion: string;
  /** Release 展示名。 */
  releaseName?: string;
  /** Release 网页地址，用于引导下载。 */
  releaseUrl: string;
  /** Release 发布时间。 */
  publishedAt?: string;
}

/**
 * 未发现更新或检查失败时的更新检查结果。
 */
export interface ElectronUpdateUnavailableResult {
  /** 是否存在可用更新。 */
  available: false;
  /** 当前应用版本。 */
  currentVersion: string;
  /** GitHub Release 最新版本，检查失败时为空。 */
  latestVersion?: string;
  /** 检查失败时的错误消息。 */
  errorMessage?: string;
}

export type ElectronUpdateCheckResult = ElectronUpdateAvailableResult | ElectronUpdateUnavailableResult;

export interface ElectronAPI {
  readFile: (filePath: string) => Promise<ElectronReadFileResult>;
  /** 获取拖拽文件对应的本地磁盘路径。 */
  getPathForFile: (file: globalThis.File) => string;
  readWorkspaceFile: (options: ElectronReadWorkspaceFileOptions) => Promise<ElectronReadWorkspaceFileResult>;
  readWorkspaceDirectory: (options: ElectronReadWorkspaceDirectoryOptions) => Promise<ElectronReadWorkspaceDirectoryResult>;
  getPathStatus: (targetPath: string) => Promise<ElectronFilePathStatus>;

  // 文件对话框操作
  openFile: (options?: ElectronOpenFileOptions) => Promise<ElectronFileResult>;

  saveFile: (content: string, filePath?: string, options?: ElectronSaveFileOptions) => Promise<string | null>;
  saveBinaryFile: (content: ArrayBuffer, filePath?: string, options?: ElectronSaveFileOptions) => Promise<string | null>;
  /** 将 PNG 图片二进制内容写入系统剪贴板。 */
  copyImageToClipboard: (content: ArrayBuffer) => Promise<void>;
  exportPdf: (options: ElectronExportPdfOptions) => Promise<string | null>;

  writeFile: (filePath: string, content: string) => Promise<void>;
  /** 仅在目标路径不存在时原子创建文本文件。 */
  createFile: (filePath: string, content: string) => Promise<void>;
  renameFile: (oldPath: string, newPath: string) => Promise<void>;
  ensureDir: (dirPath: string) => Promise<void>;
  /** 在主进程获取指定目标目录的跨窗口安装锁。 */
  acquireDirectoryInstallLock: (targetPath: string) => Promise<string>;
  /** 释放跨窗口目录安装锁。 */
  releaseDirectoryInstallLock: (token: string) => Promise<void>;
  trashFile: (filePath: string) => Promise<void>;
  showItemInFolder: (filePath: string) => Promise<void>;
  getRelativePath: (filePath: string) => Promise<string>;

  getCwd: () => Promise<string>;
  getHomeDir: () => Promise<string>;

  watchFile: (filePath: string) => Promise<void>;
  unwatchFile: (filePath: string) => Promise<void>;
  unwatchAll: () => Promise<void>;
  onFileChanged: (callback: (data: FileChangeEvent) => void) => () => void;

  watchDirectory: (dirPath: string, globPattern?: string) => Promise<void>;
  unwatchDirectory: (dirPath: string, globPattern?: string) => Promise<void>;
  onSkillChanged: (callback: (data: { type: string; filePath: string; content?: string }) => void) => () => void;

  /** 监听系统通过"打开方式"传入的文件路径 */
  onOpenFile: (callback: (filePath: string) => void) => () => void;

  // 窗口控制操作
  setWindowTitle: (title: string) => Promise<void>;
  windowMinimize: () => Promise<void>;
  windowMaximize: () => Promise<void>;
  windowClose: () => Promise<void>;
  windowIsMaximized: () => Promise<boolean>;
  windowIsFullScreen: () => Promise<boolean>;

  // 数据库操作
  dbExecute: (sql: string, params?: unknown[]) => Promise<DbExecuteResult>;
  dbSelect: <T = unknown>(sql: string, params?: unknown[]) => Promise<T[]>;

  // 聊天会话操作
  chatSessionList: (type: ChatSessionType, pagination?: SessionPaginationParams) => Promise<ChatHandlerResult<PaginatedSessionsResult>>;
  chatSessionCreate: (session: ChatSession) => Promise<ChatHandlerResult<void>>;
  chatSessionGet: (sessionId: string) => Promise<ChatHandlerResult<ChatSession | undefined>>;
  chatSessionBranch: (sourceSessionId: string, targetMessageId: string) => Promise<ChatHandlerResult<ChatSession>>;
  chatSessionUpdateTitle: (sessionId: string, title: string) => Promise<ChatHandlerResult<void>>;
  chatSessionUpdateModel: (sessionId: string, model: ChatSessionModelMetadata) => Promise<ChatHandlerResult<ChatSession>>;
  chatSessionDelete: (sessionId: string) => Promise<ChatHandlerResult<void>>;
  chatSessionUsageGet: (sessionId: string) => Promise<ChatHandlerResult<AIUsage | undefined>>;

  // 聊天消息操作
  chatMessageList: (sessionId: string, cursor?: ChatMessageHistoryCursor) => Promise<ChatHandlerResult<ChatMessageRecord[]>>;
  chatMessageAdd: (message: ChatMessageRecord) => Promise<ChatHandlerResult<void>>;
  chatMessageUpdate: (message: ChatMessageRecord) => Promise<ChatHandlerResult<void>>;
  chatMessageSetAll: (sessionId: string, messages: ChatMessageRecord[]) => Promise<ChatHandlerResult<void>>;

  // 安全存储操作
  storeGet: <T = unknown>(key: string) => Promise<T | undefined>;
  storeSet: (key: string, value: unknown) => Promise<void>;
  storeDelete: (key: string) => Promise<void>;

  // 系统操作
  openExternal: (url: string) => Promise<void>;
  /** 按平台打开图片预览。 */
  previewImage: (request: ElectronImagePreviewRequest) => Promise<ElectronImagePreviewResult>;
  /** 检查 GitHub Release 是否有新版本。 */
  checkForUpdate: () => Promise<ElectronUpdateCheckResult>;
  /** 获取 Tibis 工作区根目录，不可用时返回 null。 */
  getTibisWorkspaceRoot: () => Promise<ElectronTibisWorkspaceRoot | null>;
  /** 执行平台托管 request。 */
  request: (request: RequestInput) => Promise<RequestResponse>;
  analyzeShellCommand: (request: ElectronShellCommandSafetyRequest) => Promise<ElectronShellCommandSafetyReport>;
  /** 同步读取当前构建的 Shell auto-default capability。 */
  getShellAutoDefaultCapability: () => ElectronShellAutoDefaultCapability;
  runShellCommand: (request: ElectronShellCommandRunRequest) => Promise<ElectronShellCommandRunResult>;
  cancelShellCommand: (commandId: string) => Promise<boolean>;
  onShellCommandOutput: (callback: (chunk: ElectronShellCommandOutputChunk) => void) => () => void;
  onShellRunEvent: (callback: (event: ElectronShellRunEventEnvelope) => void) => () => void;

  // AI 服务操作
  aiInvoke: (createOptions: AICreateOptions, request: AIRequestOptions) => Promise<AsyncResult<AIInvokeResult, AIServiceError>>;
  aiStream: (createOptions: AICreateOptions, request: AIRequestOptions) => Promise<void>;
  aiStreamAbort: (requestId: string) => Promise<void>;

  // Chat runtime 操作
  chatRuntimeListActive: () => Promise<ChatRuntimeHandlerResult<ChatRuntimeRecoverySnapshot[]>>;
  chatRuntimeEstimateContext: (input: ChatRuntimeEstimateContextInput) => Promise<ChatRuntimeHandlerResult<ChatRuntimeContextUsageSnapshot>>;
  chatRuntimeSend: (input: ChatRuntimeSendInput) => Promise<ChatRuntimeHandlerResult<ChatRuntimeStartResult>>;
  chatRuntimeContinue: (input: ChatRuntimeContinueInput) => Promise<ChatRuntimeHandlerResult<ChatRuntimeStartResult>>;
  chatRuntimeCompact: (input: ChatRuntimeCompactInput) => Promise<ChatRuntimeHandlerResult<ChatRuntimeStartResult>>;
  chatRuntimeSubmitUserChoice: (input: ChatRuntimeSubmitUserChoiceInput) => Promise<ChatRuntimeHandlerResult<ChatRuntimeStartResult>>;
  chatRuntimeSubmitConfirmation: (input: ChatRuntimeSubmitConfirmationInput) => Promise<ChatRuntimeHandlerResult<void>>;
  chatRuntimeSubmitBridgeResponse: (input: ChatRuntimeBridgeResponseInput) => Promise<ChatRuntimeHandlerResult<void>>;
  chatRuntimeAutoName: (input: ChatRuntimeAutoNameInput) => Promise<ChatRuntimeHandlerResult<ChatRuntimeAutoNameResult>>;
  chatRuntimeAbort: (input: ChatRuntimeAbortInput) => Promise<ChatRuntimeHandlerResult<ChatRuntimeAbortResult>>;
  chatRuntimeSubmitToolResult: (input: ChatRuntimeSubmitToolResultInput) => Promise<ChatRuntimeHandlerResult<void>>;
  chatRuntimeSubmitMessagePart: (input: ChatRuntimeSubmitMessagePartInput) => Promise<ChatRuntimeHandlerResult<void>>;
  chatRuntimeOnMessageCreated: (callback: (event: ChatRuntimeMessageEvent) => void) => () => void;
  chatRuntimeOnMessageUpdated: (callback: (event: ChatRuntimeMessageEvent) => void) => () => void;
  chatRuntimeOnMessageDeleted: (callback: (event: ChatRuntimeMessageDeletedEvent) => void) => () => void;
  chatRuntimeOnContextUsageUpdated: (callback: (event: ChatRuntimeContextUsageEvent) => void) => () => void;
  chatRuntimeOnToolRequest: (callback: (event: ChatRuntimeToolRequestEvent) => void) => () => void;
  chatRuntimeOnToolCancelled: (callback: (event: ChatRuntimeToolCancelledEvent) => void) => () => void;
  chatRuntimeOnConfirmationRequested: (callback: (event: ChatRuntimeConfirmationRequestEvent) => void) => () => void;
  chatRuntimeOnBridgeRequested: (callback: (event: ChatRuntimeBridgeRequestEvent) => void) => () => void;
  chatRuntimeOnError: (callback: (event: ChatRuntimeEventMap['chat:runtime:error']) => void) => () => void;
  chatRuntimeOnComplete: (callback: (event: ChatRuntimeEventMap['chat:runtime:complete']) => void) => () => void;

  // MCP runtime 操作
  getMcpStatus: (serverIds: string[]) => Promise<MCPStatusResponse[]>;
  getMcpDiscoveryCache: (serverId?: string) => Promise<MCPServerDiscoveryCache | MCPServerDiscoveryCache[] | undefined>;
  refreshMcpDiscovery: (server: MCPServerConfig) => Promise<MCPDiscoveryRefreshResult>;
  connectMcpServer: (server: MCPServerConfig) => Promise<MCPDiscoveryRefreshResult>;
  disconnectMcpServer: (serverId: string) => Promise<void>;
  restartMcpServer: (server: MCPServerConfig) => Promise<MCPDiscoveryRefreshResult>;
  /** 启动 OAuth 认证流程 */
  startMcpOAuth: (server: MCPServerConfig) => Promise<{ authorizationUrl: string }>;
  /** 清除 OAuth 凭据 */
  clearMcpOAuth: (serverId: string) => Promise<void>;
  /** 监听 MCP 工具列表变更通知 */
  onMcpToolsChanged: (callback: (serverId: string) => void) => () => void;
  /** 监听 OAuth 授权 URL 打开请求 */
  onMcpOAuthOpenUrl: (callback: (url: string) => void) => () => void;

  // AI 流式事件监听
  onAiStreamText: (callback: (text: string) => void) => () => void;
  onAiStreamThinking: (callback: (thinking: string) => void) => () => void;
  onAiStreamComplete: (callback: () => void) => () => void;
  onAiStreamError: (callback: (error: AIServiceError) => void) => () => void;
  onAiStreamFinish: (callback: (payload: AIStreamFinishChunk) => void) => () => void;
  onAiStreamToolInputStart: (callback: (payload: AIStreamToolInputStartChunk) => void) => () => void;
  onAiStreamToolInputDelta: (callback: (payload: AIStreamToolInputDeltaChunk) => void) => () => void;
  onAiStreamToolInputEnd: (callback: (payload: AIStreamToolInputEndChunk) => void) => () => void;
  onAiStreamToolCall: (callback: (payload: AIStreamToolCallChunk) => void) => () => void;
  onAiStreamToolResult: (callback: (payload: AIStreamToolResultChunk) => void) => () => void;

  // 控制台日志（保留原有，与文件日志分离）
  consoleLogger: {
    debug: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };

  // Logger — 文件日志收集
  logger: {
    /** 写入 ERROR 级别日志文件 */
    error: (message: string) => Promise<void>;
    /** 写入 WARN 级别日志文件 */
    warn: (message: string) => Promise<void>;
    /** 写入 INFO 级别日志文件 */
    info: (message: string) => Promise<void>;
    /** 读取日志文件内容 */
    getLogs: (options: {
      level?: 'ERROR' | 'WARN' | 'INFO';
      scope?: 'main' | 'renderer' | 'preload';
      keyword?: string;
      date?: string;
      limit?: number;
      offset?: number;
    }) => Promise<
      {
        level: 'ERROR' | 'WARN' | 'INFO';
        message: string;
        scope: 'main' | 'renderer' | 'preload';
        timestamp: string;
      }[]
    >;
    /** 获取日志文件列表 */
    getLogFiles: () => Promise<
      {
        name: string;
        size: number;
        createdAt: string;
      }[]
    >;
    /** 在系统文件管理器中打开日志文件夹 */
    openLogFolder: () => Promise<void>;
  };

  // 菜单操作
  onMenuAction: (callback: (action: string) => void) => () => void;
  updateMenuItem: (id: string, properties: { checked?: boolean }) => void;
  syncRecentFiles: (files: RecentFileShortcutInput[]) => Promise<void>;

  // WebView 操作
  webview: WebViewAPI;

  // ==================== 图片压缩 ====================

  /**
   * 压缩图片，使用 sharp 在后台进行压缩。
   * @param buffer - 原始图片二进制数据
   * @param mimeType - 图片 MIME 类型
   * @returns 压缩结果（压缩后 ArrayBuffer + 是否实际压缩）
   */
  compressImage: (buffer: ArrayBuffer, mimeType: string) => Promise<ElectronImageCompressResult>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
