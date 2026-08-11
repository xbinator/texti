/**
 * @file ai.d.ts
 * @description AI 相关全局类型声明。
 */
import type { AsyncIterableStream, ModelMessage, TextStreamPart, ToolSet } from 'ai';
import type { JSONSchema7 } from 'json-schema';

/**
 * 服务商请求格式类型。
 */
export type AIProviderType = 'openai' | 'anthropic' | 'google' | 'deepseek' | 'alibaba' | 'volcengine' | 'moonshot' | 'glm' | 'minimax' | 'mimo';

/**
 * 模型类型。
 * @description 限制模型可选的分类，覆盖设置页模型编辑弹窗与列表筛选所支持的取值。
 */
export type AIModelType = 'chat' | 'image' | 'video';

/** AI 工具来源类型。 */
export type AIToolSource = 'builtin' | 'custom' | 'mcp';

/** AI 工具风险等级。 */
export type AIToolRiskLevel = 'read' | 'write' | 'dangerous';

/** AI 工具权限模式（用户配置）。 */
export type AIToolPermissionMode = 'ask' | 'readonly' | 'autoSafe';

/** AI 工具授权范围（用户选择）。 */
export type AIToolGrantScope = 'session' | 'always';

/** AI 工具执行状态。 */
export type AIToolExecutionStatus = 'success' | 'failure' | 'cancelled' | 'awaiting_user_input';

/**
 * AI 选项。
 * @description 等待用户输入问题时使用的单个选项条目。
 */
export interface AIChoiceOption {
  /** 可见标签。 */
  label: string;
  /** 提交的值。 */
  value: string;
  /** 可选描述。 */
  description?: string;
}

/**
 * AI 等待用户选择的单个问题。
 * @description 批量等待用户输入时使用的单题条目。
 */
export interface AIAwaitingUserChoiceItem {
  /** 题目模式：单选、多选或输入框。 */
  mode: 'single' | 'multiple' | 'input';
  /** 提示文本。 */
  question: string;
  /** 可用选项（输入框模式为空数组）。 */
  options: AIChoiceOption[];
  /** 多选时的最大选择数。 */
  maxSelections?: number;
  /** 输入框模式的占位提示文本。 */
  placeholder?: string;
}

/**
 * AI 等待用户选择问题。
 * @description 工具暂停等待用户输入时使用的载荷，支持单个问题与批量问题。
 */
export interface AIAwaitingUserChoiceQuestion extends AIAwaitingUserChoiceItem {
  /** 生成的问题标识符。 */
  questionId: string;
  /** 相关的工具调用标识符。 */
  toolCallId: string;
  /** 同一次工具调用中等待回答的问题列表。 */
  questions?: AIAwaitingUserChoiceItem[];
}

/**
 * AI 工具参数模式。
 * @description 用于工具参数验证的 JSON Schema 包装器。
 */
export interface AIToolParameterSchema {
  /** 模式类型，固定为 object。 */
  type: 'object';
  /** 属性定义。 */
  properties: Record<string, unknown>;
  /** 必需的属性名称。 */
  required?: string[];
  /** 是否允许额外属性。 */
  additionalProperties?: boolean;
}

/**
 * AI 工具定义。
 * @description 描述 AI 工具的元数据。
 */
export interface AIToolDefinition {
  /** 工具名称。 */
  name: string;
  /** 工具描述，支持静态字符串或动态函数（用于 skill 工具按需生成描述）。 */
  description: string | (() => string);
  /** 工具来源。 */
  source: AIToolSource;
  /** 风险等级。 */
  riskLevel: AIToolRiskLevel;
  /** 参数模式。 */
  parameters: AIToolParameterSchema;
  /** 此工具是否需要当前编辑器文档上下文。默认为 true。 */
  requiresActiveDocument?: boolean;
  /** UI 和策略决策使用的权限类别。 */
  permissionCategory?: 'document' | 'settings' | 'system';
  /** 此写入工具是否可以在首次权限模型中自动批准并记住。 */
  safeAutoApprove?: boolean;
  /** 此工具是否允许用户在手动确认后记住授权，但不因此启用自动安全执行。 */
  allowPermissionRemember?: boolean;
}

/**
 * 编辑器选区。
 */
export interface EditorSelection {
  /** 选区起始位置。 */
  from: number;
  /** 选区结束位置。 */
  to: number;
  /** 选中的文本。 */
  text: string;
}

/** 工具活动状态。 */
export type ChatToolActivityState = 'starting' | 'executing' | 'running_idle' | 'waiting_user' | 'waiting_external' | 'stopping' | 'interrupted';

/** 不包含产物正文的安全引用。 */
export interface ChatToolArtifactRef {
  /** 产物稳定标识。 */
  id: string;
  /** 产物类型。 */
  kind: string;
  /** 面向用户的短名称。 */
  label?: string;
}

/** 可持久化的工具进展快照。 */
export interface ChatToolProgressSnapshot {
  /** 稳定阶段标识。 */
  phase: string;
  /** 已完成工作量。 */
  completed?: number;
  /** 总工作量。 */
  total?: number;
  /** 面向用户的短说明。 */
  message?: string;
  /** 新增或更新的安全产物引用。 */
  artifacts?: ChatToolArtifactRef[];
  /** 主进程接受进展的墙钟时间。 */
  updatedAt: number;
}

/** 工具等待外部条件的有限期限。 */
export interface ChatToolExternalWait {
  /** 等待原因。 */
  reason: string;
  /** 允许下一次重试的墙钟时间。 */
  retryAt: number;
  /** 最晚等待截止时间。 */
  deadlineAt: number;
}

/** 工具卡片持久化的最后活动状态。 */
export interface ChatToolActivitySnapshot {
  /** 当前活动状态。 */
  state: ChatToolActivityState;
  /** 最后接受的执行器序号。 */
  sequence: number;
  /** 最后实质进展的墙钟时间。 */
  lastProgressAt?: number;
  /** 最后安全进展快照。 */
  progress?: ChatToolProgressSnapshot;
  /** 等待用户时的简短原因。 */
  userPrompt?: string;
  /** 等待外部条件的信息。 */
  externalWait?: ChatToolExternalWait;
  /** 用户确认继续等待的时间。 */
  idleAcknowledgedAt?: number;
}

/** 工具内部可用的受限活动上报器。 */
export interface AIToolActivityReporter {
  /** 上报存活，不代表实质进展。 */
  heartbeat(): void;
  /** 上报新的实质进展。 */
  progress(progress: Omit<ChatToolProgressSnapshot, 'updatedAt'>): void;
  /** 进入等待用户状态。 */
  waitUser(prompt: string): void;
  /** 进入有限期限的外部等待状态。 */
  waitExternal(wait: ChatToolExternalWait): void;
  /** 从等待状态恢复执行。 */
  resume(): void;
}

/**
 * Renderer 工具调用的 Runtime 元数据。
 * @description 与文档上下文解耦，确保页面工具在无编辑器时仍可接收中止与活动能力。
 */
export interface AIToolExecutionMetadata {
  /** 触发工具请求的 Runtime ID。 */
  runtimeId?: string;
  /** Renderer 本地工具中止信号。 */
  abortSignal?: AbortSignal;
  /** Renderer 本地工具的受限活动上报器。 */
  activity?: AIToolActivityReporter;
}

/**
 * AI 工具执行上下文。
 * @description 工具所需的文档和编辑器信息。
 */
export interface AIToolContext {
  /** 当前工具调用 ID，每个工具调用执行时由调用方注入 */
  toolCallId?: string;
  /** 仅允许上报活动的受限接口。 */
  activity?: AIToolActivityReporter;
  /** 当前文档信息。 */
  document: {
    /** 文档标识符。 */
    id: string;
    /** 文档标题。 */
    title: string;
    /** 文件路径，未保存文档为 null。 */
    path: string | null;
    /** 供工具与文件引用系统消费的文档定位符，未保存文档使用 `unsaved://` 虚拟路径。 */
    locator?: string;
    /** 读取文档内容。 */
    getContent: () => string;
  };
  /** 编辑器操作。 */
  editor: {
    /** 读取当前选区。 */
    getSelection: () => EditorSelection | null;
    /** 在光标处插入内容。 */
    insertAtCursor: (content: string) => Promise<void>;
    /** 替换当前选区。 */
    replaceSelection: (content: string) => Promise<void>;
    /** 替换整个文档内容。 */
    replaceDocument: (content: string) => Promise<void>;
  };
}

/**
 * AI 工具执行错误。
 * @description 描述工具执行失败的原因。
 */
export interface AIToolExecutionError {
  /** 错误代码。 */
  code:
    | 'TOOL_NOT_FOUND'
    | 'INVALID_INPUT'
    | 'NO_ACTIVE_DOCUMENT'
    | 'NO_SELECTION'
    | 'NO_CURSOR'
    | 'PERMISSION_DENIED'
    | 'USER_CANCELLED'
    | 'EDITOR_UNAVAILABLE'
    | 'STALE_CONTEXT'
    | 'STALE_SNAPSHOT'
    | 'PAGE_LOADING'
    | 'ELEMENT_NOT_FOUND'
    | 'ACTION_NOT_SUPPORTED'
    | 'OPTION_AMBIGUOUS'
    | 'SCROLL_TARGET_NOT_FOUND'
    | 'BRIDGE_TIMEOUT'
    | 'TOOL_TIMEOUT'
    | 'TOOL_UNRESPONSIVE'
    | 'EXTERNAL_WAIT_TIMEOUT'
    | 'RUNTIME_INTERRUPTED'
    | 'INTERACTION_TIMEOUT'
    | 'INTERACTION_LIMIT_EXCEEDED'
    | 'UNSUPPORTED_INTERACTION'
    | 'PROCESS_CLEANUP_FAILED'
    | 'UNSUPPORTED_PROVIDER'
    | 'CONFIRMATION_DISMISSED'
    | 'protocol_error'
    | 'EXECUTION_FAILED';
  /** 错误消息。 */
  message: string;
  /** 保留给模型的结构化、可序列化失败元数据。 */
  details?: unknown;
}

/**
 * AI 工具执行成功结果。
 * @description status = success。
 */
export interface AIToolExecutionSuccessResult<TResult = unknown> {
  /** 工具名称。 */
  toolName: string;
  /** 执行状态。 */
  status: 'success';
  /** 成功载荷。 */
  data: TResult;
  /** 成功结果不携带错误。 */
  error?: never;
}

/**
 * AI 工具执行失败结果。
 * @description status = failure。
 */
export interface AIToolExecutionFailureResult {
  /** 工具名称。 */
  toolName: string;
  /** 执行状态。 */
  status: 'failure';
  /** 失败详情。 */
  error: AIToolExecutionError;
  /** 失败结果不携带数据。 */
  data?: never;
}

/**
 * AI 工具执行取消结果。
 * @description status = cancelled。
 */
export interface AIToolExecutionCancelledResult {
  /** 工具名称。 */
  toolName: string;
  /** 执行状态。 */
  status: 'cancelled';
  /** 取消详情。 */
  error: AIToolExecutionError;
  /** 取消结果不携带数据。 */
  data?: never;
}

/**
 * AI 工具执行等待用户输入结果。
 * @description status = awaiting_user_input。
 */
export interface AIToolExecutionAwaitingUserInputResult {
  /** 工具名称。 */
  toolName: string;
  /** 执行状态。 */
  status: 'awaiting_user_input';
  /** 问题载荷。 */
  data: AIAwaitingUserChoiceQuestion;
  /** 等待结果不携带错误。 */
  error?: never;
}

/**
 * AI 工具执行结果。
 * @description 所有终止工具状态的判别联合。
 */
export type AIToolExecutionResult<TResult = unknown> =
  | AIToolExecutionSuccessResult<TResult>
  | AIToolExecutionFailureResult
  | AIToolExecutionCancelledResult
  | AIToolExecutionAwaitingUserInputResult;

/**
 * AI 工具执行器接口。
 * @description 定义工具执行能力。
 */
export interface AIToolExecutor<TInput = unknown, TResult = unknown> {
  /** 工具定义。 */
  definition: AIToolDefinition;
  /**
   * 执行工具。
   * @param input - 工具输入。
   * @param context - 执行上下文，不需要活动文档的工具可省略。
   * @param metadata - 与文档无关的 Runtime 执行元数据。
   * @returns 工具执行结果。
   */
  execute(input: TInput, context?: AIToolContext, metadata?: AIToolExecutionMetadata): Promise<AIToolExecutionResult<TResult>>;
}

export interface AICreateOptions {
  /** 服务商类型。 */
  providerType: AIProviderType;
  /** 服务商标识符。 */
  providerId: string;
  /** 服务商名称。 */
  providerName: string;
  /** API 密钥。 */
  apiKey?: string;
  /** 可选的基础 URL。 */
  baseUrl?: string;
}

/**
 * AI 传输工具结果。
 * @description 用于将工具结果发送回模型。
 */
export interface AITransportToolResult {
  /** 工具调用标识符。 */
  toolCallId: string;
  /** 工具名称。 */
  toolName: string;
  /** 工具结果载荷。 */
  result: unknown;
}

export interface AITransportTool {
  /** 工具名称。 */
  name: string;
  /** 工具描述。 */
  description: string;
  /** 工具参数模式。 */
  parameters: JSONSchema7;
}

/**
 * AI 输出配置。
 * @description 使用 AI SDK 的 output/object schema 能力约束返回结果。
 */
export interface AIOutputOptions {
  /** JSON Schema 定义。 */
  schema: JSONSchema7;
  /** 可选的结构化输出名称。 */
  name?: string;
  /** 可选的结构化输出描述。 */
  description?: string;
}

/**
 * AI 推理控制选项。
 * @description 只表达业务语义，供应商专属参数由对应 provider 实现映射。
 */
export interface AIReasoningOptions {
  /** 是否允许模型输出 reasoning / thinking。 */
  enabled: boolean;
}

/**
 * Tavily 运行时配置。
 */
export interface AITavilyRuntimeConfig {
  /** 是否启用 Tavily 工具。 */
  enabled: boolean;
  /** Tavily API Key。 */
  apiKey: string;
}

/**
 * MCP tool 的结构化选择器。
 */
export interface MCPToolSelector {
  /** 所属 server ID。 */
  serverId: string;
  /** 原始 tool 名称。 */
  toolName: string;
}

/**
 * MCP discovery 工具快照。
 */
export interface MCPDiscoveredToolSnapshot {
  /** 所属 server ID。 */
  serverId: string;
  /** 原始 tool 名称。 */
  toolName: string;
  /** 可选工具描述。 */
  description?: string;
  /** MCP tool inputSchema。 */
  inputSchema?: Record<string, unknown>;
}

/**
 * MCP OAuth 配置。
 */
export interface MCPOAuthConfig {
  /** OAuth 客户端 ID。 */
  clientId?: string;
  /** OAuth 客户端密钥。 */
  clientSecret?: string;
  /** 访问令牌。 */
  accessToken?: string;
  /** 刷新令牌。 */
  refreshToken?: string;
  /** 令牌过期时间（Unix 时间戳，秒）。 */
  expiresAt?: number;
  /** 授权范围。 */
  scope?: string;
}

/**
 * MCP server 运行配置。
 */
export interface MCPServerConfig {
  /** 稳定 ID。 */
  id: string;
  /** 展示名称。 */
  name: string;
  /** 是否启用。 */
  enabled: boolean;
  /** 用户在编辑器中提交的原始 JSON 文本。 */
  editorJsonText?: string;
  /** transport 类型。 */
  transport: 'stdio' | 'streamableHTTP' | 'sse';
  /** HTTP/SSE 端点 URL（streamableHTTP / sse 必填）。 */
  url?: string;
  /** 启动命令（stdio 必填）。 */
  command: string;
  /** 启动参数。 */
  args: string[];
  /** 环境变量。 */
  env: Record<string, string>;
  /** 远程 MCP 请求头。 */
  headers: Record<string, string>;
  /** server 级工具白名单。 */
  toolAllowlist: string[];
  /** OAuth 配置（远程服务器可选）。 */
  oauth?: MCPOAuthConfig;
  /** 是否监听工具变更通知。 */
  watchToolChanges?: boolean;
  /** 连接与握手超时。 */
  connectTimeoutMs: number;
  /** 单次工具调用超时。 */
  toolCallTimeoutMs: number;
}

/**
 * MCP server 运行时请求配置。
 */
export type MCPRuntimeServerConfig = Omit<MCPServerConfig, 'editorJsonText'>;

/**
 * MCP 工具设置。
 */
export interface MCPToolSettings {
  /** server 列表。 */
  servers: MCPServerConfig[];
}

/**
 * MCP sandbox 运行状态。
 */
export type MCPSandboxStatus = 'idle' | 'starting' | 'running' | 'failed';

/**
 * MCP 本地 runtime 运行状态。
 */
export type MCPRuntimeStatus = 'idle' | 'connecting' | 'connected' | 'failed' | 'disabled' | 'needs_auth' | 'needs_client_registration';

/**
 * MCP discovery 运行状态。
 */
export type MCPDiscoveryStatus = 'idle' | 'refreshing' | 'ready' | 'failed';

/**
 * MCP server 运行态状态。
 */
export interface MCPStatusResponse {
  /** server ID。 */
  serverId: string;
  /** runtime 状态。 */
  runtimeStatus: MCPRuntimeStatus;
  /** sandbox 状态。 */
  sandboxStatus: MCPSandboxStatus;
  /** discovery 状态。 */
  discoveryStatus: MCPDiscoveryStatus;
  /** 最近一次状态说明。 */
  message?: string;
}

/**
 * 单个 MCP server 的 discovery cache。
 */
export interface MCPServerDiscoveryCache {
  /** server ID。 */
  serverId: string;
  /** discovery 得到的工具快照。 */
  tools: MCPDiscoveredToolSnapshot[];
  /** discovery 时间戳。 */
  discoveredAt: number;
}

/**
 * MCP discovery 刷新结果。
 */
export interface MCPDiscoveryRefreshResult {
  /** 是否成功。 */
  ok: boolean;
  /** server ID。 */
  serverId: string;
  /** 成功时的 discovery cache。 */
  cache?: MCPServerDiscoveryCache;
  /** 失败时的稳定错误码。 */
  errorCode?: string;
  /** 失败说明。 */
  message?: string;
}

/**
 * 发往主进程 AI 服务的 MCP 请求配置。
 */
export interface AIMCPRequestConfig {
  /** 当前请求携带的 MCP server 配置快照。 */
  servers: MCPRuntimeServerConfig[];
  /** 当前请求启用的 server ID。 */
  enabledServerIds: string[];
  /** 当前请求允许的 tool 标识。 */
  enabledTools: MCPToolSelector[];
  /** 当前请求附加的 MCP 工具说明词。 */
  toolInstructions: string;
}

export interface AIRequestOptions {
  /** 请求标识符。 */
  requestId?: string;
  /** 服务商标识符。 */
  providerId?: string;
  /** 模型标识符。 */
  modelId: string;
  /** 提示文本。 */
  prompt?: string;
  /** 系统指令。 */
  system?: string;
  /** 温度参数。 */
  temperature?: number;
  /** 最大输出 token 数量。 */
  maxOutputTokens?: number;
  /** 对话消息列表。 */
  messages?: ModelMessage[];
  /** 可用工具列表。 */
  tools?: AITransportTool[];
  /** Tavily 运行时配置。 */
  tavily?: AITavilyRuntimeConfig;
  /** MCP 运行时请求配置。 */
  mcp?: AIMCPRequestConfig;
  /** 上一次工具调用结果。 */
  toolResults?: AITransportToolResult[];
  /** 输出配置。 */
  output?: AIOutputOptions;
  /** 推理控制配置。 */
  reasoning?: AIReasoningOptions;
}

export interface AIStreamToolCallChunk {
  /** 工具调用标识符。 */
  toolCallId: string;
  /** 工具名称。 */
  toolName: string;
  /** 工具输入参数。 */
  input: unknown;
}

/**
 * AI 流式工具输入开始片段。
 * @description 模型开始流式输出工具参数时发送，通常早于最终 tool-call。
 */
export interface AIStreamToolInputStartChunk {
  /** 工具调用标识符。 */
  toolCallId: string;
  /** 工具名称。 */
  toolName: string;
}

/**
 * AI 流式工具输入增量片段。
 * @description 承载工具参数 JSON 的增量文本，可用于预览路径和正文内容。
 */
export interface AIStreamToolInputDeltaChunk {
  /** 工具调用标识符。 */
  toolCallId: string;
  /** 工具输入 JSON 的增量文本。 */
  inputTextDelta: string;
}

/**
 * AI 流式工具输入结束片段。
 * @description 表示工具参数的流式输入阶段结束。
 */
export interface AIStreamToolInputEndChunk {
  /** 工具调用标识符。 */
  toolCallId: string;
}

/**
 * AI 流式工具结果片段。
 * @description 由主进程将 SDK 工具结果规范化后发送给渲染进程。
 */
export interface AIStreamToolResultChunk {
  /** 工具调用标识符。 */
  toolCallId: string;
  /** 工具名称。 */
  toolName: string;
  /** 规范化后的工具执行结果。 */
  result: AIToolExecutionResult;
}

/**
 * 服务商模型元数据。
 */
export interface AIProviderModel {
  /** 唯一标识符。 */
  id: string;
  /** 显示名称。 */
  name: string;
  /** 模型类型。 */
  type: AIModelType;
  /** 此模型是否启用。 */
  isEnabled: boolean;
  /** 此模型是否已被用户删除。 */
  isDelete?: boolean;
  /** 上下文窗口大小。 */
  contextWindow?: number;
  /** 单次生成允许的最大输出 Token 数。 */
  maxOutputTokens?: number;
  /** 是否支持工具使用。 */
  supportsTools?: boolean;
  /** 是否支持视觉。 */
  supportsVision?: boolean;
  /** 是否支持深度思考。 */
  supportsDeepThought?: boolean;
  /** 是否支持网络搜索。 */
  supportsWebSearch?: boolean;
  /** 是否支持图像生成。 */
  supportsImageGeneration?: boolean;
  /** 是否支持视频识别。 */
  supportsVideoRecognition?: boolean;
}

/**
 * AI 服务错误。
 * @description 扩展基础错误结构，添加代码字段。
 */
export interface AIServiceError {
  /** 错误代码。 */
  code: AIErrorCode;
  /** 错误消息。 */
  message: string;
}

/**
 * AI 服务商配置。
 */
export interface AIProvider {
  /** 唯一服务商标识符。 */
  id: string;
  /** 服务商显示名称。 */
  name: string;
  /** 服务商描述。 */
  description: string;
  /** 服务商请求格式类型。 */
  type: AIProviderType;
  /** 服务商是否启用。 */
  isEnabled: boolean;
  /** API 密钥。 */
  apiKey?: string;
  /** 可选的基础 URL。 */
  baseUrl?: string;
  /** 服务商图标。 */
  logo?: string;
  /** 是否为用户定义的服务商。 */
  isCustom?: boolean;
  /** 服务商是否只读。 */
  readonly?: boolean;
  /** 支持的模型。 */
  models?: AIProviderModel[];
}

/**
 * AI 自定义服务商载荷。
 * @description 创建或更新服务商时使用的数据。
 */
export interface AICustomProvider {
  /** 唯一标识符。 */
  id: string;
  /** 服务商显示名称。 */
  name: string;
  /** 服务商描述。 */
  description?: string;
  /** 服务商请求格式类型。 */
  type: AIProviderType;
  /** 服务商图标。 */
  logo?: string;
  /** 服务商是否启用。 */
  isEnabled?: boolean;
  /** API 密钥。 */
  apiKey?: string;
  /** 可选的基础 URL。 */
  baseUrl?: string;
}

export interface AIUsage {
  /** 输入 token 数量。 */
  inputTokens: number;
  /** 输出 token 数量。 */
  outputTokens: number;
  /** 总 token 数量。 */
  totalTokens: number;
}

export interface AIInvokeResult {
  /** 最终生成文本。 */
  text: string;
  /** 结构化输出。 */
  output?: unknown;
  /** 最后一个模型步骤的 token 使用量。 */
  stepUsage?: AIUsage;
  /** 本次 SDK 调用所有模型步骤的累计 token 使用量。 */
  totalUsage?: AIUsage;
}

/**
 * AI SDK 7 完整事件流结果。
 */
export interface AIStreamResult {
  /** 包含文本、推理、工具和完成事件的强类型流。 */
  stream: AsyncIterableStream<TextStreamPart<ToolSet>>;
}

/**
 * AI 流式结束原因。
 */
export type AIStreamFinishReason = 'stop' | 'length' | 'content-filter' | 'tool-calls' | 'error' | 'other';

export interface AIStreamFinishChunk {
  /** 流式结束原因。 */
  finishReason: AIStreamFinishReason;
  /** 最后一个模型步骤的 token 使用量。 */
  stepUsage?: AIUsage;
  /** 本次 SDK 调用所有模型步骤的累计 token 使用量。 */
  totalUsage: AIUsage;
}
