/**
 * @file types.mts
 * @description ChatRuntime 主进程工具共享类型。
 */
import type { SUPPORTED_SETTING_KEYS } from '../../../../../../shared/settings/definitions.js';
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

/** Runtime 可选主题预设。 */
export interface RuntimeThemePresetOption {
  /** 主题预设 ID。 */
  id: string;
  /** 主题预设显示名称。 */
  label: string;
  /** 主题预设氛围描述。 */
  description: string;
}

/** Runtime 设置快照。 */
export interface RuntimeSettingsSnapshot {
  /** 设置键值。 */
  settings: Partial<Record<RuntimeSettingKey, RuntimeSettingValue>>;
  /** renderer theme registry 中当前可用的主题预设。 */
  themePresetOptions: RuntimeThemePresetOption[];
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
