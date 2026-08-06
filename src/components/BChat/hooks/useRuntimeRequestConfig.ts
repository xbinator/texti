/**
 * @file useRuntimeRequestConfig.ts
 * @description ChatRuntime 请求准备 IO 与纯策略适配 hook。
 */
import type { RuntimeToolDiscoveryBinding } from './useRuntimeTools';
import type { Message, ServiceConfig } from '../utils/types';
import type { AIMCPRequestConfig, AITavilyRuntimeConfig, AIToolExecutor } from 'types/ai';
import type { ChatRuntimeContext, ChatRuntimeEnvironmentContext, ChatRuntimeSkillSnapshot, ChatRuntimeUserInputPart } from 'types/chat-runtime';
import type { Ref } from 'vue';
import { createMemorySelection } from '@/ai/chat/policies/memorySelection';
import {
  buildRuntimeRequestConfig,
  type ChatRuntimeRequestConfig,
  type RuntimeRequestPolicyInput,
  type RuntimeRequestPolicyResult
} from '@/ai/chat/policies/runtimeRequest';
import type { MemorySelectionContext, MemorySelectionDebugInfo } from '@/ai/memory/types';
import { logger } from '@/shared/logger';

/**
 * Runtime 请求准备 hook 选项。
 */
interface UseRuntimeRequestConfigOptions {
  /** 模型上下文窗口 */
  contextWindow: Ref<number>;
  /** 当前工作区根目录 */
  workspaceRoot: Readonly<Ref<string | null>>;
  /** 校验当前会话覆盖目录在本次 Runtime 请求前仍可用。 */
  assertWorkspaceAvailable?: () => Promise<void>;
  /** 解析 Provider 服务配置 */
  resolveServiceConfig: () => Promise<ServiceConfig | undefined>;
  /** 同步磁盘 AI 资源 */
  syncAIResources: () => Promise<void>;
  /** 读取当前候选工具 */
  getActiveTools: (binding?: RuntimeToolDiscoveryBinding) => AIToolExecutor[];
  /** 读取 Skill 内容版本 */
  getSkillContentHashes: () => Record<string, string>;
  /** 解析显式选择的 Skill 内容快照 */
  resolveSkillSnapshots: (names: string[]) => Promise<ChatRuntimeSkillSnapshot[]>;
  /** 解析 Runtime 记忆上下文 */
  resolveRuntimeMemoryContext: (
    selection?: MemorySelectionContext,
    onSelectionDebug?: (debugInfo: MemorySelectionDebugInfo) => void
  ) => Promise<string | undefined>;
  /** 解析 Runtime 当前环境上下文 */
  resolveRuntimeEnvironmentContext: (
    binding: RuntimeToolDiscoveryBinding | undefined,
    workspaceRoot: string | null,
    targetMessageId: string | undefined
  ) => ChatRuntimeEnvironmentContext | undefined;
  /** 解析 Tavily Runtime 配置 */
  resolveRuntimeTavilyConfig: () => AITavilyRuntimeConfig | undefined;
  /** 解析 MCP Runtime 配置 */
  resolveRuntimeMcpRequestConfig: () => AIMCPRequestConfig | undefined;
  /** Provider 配置缺失回调 */
  onMissingServiceConfig: () => void;
}

/**
 * 已完成 IO 的 Runtime 请求准备结果。
 */
export interface PreparedRuntimeRequest extends RuntimeRequestPolicyResult {
  /** 当前 Memory 选择上下文 */
  memorySelection?: MemorySelectionContext;
}

/**
 * Runtime 记忆解析结果。
 */
interface RuntimeMemoryResolution {
  /** 注入 Runtime Context 的记忆文本。 */
  content?: string;
  /** Memory 选择调试信息。 */
  debugInfo?: MemorySelectionDebugInfo;
}

/**
 * Runtime Context 片段。
 */
interface RuntimeContextParts {
  /** 接收 Runtime Context 的用户消息 ID。 */
  targetMessageId?: string;
  /** 已解析的记忆上下文文本。 */
  memoryContext?: string;
  /** 已解析的当前环境上下文。 */
  environmentContext?: ChatRuntimeEnvironmentContext;
  /** 已解析的 Skill 快照。 */
  skillSnapshots: ChatRuntimeSkillSnapshot[];
}

/**
 * Runtime 请求纯策略输入依赖。
 */
interface PolicyInputOptions {
  /** Provider 服务配置。 */
  serviceConfig: ServiceConfig;
  /** 模型上下文窗口。 */
  contextWindow: number;
  /** 本轮冻结的工作区根目录。 */
  workspaceRoot: string | null;
  /** 本轮冻结的工具发现绑定。 */
  discoveryBinding?: RuntimeToolDiscoveryBinding;
  /** 当前 Memory 选择上下文。 */
  memorySelection?: MemorySelectionContext;
  /** 本轮 Runtime 临时上下文。 */
  runtimeContext?: ChatRuntimeContext;
  /** 读取当前候选工具。 */
  getActiveTools: (binding?: RuntimeToolDiscoveryBinding) => AIToolExecutor[];
  /** 读取 Skill 内容版本。 */
  getSkillContentHashes: () => Record<string, string>;
  /** Tavily Runtime 配置。 */
  tavily?: AITavilyRuntimeConfig;
  /** MCP Runtime 配置。 */
  mcp?: AIMCPRequestConfig;
}

/**
 * 将冻结的工作区根目录补入工具发现绑定。
 * @param binding - 提交时冻结的工具资源身份
 * @param workspaceRoot - Runtime 请求使用的工作区根目录
 * @returns 带工作区根目录的工具发现绑定
 */
function createDiscoveryBinding(binding: RuntimeToolDiscoveryBinding | undefined, workspaceRoot: string | null): RuntimeToolDiscoveryBinding | undefined {
  if (!binding) return undefined;

  return Object.freeze({
    ...binding,
    workspaceRoot: binding.workspaceRoot !== undefined ? binding.workspaceRoot : workspaceRoot
  });
}

/**
 * 解析本轮请求使用的工作区根目录。
 * @param binding - 提交时冻结的工具资源身份
 * @param workspaceRoot - 当前工作区根目录
 * @returns 本轮请求冻结的工作区根目录
 */
function resolveWorkspaceRoot(binding: RuntimeToolDiscoveryBinding | undefined, workspaceRoot: string | null): string | null {
  return binding?.workspaceRoot !== undefined ? binding.workspaceRoot : workspaceRoot;
}

/**
 * 从 Runtime 输入或持久化消息中读取有序 SkillReference 名称。
 * @param selectionSource - 当前用户消息
 * @param selectionParts - 发送前结构化输入
 * @returns 允许包含重复项的 Skill 名称
 */
function collectSkillNames(selectionSource?: Message | null, selectionParts: ChatRuntimeUserInputPart[] = []): string[] {
  const sourceParts = selectionParts.length > 0 ? selectionParts : selectionSource?.parts ?? [];
  return sourceParts.filter((part) => part.type === 'skill_reference').map((part): string => part.name);
}

/**
 * 构造 Memory 选择上下文。
 * @param selectionSource - Memory 选择使用的用户消息
 * @param selectionParts - Runtime 结构化输入
 * @param workspaceRoot - 本轮冻结的工作区根目录
 * @returns Memory 选择上下文
 */
function createSelectionContext(
  selectionSource: Message | null | undefined,
  selectionParts: ChatRuntimeUserInputPart[],
  workspaceRoot?: string | null
): MemorySelectionContext | undefined {
  if (!selectionSource) return undefined;

  return createMemorySelection({
    content: selectionSource.content,
    messageReferences: selectionSource.references?.map((reference): string => reference.path) ?? [],
    filePartReferences: selectionParts.filter((part) => part.type === 'file').map((part): string => part.path),
    workspaceRoot: workspaceRoot || undefined
  });
}

/**
 * 合成 Runtime 临时上下文。
 * @param input - Runtime Context 片段
 * @returns Runtime 临时上下文
 */
function createRuntimeContext(input: RuntimeContextParts): ChatRuntimeContext | undefined {
  if (!input.targetMessageId) return undefined;
  const hasContext = Boolean(input.memoryContext || input.environmentContext || input.skillSnapshots.length > 0);
  if (!hasContext) return undefined;

  return {
    ...(input.memoryContext
      ? {
          memory: {
            targetMessageId: input.targetMessageId,
            content: input.memoryContext
          }
        }
      : {}),
    ...(input.environmentContext ? { environment: input.environmentContext } : {}),
    ...(input.skillSnapshots.length > 0
      ? {
          skill: {
            targetMessageId: input.targetMessageId,
            snapshots: input.skillSnapshots
          }
        }
      : {})
  };
}

/**
 * 构造 Runtime 请求纯策略输入。
 * @param input - Runtime 请求依赖
 * @returns Runtime 请求纯策略输入
 */
function createPolicyInput(input: PolicyInputOptions): RuntimeRequestPolicyInput {
  const toolSupport = input.serviceConfig.toolSupport.supported;

  return {
    model: { providerId: input.serviceConfig.providerId, modelId: input.serviceConfig.modelId },
    contextWindow: input.contextWindow,
    workspaceRoot: input.workspaceRoot || undefined,
    candidateTools: toolSupport ? input.getActiveTools(input.discoveryBinding) : [],
    toolSupport,
    memoryMode: input.memorySelection?.mode,
    skillContentHashes: input.getSkillContentHashes(),
    runtimeContext: input.runtimeContext,
    tavily: input.tavily,
    mcp: input.mcp
  };
}

/**
 * 记录 Memory 选择调试信息。
 * @param debugInfo - Memory 选择调试信息
 * @param editMemoryExposed - edit_memory 是否对模型可见
 */
function logMemoryDebug(debugInfo: MemorySelectionDebugInfo | undefined, editMemoryExposed: boolean): void {
  if (!debugInfo) return;
  logger.info(`[memory-selection] ${JSON.stringify({ ...debugInfo, editMemoryExposed })}`);
}

/**
 * Runtime 请求准备 hook 返回值。
 */
interface UseRuntimeRequestConfigReturn {
  /** 准备完整 Runtime 请求和 renderer capabilities */
  prepareRuntimeRequest: (
    selectionSource?: Message | null,
    selectionParts?: ChatRuntimeUserInputPart[],
    toolBinding?: RuntimeToolDiscoveryBinding
  ) => Promise<PreparedRuntimeRequest | null>;
  /** 兼容旧调用方，仅返回主进程请求配置 */
  resolveRuntimeRequestConfig: (
    selectionSource?: Message | null,
    selectionParts?: ChatRuntimeUserInputPart[],
    toolBinding?: RuntimeToolDiscoveryBinding
  ) => Promise<ChatRuntimeRequestConfig | null>;
}

/**
 * 准备 ChatRuntime 请求配置。
 * @param options - Runtime IO 依赖
 * @returns 请求准备能力
 */
export function useRuntimeRequestConfig(options: UseRuntimeRequestConfigOptions): UseRuntimeRequestConfigReturn {
  /**
   * 解析 Runtime 记忆上下文并保留调试信息。
   * @param memorySelection - Memory 选择上下文
   * @returns Runtime 记忆解析结果
   */
  async function resolveMemoryContext(memorySelection?: MemorySelectionContext): Promise<RuntimeMemoryResolution> {
    let debugInfo: MemorySelectionDebugInfo | undefined;
    const content = await options.resolveRuntimeMemoryContext(memorySelection, (selectionDebug: MemorySelectionDebugInfo): void => {
      debugInfo = selectionDebug;
    });
    return { content, debugInfo };
  }

  /**
   * 解析完整 Runtime 请求。
   * @param selectionSource - Memory 选择使用的用户消息
   * @param selectionParts - Runtime 结构化输入
   * @param toolBinding - 提交时冻结的工具资源身份
   * @returns 请求与 renderer 工具快照
   */
  async function prepareRuntimeRequest(
    selectionSource?: Message | null,
    selectionParts?: ChatRuntimeUserInputPart[],
    toolBinding?: RuntimeToolDiscoveryBinding
  ): Promise<PreparedRuntimeRequest | null> {
    const serviceConfig = await options.resolveServiceConfig();
    if (!serviceConfig) {
      options.onMissingServiceConfig();
      return null;
    }

    await options.assertWorkspaceAvailable?.();
    const requestWorkspaceRoot = resolveWorkspaceRoot(toolBinding, options.workspaceRoot.value);
    const discoveryBinding = createDiscoveryBinding(toolBinding, requestWorkspaceRoot);
    await options.syncAIResources();
    const runtimeSelectionParts = selectionParts ?? [];
    const targetMessageId = selectionSource?.id;
    const skillSnapshots = await options.resolveSkillSnapshots(collectSkillNames(selectionSource, runtimeSelectionParts));
    const memorySelection = createSelectionContext(selectionSource, runtimeSelectionParts, requestWorkspaceRoot);
    const memoryResolution = await resolveMemoryContext(memorySelection);
    const environmentContext = options.resolveRuntimeEnvironmentContext(discoveryBinding, requestWorkspaceRoot, targetMessageId);
    const runtimeContext = createRuntimeContext({
      targetMessageId,
      memoryContext: memoryResolution.content,
      environmentContext,
      skillSnapshots
    });
    const result = buildRuntimeRequestConfig(
      createPolicyInput({
        serviceConfig,
        contextWindow: options.contextWindow.value,
        workspaceRoot: requestWorkspaceRoot,
        discoveryBinding,
        memorySelection,
        runtimeContext,
        getActiveTools: options.getActiveTools,
        getSkillContentHashes: options.getSkillContentHashes,
        tavily: options.resolveRuntimeTavilyConfig(),
        mcp: options.resolveRuntimeMcpRequestConfig()
      })
    );
    logMemoryDebug(memoryResolution.debugInfo, result.editMemoryExposed);

    return {
      ...result,
      memorySelection
    };
  }

  /**
   * 兼容旧 Runtime 调用方读取配置。
   * @param selectionSource - Memory 选择使用的用户消息
   * @param selectionParts - Runtime 结构化输入
   * @param toolBinding - 提交时冻结的工具资源身份
   * @returns 主进程 Runtime 请求配置
   */
  async function resolveRuntimeRequestConfig(
    selectionSource?: Message | null,
    selectionParts?: ChatRuntimeUserInputPart[],
    toolBinding?: RuntimeToolDiscoveryBinding
  ): Promise<ChatRuntimeRequestConfig | null> {
    return (await prepareRuntimeRequest(selectionSource, selectionParts, toolBinding))?.config ?? null;
  }

  return { prepareRuntimeRequest, resolveRuntimeRequestConfig };
}
