/**
 * @file types.mts
 * @description ChatRuntime 主进程工具共享类型。
 */
import type {
  SUPPORTED_SETTING_KEYS,
  SUPPORTED_WEBPAGE_ACTION_TYPES,
  SUPPORTED_WEBPAGE_PRESS_KEYS,
  SUPPORTED_WEBPAGE_SCROLL_DIRECTIONS
} from './constants.mjs';
import type { LogLevel, LogScope } from '../../../logger/types.mjs';
import type { ChatRuntimeMainToolExecutionInput } from '../types.mjs';
import type { AIToolExecutionResult, MCPServerConfig, MCPToolSettings } from 'types/ai';
import type { ChatRuntimeBridgeResult, ChatRuntimeConfirmationDecision, ChatRuntimeConfirmationRequest } from 'types/chat-runtime';

/** 主进程工具 bridge 请求输入。 */
export interface MainToolBridgeRequest {
  /** Runtime ID。 */
  runtimeId: string;
  /** 工具调用 ID。 */
  toolCallId: string;
  /** Bridge 动作类型。 */
  kind: string;
  /** Bridge payload。 */
  payload?: unknown;
  /** 当前工具调用中止信号。 */
  signal?: AbortSignal;
}

/** 主进程工具确认请求输入。 */
export interface MainToolConfirmationRequest {
  /** Runtime ID。 */
  runtimeId: string;
  /** 工具调用 ID。 */
  toolCallId: string;
  /** 确认请求。 */
  request: ChatRuntimeConfirmationRequest;
  /** 当前工具调用中止信号。 */
  signal?: AbortSignal;
}

/** 主进程工具依赖。 */
export interface MainToolsDependencies {
  /** 当前时间。 */
  now: () => string;
  /** 请求 renderer bridge。 */
  requestBridge: (input: MainToolBridgeRequest) => Promise<ChatRuntimeBridgeResult>;
  /** 请求 renderer 确认。 */
  requestConfirmation: (input: MainToolConfirmationRequest) => Promise<ChatRuntimeConfirmationDecision>;
}

/** 主进程工具执行器。 */
export type MainToolExecutor = (input: ChatRuntimeMainToolExecutionInput) => Promise<AIToolExecutionResult>;

/** Runtime 文档选区。 */
export interface RuntimeDocumentSelection {
  /** 选区起始位置。 */
  from: number;
  /** 选区结束位置。 */
  to: number;
  /** 选中的文本内容。 */
  text: string;
}

/** Runtime 文档快照。 */
export interface RuntimeDocumentSnapshot {
  /** 文档 ID。 */
  id: string;
  /** 文档标题。 */
  title: string;
  /** 文档真实路径，未保存时可为空。 */
  path: string | null;
  /** 文档虚拟定位符。 */
  locator?: string;
  /** 文档内容。 */
  content: string;
  /** 当前编辑器选区。 */
  selection?: RuntimeDocumentSelection | null;
}

/** Runtime 网页快照。 */
export interface RuntimeWebpageSnapshot {
  /** 页面地址。 */
  url: string;
  /** 页面标题。 */
  title: string;
  /** 给模型优先阅读的 BrowserState 风格摘要。 */
  summary: string;
  /** 页面视口与滚动位置提示。 */
  header: string;
  /** LLM 可读的简化 DOM 结构。 */
  content: string;
  /** 页面底部与剩余滚动提示。 */
  footer: string;
  /** 页面可见文本。 */
  text: string;
  /** 页面选中文本。 */
  selectedText: string;
  /** 页面标题结构。 */
  headings: unknown[];
  /** 页面链接列表。 */
  links: unknown[];
  /** 快照采集时间戳。 */
  capturedAt: number;
  /** 字段截断状态。 */
  truncated: Record<string, unknown>;
  /** 页面 Agent 观察快照 ID。 */
  snapshotId: string;
  /** 当前视口视觉摘要。 */
  viewport?: Record<string, unknown>;
  /** 用户手动选择的页面元素摘要。 */
  selectedElement?: Record<string, unknown>;
}

/** Runtime 网页操作动作。 */
export type RuntimeWebpageOperateAction =
  | { type: 'click'; index: number }
  | { type: 'input'; index: number; text: string; clear?: boolean }
  | { type: 'select'; index: number; optionText: string }
  | { type: 'press'; index: number; key: (typeof SUPPORTED_WEBPAGE_PRESS_KEYS)[number] }
  | { type: 'scroll'; index?: number; direction: (typeof SUPPORTED_WEBPAGE_SCROLL_DIRECTIONS)[number]; pixels?: number }
  | { type: 'navigate'; url: string }
  | { type: 'wait'; seconds?: number };

/** Runtime 网页操作输入。 */
export interface RuntimeWebpageOperateInput {
  /** 非 navigate 动作使用的当前快照 ID。 */
  snapshotId?: string;
  /** 已归一化的网页操作动作。 */
  action: RuntimeWebpageOperateAction;
}

/** Runtime 网页操作目标。 */
export interface RuntimeWebpageOperateTarget {
  /** 元素句柄。 */
  index: number;
  /** 元素可读标签。 */
  label: string;
  /** 元素标签名。 */
  tagName: string;
}

/** Runtime 网页滚动坐标。 */
export interface RuntimeWebpageScrollPosition {
  /** 水平滚动位置。 */
  x: number;
  /** 垂直滚动位置。 */
  y: number;
}

/** Runtime 网页滚动结果。 */
export interface RuntimeWebpageOperateScrollResult {
  /** 滚动窗口或元素。 */
  targetType: 'window' | 'element';
  /** 滚动前位置。 */
  before: RuntimeWebpageScrollPosition;
  /** 滚动后位置。 */
  after: RuntimeWebpageScrollPosition;
  /** 位置是否变化。 */
  changed: boolean;
}

/** Runtime 网页操作结果。 */
export interface RuntimeWebpageOperateResult {
  /** 操作是否完成。 */
  ok: boolean;
  /** 实际执行的动作类型。 */
  action: (typeof SUPPORTED_WEBPAGE_ACTION_TYPES)[number];
  /** 被操作目标摘要。 */
  target: RuntimeWebpageOperateTarget | null;
  /** 给模型看的结果说明。 */
  message: string;
  /** 滚动动作的实际滚动结果。 */
  scroll?: RuntimeWebpageOperateScrollResult;
  /** 操作是否触发导航。 */
  navigationStarted: boolean;
  /** 页面是否可能发生变化。 */
  pageChanged: boolean;
  /** 是否建议重新读取网页。 */
  shouldReadAgain: boolean;
}

/** Runtime 文件内容快照。 */
export interface RuntimeFileContentSnapshot {
  /** Tibis 文档系统提供的稳定 artifact ID。 */
  artifactId?: string;
  /** 原始请求路径。 */
  path: string;
  /** 文件内容。 */
  content: string;
}

/** Runtime 文件读取参数。 */
export interface RuntimeReadFileInput {
  /** 文件路径。 */
  filePath: string;
  /** 起始行号。 */
  offset: number;
  /** 读取行数。 */
  limit?: number;
}

/** Runtime 目录读取参数。 */
export interface RuntimeReadDirectoryInput {
  /** 目录路径。 */
  directoryPath: string;
}

/** Runtime glob 搜索参数。 */
export interface RuntimeGlobInput {
  /** Glob 模式。 */
  pattern: string;
  /** 搜索目录路径。 */
  searchPath: string;
}

/** Runtime grep 搜索参数。 */
export interface RuntimeGrepInput {
  /** grep -E 正则。 */
  pattern: string;
  /** 搜索文件或目录路径。 */
  searchPath: string;
  /** 候选文件 glob。 */
  include?: string;
}

/** Runtime 可读取的设置键。 */
export type RuntimeSettingKey = (typeof SUPPORTED_SETTING_KEYS)[number];

/** Runtime 设置值。 */
export type RuntimeSettingValue = string | boolean | number;

/** Runtime 设置快照。 */
export interface RuntimeSettingsSnapshot {
  /** 设置键值。 */
  settings: Partial<Record<RuntimeSettingKey, RuntimeSettingValue>>;
}

/** Runtime 设置读取输入。 */
export interface RuntimeGetSettingsInput {
  /** 目标设置键。 */
  keys: RuntimeSettingKey[];
}

/** Runtime 设置修改输入。 */
export interface RuntimeUpdateSettingsInput {
  /** 设置键。 */
  key: RuntimeSettingKey;
  /** 设置值。 */
  value: string | boolean;
}

/** Runtime 设置修改结果。 */
export interface RuntimeUpdateSettingsResult {
  /** 是否已应用。 */
  applied: true;
  /** 设置键。 */
  key: RuntimeSettingKey;
  /** 修改前值。 */
  previousValue: RuntimeSettingValue;
  /** 修改后值。 */
  currentValue: RuntimeSettingValue;
}

/** Runtime 打开资源类型。 */
export type RuntimeOpenResourceType = 'file' | 'webview' | 'external';

/** Runtime 打开资源输入。 */
export interface RuntimeOpenResourceInput {
  /** 路径或 URL。 */
  path: string;
  /** 资源类型。 */
  resourceType: RuntimeOpenResourceType;
}

/** Runtime 打开资源结果。 */
export interface RuntimeOpenResourceResult {
  /** 路径或 URL。 */
  path: string;
  /** 资源类型。 */
  resourceType: RuntimeOpenResourceType;
  /** 是否已打开。 */
  opened: boolean;
  /** 文件 ID。 */
  fileId?: string;
}

/** Runtime 创建文档输入。 */
export interface RuntimeCreateDocumentInput {
  /** 文档标题。 */
  title: string;
  /** 文档内容。 */
  content: string;
  /** 文档扩展名。 */
  ext: string;
}

/** Runtime 写入文件输入。 */
export interface RuntimeWriteFileInput {
  /** 文件路径。 */
  filePath: string;
  /** 文件内容。 */
  content: string;
}

/** Runtime 编辑文件输入。 */
export interface RuntimeEditFileInput {
  /** 文件路径。 */
  filePath: string;
  /** 待替换文本。 */
  oldString: string;
  /** 替换后文本。 */
  newString: string;
  /** 是否替换全部匹配项。 */
  replaceAll: boolean;
}

/** Runtime 写入文件目标。 */
export type RuntimeWriteTarget =
  | {
      /** 目标类型。 */
      type: 'draft';
      /** 原始相对路径。 */
      originalPath: string;
    }
  | {
      /** 目标类型。 */
      type: 'file';
      /** 用于确认和结果展示的规范化文件路径。 */
      filePath: string;
      /** 用户输入经词法解析后的原始磁盘路径。 */
      sourcePath?: string;
      /** 解析符号链接后的实际磁盘写入路径。 */
      writePath?: string;
      /** 是否位于工作区外。 */
      outsideWorkspace: boolean;
    }
  | {
      /** 目标类型。 */
      type: 'unsaved';
      /** 未保存虚拟路径。 */
      filePath: string;
    };

/** Runtime 只读文件目标。 */
export interface RuntimeReadTarget {
  /** 规范化文件路径。 */
  filePath: string;
  /** 是否位于工作区外。 */
  outsideWorkspace: boolean;
}

/** Runtime 草稿文件。 */
export interface RuntimeDraftFile {
  /** 文件类型。 */
  type: 'file';
  /** 文件 ID。 */
  id: string;
  /** 磁盘路径。 */
  path: string | null;
  /** 文件名。 */
  name: string;
  /** 扩展名。 */
  ext: string;
  /** 文件内容。 */
  content: string;
}

/** Runtime 创建草稿结果。 */
export interface RuntimeOpenDraftResult {
  /** 草稿文件。 */
  file: RuntimeDraftFile;
  /** 未保存虚拟路径。 */
  unsavedPath: string;
}

/** Runtime settings.json 文件结构。 */
export interface RuntimeSettingsFile {
  /** 文件版本。 */
  version: 1;
  /** Provider 原始配置。 */
  providers: unknown[];
  /** MCP 工具配置。 */
  mcp: MCPToolSettings;
  /** Tavily 原始配置。 */
  tavily?: unknown;
}

/** Runtime 更新 MCP server 输入。 */
export interface RuntimeUpdateMcpServerInput {
  /** MCP server ID。 */
  serverId: string;
  /** 待更新字段。 */
  patch: Partial<MCPServerConfig>;
}

/** Runtime 删除 MCP server 输入。 */
export interface RuntimeRemoveMcpServerInput {
  /** MCP server ID。 */
  serverId: string;
}

/** Runtime 刷新 MCP discovery 输入。 */
export interface RuntimeRefreshMcpDiscoveryInput {
  /** MCP server ID。 */
  serverId: string;
}

/** 日志查询生效筛选条件。 */
export interface RuntimeLogFilters {
  /** 日志级别筛选。 */
  level?: LogLevel;
  /** 日志来源筛选。 */
  scope?: LogScope;
  /** 关键字筛选。 */
  keyword?: string;
  /** 查询日期。 */
  date?: string;
  /** 返回条数。 */
  limit: number;
  /** 分页偏移量。 */
  offset: number;
  /** 是否使用默认日期。 */
  usedDefaultDate: boolean;
}
