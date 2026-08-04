/**
 * @file tools.mts
 * @description MCP 工具发现结果的主进程过滤边界。
 */
import type { ToolExecutionOptions, ToolSet } from 'ai';
import type {
  AIMCPRequestConfig,
  AIToolExecutionResult,
  ChatToolProgressSnapshot,
  MCPDiscoveredToolSnapshot,
  MCPServerConfig,
  MCPToolSettings,
  MCPToolSelector
} from 'types/ai';
import { jsonSchema, tool } from 'ai';
import { isEqual } from 'lodash-es';
import { AI_LEGACY_TOOL_TIMEOUT_MS } from '../ai/tool-loop-policy.mjs';

/** MCP 进展说明最大 Unicode code point 数量。 */
const MCP_PROGRESS_MESSAGE_LIMIT = 500;

/** 不声明工具专属 context 时可消费的 AI SDK 执行选项。 */
type ContextlessToolOptions = Omit<ToolExecutionOptions<unknown>, 'context'>;

/**
 * MCP 工具执行请求。
 */
export interface MCPToolExecuteRequest {
  /** 所属 server ID */
  serverId: string;
  /** 原始 MCP tool 名称 */
  toolName: string;
  /** 模型传入的工具参数 */
  input: unknown;
  /** AI SDK 工具调用 ID。 */
  toolCallId: string;
  /** 编码后的 AI SDK 工具名称。 */
  sdkToolName: string;
}

/** MCP progress 的稳定子集。 */
export interface MCPToolProgress {
  /** 已完成工作量。 */
  progress: number;
  /** 总工作量。 */
  total?: number;
  /** 服务端进展说明。 */
  message?: string;
}

/** MCP 工具执行边界选项。 */
export interface MCPToolExecutorOptions {
  /** 合并后的中止信号。 */
  abortSignal?: AbortSignal;
  /** MCP progress 回调。 */
  onProgress?: (progress: MCPToolProgress) => void;
  /** 非 Runtime 直接调用使用的固定总时限。 */
  timeoutMs?: number;
}

/**
 * MCP 工具执行函数。
 */
export type MCPToolExecutor = (request: MCPToolExecuteRequest, options?: MCPToolExecutorOptions) => Promise<unknown>;

/** MCP 工具可使用的 Watchdog 租约窄接口。 */
export interface MCPToolActivityLease {
  /** Watchdog 中止信号。 */
  readonly signal: AbortSignal;
  /** Watchdog 结构化终态。 */
  readonly settled: Promise<AIToolExecutionResult>;
  /** 提交非终态活动。 */
  report(activity: import('types/chat-runtime').ChatRuntimeToolActivity): boolean;
  /** 自然结束时释放租约。 */
  finish(): void;
}

/** MCP 工具升级 Watchdog 的受限桥。 */
export interface MCPToolActivityBridge {
  /**
   * 为首次报告 progress 的工具启动租约。
   * @param toolCallId - AI SDK 工具调用 ID
   * @param toolName - AI SDK 工具名称
   * @returns 工具 Watchdog 租约
   */
  start(toolCallId: string, toolName: string): MCPToolActivityLease;
}

/** MCP AI SDK 工具运行策略。 */
export interface MCPToolRuntimeOptions {
  /** ChatRuntime 工具活动桥；缺失时由 AI SDK 直接调用策略保护。 */
  toolActivity?: MCPToolActivityBridge;
  /** 测试或兼容策略覆盖的静态观察窗口。 */
  legacyTimeoutMs?: number;
  /** 非 Runtime 直接调用按 server ID 使用的既有静态时限。 */
  staticTimeouts?: ReadonlyMap<string, number>;
}

/** 单次受活动管理的 MCP 执行输入。 */
interface MCPManagedExecutionInput {
  /** 原始 MCP 执行器。 */
  executeTool: MCPToolExecutor;
  /** MCP 工具身份与输入。 */
  request: MCPToolExecuteRequest;
  /** AI SDK 执行选项。 */
  sdkOptions: ContextlessToolOptions;
  /** Runtime 活动策略。 */
  runtimeOptions: MCPToolRuntimeOptions;
}

/**
 * 合并可选中止信号。
 * @param signals - 候选信号
 * @returns 合并信号
 */
function mergeMcpSignals(signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
  const activeSignals = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  if (activeSignals.length === 0) return undefined;
  if (activeSignals.length === 1) return activeSignals[0];
  return AbortSignal.any(activeSignals);
}

/**
 * 创建不支持 progress 的 MCP 工具兼容超时结果。
 * @param toolName - AI SDK 工具名称
 * @returns 结构化失败结果
 */
function createLegacyTimeout(toolName: string): AIToolExecutionResult {
  return {
    toolName,
    status: 'failure',
    error: { code: 'TOOL_TIMEOUT', message: 'MCP 工具在兼容窗口内没有报告进展' }
  };
}

/**
 * 把 MCP progress 转换为统一进展快照。
 * @param progress - MCP progress
 * @returns Watchdog progress 活动
 */
function createMcpProgress(progress: MCPToolProgress): Omit<ChatToolProgressSnapshot, 'updatedAt'> | null {
  if (!Number.isFinite(progress.progress) || progress.progress < 0) return null;
  if (progress.total !== undefined && (!Number.isFinite(progress.total) || progress.total < 0)) return null;
  if (progress.message !== undefined && typeof progress.message !== 'string') return null;
  return {
    phase: 'mcp_progress',
    completed: progress.progress,
    ...(progress.total !== undefined ? { total: progress.total } : {}),
    ...(progress.message !== undefined ? { message: Array.from(progress.message).slice(0, MCP_PROGRESS_MESSAGE_LIMIT).join('') } : {})
  };
}

/**
 * 执行可由首个 progress 升级为 Watchdog 的 MCP 调用。
 * @param input - 工具、SDK 与 Runtime 策略
 * @returns MCP 结果或结构化超时结果
 */
async function executeMcpWithActivity(input: MCPManagedExecutionInput): Promise<unknown> {
  const { executeTool, request, sdkOptions, runtimeOptions } = input;
  if (!runtimeOptions.toolActivity) {
    return executeTool(request, {
      abortSignal: sdkOptions.abortSignal,
      timeoutMs: runtimeOptions.staticTimeouts?.get(request.serverId)
    });
  }

  const localController = new AbortController();
  const abortSignal = mergeMcpSignals([sdkOptions.abortSignal, localController.signal]);
  const legacyTimeoutMs = runtimeOptions.legacyTimeoutMs ?? AI_LEGACY_TOOL_TIMEOUT_MS;
  let lease: MCPToolActivityLease | undefined;
  let legacyResult: AIToolExecutionResult | undefined;
  let acceptingProgress = true;
  let previousProgress: Omit<ChatToolProgressSnapshot, 'updatedAt'> | undefined;
  let resolveWatchdog: (result: AIToolExecutionResult) => void = (): void => undefined;
  const watchdogOutcome = new Promise<AIToolExecutionResult>((resolve): void => {
    resolveWatchdog = resolve;
  });
  let resolveLegacy: (result: AIToolExecutionResult) => void = (): void => undefined;
  const legacyOutcome = new Promise<AIToolExecutionResult>((resolve): void => {
    resolveLegacy = resolve;
  });
  const legacyTimer = setTimeout((): void => {
    legacyResult = createLegacyTimeout(request.sdkToolName);
    resolveLegacy(legacyResult);
    localController.abort();
  }, legacyTimeoutMs);
  const abortOnWatchdog = (): void => localController.abort();

  /** 首个进展升级租约；重复进展仅刷新存活。 */
  const onProgress = (progress: MCPToolProgress): void => {
    if (!acceptingProgress || legacyResult) return;
    const nextProgress = createMcpProgress(progress);
    if (!nextProgress) return;
    if (!lease) {
      clearTimeout(legacyTimer);
      lease = runtimeOptions.toolActivity?.start(request.toolCallId, request.sdkToolName);
      if (!lease) return;
      lease.report({ kind: 'started' });
      lease.signal.addEventListener('abort', abortOnWatchdog, { once: true });
      lease.settled.then(resolveWatchdog).catch((): void => undefined);
    }
    if (isEqual(previousProgress, nextProgress)) {
      lease.report({ kind: 'heartbeat' });
      return;
    }
    previousProgress = nextProgress;
    lease.report({ kind: 'progress', progress: nextProgress });
  };

  const execution = executeTool(request, { abortSignal, onProgress }).catch(async (error: unknown): Promise<unknown> => {
    if (legacyResult) return legacyResult;
    if (lease?.signal.aborted) return lease.settled;
    throw error;
  });

  try {
    return await Promise.race([execution, legacyOutcome, watchdogOutcome]);
  } finally {
    acceptingProgress = false;
    clearTimeout(legacyTimer);
    lease?.signal.removeEventListener('abort', abortOnWatchdog);
    lease?.finish();
  }
}

/**
 * 判断 server 配置是否完整到可以参与工具暴露（仅检查配置完整性，不检查运行时连接状态）。
 * 运行时连接由 executeMcpTool 内部自动处理（按需重连）。
 * @param server - MCP server 配置
 * @param request - 当前请求的 MCP 配置
 * @returns 是否可参与工具暴露
 */
function isServerRunnableForRequest(server: MCPServerConfig, request: AIMCPRequestConfig): boolean {
  if (!server.enabled || !request.enabledServerIds.includes(server.id)) return false;
  if (server.transport === 'stdio') return server.command.trim().length > 0;
  return Boolean(server.url?.trim());
}

/**
 * 创建 server 级工具白名单集合。
 * @param server - MCP server 配置
 * @returns 白名单集合；空集合表示不限制
 */
function createServerAllowlist(server: MCPServerConfig): Set<string> {
  return new Set(server.toolAllowlist.map((toolName) => toolName.trim()).filter((toolName) => toolName.length > 0));
}

/**
 * 创建请求级工具选择器集合。
 * @param enabledTools - 当前请求允许的工具选择器
 * @returns 请求级工具选择器集合；空集合表示不限制
 */
function createRequestToolSelectorSet(enabledTools: MCPToolSelector[]): Set<string> {
  return new Set(enabledTools.map((selector) => `${selector.serverId}\u0000${selector.toolName}`));
}

/**
 * 判断 discovery 工具是否通过 server 级 allowlist。
 * @param tool - discovery 工具快照
 * @param serverAllowlist - server 级 allowlist
 * @returns 是否允许暴露
 */
function isAllowedByServerAllowlist(discoveredTool: MCPDiscoveredToolSnapshot, serverAllowlist: Set<string>): boolean {
  return serverAllowlist.size === 0 || serverAllowlist.has(discoveredTool.toolName);
}

/**
 * 判断 discovery 工具是否通过请求级选择器。
 * @param tool - discovery 工具快照
 * @param requestToolSelectors - 请求级工具选择器集合
 * @returns 是否允许暴露
 */
function isAllowedByRequestSelectors(discoveredTool: MCPDiscoveredToolSnapshot, requestToolSelectors: Set<string>): boolean {
  return requestToolSelectors.size === 0 || requestToolSelectors.has(`${discoveredTool.serverId}\u0000${discoveredTool.toolName}`);
}

/**
 * 将字符串编码成 AI SDK 工具名可用的十六进制片段。
 * @param value - 原始字符串
 * @returns 十六进制编码片段
 */
function encodeToolNamePart(value: string): string {
  return Buffer.from(value, 'utf8').toString('hex');
}

/**
 * 将 MCP server 与原始 tool 名称转换为 AI SDK 工具名。
 * @param serverId - MCP server ID
 * @param toolName - 原始 MCP tool 名称
 * @returns server-scoped AI SDK 工具名
 */
export function toMcpSdkToolName(serverId: string, toolName: string): string {
  return `mcp_${encodeToolNamePart(serverId)}_${encodeToolNamePart(toolName)}`;
}

/**
 * 解析本次请求最终可暴露的 MCP 工具。
 * @param settings - 全局 MCP 工具设置
 * @param request - 当前请求 MCP 配置
 * @param discoveredTools - 最近一次 discovery 得到的工具快照
 * @returns 已按 server 与请求权限裁剪后的工具列表
 */
export function resolveMcpExposedTools(
  settings: MCPToolSettings,
  request: AIMCPRequestConfig,
  discoveredTools: MCPDiscoveredToolSnapshot[]
): MCPDiscoveredToolSnapshot[] {
  const runnableServers = new Map<string, MCPServerConfig>();
  for (const server of settings.servers) {
    if (isServerRunnableForRequest(server, request)) {
      runnableServers.set(server.id, server);
    }
  }

  const requestToolSelectors = createRequestToolSelectorSet(request.enabledTools);

  return discoveredTools.filter((discoveredTool) => {
    const server = runnableServers.get(discoveredTool.serverId);
    if (!server) return false;

    const serverAllowlist = createServerAllowlist(server);
    return isAllowedByServerAllowlist(discoveredTool, serverAllowlist) && isAllowedByRequestSelectors(discoveredTool, requestToolSelectors);
  });
}

/**
 * 将已过滤的 MCP 工具快照转换为 AI SDK ToolSet。
 * @param exposedTools - 已过滤的 MCP 工具快照
 * @param executeTool - MCP runtime 执行函数
 * @returns AI SDK ToolSet
 */
export function createMcpSdkTools(
  exposedTools: MCPDiscoveredToolSnapshot[],
  executeTool: MCPToolExecutor,
  runtimeOptions: MCPToolRuntimeOptions = {}
): ToolSet {
  const entries = exposedTools.map((exposedTool) => {
    const sdkToolName = toMcpSdkToolName(exposedTool.serverId, exposedTool.toolName);

    return [
      sdkToolName,
      tool({
        description: exposedTool.description ?? `MCP tool ${exposedTool.toolName} from server ${exposedTool.serverId}.`,
        inputSchema: jsonSchema(
          exposedTool.inputSchema ?? {
            type: 'object',
            properties: {},
            additionalProperties: true
          }
        ),
        execute: async (input: unknown, options: ContextlessToolOptions) =>
          executeMcpWithActivity({
            executeTool,
            request: {
              serverId: exposedTool.serverId,
              toolName: exposedTool.toolName,
              input,
              toolCallId: options.toolCallId,
              sdkToolName
            },
            sdkOptions: options,
            runtimeOptions
          })
      })
    ] as const;
  });

  return Object.fromEntries(entries);
}
