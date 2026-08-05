/**
 * @file types.ts
 * @description 页面工具上下文（Tool Context）注册、查询和 Bridge 分发类型。
 */
import type { AIToolExecutor } from 'types/ai';
import type { ChatRuntimeBridgeRequestEvent, ChatToolBinding } from 'types/chat-runtime';
import type { Ref } from 'vue';

export type { ChatToolBinding } from 'types/chat-runtime';

/** 页面 Bridge handler 的处理结果。 */
export type ChatBridgeDispatchResult = { readonly handled: true; readonly data: unknown } | { readonly handled: false };

/** 页面 Bridge 请求处理器。 */
export type ChatBridgeHandler = (event: ChatRuntimeBridgeRequestEvent) => Promise<ChatBridgeDispatchResult> | ChatBridgeDispatchResult;

/** Registry 内部可注册的页面工具上下文。 */
export interface ToolContextRegistration {
  /** 页面工具资源身份。 */
  readonly binding: ChatToolBinding;
  /** 动态创建当前资源工具。 */
  readonly getTools: () => AIToolExecutor[];
  /** 需要隐藏的应用级工具名称。 */
  readonly hiddenToolNames: readonly string[];
  /** 按 Bridge kind 索引的处理器。 */
  readonly bridgeHandlers: Readonly<Record<string, ChatBridgeHandler>>;
}

/** 单次注册返回的 owner-safe 控制句柄。 */
export interface ToolContextHandle {
  /** 不可变资源身份。 */
  readonly binding: ChatToolBinding;
  /** 将该资源设为当前激活项。 */
  activate(): void;
  /** 仅在该资源仍为当前项时清除激活状态。 */
  deactivate(): void;
  /** 仅在 owner 仍匹配时注销资源。 */
  unregister(): void;
}

/** 页面工具上下文 Registry。 */
export interface ToolContextRegistry {
  /** 注册页面工具资源。 */
  register(registration: ToolContextRegistration): ToolContextHandle;
  /** 获取当前激活 binding。 */
  getActiveBinding(): ChatToolBinding | undefined;
  /** 按 binding 获取工具。 */
  getBoundTools(binding: ChatToolBinding): AIToolExecutor[];
  /** 按 binding 获取隐藏工具名称。 */
  getHiddenToolNames(binding: ChatToolBinding): readonly string[];
  /** 按 binding 分发 Bridge。 */
  dispatchBridge(binding: ChatToolBinding, event: ChatRuntimeBridgeRequestEvent): Promise<ChatBridgeDispatchResult>;
  /** 订阅 Registry 有效状态变化。 */
  subscribe(listener: () => void): () => void;
  /** 清空 Registry，仅供应用销毁与测试隔离。 */
  clear(): void;
}

/** 页面工具上下文注册 Hook 选项。 */
export interface UseToolContextOptions {
  /** 页面提供方命名空间。 */
  readonly providerId: string;
  /** 当前资源稳定标识。 */
  readonly resourceId: Readonly<Ref<string>>;
  /** 当前资源是否可以提供能力。 */
  readonly available: Readonly<Ref<boolean>>;
  /** 当前页面是否激活。 */
  readonly active: Readonly<Ref<boolean>>;
  /** 动态创建当前资源工具。 */
  readonly getTools: () => AIToolExecutor[];
  /** 需要隐藏的应用级工具名称。 */
  readonly hiddenToolNames?: readonly string[];
  /** 页面 Bridge handlers。 */
  readonly bridgeHandlers: Readonly<Record<string, ChatBridgeHandler>>;
}

/** BChat 消费的通用页面工具能力。 */
export interface ActiveToolContext extends Pick<ToolContextRegistry, 'getActiveBinding' | 'getBoundTools' | 'getHiddenToolNames' | 'dispatchBridge'> {
  /** Registry 状态变化修订号。 */
  readonly revision: Readonly<Ref<number>>;
}
