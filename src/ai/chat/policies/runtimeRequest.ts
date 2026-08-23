/**
 * @file runtimeRequest.ts
 * @description ChatRuntime 请求配置与 renderer 工具快照纯策略。
 */
import type { AIMCPRequestConfig, AITavilyRuntimeConfig, AIToolExecutor } from 'types/ai';
import type { ChatRuntimeContext, ChatRuntimeModelSelection, ChatRuntimeSendInput } from 'types/chat-runtime';
import { GLOB_TOOL_NAME, GREP_TOOL_NAME, READ_DIRECTORY_TOOL_NAME } from '@@/shared/ai/tools/index.ts';
import type { MemoryInjectionMode } from '@/ai/memory/types';
import { toTransportTools } from '@/ai/tools/stream';
import { filterMemoryTools } from './memorySelection';

/** 依赖已选工作区才能安全暴露给模型的目录发现工具。 */
const WORKSPACE_DISCOVERY_TOOL_NAMES = new Set<string>([READ_DIRECTORY_TOOL_NAME, GLOB_TOOL_NAME, GREP_TOOL_NAME]);

/** ChatRuntime 通用请求配置。 */
export type ChatRuntimeRequestConfig = Pick<
  ChatRuntimeSendInput,
  'contextWindow' | 'system' | 'workspaceRoot' | 'tools' | 'skillContentHashes' | 'runtimeContext' | 'tavily' | 'mcp' | 'capabilities'
> & {
  /** 当前 Runtime 已冻结的模型标识。 */
  model: ChatRuntimeModelSelection;
};

/**
 * Runtime 请求配置纯策略输入。
 */
export interface RuntimeRequestPolicyInput {
  /** 当前 Runtime 使用的模型标识。 */
  model: ChatRuntimeModelSelection;
  /** 模型上下文窗口 */
  contextWindow: number;
  /** 已解析 system prompt */
  system?: string;
  /** 当前工作区根目录 */
  workspaceRoot?: string;
  /** 当前候选 renderer 工具 */
  candidateTools: AIToolExecutor[];
  /** Provider 是否支持工具调用 */
  toolSupport: boolean;
  /** 本轮 Memory 注入模式 */
  memoryMode?: MemoryInjectionMode;
  /** 当前 Skill 内容版本 */
  skillContentHashes: Record<string, string>;
  /** 本轮只在 Runtime 生命周期内生效的临时上下文 */
  runtimeContext?: ChatRuntimeContext;
  /** Tavily Runtime 配置 */
  tavily?: AITavilyRuntimeConfig;
  /** MCP Runtime 配置 */
  mcp?: AIMCPRequestConfig;
}

/**
 * Runtime 请求配置纯策略结果。
 */
export interface RuntimeRequestPolicyResult {
  /** 主进程 Runtime 请求配置 */
  config: ChatRuntimeRequestConfig;
  /** Runtime 启动时需要冻结的 renderer 工具 */
  rendererTools: AIToolExecutor[];
  /** 是否向模型暴露 edit_memory */
  editMemoryExposed: boolean;
}

/**
 * 根据工作区状态过滤目录发现工具。
 * @param tools - 候选工具列表
 * @param workspaceRoot - 当前请求冻结的工作区根目录
 * @returns 过滤后的工具列表
 */
function filterWorkspaceTools(tools: AIToolExecutor[], workspaceRoot: string | undefined): AIToolExecutor[] {
  if (workspaceRoot?.trim()) return tools;

  return tools.filter((tool: AIToolExecutor): boolean => !WORKSPACE_DISCOVERY_TOOL_NAMES.has(tool.definition.name));
}

/**
 * 构建 Runtime 请求配置和 renderer 工具快照。
 * @param input - 已解析的请求依赖
 * @returns Runtime 请求策略结果
 */
export function buildRuntimeRequestConfig(input: RuntimeRequestPolicyInput): RuntimeRequestPolicyResult {
  const workspaceTools = filterWorkspaceTools(input.candidateTools, input.workspaceRoot);
  const rendererTools = input.toolSupport ? filterMemoryTools(workspaceTools, input.memoryMode) : [];

  return {
    config: {
      model: input.model,
      contextWindow: input.contextWindow,
      system: input.system,
      workspaceRoot: input.workspaceRoot,
      tools: input.toolSupport ? toTransportTools(rendererTools) : undefined,
      skillContentHashes: input.skillContentHashes,
      runtimeContext: input.runtimeContext,
      tavily: input.tavily,
      mcp: input.mcp
    },
    rendererTools,
    editMemoryExposed: rendererTools.some((tool: AIToolExecutor): boolean => tool.definition.name === 'edit_memory')
  };
}
