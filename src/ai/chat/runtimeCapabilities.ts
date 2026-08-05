/**
 * @file runtimeCapabilities.ts
 * @description 按 Runtime ID 冻结 renderer 工具与 Bridge 能力。
 */
import type { AIToolContext, AIToolExecutor } from 'types/ai';
import type { ChatRuntimeBridgeRequestEvent, ChatRuntimeCapabilityDescriptor } from 'types/chat-runtime';

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
                rendererToolNames: Object.freeze([...capabilities.descriptor.rendererToolNames]),
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
