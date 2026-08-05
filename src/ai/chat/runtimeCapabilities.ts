/**
 * @file runtimeCapabilities.ts
 * @description 按 Runtime ID 冻结 renderer 工具与 Bridge 能力。
 */
import type { AIToolContext, AIToolExecutor } from 'types/ai';
import type {
  ChatRendererToolDescriptor,
  ChatRendererToolHistoryPolicy,
  ChatRuntimeBridgeRequestEvent,
  ChatRuntimeCapabilityDescriptor
} from 'types/chat-runtime';

/**
 * 深度复制并冻结 Renderer 历史策略。
 * @param history - 原始历史策略
 * @returns 不可变历史策略
 */
function freezeHistory(history: ChatRendererToolHistoryPolicy | undefined): ChatRendererToolHistoryPolicy | undefined {
  if (!history) return undefined;
  return Object.freeze({
    mode: history.mode,
    ...(history.placeholder !== undefined ? { placeholder: history.placeholder } : {}),
    ...(history.redactInputPaths ? { redactInputPaths: Object.freeze([...history.redactInputPaths]) } : {})
  });
}

/**
 * 复制并冻结 Renderer 工具描述符。
 * @param tools - 原始描述符列表
 * @returns 不可变描述符列表
 */
function freezeRendererTools(tools: readonly ChatRendererToolDescriptor[]): readonly ChatRendererToolDescriptor[] {
  const names = new Set<string>();
  return Object.freeze(
    tools.map((tool: ChatRendererToolDescriptor): ChatRendererToolDescriptor => {
      if (names.has(tool.name)) throw new Error(`Duplicate renderer tool descriptor: ${tool.name}`);
      names.add(tool.name);
      return Object.freeze({ name: tool.name, ...(tool.history ? { history: freezeHistory(tool.history) } : {}) });
    })
  );
}

/**
 * Runtime 启动时捕获的 renderer 能力。
 */
export interface RuntimeExecutionCapabilities {
  /** Runtime 可调用的 renderer 工具 */
  tools: readonly AIToolExecutor[];
  /** 主进程可持有的 Runtime 能力身份描述符 */
  descriptor?: ChatRuntimeCapabilityDescriptor;
  /** 按已捕获文档 ID 读取工具上下文 */
  getToolContext: () => AIToolContext | undefined;
  /** 应用级 Bridge 请求处理器 */
  handleBridgeRequest: (event: ChatRuntimeBridgeRequestEvent) => Promise<unknown>;
}

/**
 * Runtime capability registry。
 */
export interface RuntimeCapabilityRegistry {
  /** 注册 Runtime 能力 */
  register: (runtimeId: string, capabilities: RuntimeExecutionCapabilities) => void;
  /** 读取 Runtime 能力 */
  get: (runtimeId: string) => RuntimeExecutionCapabilities | undefined;
  /** 删除 Runtime 能力 */
  delete: (runtimeId: string) => boolean;
  /** 清空全部 Runtime 能力 */
  clear: () => void;
}

/**
 * 创建 Runtime capability registry。
 * @returns capability registry
 */
export function createRuntimeCapabilityRegistry(): RuntimeCapabilityRegistry {
  const capabilitiesByRuntime = new Map<string, RuntimeExecutionCapabilities>();

  return {
    register(runtimeId: string, capabilities: RuntimeExecutionCapabilities): void {
      capabilitiesByRuntime.set(
        runtimeId,
        Object.freeze({
          ...capabilities,
          tools: Object.freeze([...capabilities.tools]),
          descriptor: capabilities.descriptor
            ? Object.freeze({
                ...capabilities.descriptor,
                rendererTools: freezeRendererTools(capabilities.descriptor.rendererTools ?? []),
                toolContext: capabilities.descriptor.toolContext ? Object.freeze({ ...capabilities.descriptor.toolContext }) : undefined
              })
            : undefined
        })
      );
    },
    get(runtimeId: string): RuntimeExecutionCapabilities | undefined {
      return capabilitiesByRuntime.get(runtimeId);
    },
    delete(runtimeId: string): boolean {
      return capabilitiesByRuntime.delete(runtimeId);
    },
    clear(): void {
      capabilitiesByRuntime.clear();
    }
  };
}
