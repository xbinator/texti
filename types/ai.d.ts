import type { ModelMessage } from 'ai';
import type { JSONSchema7 } from 'json-schema';

/**
 * 提供商请求格式类型
 * - openai: OpenAI 兼容格式
 * - anthropic: Anthropic 格式
 * - google: Google 格式
 */
export type AIProviderType = 'openai' | 'anthropic' | 'google' | 'deepseek';

/** AI 工具来源类型 */
export type AIToolSource = 'builtin' | 'custom' | 'mcp';

/** AI 工具权限级别 */
export type AIToolPermission = 'read' | 'write' | 'dangerous';

/** AI 工具执行状态 */
export type AIToolExecutionStatus = 'success' | 'failure' | 'cancelled';

/**
 * AI 工具参数 Schema
 * @description 定义工具参数的 JSON Schema 结构
 */
export interface AIToolParameterSchema {
  /** Schema 类型，固定为 object */
  type: 'object';
  /** 参数属性定义 */
  properties: Record<string, unknown>;
  /** 必需参数列表 */
  required?: string[];
  /** 是否允许额外属性 */
  additionalProperties?: boolean;
}

/**
 * AI 工具定义
 * @description 描述一个 AI 工具的元信息
 */
export interface AIToolDefinition {
  /** 工具名称 */
  name: string;
  /** 工具描述 */
  description: string;
  /** 工具来源 */
  source: AIToolSource;
  /** 权限级别 */
  permission: AIToolPermission;
  /** 参数 Schema */
  parameters: AIToolParameterSchema;
}

/**
 * 编辑器选区信息
 */
export interface EditorSelection {
  /** 选区起始位置 */
  from: number;
  /** 选区结束位置 */
  to: number;
  /** 选区文本内容 */
  text: string;
}

/**
 * AI 工具执行上下文
 * @description 提供工具执行所需的文档和编辑器信息
 */
export interface AIToolContext {
  /** 当前文档信息 */
  document: {
    /** 文档 ID */
    id: string;
    /** 文档标题 */
    title: string;
    /** 文档路径（本地文件路径或 null） */
    path: string | null;
    /** 获取文档内容的函数 */
    getContent: () => string;
  };
  /** 编辑器操作接口 */
  editor: {
    /** 获取当前选区 */
    getSelection: () => EditorSelection | null;
    /** 在光标位置插入内容 */
    insertAtCursor: (content: string) => Promise<void>;
    /** 替换当前选区内容 */
    replaceSelection: (content: string) => Promise<void>;
    /** 替换整个文档内容 */
    replaceDocument: (content: string) => Promise<void>;
  };
}

/**
 * AI 工具执行错误
 * @description 描述工具执行失败的原因
 */
export interface AIToolExecutionError {
  /** 错误代码 */
  code:
    | 'TOOL_NOT_FOUND'
    | 'INVALID_INPUT'
    | 'NO_ACTIVE_DOCUMENT'
    | 'NO_SELECTION'
    | 'NO_CURSOR'
    | 'USER_CANCELLED'
    | 'EDITOR_UNAVAILABLE'
    | 'STALE_CONTEXT'
    | 'TOOL_TIMEOUT'
    | 'UNSUPPORTED_PROVIDER'
    | 'CONFIRMATION_DISMISSED'
    | 'EXECUTION_FAILED';
  /** 错误消息 */
  message: string;
}

/**
 * AI 工具执行结果
 * @description 描述工具执行的最终结果
 */
export interface AIToolExecutionResult<TResult = unknown> {
  /** 工具名称 */
  toolName: string;
  /** 执行状态 */
  status: AIToolExecutionStatus;
  /** 成功时返回的数据 */
  data?: TResult;
  /** 失败时的错误信息 */
  error?: AIToolExecutionError;
}

/**
 * AI 工具执行器接口
 * @description 定义工具的执行能力
 */
export interface AIToolExecutor<TInput = unknown, TResult = unknown> {
  /** 工具定义 */
  definition: AIToolDefinition;
  /**
   * 执行工具
   * @param input - 工具输入参数
   * @param context - 执行上下文
   * @returns 执行结果
   */
  execute(input: TInput, context: AIToolContext): Promise<AIToolExecutionResult<TResult>>;
}

export interface AICreateOptions {
  // 提供商类型
  providerType: AIProviderType;
  // 提供商 ID
  providerId: string;
  // 提供商 名称
  providerName: string;
  // 服务商 API 密钥
  apiKey?: string;
  // 自定义 API 基础地址
  baseUrl?: string;
}

/**
 * 工具执行结果
 * @description 描述工具执行的结果，用于模型继续生成
 */
export interface AITransportToolResult {
  /** 工具调用 ID，用于关联调用和结果 */
  toolCallId: string;
  /** 工具名称，标识执行的工具 */
  toolName: string;
  /** 工具执行结果数据 */
  result: unknown;
}

export interface AITransportTool {
  // 工具名称
  name: string;
  // 工具描述
  description: string;
  // 工具参数定义
  // 用于模型调用时的参数验证和转换
  parameters: JSONSchema7;
}

export interface AIRequestOptions {
  // 请求唯一标识，用于中止等操作
  requestId?: string;
  // 提供商 ID
  providerId?: string;
  // 模型 ID
  modelId: string;
  // 提示词
  prompt?: string;
  // 系统提示
  system?: string;
  // 温度
  temperature?: number;
  // 对话消息列表（用于多轮对话）
  messages?: ModelMessage[];
  // 可供模型调用的工具定义
  tools?: AITransportTool[];
  // 上一轮工具执行结果，用于继续模型生成
  toolResults?: AITransportToolResult[];
}

export interface AIStreamToolCallChunk {
  toolCallId: string;
  toolName: string;
  input: unknown;
}

/**
 * 提供商模型配置
 */
export interface AIProviderModel {
  /** 模型唯一标识符 */
  id: string;
  /** 模型显示名称 */
  name: string;
  /** 模型类型 */
  type: string;
  /** 是否启用该模型 */
  isEnabled: boolean;
  /** 上下文窗口大小 */
  contextWindow?: number;
  /** 是否支持技能使用 */
  supportsTools?: boolean;
  /** 是否支持视觉识别 */
  supportsVision?: boolean;
  /** 是否支持深度思考 */
  supportsDeepThought?: boolean;
  /** 是否支持联网搜索 */
  supportsWebSearch?: boolean;
  /** 是否支持图片生成 */
  supportsImageGeneration?: boolean;
  /** 是否支持视频识别 */
  supportsVideoRecognition?: boolean;
}

/**
 * AI 服务错误类型
 * 扩展了标准 Error 对象，添加了错误代码和原因字段
 */
export interface AIServiceError {
  /** 错误代码 */
  code: AIErrorCode;
  /** 错误原因 */
  message: string;
}

/**
 * AI 提供商配置
 */
export interface AIProvider {
  /** 提供商唯一标识符 */
  id: string;
  /** 提供商显示名称 */
  name: string;
  /** 提供商描述 */
  description: string;
  /** 提供商请求格式类型 */
  type: AIProviderType;
  /** 是否启用该提供商 */
  isEnabled: boolean;
  /** API 密钥 */
  apiKey?: string;
  /** 自定义 API 基础地址 */
  baseUrl?: string;
  /** 提供商标识 Logo */
  logo?: string;
  /** 是否为用户自定义提供商 */
  isCustom?: boolean;
  /** 是否为只读提供商（不可修改或删除） */
  readonly?: boolean;
  /** 提供商支持的模型列表 */
  models?: AIProviderModel[];
}

/**
 * 自定义提供商创建/更新的数据结构
 */
export interface AICustomProvider {
  /** 提供商唯一标识符 */
  id: string;
  /** 提供商显示名称 */
  name: string;
  /** 提供商描述 */
  description?: string;
  /** 提供商请求格式类型 */
  type: AIProviderType;
  /** 提供商标识 Logo */
  logo?: string;
  /** 是否启用 */
  isEnabled?: boolean;
  /** API 密钥 */
  apiKey?: string;
  /** 自定义 API 基础地址 */
  baseUrl?: string;
}

export interface AIUsage {
  /** 输入令牌数 */
  inputTokens: number;
  /** 输出令牌数 */
  outputTokens: number;
  /** 总令牌数 */
  totalTokens: number;
}

export interface AIInvokeResult {
  text: string;
  usage?: AIUsage;
}

export interface AIStreamResult {
  stream: StreamTextResult['textStream'];
}

export interface AIStreamFinishChunk {
  usage: AIUsage;
}
