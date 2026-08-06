/**
 * @file types.ts
 * @description 页面工具上下文（Tool Context）注册、查询和 Bridge 分发类型。
 */
import type { AIToolContext, AIToolDefinition, AIToolExecutionMetadata, AIToolExecutionResult, AIToolExecutor } from 'types/ai';
import type {
  ChatRendererToolDescriptor,
  ChatRendererToolHistoryPolicy,
  ChatRuntimeBridgeRequestEvent,
  ChatRuntimePageEnvironmentContext,
  ChatToolBinding
} from 'types/chat-runtime';
import type { Ref } from 'vue';
import type { AIToolConfirmationAdapter } from '@/ai/tools/confirmation';

export type { ChatRendererToolDescriptor, ChatRendererToolHistoryPolicy, ChatToolBinding } from 'types/chat-runtime';

/** 页面 Bridge handler 的处理结果。 */
export type ChatBridgeDispatchResult = { readonly handled: true; readonly data: unknown } | { readonly handled: false };

/** 页面 Bridge 请求处理器。 */
export type ChatBridgeHandler = (event: ChatRuntimeBridgeRequestEvent) => Promise<ChatBridgeDispatchResult> | ChatBridgeDispatchResult;

/** 页面写工具提供的确认展示内容。 */
export interface ToolContextConfirmation {
  /** 确认标题。 */
  readonly title: string;
  /** 本次操作说明。 */
  readonly description: string;
  /** 可选的操作前文本。 */
  readonly beforeText?: string;
  /** 可选的操作后文本。 */
  readonly afterText?: string;
  /** 是否允许记住授权。 */
  readonly allowRemember?: boolean;
}

/** 页面工具的 Renderer 展示扩展。 */
export interface ToolContextPresentation {
  /** 工具可见名称。 */
  readonly label: string;
  /** 将工具结果转换为短摘要。 */
  readonly summarize?: (result: AIToolExecutionResult) => string;
}

/** 页面工具使用的可克隆模型定义。 */
export interface ToolContextDefinition extends Omit<AIToolDefinition, 'description'> {
  /** 页面工具描述必须是可克隆字符串。 */
  readonly description: string;
}

/** 页面一次性注册的完整 Renderer 工具。 */
export interface ToolContextTool {
  /** 模型定义、参数 Schema 和风险等级。 */
  readonly definition: ToolContextDefinition;
  /** 在冻结 binding 对应资源上执行工具。 */
  execute(input: unknown, context?: AIToolContext, metadata?: AIToolExecutionMetadata): Promise<AIToolExecutionResult> | AIToolExecutionResult;
  /** 可选的写操作确认内容生成器。 */
  readonly createConfirmation?: (input: unknown) => ToolContextConfirmation;
  /** 可选的 Renderer 展示能力。 */
  readonly presentation?: ToolContextPresentation;
  /** 可选的主进程通用历史策略。 */
  readonly history?: ChatRendererToolHistoryPolicy;
}

/** 页面工具执行所需的通用 Runtime 服务。 */
export interface ToolContextRuntimeServices {
  /** 当前 Runtime 的统一确认适配器。 */
  readonly confirmation: AIToolConfirmationAdapter;
}

/** Registry 内部可注册的页面工具上下文。 */
export interface ToolContextRegistration {
  /** 页面工具资源身份。 */
  readonly binding: ChatToolBinding;
  /** 动态创建当前资源工具。 */
  readonly getTools: () => ToolContextTool[];
  /** 动态读取当前资源的轻量环境上下文。 */
  readonly getEnvironmentContext?: () => ChatRuntimePageEnvironmentContext | undefined;
  /** 需要隐藏的应用级工具名称。 */
  readonly hiddenToolNames: readonly string[];
  /** 按 Bridge kind 索引的处理器。 */
  readonly appBridgeHandlers?: Readonly<Record<string, ChatBridgeHandler>>;
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
  getBoundTools(binding: ChatToolBinding, services: ToolContextRuntimeServices): AIToolExecutor[];
  /** 按 binding 获取隐藏工具名称。 */
  getHiddenToolNames(binding: ChatToolBinding): readonly string[];
  /** 按 binding 获取 Renderer 展示能力。 */
  getPresentation(binding: ChatToolBinding, toolName: string): ToolContextPresentation | undefined;
  /** 仅在所有已注册页面的同名工具展示一致时返回展示能力。 */
  getPresentationByTool(toolName: string): ToolContextPresentation | undefined;
  /** 按 binding 获取可克隆 Renderer 工具描述符。 */
  getRendererTools(binding: ChatToolBinding): readonly ChatRendererToolDescriptor[];
  /** 按 binding 获取页面注册的轻量环境上下文。 */
  getEnvironmentContext(binding: ChatToolBinding): ChatRuntimePageEnvironmentContext | undefined;
  /** 按 binding 分发应用级 Bridge。 */
  dispatchAppBridge(binding: ChatToolBinding, event: ChatRuntimeBridgeRequestEvent): Promise<ChatBridgeDispatchResult>;
  /** 订阅 Registry 有效状态变化。 */
  subscribe(listener: () => void): () => void;
  /** 清空 Registry，仅供应用销毁与测试隔离。 */
  clear(): void;
}

/** 页面工具上下文注册 Hook 选项。 */
export interface ChatContextProviderOptions {
  /** 页面提供方命名空间。 */
  readonly providerId: string;
  /** 当前资源稳定标识。 */
  readonly resourceId: Readonly<Ref<string>>;
  /** 当前资源是否可以提供能力。 */
  readonly available: Readonly<Ref<boolean>>;
  /** 当前页面是否激活。 */
  readonly active: Readonly<Ref<boolean>>;
  /** 动态创建当前资源工具。 */
  readonly getTools: () => ToolContextTool[];
  /** 动态读取当前资源的轻量环境上下文。 */
  readonly getEnvironmentContext?: () => ChatRuntimePageEnvironmentContext | undefined;
  /** 需要隐藏的应用级工具名称。 */
  readonly hiddenToolNames?: readonly string[];
  /** 页面 Bridge handlers。 */
  readonly appBridgeHandlers?: Readonly<Record<string, ChatBridgeHandler>>;
}

/** BChat 消费的通用页面工具能力。 */
export interface ActiveChatContext
  extends Pick<
    ToolContextRegistry,
    | 'getActiveBinding'
    | 'getBoundTools'
    | 'getHiddenToolNames'
    | 'getPresentation'
    | 'getPresentationByTool'
    | 'getRendererTools'
    | 'getEnvironmentContext'
    | 'dispatchAppBridge'
  > {
  /** Registry 状态变化修订号。 */
  readonly revision: Readonly<Ref<number>>;
}
