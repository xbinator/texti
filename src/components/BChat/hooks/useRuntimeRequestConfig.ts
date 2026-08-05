/**
 * @file useRuntimeRequestConfig.ts
 * @description ChatRuntime 请求准备 IO 与纯策略适配 hook。
 */
import type { RuntimeToolDiscoveryBinding } from './useRuntimeTools';
import type { Message, ServiceConfig } from '../utils/types';
import type { AIMCPRequestConfig, AITavilyRuntimeConfig, AIToolExecutor } from 'types/ai';
import type { ChatRuntimeContext, ChatRuntimeSkillSnapshot, ChatRuntimeUserInputPart } from 'types/chat-runtime';
import type { Ref } from 'vue';
import { createMemorySelection } from '@/ai/chat/policies/memorySelection';
import { buildRuntimeRequestConfig, type ChatRuntimeRequestConfig, type RuntimeRequestPolicyResult } from '@/ai/chat/policies/runtimeRequest';
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
  /** 解析 system prompt */
  resolveRuntimeSystemPrompt: (
    selection?: MemorySelectionContext,
    onSelectionDebug?: (debugInfo: MemorySelectionDebugInfo) => void
  ) => Promise<string | undefined>;
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
   * 从 Runtime 输入或持久化消息中读取有序 SkillReference 名称。
   * @param selectionSource - 当前用户消息
   * @param selectionParts - 发送前结构化输入
   * @returns 允许包含重复项的 Skill 名称
   */
  function collectSkillNames(selectionSource?: Message | null, selectionParts: ChatRuntimeUserInputPart[] = []): string[] {
    const sourceParts = selectionParts.length > 0 ? selectionParts : selectionSource?.parts ?? [];
    return sourceParts.filter((part) => part.type === 'skill_reference').map((part) => part.name);
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
    const requestWorkspaceRoot = toolBinding?.workspaceRoot !== undefined ? toolBinding.workspaceRoot : options.workspaceRoot.value;
    const discoveryBinding = createDiscoveryBinding(toolBinding, requestWorkspaceRoot);
    await options.syncAIResources();
    const runtimeSelectionParts = selectionParts ?? [];
    const resolvedSkills = await options.resolveSkillSnapshots(collectSkillNames(selectionSource, runtimeSelectionParts));
    const runtimeContext: ChatRuntimeContext | undefined =
      resolvedSkills.length > 0 && selectionSource
        ? {
            skill: {
              targetMessageId: selectionSource.id,
              snapshots: resolvedSkills
            }
          }
        : undefined;
    // 构造 Memory 选择上下文（无消息源时跳过）
    let memorySelection: MemorySelectionContext | undefined;
    if (selectionSource) {
      memorySelection = createMemorySelection({
        content: selectionSource.content,
        messageReferences: selectionSource.references?.map((reference) => reference.path) ?? [],
        filePartReferences: runtimeSelectionParts.filter((part) => part.type === 'file').map((part) => part.path),
        workspaceRoot: requestWorkspaceRoot || undefined
      });
    }
    let memorySelectionDebugInfo: MemorySelectionDebugInfo | undefined;
    const system = await options.resolveRuntimeSystemPrompt(memorySelection, (debugInfo: MemorySelectionDebugInfo): void => {
      memorySelectionDebugInfo = debugInfo;
    });
    const result = buildRuntimeRequestConfig({
      model: { providerId: serviceConfig.providerId, modelId: serviceConfig.modelId },
      contextWindow: options.contextWindow.value,
      system,
      workspaceRoot: requestWorkspaceRoot || undefined,
      candidateTools: serviceConfig.toolSupport.supported ? options.getActiveTools(discoveryBinding) : [],
      toolSupport: serviceConfig.toolSupport.supported,
      memoryMode: memorySelection?.mode,
      skillContentHashes: options.getSkillContentHashes(),
      runtimeContext,
      tavily: options.resolveRuntimeTavilyConfig(),
      mcp: options.resolveRuntimeMcpRequestConfig()
    });

    if (memorySelectionDebugInfo) {
      logger.info(`[memory-selection] ${JSON.stringify({ ...memorySelectionDebugInfo, editMemoryExposed: result.editMemoryExposed })}`);
    }

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
