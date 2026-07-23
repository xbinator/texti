/**
 * @file types.mts
 * @description ChatRuntime 主进程内部类型。
 */
import type { ArtifactRegistry } from './compaction/artifact-registry.mjs';
import type { CompactionExecutor } from './compaction/executor.mjs';
import type { SummaryGeneratorDependencies } from './compaction/summary-generator.mjs';
import type { RuntimeLockRegistry } from './infrastructure/locks.mjs';
import type { RuntimeFilePartMaterializer } from './messages/file-parts.mjs';
import type { ChatModelResolution } from './model/resolver.mjs';
import type { ToolStepSnapshot } from '../../ai/tool-loop-policy.mjs';
import type {
  AICreateOptions,
  AIInvokeResult,
  AIMCPRequestConfig,
  AIRequestOptions,
  AIServiceError,
  AITavilyRuntimeConfig,
  AIToolExecutionResult,
  AITransportTool,
  AIUsage
} from 'types/ai';
import type { ChatMessageRecord } from 'types/chat';
import type {
  ChatRuntimeAddress,
  ChatRuntimeCapabilityDescriptor,
  ChatRuntimeContext,
  ChatRuntimeEventBase,
  ChatRuntimeEventMap,
  ChatRuntimeModelSelection
} from 'types/chat-runtime';

/** Runtime 生命周期状态。 */
export type ChatRuntimeStatus = 'running' | 'completed';

/** Runtime 当前执行阶段。 */
export type ChatRuntimePhase = 'streaming' | 'compacting';

/** 活跃 runtime 状态。 */
export interface ActiveChatRuntime extends ChatRuntimeAddress {
  /** Renderer client id。 */
  clientId: string;
  /** Renderer 在本 Runtime 启动时冻结的模型标识。 */
  model?: ChatRuntimeModelSelection;
  /** Renderer 重建能力所需的可克隆描述符。 */
  capabilities?: ChatRuntimeCapabilityDescriptor;
  /** 当前模型上下文窗口。 */
  contextWindow?: number;
  /** 系统提示上下文。 */
  system?: string;
  /** 当前工作区根目录。 */
  workspaceRoot?: string;
  /** 传输工具 schema。 */
  tools?: AITransportTool[];
  /** 当前启用 Skill 的内容版本。 */
  skillContentHashes?: Record<string, string>;
  /** 当前生命周期内生效的临时 Runtime 上下文。 */
  runtimeContext?: ChatRuntimeContext;
  /** Tavily 运行时配置。 */
  tavily?: AITavilyRuntimeConfig;
  /** MCP 运行时配置。 */
  mcp?: AIMCPRequestConfig;
  /** 当前生命周期状态。 */
  status: ChatRuntimeStatus;
  /** 当前 Runtime 根据 checkpoint 与文件工具结果维护的 artifact 身份映射。 */
  artifactRegistry?: ArtifactRegistry;
  /** 当前模型请求边界冻结的模型解析结果，不进入持久化或 recovery snapshot。 */
  resolvedModel?: ChatModelResolution;
  /** 当前模型步骤产生的工具调用快照，仅用于进程内循环策略。 */
  currentToolStep?: ToolStepSnapshot;
  /** 当前执行阶段。 */
  phase: ChatRuntimePhase;
  /** 当前压缩阶段的触发来源，仅保留在活跃 Runtime 内存中。 */
  compactionTrigger?: 'automatic' | 'manual';
  /** 后续模型流和工具执行共用的中止控制器。 */
  abortController: AbortController;
  /** 创建时间戳。 */
  createdAt: number;
  /** 当前任务级执行时钟暂停开始时间戳。 */
  taskPausedAt?: number;
  /** 当前任务级执行时钟累计暂停时长。 */
  taskPausedDurationMs?: number;
  /** 当前任务级执行时钟暂停嵌套深度。 */
  taskPauseDepth?: number;
}

/**
 * 从活跃 Runtime 提取完整事件地址。
 * @param runtime - 活跃 Runtime
 * @returns 事件共享地址
 */
export function createRuntimeEventBase(runtime: ActiveChatRuntime): ChatRuntimeEventBase {
  return {
    sessionId: runtime.sessionId,
    turnId: runtime.turnId,
    agentId: runtime.agentId,
    runtimeId: runtime.runtimeId,
    parentAgentId: runtime.parentAgentId,
    parentRuntimeId: runtime.parentRuntimeId,
    rootRuntimeId: runtime.rootRuntimeId,
    continuationOfRuntimeId: runtime.continuationOfRuntimeId,
    clientId: runtime.clientId
  };
}

/** Runtime 事件发送函数。 */
export type ChatRuntimeEventEmitter = <TName extends keyof ChatRuntimeEventMap>(name: TName, payload: ChatRuntimeEventMap[TName]) => void;

/** Runtime 创建消息类型。 */
export type ChatRuntimeMessageKind = 'user' | 'assistant' | 'interrupt';

/** Runtime 消息写入器。 */
export interface ChatRuntimeMessageWriter {
  /**
   * 新增聊天消息。
   * @param message - 聊天消息
   */
  addMessage(message: ChatMessageRecord): Promise<void> | void;
  /**
   * 更新聊天消息。
   * @param message - 聊天消息
   */
  updateMessage(message: ChatMessageRecord): Promise<void> | void;
  /**
   * 删除聊天消息。
   * @param sessionId - 会话 ID
   * @param messageId - 消息 ID
   */
  deleteMessage?(sessionId: string, messageId: string): Promise<void> | void;
}

/** Runtime 消息读取器。 */
export interface ChatRuntimeMessageReader {
  /**
   * 读取会话消息。
   * @param sessionId - 会话 ID
   * @returns 会话消息
   */
  getMessages(sessionId: string): Promise<ChatMessageRecord[]> | ChatMessageRecord[];
}

/** Runtime 流式执行输入。 */
export interface ChatRuntimeStreamExecutorInput {
  /** runtime 状态。 */
  runtime: ActiveChatRuntime;
  /** 当前 runtime 可用的源消息上下文。 */
  sourceMessages?: ChatMessageRecord[];
  /** 用户消息。 */
  userMessage: ChatMessageRecord;
  /** assistant 草稿消息。 */
  assistantMessage: ChatMessageRecord;
  /** 是否强制当前模型调用生成最终回答。 */
  forceFinal?: boolean;
  /** 当前用户任务剩余的总超时时间。 */
  totalTimeoutMs?: number;
}

/** Provider 边界捕获的单个延迟工具调用。 */
export interface ChatRuntimeDeferredToolCall {
  /** 原始工具调用 ID。 */
  toolCallId: string;
  /** 当前基础阶段唯一允许的委派工具。 */
  toolName: 'delegate_task';
  /** 已通过基础契约校验的工具输入。 */
  input: unknown;
  /** 工具参数的稳定 SHA-256。 */
  argumentsHash: string;
  /** 可选 Provider 元数据稳定 SHA-256。 */
  providerMetadataHash?: string;
}

/** 结束 Runtime A 且不产生模型可见工具结果的内部控制结果。 */
export interface ChatRuntimeDelegationSuspension {
  /** 同一模型步骤内按 Provider 顺序捕获的延迟调用。 */
  toolCalls: readonly ChatRuntimeDeferredToolCall[];
}

/** Runtime 交给 Coordinator 原子 prepare 边界的完整输入。 */
export interface ChatRuntimeDelegationPrepareInput {
  /** Runtime 在调用同步 prepare 边界前预分配的 Checkpoint ID。 */
  checkpointId: string;
  /** 产生委派调用的 Primary Runtime。 */
  runtime: ActiveChatRuntime;
  /** 含完整延迟工具片段的 working assistant 快照。 */
  assistantMessage: ChatMessageRecord;
  /** 不进入模型 output 的延迟调用控制数据。 */
  suspension: ChatRuntimeDelegationSuspension;
}

/** Coordinator 同步完成委派 prepare 后返回的精确确认。 */
export interface ChatRuntimeDelegationPrepareAck {
  /** 完整原子 prepare 已在当前调用栈内提交。 */
  readonly prepared: true;
}

/**
 * Coordinator 原子 prepare 边界。
 * 实现必须通过 Agent Store 的同步 persistAssistant 回调，在一个事务内提交
 * 完整 assistant、Tasks、Checkpoint、Events 和 Outbox。
 */
export type ChatRuntimeDelegationPreparer = (input: ChatRuntimeDelegationPrepareInput) => ChatRuntimeDelegationPrepareAck;

/** Runtime 流式执行结果。 */
export interface ChatRuntimeStreamExecutorResult {
  /** 最后一个模型步骤的 usage。 */
  stepUsage?: AIUsage;
  /** 本次 SDK 调用所有模型步骤的累计 usage。 */
  totalUsage?: AIUsage;
  /** 是否应带当前 assistant 工具结果继续同一轮模型调用。 */
  shouldContinue?: boolean;
  /** 不进入模型 output 的内部委派挂起控制数据。 */
  suspension?: ChatRuntimeDelegationSuspension;
}

/** Renderer 工具执行输入。 */
export interface ChatRuntimeRendererToolExecutionInput {
  /** runtime 状态。 */
  runtime: ActiveChatRuntime;
  /** 工具调用 ID。 */
  toolCallId: string;
  /** 工具名称。 */
  toolName: string;
  /** 工具输入。 */
  input: unknown;
  /** 当前工具调用的组合中止信号。 */
  signal?: AbortSignal;
}

/** Renderer 工具执行函数。 */
export type ChatRuntimeRendererToolExecutor = (input: ChatRuntimeRendererToolExecutionInput) => Promise<AIToolExecutionResult>;

/** 工具执行超时控制器。 */
export interface ChatRuntimeToolTimeoutControls {
  /** 暂停当前工具执行超时计时。 */
  pause: () => void;
  /** 恢复当前工具执行超时计时。 */
  resume: () => void;
}

/** 主进程工具执行输入。 */
export interface ChatRuntimeMainToolExecutionInput {
  /** runtime 状态。 */
  runtime: ActiveChatRuntime;
  /** 工具调用 ID。 */
  toolCallId: string;
  /** 工具名称。 */
  toolName: string;
  /** 工具输入。 */
  input: unknown;
  /** 当前工具调用的组合中止信号。 */
  signal?: AbortSignal;
  /** 当前工具调用的超时控制器，用于等待人工确认时暂停计时。 */
  timeoutControls?: ChatRuntimeToolTimeoutControls;
}

/** 主进程工具执行函数。 */
export type ChatRuntimeMainToolExecutor = (input: ChatRuntimeMainToolExecutionInput) => Promise<AIToolExecutionResult>;

/** Runtime assistant 草稿更新函数。 */
export type ChatRuntimeAssistantUpdater = (message: ChatMessageRecord) => Promise<void>;

/** Runtime 流式执行器。 */
export type ChatRuntimeStreamExecutor = (
  input: ChatRuntimeStreamExecutorInput,
  updateAssistant: ChatRuntimeAssistantUpdater
) => Promise<ChatRuntimeStreamExecutorResult>;

/** Runtime 流式中止函数。 */
export type ChatRuntimeStreamAborter = (runtimeId: string) => Promise<void> | void;

/** Runtime 自动命名模型解析结果。 */
export interface ChatRuntimeAutoNameModelResolution {
  /** AI 服务创建参数。 */
  createOptions: AICreateOptions;
  /** 模型 ID。 */
  modelId: string;
}

/** Runtime 自动命名模型解析函数。 */
export type ChatRuntimeAutoNameModelResolver = () => Promise<ChatRuntimeAutoNameModelResolution | null>;

/** Runtime 自动命名文本生成函数。 */
export type ChatRuntimeAutoNameGenerator = (
  createOptions: AICreateOptions,
  request: AIRequestOptions
) => Promise<[AIServiceError] | [undefined, AIInvokeResult]>;

/** Runtime 服务依赖项。 */
export interface ChatRuntimeServiceDependencies {
  /** 向 renderer 发送 runtime 事件。 */
  emit: ChatRuntimeEventEmitter;
  /** runtime 消息写入器。 */
  messageWriter: ChatRuntimeMessageWriter;
  /** runtime 消息读取器。 */
  messageReader: ChatRuntimeMessageReader;
  /** runtime 流式执行器。 */
  streamExecutor: ChatRuntimeStreamExecutor;
  /** 可选共享 Runtime/Chat resource-scope 锁注册表。 */
  locks?: RuntimeLockRegistry;
  /** 原子提交完整 assistant 与委派事实的 Coordinator prepare 边界。 */
  prepareDelegation?: ChatRuntimeDelegationPreparer;
  /** 解析指定 Runtime 模型，缺失时回退全局默认模型。 */
  resolveModel: (model?: ChatRuntimeModelSelection) => Promise<ChatModelResolution | null>;
  /** 调用结构化上下文摘要模型。 */
  compactionGenerateText: SummaryGeneratorDependencies['generateText'];
  /** 可选的上下文压缩 executor 测试替身。 */
  compactionExecutor?: CompactionExecutor;
  /** 扫描应用重启后遗留 pending checkpoint 的消息。 */
  listPendingCompactionMessages: () => Promise<ChatMessageRecord[]> | ChatMessageRecord[];
  /** 文件 part 固化函数。 */
  materializeFileParts: RuntimeFilePartMaterializer;
  /** runtime 流式中止函数。 */
  streamAbort: ChatRuntimeStreamAborter;
  /** Renderer 本地工具超时时间。 */
  rendererToolTimeoutMs: number;
  /** 创建 runtime 消息 ID。 */
  createMessageId: (kind: ChatRuntimeMessageKind) => string;
  /** 获取当前 ISO 时间。 */
  now: () => string;
  /** 自动命名模型解析函数。 */
  autoNameResolveModel: ChatRuntimeAutoNameModelResolver;
  /** 自动命名文本生成函数。 */
  autoNameGenerateText: ChatRuntimeAutoNameGenerator;
  /** 自动命名标题持久化函数。 */
  autoNameUpdateSessionTitle: (sessionId: string, title: string) => Promise<void> | void;
  /** 测试专用：保持 runtime 打开以验证写入锁。 */
  keepRuntimeOpenForTest?: boolean;
}
