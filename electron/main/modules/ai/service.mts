/**
 * @file service.mts
 * @description AI 服务核心类，封装文本生成和流式文本生成能力
 */
import type { FlexibleSchema, ToolExecutionOptions, ToolSet } from 'ai';
import type {
  AICreateOptions,
  AIRequestOptions,
  AIInvokeResult,
  AIStreamResult,
  AIServiceError,
  AIToolExecutionResult,
  AIUsage,
  MCPDiscoveredToolSnapshot
} from 'types/ai';
import { generateText, isLoopFinished, jsonSchema, Output, streamText, tool } from 'ai';
import { log } from '../logger/service.mjs';
import { connectMcpServer, executeMcpTool, getMcpDiscoveryCache } from '../mcp/session.mjs';
import { createMcpSdkTools, resolveMcpExposedTools, type MCPToolActivityBridge } from '../mcp/tools.mjs';
import { AI_ERROR_CODE } from './errors/codes.mjs';
import { AIProviderRegistry } from './providers/_index.mjs';
import {
  AI_LEGACY_TOOL_TIMEOUT_MS,
  AI_DIRECT_REQUEST_TIMEOUT,
  appendFinalInstructions,
  createRequestTimeout,
  createRuntimeToolLoopTimeout,
  prepareToolStep
} from './tool-loop-policy.mjs';
import { normalizeAIUsage } from './usage.mjs';

// ─── 纯工具函数 ──────────────────────────────────────────────────────────────

/** Tavily API 基础地址。 */
const TAVILY_API_BASE_URL = 'https://api.tavily.com';

/** Tavily API 端点。 */
type TavilyEndpoint = '/search' | '/extract';

/** 不声明工具专属 context 时可消费的 AI SDK 执行选项。 */
type ContextlessToolOptions = Omit<ToolExecutionOptions<unknown>, 'context'>;

/** 主进程内部模型调用策略，不进入 IPC 或用户请求配置。 */
export interface AIServiceCallOptions {
  /** 工具续轮是否由 ChatRuntime 统一托管。 */
  runtimeToolLoop?: boolean;
  /** 是否强制本次调用只生成最终回答。 */
  forceFinal?: boolean;
  /** Runtime MCP 工具的进度升级桥。 */
  toolActivity?: MCPToolActivityBridge;
}

/** Tavily 搜索深度。 */
type TavilySearchDepth = 'basic' | 'advanced';

/** Tavily 搜索主题。 */
type TavilySearchTopic = 'general' | 'news' | 'finance';

/** Tavily 搜索时间范围。 */
type TavilyTimeRange = 'day' | 'month' | 'year' | 'd' | 'y' | 'm' | 'week' | 'w';

/** Tavily 提取深度。 */
type TavilyExtractDepth = 'basic' | 'advanced';

/** Tavily 提取输出格式。 */
type TavilyExtractFormat = 'markdown' | 'text';

/**
 * Tavily Search 硬编码默认参数。
 */
const TAVILY_SEARCH_DEFAULTS = {
  searchDepth: 'basic' as TavilySearchDepth,
  topic: 'general' as TavilySearchTopic,
  timeRange: undefined as TavilyTimeRange | undefined,
  country: 'china' as string | undefined,
  maxResults: 5,
  includeAnswer: true,
  includeImages: false,
  includeDomains: [] as string[],
  excludeDomains: [] as string[]
};

/**
 * Tavily Extract 硬编码默认参数。
 */
const TAVILY_EXTRACT_DEFAULTS = {
  extractDepth: 'basic' as TavilyExtractDepth,
  format: 'markdown' as TavilyExtractFormat,
  includeImages: false
};

/**
 * Tavily Search 工具输入。
 */
interface TavilySearchInput {
  /** 搜索查询。 */
  query: string;
  /** 搜索深度。 */
  searchDepth?: TavilySearchDepth;
  /** 搜索主题。 */
  topic?: TavilySearchTopic;
  /** 搜索时间范围。 */
  timeRange?: TavilyTimeRange;
  /** 本地化搜索国家。 */
  country?: string;
  /** 最大结果数。 */
  maxResults?: number;
  /** 是否包含 Tavily 生成的答案。 */
  includeAnswer?: boolean;
  /** 是否包含图片。 */
  includeImages?: boolean;
  /** 限定搜索域名。 */
  includeDomains?: string[];
  /** 排除搜索域名。 */
  excludeDomains?: string[];
}

/**
 * Tavily Extract 单 URL 输入。
 */
interface TavilyExtractSingleUrlInput {
  /** 需要提取正文的页面 URL。 */
  url: string;
  /** 提取深度。 */
  extractDepth?: 'basic' | 'advanced';
  /** 可选的重排意图查询。 */
  query?: string;
}

/**
 * Tavily Search API 请求体。
 */
interface TavilySearchRequest {
  /** 搜索查询。 */
  query: string;
  /** Tavily API snake_case 搜索深度。 */
  search_depth: TavilySearchDepth;
  /** 搜索主题。 */
  topic: TavilySearchTopic;
  /** 搜索时间范围。 */
  time_range?: TavilyTimeRange;
  /** 本地化搜索国家。 */
  country?: string;
  /** 最大结果数。 */
  max_results: number;
  /** 是否包含 Tavily 生成的答案。 */
  include_answer: boolean;
  /** 是否包含图片。 */
  include_images: boolean;
  /** 限定搜索域名。 */
  include_domains: string[];
  /** 排除搜索域名。 */
  exclude_domains: string[];
}

/**
 * Tavily Extract API 请求体。
 */
interface TavilyExtractRequest {
  /** 待提取 URL 列表。 */
  urls: string[];
  /** 提取深度。 */
  extract_depth: TavilyExtractDepth;
  /** 输出格式。 */
  format: TavilyExtractFormat;
  /** 是否包含图片。 */
  include_images: boolean;
  /** 可选的重排意图查询。 */
  query?: string;
}

/** Tavily API 请求体联合类型。 */
type TavilyRequestPayload = TavilySearchRequest | TavilyExtractRequest;

/** 延迟到合并中止信号后才启动的 Tavily 请求。 */
type TavilyRequestRunner = (abortSignal?: AbortSignal) => Promise<unknown>;

/**
 * 判断值是否为普通记录对象。
 * @param value - 待判断值
 * @returns 是否为普通记录对象
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * 从 Tavily 错误响应中读取可展示错误信息。
 * @param payload - Tavily 响应体
 * @returns 错误信息，不存在时返回 null
 */
function readTavilyErrorMessage(payload: unknown): string | null {
  if (!isRecord(payload)) return null;

  for (const key of ['detail', 'error', 'message']) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }

  return null;
}

/**
 * 读取 Tavily JSON 响应体。
 * @param response - fetch 响应
 * @returns JSON 响应，非 JSON 时返回原始文本
 */
async function readTavilyResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/**
 * 调用 Tavily JSON API。
 * @param endpoint - Tavily API 端点
 * @param apiKey - Tavily API Key
 * @param payload - 请求体
 * @param abortSignal - 可选中止信号
 * @returns Tavily JSON 响应
 */
async function postTavilyJson(endpoint: TavilyEndpoint, apiKey: string, payload: TavilyRequestPayload, abortSignal?: AbortSignal): Promise<unknown> {
  const response = await fetch(`${TAVILY_API_BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload),
    signal: abortSignal
  });
  const body = await readTavilyResponseBody(response);

  if (!response.ok) {
    const message = readTavilyErrorMessage(body) ?? `Tavily API request failed with status ${response.status}`;
    throw new Error(message);
  }

  return body;
}

/**
 * 合并可选中止信号。
 * @param signals - 可选中止信号列表
 * @returns 单个中止信号，不存在可用信号时返回 undefined
 */
function mergeOptionalSignals(signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
  const activeSignals = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  if (activeSignals.length === 0) return undefined;
  if (activeSignals.length === 1) return activeSignals[0];

  return AbortSignal.any(activeSignals);
}

/**
 * 执行不支持活动协议的 Tavily 请求，并保留 60 秒兼容保护。
 * @param toolName - AI SDK 工具名称
 * @param runRequest - 使用合并信号启动请求的函数
 * @param abortSignal - AI SDK 上游中止信号
 * @returns Tavily 响应或结构化超时结果
 */
async function executeLegacyTavily(toolName: string, runRequest: TavilyRequestRunner, abortSignal?: AbortSignal): Promise<unknown> {
  const timeoutController = new AbortController();
  const mergedSignal = mergeOptionalSignals([abortSignal, timeoutController.signal]);
  let timeoutResult: AIToolExecutionResult | undefined;
  let resolveTimeout: (result: AIToolExecutionResult) => void = (): void => undefined;
  const timeoutOutcome = new Promise<AIToolExecutionResult>((resolve): void => {
    resolveTimeout = resolve;
  });
  const timeoutTimer = setTimeout((): void => {
    timeoutResult = {
      toolName,
      status: 'failure',
      error: { code: 'TOOL_TIMEOUT', message: 'Tavily 工具执行超过兼容等待时限' }
    };
    resolveTimeout(timeoutResult);
    timeoutController.abort();
  }, AI_LEGACY_TOOL_TIMEOUT_MS);
  const execution = runRequest(mergedSignal).catch((error: unknown): unknown => {
    if (timeoutResult) return timeoutResult;
    throw error;
  });

  try {
    return await Promise.race([execution, timeoutOutcome]);
  } finally {
    clearTimeout(timeoutTimer);
  }
}

/**
 * 构建 Tavily Search 工具输入 schema。
 * @returns AI SDK flexible schema
 */
function createTavilySearchInputSchema(): FlexibleSchema<TavilySearchInput> {
  return jsonSchema({
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The web search query'
      },
      searchDepth: {
        type: 'string',
        enum: ['basic', 'advanced'],
        description: "Search depth - 'basic' for quick results, 'advanced' for deeper search"
      },
      topic: {
        type: 'string',
        enum: ['general', 'news', 'finance'],
        description: 'Search category'
      },
      timeRange: {
        type: 'string',
        enum: ['day', 'month', 'year', 'd', 'y', 'm', 'week', 'w'],
        description: 'Optional time range for search results'
      },
      country: {
        type: 'string',
        description: 'Optional country code or country name for localized results'
      },
      maxResults: {
        type: 'number',
        description: 'Maximum number of results to return'
      },
      includeAnswer: {
        type: 'boolean',
        description: 'Whether to include Tavily generated answer'
      },
      includeImages: {
        type: 'boolean',
        description: 'Whether to include images'
      },
      includeDomains: {
        type: 'array',
        items: { type: 'string' },
        description: 'Domains to include'
      },
      excludeDomains: {
        type: 'array',
        items: { type: 'string' },
        description: 'Domains to exclude'
      }
    },
    required: ['query'],
    additionalProperties: false
  }) as FlexibleSchema<TavilySearchInput>;
}

/**
 * 构建 Tavily Search API 请求体。
 * @param input - 工具输入
 * @returns Tavily Search 请求体
 */
function createTavilySearchRequest(input: TavilySearchInput): TavilySearchRequest {
  return {
    query: input.query,
    search_depth: input.searchDepth ?? TAVILY_SEARCH_DEFAULTS.searchDepth,
    topic: input.topic ?? TAVILY_SEARCH_DEFAULTS.topic,
    ...(input.timeRange ?? TAVILY_SEARCH_DEFAULTS.timeRange ? { time_range: input.timeRange ?? TAVILY_SEARCH_DEFAULTS.timeRange } : {}),
    ...(input.country ?? TAVILY_SEARCH_DEFAULTS.country ? { country: input.country ?? TAVILY_SEARCH_DEFAULTS.country } : {}),
    max_results: input.maxResults ?? TAVILY_SEARCH_DEFAULTS.maxResults,
    include_answer: input.includeAnswer ?? TAVILY_SEARCH_DEFAULTS.includeAnswer,
    include_images: input.includeImages ?? TAVILY_SEARCH_DEFAULTS.includeImages,
    include_domains: input.includeDomains ?? TAVILY_SEARCH_DEFAULTS.includeDomains,
    exclude_domains: input.excludeDomains ?? TAVILY_SEARCH_DEFAULTS.excludeDomains
  };
}

/**
 * 创建 Tavily Search AI SDK 工具。
 * @param apiKey - Tavily API Key
 * @returns AI SDK 工具
 */
function createTavilySearchTool(apiKey: string) {
  return tool({
    description: 'Search the web for real-time, AI-optimized information using Tavily Search.',
    inputSchema: createTavilySearchInputSchema(),
    execute: async (input: TavilySearchInput, options: ContextlessToolOptions) => {
      return executeLegacyTavily(
        'tavily_search',
        (abortSignal?: AbortSignal): Promise<unknown> => postTavilyJson('/search', apiKey, createTavilySearchRequest(input), abortSignal),
        options.abortSignal
      );
    }
  });
}

/**
 * 对外暴露单 URL 版本的 Tavily Extract 工具。
 * @param apiKey - Tavily API Key
 * @returns AI SDK 工具
 */
function createTavilyExtractTool(apiKey: string) {
  const inputSchema = jsonSchema({
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL to extract content from'
      },
      extractDepth: {
        type: 'string',
        enum: ['basic', 'advanced'],
        description: "Extraction depth - 'basic' for main content, 'advanced' for comprehensive extraction"
      },
      query: {
        type: 'string',
        description: 'Optional user intent query for reranking extracted content chunks'
      }
    },
    required: ['url'],
    additionalProperties: false
  }) as FlexibleSchema<TavilyExtractSingleUrlInput>;

  return tool({
    description: 'Extract clean, structured content from a single URL. Returns parsed content in markdown or text format, optimized for AI consumption.',
    inputSchema,
    execute: async ({ url, extractDepth, query }: TavilyExtractSingleUrlInput, options: ContextlessToolOptions) => {
      const request: TavilyExtractRequest = {
        urls: [url],
        extract_depth: extractDepth ?? TAVILY_EXTRACT_DEFAULTS.extractDepth,
        format: TAVILY_EXTRACT_DEFAULTS.format,
        include_images: TAVILY_EXTRACT_DEFAULTS.includeImages,
        ...(query?.trim() ? { query } : {})
      };
      return executeLegacyTavily(
        'tavily_extract',
        (abortSignal?: AbortSignal): Promise<unknown> => postTavilyJson('/extract', apiKey, request, abortSignal),
        options.abortSignal
      );
    }
  });
}

/**
 * 根据 Tavily 配置创建主进程 Tavily 工具集。
 * 配置缺失或未启用时返回空对象。
 * @param tavily - Tavily 配置
 * @returns Tavily 工具集
 */
function createTavilyHttpTools(tavily: AIRequestOptions['tavily']): ToolSet {
  if (!tavily?.enabled || !tavily.apiKey.trim()) return {};

  return {
    tavily_search: createTavilySearchTool(tavily.apiKey),
    tavily_extract: createTavilyExtractTool(tavily.apiKey)
  };
}

/**
 * 判断当前请求是否启用了主进程可直接执行的 Tavily HTTP 工具。
 * @param tavily - Tavily 配置
 * @returns 是否需要开启多步工具循环
 */
function hasTavilyHttpTools(tavily: AIRequestOptions['tavily']): boolean {
  return Boolean(tavily?.enabled && tavily.apiKey.trim());
}

/**
 * 判断当前请求是否启用了可由主进程执行的 MCP SDK 工具。
 * @param mcp - MCP 请求配置
 * @returns 是否存在可启用的 MCP server
 */
function hasMcpSdkTools(mcp: AIRequestOptions['mcp']): boolean {
  return Boolean(
    mcp?.servers.some((server) => {
      if (!server.enabled || !mcp.enabledServerIds.includes(server.id)) return false;
      if (server.transport === 'stdio') return server.command.trim().length > 0;
      return Boolean(server.url?.trim());
    })
  );
}

/**
 * 判断单个 MCP server 是否可在当前请求中运行。
 * @param server - MCP server 配置
 * @param mcp - 当前请求的 MCP 配置
 * @returns 是否可运行
 */
function isMcpServerRunnableForRequest(server: NonNullable<AIRequestOptions['mcp']>['servers'][number], mcp: NonNullable<AIRequestOptions['mcp']>): boolean {
  if (!server.enabled || !mcp.enabledServerIds.includes(server.id)) return false;
  if (server.transport === 'stdio') return server.command.trim().length > 0;
  return Boolean(server.url?.trim());
}

/**
 * 准备当前请求需要暴露的 MCP discovery 工具。
 * @param mcp - 当前请求的 MCP 配置
 * @returns 可用于注册 AI SDK 工具的 discovery 工具列表
 */
async function prepareMcpDiscoveredTools(mcp: AIRequestOptions['mcp'], abortSignal?: AbortSignal): Promise<MCPDiscoveredToolSnapshot[]> {
  if (!mcp) return [];
  abortSignal?.throwIfAborted();

  const runnableServers = mcp.servers.filter((server) => isMcpServerRunnableForRequest(server, mcp));
  const toolGroups = await Promise.all(
    runnableServers.map(async (server): Promise<MCPDiscoveredToolSnapshot[]> => {
      abortSignal?.throwIfAborted();
      // 优先复用设置页或上一轮聊天已经写入的 discovery cache，避免重复启动 server。
      const cache = getMcpDiscoveryCache(server.id);
      if (cache && !Array.isArray(cache)) {
        return cache.tools;
      }

      const result = await connectMcpServer(server, abortSignal);
      abortSignal?.throwIfAborted();
      if (result.ok && result.cache) {
        return result.cache.tools;
      }

      log.warn(`[AIService] MCP discovery unavailable for ${server.id}:`, result.message ?? result.errorCode ?? 'unknown error');
      return [];
    })
  );

  return toolGroups.flat();
}

/**
 * 将 MCP 工具说明词追加到系统提示。
 * @param system - 原始系统提示
 * @param mcp - MCP 请求配置
 * @returns 追加后的系统提示
 */
function appendMcpToolInstructions(system: string | undefined, mcp: AIRequestOptions['mcp']): string | undefined {
  const instructions = mcp?.toolInstructions.trim();
  if (!instructions) return system;

  const mcpSection = `MCP tool usage instructions:\n${instructions}`;
  return system?.trim() ? `${system}\n\n${mcpSection}` : mcpSection;
}

/**
 * 将前端工具定义与 Tavily 工具合并为 AI SDK 兼容的工具集。
 * 合并结果为空时返回 undefined，避免向 SDK 传入空对象。
 */
async function toSdkTools(
  tools: AIRequestOptions['tools'],
  tavily: AIRequestOptions['tavily'],
  mcp: AIRequestOptions['mcp'],
  callOptions: AIServiceCallOptions,
  abortSignal?: AbortSignal
): Promise<ToolSet | undefined> {
  let rendererTools: ToolSet = {};
  if (tools?.length) {
    rendererTools = Object.fromEntries(tools.map((item) => [item.name, tool({ description: item.description, inputSchema: jsonSchema(item.parameters) })]));
  }

  const mcpDiscoveredTools = await prepareMcpDiscoveredTools(mcp, abortSignal);

  let mcpTools: ToolSet = {};
  if (mcp && mcpDiscoveredTools.length > 0) {
    mcpTools = createMcpSdkTools(
      resolveMcpExposedTools(
        {
          servers: mcp.servers
        },
        mcp,
        mcpDiscoveredTools
      ),
      async ({ serverId, toolName, input }, options) => {
        const server = mcp.servers.find((item) => item.id === serverId);
        if (!server) {
          throw new Error(`MCP server not found for tool execution: ${serverId}`);
        }
        return executeMcpTool(server, toolName, input, {
          signal: options?.abortSignal,
          onProgress: options?.onProgress,
          timeoutMs: options?.timeoutMs
        });
      },
      {
        toolActivity: callOptions.toolActivity,
        staticTimeouts: new Map(mcp.servers.map((server): [string, number] => [server.id, server.toolCallTimeoutMs]))
      }
    );
  }

  const merged: ToolSet = { ...rendererTools, ...createTavilyHttpTools(tavily), ...mcpTools };
  if (Object.keys(merged).length === 0) {
    return undefined;
  }

  return merged;
}

/**
 * 将结构化输出配置转换为 AI SDK Output 格式。
 */
function toOutput(output: AIRequestOptions['output']) {
  if (!output) return undefined;
  return Output.object({ schema: jsonSchema(output.schema), name: output.name, description: output.description });
}

/** AI SDK 文本生成末步结果的最小可读形状。 */
interface GenerateTextStepLike {
  /** 末步 token 使用量。 */
  readonly usage?: Partial<AIUsage> | null;
}

/** AI SDK 文本生成结果的最小可读形状。 */
interface GenerateTextResultLike {
  /** 生成文本。 */
  readonly text: string;
  /** 结构化输出，未请求结构化输出时访问可能抛出 AI SDK 错误。 */
  readonly output?: unknown;
  /** AI SDK 7 末步结果。 */
  readonly finalStep?: GenerateTextStepLike;
  /** 顶层 token 使用量；AI SDK 7 中为所有步骤累计值。 */
  readonly usage?: Partial<AIUsage> | null;
}

/** AI 请求白名单诊断元数据。 */
interface AIRequestLogMetadata {
  /** 可关联取消和 Runtime 的请求标识。 */
  requestId?: string;
  /** 当前模型标识。 */
  modelId: string;
  /** 是否使用消息数组输入。 */
  hasMessages: boolean;
  /** 是否使用单提示词输入。 */
  hasPrompt: boolean;
  /** 是否请求结构化输出。 */
  hasStructuredOutput: boolean;
  /** 声明的工具数量。 */
  toolCount: number;
  /** 是否启用 MCP。 */
  hasMcp: boolean;
  /** 是否启用 Tavily。 */
  hasTavily: boolean;
}

/** AI 生成结果白名单诊断元数据。 */
interface AIResultLogMetadata {
  /** 是否请求结构化输出。 */
  hasStructuredOutput: boolean;
  /** 最后一个模型步骤的 Token 用量。 */
  stepUsage?: AIUsage;
  /** 本次 SDK 调用累计的 Token 用量。 */
  totalUsage?: AIUsage;
}

/**
 * 创建不含 prompt、消息、工具参数或 provider secret 的请求日志。
 * @param request - 原始 AI 请求
 * @returns 白名单请求元数据
 */
function createRequestLog(request: AIRequestOptions): AIRequestLogMetadata {
  return {
    requestId: request.requestId,
    modelId: request.modelId,
    hasMessages: Boolean(request.messages?.length),
    hasPrompt: Boolean(request.prompt),
    hasStructuredOutput: Boolean(request.output),
    toolCount: request.tools?.length ?? 0,
    hasMcp: Boolean(request.mcp),
    hasTavily: Boolean(request.tavily)
  };
}

/**
 * 创建不含正文或结构化输出内容的结果日志。
 * @param result - 已归一化 AI 调用结果
 * @param hasStructuredOutput - 是否请求结构化输出
 * @returns 白名单结果元数据
 */
function createResultLog(result: AIInvokeResult, hasStructuredOutput: boolean): AIResultLogMetadata {
  return {
    hasStructuredOutput,
    stepUsage: result.stepUsage ? { ...result.stepUsage } : undefined,
    totalUsage: result.totalUsage ? { ...result.totalUsage } : undefined
  };
}

/**
 * 将 AI SDK 文本生成结果转换为渲染进程可消费的调用结果。
 * @param result - AI SDK 文本生成结果
 * @param includeStructuredOutput - 是否读取并传递结构化输出
 * @returns 主进程 AI 调用结果
 */
export function createAIInvokeResult(result: GenerateTextResultLike, includeStructuredOutput: boolean): AIInvokeResult {
  const stepUsage = normalizeAIUsage(result.finalStep?.usage ?? result.usage ?? {});
  const totalUsage = normalizeAIUsage(result.usage ?? result.finalStep?.usage ?? {});
  const invokeResult: AIInvokeResult = {
    text: result.text,
    stepUsage,
    totalUsage
  };

  // AI SDK 在没有结构化输出时会通过 getter 抛 NoOutputGeneratedError，因此仅在显式请求 output 时读取。
  if (includeStructuredOutput) {
    invokeResult.output = result.output;
  }

  return invokeResult;
}

/**
 * 判断是否为可预期的临时服务错误（限流 / 服务不可用）。
 */
function isExpectedTransientError(error: AIServiceError): boolean {
  return error.code === AI_ERROR_CODE.RATE_LIMITED || error.code === AI_ERROR_CODE.SERVICE_UNAVAILABLE;
}

// ─── AIService ───────────────────────────────────────────────────────────────

/**
 * AI 服务类
 * 封装模型调用能力，支持同步文本生成与流式文本生成两种模式。
 */
class AIService {
  public aiProvider: AIProviderRegistry = new AIProviderRegistry();

  private abortControllers = new Map<string, AbortController>();

  // ── AbortController 管理 ──────────────────────────────────────────────────

  abortStream(requestId: string): void {
    const controller = this.abortControllers.get(requestId);
    if (!controller) return;

    controller.abort();
    this.abortControllers.delete(requestId);
    log.info(`[AIService] Stream aborted manually for requestId: ${requestId}`);
  }

  removeController(requestId: string): void {
    this.abortControllers.delete(requestId);
  }

  /**
   * 仅释放仍由当前调用持有的控制器，避免旧流结束误删复用 ID 的新流。
   * @param requestId - 请求标识
   * @param signal - 当前调用注册的信号
   */
  private releaseController(requestId: string, signal: AbortSignal): void {
    if (this.abortControllers.get(requestId)?.signal === signal) this.removeController(requestId);
  }

  /**
   * 为指定请求创建 AbortSignal，并注册到内部映射表。
   * requestId 缺失时返回 undefined。
   */
  private registerAbortSignal(requestId?: string): AbortSignal | undefined {
    if (!requestId) return undefined;

    this.abortControllers.get(requestId)?.abort();
    const controller = new AbortController();
    this.abortControllers.set(requestId, controller);
    return controller.signal;
  }

  // ── 内部辅助 ──────────────────────────────────────────────────────────────

  private createModel(createOptions: AICreateOptions, modelId: string) {
    return this.aiProvider.create(createOptions, modelId);
  }

  /**
   * 构建 generateText / streamText 共用的基础选项。
   */
  private async buildBaseOptions(createOptions: AICreateOptions, request: AIRequestOptions, callOptions: AIServiceCallOptions, abortSignal?: AbortSignal) {
    const tools = await toSdkTools(request.tools, request.tavily, request.mcp, callOptions, abortSignal);
    const hasExecutableTools = hasTavilyHttpTools(request.tavily) || hasMcpSdkTools(request.mcp);
    const instructions = appendMcpToolInstructions(request.system, request.mcp);

    return {
      model: this.createModel(createOptions, request.modelId),
      instructions: callOptions.forceFinal ? appendFinalInstructions(instructions) : instructions,
      temperature: request.temperature,
      maxOutputTokens: request.maxOutputTokens,
      providerOptions: this.aiProvider.createProviderOptions(createOptions.providerType, request),
      tools,
      timeout: callOptions.runtimeToolLoop ? createRuntimeToolLoopTimeout() : createRequestTimeout(),
      // 压缩边界的 system 消息由 Tibis 内部生成并持久化，保留其原始消息位置以维持上下文语义。
      ...(request.messages ? { allowSystemInMessages: true } : {}),
      ...(hasExecutableTools && !callOptions.runtimeToolLoop ? { prepareStep: prepareToolStep, stopWhen: isLoopFinished() } : {}),
      ...(callOptions.forceFinal ? { toolChoice: 'none' as const } : {})
    };
  }

  /**
   * 统一处理 AI 调用异常：标准化错误、按类型记录日志，并返回错误元组。
   */
  private handleError(scope: string, error: unknown, providerType: AICreateOptions['providerType']): [AIServiceError] {
    const normalized = this.aiProvider.normalizeError(error, providerType);
    const metadata = { code: normalized.code };

    if (isExpectedTransientError(normalized)) {
      log.warn(`[AIService] ${scope} failed:`, metadata);
    } else {
      log.error(`[AIService] ${scope} failed:`, metadata);
    }

    return [normalized];
  }

  // ── 公开 API ──────────────────────────────────────────────────────────────

  /**
   * 同步生成文本。
   */
  async generateText(
    createOptions: AICreateOptions,
    request: AIRequestOptions,
    callOptions: AIServiceCallOptions = {}
  ): Promise<[AIServiceError] | [undefined, AIInvokeResult]> {
    let manualSignal: AbortSignal | undefined;
    try {
      log.info(`[AIService] generateText request:`, createRequestLog(request));
      manualSignal = this.registerAbortSignal(request.requestId);
      const deadlineSignal = callOptions.runtimeToolLoop ? undefined : AbortSignal.timeout(AI_DIRECT_REQUEST_TIMEOUT.totalMs);
      const abortSignal = mergeOptionalSignals([manualSignal, deadlineSignal]);

      const baseOptions = {
        ...(await this.buildBaseOptions(createOptions, request, callOptions, abortSignal)),
        ...(abortSignal ? { abortSignal } : {}),
        output: toOutput(request.output)
      };

      const result = request.messages
        ? await generateText({ ...baseOptions, messages: request.messages })
        : await generateText({ ...baseOptions, prompt: request.prompt ?? '' });

      const invokeResult = createAIInvokeResult(result, Boolean(request.output));
      log.info(`[AIService] generateText result:`, createResultLog(invokeResult, Boolean(request.output)));

      return [undefined, invokeResult];
    } catch (error) {
      return this.handleError('generateText', error, createOptions.providerType);
    } finally {
      if (request.requestId && manualSignal) this.releaseController(request.requestId, manualSignal);
    }
  }

  /**
   * 流式生成文本。
   */
  async streamText(
    createOptions: AICreateOptions,
    request: AIRequestOptions,
    callOptions: AIServiceCallOptions = {}
  ): Promise<[AIServiceError] | [undefined, AIStreamResult]> {
    let manualSignal: AbortSignal | undefined;
    try {
      log.info(`[AIService] streamText request:`, createRequestLog(request));
      manualSignal = this.registerAbortSignal(request.requestId);
      const deadlineSignal = callOptions.runtimeToolLoop ? undefined : AbortSignal.timeout(AI_DIRECT_REQUEST_TIMEOUT.totalMs);
      const buildAbortSignal = mergeOptionalSignals([manualSignal, deadlineSignal]);
      const streamAbortSignal = callOptions.runtimeToolLoop ? manualSignal : buildAbortSignal;
      const releaseRequestId = request.requestId;
      const releaseSignal = manualSignal;

      const baseOptions = {
        ...(await this.buildBaseOptions(createOptions, request, callOptions, buildAbortSignal)),
        ...(streamAbortSignal ? { abortSignal: streamAbortSignal } : {}),
        // ChatRuntime 直接消费完整流时没有 IPC finally，由 v7 onEnd 统一释放请求控制器。
        ...(releaseRequestId && releaseSignal ? { onEnd: (): void => this.releaseController(releaseRequestId, releaseSignal) } : {})
      };

      const result = request.messages
        ? streamText({ ...baseOptions, messages: request.messages })
        : streamText({ ...baseOptions, prompt: request.prompt ?? '' });

      return [undefined, { stream: result.stream }];
    } catch (error) {
      if (request.requestId && manualSignal) this.releaseController(request.requestId, manualSignal);
      return this.handleError('streamText', error, createOptions.providerType);
    }
  }
}

/** AI 服务单例 */
export const aiService = new AIService();
