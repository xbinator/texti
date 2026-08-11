/**
 * @file chat-runtime.d.ts
 * @description Shared chat runtime command and event types.
 */
import type {
  AIMCPRequestConfig,
  AIServiceError,
  AITavilyRuntimeConfig,
  AIToolExecutionError,
  AIToolExecutionResult,
  AIToolGrantScope,
  AIToolRiskLevel,
  AITransportTool,
  AIUsage,
  ChatToolExternalWait,
  ChatToolProgressSnapshot
} from './ai';
import type {
  AIUserChoiceAnswerData,
  ChatPendingInteraction,
  ChatMessageConfirmationCustomInputConfig,
  ChatMessageFilePartInput,
  ChatMessagePart,
  ChatMessageRecord,
  ChatMessageSkillReferencePart,
  ChatMessageTextPart,
  ChatMessageWidgetResultPart
} from './chat';

/** Runtime event channel names emitted from main process to renderer. */
export type ChatRuntimeEventName =
  | 'chat:runtime:message-created'
  | 'chat:runtime:message-updated'
  | 'chat:runtime:message-delta'
  | 'chat:runtime:message-deleted'
  | 'chat:runtime:context-usage-updated'
  | 'chat:runtime:tool-request'
  | 'chat:runtime:tool-cancelled'
  | 'chat:runtime:confirmation-requested'
  | 'chat:runtime:bridge-requested'
  | 'chat:runtime:error'
  | 'chat:runtime:complete';

/** Runtime command result wrapper. */
export interface ChatRuntimeHandlerResult<T = void> {
  /** Whether the command succeeded. */
  ok: boolean;
  /** Command data when successful. */
  data?: T;
  /** Error message when unsuccessful. */
  error?: string;
  /** Stable error code for UI handling. */
  code?: string;
}

/** Renderer context snapshot sent with runtime commands. */
export interface ChatRuntimeClientSnapshot {
  /** Active document snapshot available to main process. */
  document?: {
    /** Document id. */
    id: string;
    /** Visible title. */
    title: string;
    /** Disk path when saved. */
    path: string | null;
    /** Virtual locator for unsaved documents. */
    locator?: string;
    /** Current document content. */
    content: string;
    /** Current selection snapshot. */
    selection?: {
      /** Selection start offset. */
      from: number;
      /** Selection end offset. */
      to: number;
      /** Selected text. */
      text: string;
    } | null;
  };
}

/** Cloneable page tool identity retained by one ChatRuntime. */
export interface ChatToolBinding {
  /** Stable provider namespace. */
  readonly providerId: string;
  /** Stable resource identity inside the provider. */
  readonly resourceId: string;
}

/** Renderer 工具的声明式历史投影策略。 */
export interface ChatRendererToolHistoryPolicy {
  /** 完整保留，或只保留该工具最新一次完整结果。 */
  readonly mode: 'keep' | 'latest-only';
  /** 旧结果被裁剪后的稳定说明。 */
  readonly placeholder?: string;
  /** 工具输入中需要从模型历史移除的自有属性路径。 */
  readonly redactInputPaths?: readonly string[];
}

/** Runtime 冻结的 Renderer 工具能力。 */
export interface ChatRendererToolDescriptor {
  /** 冻结的工具名称。 */
  readonly name: string;
  /** 可选的通用历史投影策略。 */
  readonly history?: ChatRendererToolHistoryPolicy;
}

/** Cloneable renderer capability identity retained by the main-process runtime. */
export interface ChatRuntimeCapabilityDescriptor {
  /** Renderer tools exposed when the runtime started. */
  readonly rendererTools: readonly ChatRendererToolDescriptor[];
  /** Workspace root captured when renderer tool executors were registered. */
  workspaceRoot?: string;
  /** Page tool resource captured when the runtime started. */
  toolContext?: ChatToolBinding;
}

/** Renderer message snapshot accepted by runtime continuation commands. */
export type ChatRuntimeMessageSnapshot = Omit<ChatMessageRecord, 'sessionId'> & {
  /** Session id may be absent in renderer-only BChat messages. */
  sessionId?: string;
};

/** Skill 内容在单个 Runtime 生命周期内使用的只读快照。 */
export interface ChatRuntimeSkillSnapshot {
  /** Skill frontmatter 名称。 */
  readonly name: string;
  /** Skill 当前解析内容。 */
  readonly content: string;
  /** 完整 SKILL.md 的内容版本。 */
  readonly contentHash: string;
  /** Skill 来源文件路径。 */
  readonly filePath: string;
}

/** 单个 Runtime 生命周期内的显式 Skill 上下文。 */
export interface ChatRuntimeSkillContext {
  /** 接收显式 Skill 内容的用户消息 ID。 */
  readonly targetMessageId: string;
  /** 按首次引用顺序冻结的 Skill 内容快照。 */
  readonly snapshots: ChatRuntimeSkillSnapshot[];
}

/** Runtime 注入的用户记忆上下文。 */
export interface ChatRuntimeMemoryContext {
  /** 接收记忆上下文的用户消息 ID。 */
  readonly targetMessageId: string;
  /** 已按预算裁剪的记忆文本。 */
  readonly content: string;
}

/** Runtime 当前环境元信息。 */
export interface ChatRuntimeEnvironmentMetadata {
  /** 当前操作系统名称。 */
  readonly operatingSystem: string;
  /** 当前 IANA 时区。 */
  readonly timezone: string;
  /** 当前本地日期，格式为 YYYY-MM-DD。 */
  readonly currentDate: string;
  /** 当前本地具体时间，格式为 YYYY-MM-DD HH:mm:ss。 */
  readonly currentTime: string;
  /** 当前主工作目录路径。 */
  readonly workspaceRoot?: string;
}

/** Runtime 环境上下文片段。 */
export interface ChatRuntimeEnvironmentSection {
  /** XML 安全的 section 标签名。 */
  readonly tag: string;
  /** 已由页面按自身语义组装、等待 Runtime 统一转义的文本行。 */
  readonly lines: readonly string[];
}

/** 页面可注册的当前环境片段。 */
export interface ChatRuntimePageEnvironmentContext {
  /** 页面自描述的环境 section。 */
  readonly sections?: readonly ChatRuntimeEnvironmentSection[];
}

/** Runtime 注入的当前环境上下文。 */
export interface ChatRuntimeEnvironmentContext {
  /** 接收环境上下文的用户消息 ID。 */
  readonly targetMessageId: string;
  /** 当前环境元信息。 */
  readonly metadata: ChatRuntimeEnvironmentMetadata;
  /** 页面自描述的环境 section。 */
  readonly sections?: readonly ChatRuntimeEnvironmentSection[];
}

/** Renderer 传递给主进程的临时 Runtime 上下文容器。 */
export interface ChatRuntimeContext {
  /** 当前用户轮次使用的记忆上下文。 */
  readonly memory?: ChatRuntimeMemoryContext;
  /** 当前用户轮次使用的环境上下文。 */
  readonly environment?: ChatRuntimeEnvironmentContext;
  /** 当前用户轮次显式选择的 Skill 上下文。 */
  readonly skill?: ChatRuntimeSkillContext;
}

/** Renderer-created user input parts accepted by runtime send commands. */
export type ChatRuntimeUserInputPart = ChatMessageTextPart | ChatMessageFilePartInput | ChatMessageSkillReferencePart | ChatMessageWidgetResultPart;

/** Renderer-selected model identity frozen for one Runtime. */
export interface ChatRuntimeModelSelection {
  /** Provider stable identifier. */
  readonly providerId: string;
  /** Model identifier within the provider. */
  readonly modelId: string;
}

/** Immutable lineage and routing address of one concrete Runtime instance. */
export interface ChatRuntimeAddress {
  /** Owning chat session. */
  sessionId: string;
  /** Stable turn shared by Runtime continuations. */
  turnId: string;
  /** Stable actor identity. */
  agentId: string;
  /** Concrete replaceable Runtime identity. */
  runtimeId: string;
  /** Stable parent actor when this Runtime belongs to a Child. */
  parentAgentId?: string;
  /** Runtime that created this delegated execution. */
  parentRuntimeId?: string;
  /** Root Runtime of the Turn tree. */
  rootRuntimeId: string;
  /** Previous Runtime of the same actor when this is a continuation. */
  continuationOfRuntimeId?: string;
}

/** Send command input. */
export interface ChatRuntimeSendInput extends ChatRuntimeAddress {
  /** Renderer chat panel id. */
  clientId: string;
  /** Model selected for this Runtime; falls back to the global chat model when omitted. */
  model?: ChatRuntimeModelSelection;
  /** User message text. */
  content: string;
  /** Ordered user input parts parsed by renderer before file snapshots are materialized. */
  parts?: ChatRuntimeUserInputPart[];
  /** Renderer-created user message id, used to avoid duplicate local/runtime messages. */
  userMessageId?: string;
  /** Renderer-created user message timestamp. */
  userMessageCreatedAt?: string;
  /** Current model context window for usage estimation. */
  contextWindow?: number;
  /** System prompt context owned by renderer state until main process owns memory. */
  system?: string;
  /** Current workspace root used by main-process file tools. */
  workspaceRoot?: string;
  /** Transport tool schemas executable by main process AI runtime. */
  tools?: AITransportTool[];
  /** Current enabled Skill content versions used to invalidate stale history. */
  skillContentHashes?: Record<string, string>;
  /** Temporary context applied only while this Runtime is active. */
  runtimeContext?: ChatRuntimeContext;
  /** Tavily runtime config executable in main process. */
  tavily?: AITavilyRuntimeConfig;
  /** MCP runtime config executable in main process. */
  mcp?: AIMCPRequestConfig;
  /** Optional file/image attachments stored in the normal chat message shape. */
  files?: ChatMessageRecord['files'];
  /** Renderer-side context snapshot captured at send time. */
  snapshot?: ChatRuntimeClientSnapshot;
  /** Renderer capability identity used to rebuild routing after renderer reload. */
  capabilities?: ChatRuntimeCapabilityDescriptor;
}

/** Continue command input for resuming a paused assistant turn. */
export interface ChatRuntimeContinueInput extends ChatRuntimeAddress {
  /** Renderer chat panel id. */
  clientId: string;
  /** Model selected for this Runtime; falls back to the global chat model when omitted. */
  model?: ChatRuntimeModelSelection;
  /** Current model context window for usage estimation. */
  contextWindow?: number;
  /** System prompt context owned by renderer state until main process owns memory. */
  system?: string;
  /** Current workspace root used by main-process file tools. */
  workspaceRoot?: string;
  /** Transport tool schemas executable by main process AI runtime. */
  tools?: AITransportTool[];
  /** Current enabled Skill content versions used to invalidate stale history. */
  skillContentHashes?: Record<string, string>;
  /** Temporary context applied only while this Runtime is active. */
  runtimeContext?: ChatRuntimeContext;
  /** Tavily runtime config executable in main process. */
  tavily?: AITavilyRuntimeConfig;
  /** MCP runtime config executable in main process. */
  mcp?: AIMCPRequestConfig;
  /** Renderer-updated message snapshot to continue from. */
  messages: ChatRuntimeMessageSnapshot[];
  /** Renderer capability identity used to rebuild routing after renderer reload. */
  capabilities?: ChatRuntimeCapabilityDescriptor;
}

/** Manual context compaction command input. */
export interface ChatRuntimeCompactInput extends ChatRuntimeAddress {
  /** Renderer chat panel id. */
  clientId: string;
  /** Model selected for this Runtime; falls back to the global chat model when omitted. */
  model?: ChatRuntimeModelSelection;
  /** Current model context window used for budgeting. */
  contextWindow?: number;
  /** Current system prompt context. */
  system?: string;
  /** Current workspace root used by main-process file tools. */
  workspaceRoot?: string;
  /** Transport tool schemas included in context budgeting. */
  tools?: AITransportTool[];
  /** Current enabled Skill content versions. */
  skillContentHashes?: Record<string, string>;
  /** Temporary context, normally absent for manual compaction. */
  runtimeContext?: ChatRuntimeContext;
  /** Renderer capability identity captured at compaction start. */
  capabilities?: ChatRuntimeCapabilityDescriptor;
}

/** Submit-user-choice command input for resuming an awaiting assistant turn from persisted runtime messages. */
export interface ChatRuntimeSubmitUserChoiceInput extends ChatRuntimeAddress {
  /** Renderer chat panel id. */
  clientId: string;
  /** Model selected for this Runtime; falls back to the global chat model when omitted. */
  model?: ChatRuntimeModelSelection;
  /** Current model context window for usage estimation. */
  contextWindow?: number;
  /** System prompt context owned by renderer state until main process owns memory. */
  system?: string;
  /** Current workspace root used by main-process file tools. */
  workspaceRoot?: string;
  /** Transport tool schemas executable by main process AI runtime. */
  tools?: AITransportTool[];
  /** Current enabled Skill content versions used to invalidate stale history. */
  skillContentHashes?: Record<string, string>;
  /** Temporary context restored for the resumed user turn. */
  runtimeContext?: ChatRuntimeContext;
  /** Tavily runtime config executable in main process. */
  tavily?: AITavilyRuntimeConfig;
  /** MCP runtime config executable in main process. */
  mcp?: AIMCPRequestConfig;
  /** User choice answer submitted by renderer UI. */
  answer: AIUserChoiceAnswerData;
  /** Renderer capability identity used to rebuild routing after renderer reload. */
  capabilities?: ChatRuntimeCapabilityDescriptor;
}

/** Runtime confirmation decision submitted by renderer UI. */
export type ChatRuntimeConfirmationDecision =
  | { approved: false }
  | {
      /** Whether the operation is approved. */
      approved: true;
      /** Optional permission grant scope. */
      grantScope?: AIToolGrantScope;
    };

/** Runtime confirmation request shown by renderer UI. */
export interface ChatRuntimeConfirmationRequest {
  /** Related tool call id. */
  toolCallId?: string;
  /** Tool name. */
  toolName: string;
  /** Confirmation title. */
  title: string;
  /** Confirmation description. */
  description: string;
  /** Operation risk level. */
  riskLevel: AIToolRiskLevel;
  /** Text before the operation. */
  beforeText?: string;
  /** Text after the operation. */
  afterText?: string;
  /** Whether renderer may offer remembered approvals. */
  allowRemember?: boolean;
  /** Available remembered approval scopes. */
  rememberScopes?: AIToolGrantScope[];
  /** Custom input config associated with the confirmation UI. */
  customInput?: ChatMessageConfirmationCustomInputConfig;
}

/** Submit-confirmation command input. */
export interface ChatRuntimeSubmitConfirmationInput {
  /** Runtime id waiting for this confirmation. */
  runtimeId: string;
  /** Confirmation request id. */
  confirmationId: string;
  /** Renderer confirmation decision. */
  decision: ChatRuntimeConfirmationDecision;
}

/** Runtime renderer bridge result. */
export type ChatRuntimeBridgeResult =
  | {
      /** Bridge request succeeded. */
      status: 'success';
      /** JSON-cloneable bridge payload. */
      data: unknown;
    }
  | {
      /** Bridge request failed. */
      status: 'failure';
      /** Failure details. */
      error: AIToolExecutionError;
    };

/** Submit-bridge-response command input. */
export interface ChatRuntimeBridgeResponseInput {
  /** Runtime id waiting for this bridge response. */
  runtimeId: string;
  /** Bridge request id. */
  requestId: string;
  /** Bridge result. */
  result: ChatRuntimeBridgeResult;
}

/** Abort command input. */
export interface ChatRuntimeAbortInput {
  /** Runtime id to abort. */
  runtimeId: string;
}

/** Persisted message mutations produced by aborting a Runtime. */
export interface ChatRuntimeAbortResult {
  /** Empty assistant draft removed during abort finalization. */
  deletedMessageId?: string;
  /** Partial assistant response finalized during abort. */
  assistantMessage?: ChatMessageRecord;
  /** Interrupt marker persisted after abort finalization. */
  interruptMessage?: ChatMessageRecord;
}

/** Renderer local tool result submission input. */
export interface ChatRuntimeSubmitToolResultInput {
  /** Runtime id waiting for this result. */
  runtimeId: string;
  /** Tool call id. */
  toolCallId: string;
  /** Tool execution result. */
  result: AIToolExecutionResult;
}

/** 执行器可提交的非终态工具活动。 */
export type ChatRuntimeToolActivity =
  | { kind: 'started' }
  | { kind: 'heartbeat' }
  | { kind: 'progress'; progress: Omit<ChatToolProgressSnapshot, 'updatedAt'> }
  | { kind: 'waiting_user'; prompt: string }
  | { kind: 'waiting_external'; wait: ChatToolExternalWait }
  | { kind: 'resumed' };

/** Renderer 到主进程的工具活动事件。 */
export interface ChatRuntimeSubmitToolActivityInput {
  /** 所属 Runtime。 */
  runtimeId: string;
  /** 所属工具调用。 */
  toolCallId: string;
  /** 单执行器严格递增序号。 */
  sequence: number;
  /** 执行器观察到事件的墙钟时间，仅用于诊断。 */
  occurredAt: number;
  /** 不包含终态的活动。 */
  activity: ChatRuntimeToolActivity;
}

/** 用户针对单个在途工具的控制。 */
export interface ChatRuntimeControlToolInput {
  /** 所属 Runtime。 */
  runtimeId: string;
  /** 所属工具调用。 */
  toolCallId: string;
  /** 继续等待或停止。 */
  action: 'continue_waiting' | 'stop';
}

/** Renderer message part submission input. */
export interface ChatRuntimeSubmitMessagePartInput {
  /** Runtime id owning the active assistant message. */
  runtimeId: string;
  /** Active assistant message id. */
  messageId: string;
  /** Next message part snapshot. */
  part: ChatMessagePart;
}

/** Auto-name command input. */
export interface ChatRuntimeAutoNameInput {
  /** Session id to rename. */
  sessionId: string;
  /** First user message content. */
  userMessage: string;
  /** First assistant response content. */
  aiResponse: string;
}

/** Auto-name command result. */
export type ChatRuntimeAutoNameResult =
  | {
      /** Naming succeeded and title has been persisted. */
      status: 'success';
      /** Persisted title. */
      title: string;
    }
  | {
      /** Naming was skipped before model invocation or persistence. */
      status: 'skipped';
      /** Stable skip reason. */
      reason: 'no_model_config' | 'empty_title';
    }
  | {
      /** Naming failed after attempting work. */
      status: 'failed';
      /** Error description. */
      errorMessage: string;
    };

/** Runtime state returned after starting a command. */
export interface ChatRuntimeStartResult {
  /** Runtime id created by main process. */
  runtimeId: string;
  /** Session id owned by the runtime. */
  sessionId: string;
  /** Whether the command completed synchronously without leaving an active runtime. */
  completed?: boolean;
}

/** Read-only context usage estimate input for an idle session. */
export interface ChatRuntimeEstimateContextInput {
  /** Session whose persisted messages should be projected. */
  sessionId: string;
  /** Maximum context window for the currently selected model. */
  contextWindow: number;
}

/** Common event envelope fields. */
export interface ChatRuntimeEventBase extends ChatRuntimeAddress {
  /** Renderer client id. */
  clientId: string;
}

/** Message event emitted when a message is created or updated. */
export interface ChatRuntimeMessageEvent extends ChatRuntimeEventBase {
  /** Message payload. */
  message: ChatMessageRecord;
  /** 当前 Assistant 完整检查点的 Runtime 修订号。 */
  revision?: number;
}

/** Assistant 高频追加型消息变更。 */
export type ChatRuntimeMessageMutation =
  | {
      /** 追加 Assistant 文本。 */
      kind: 'append-text';
      /** 目标文本 Part ID。 */
      partId: string;
      /** 文本增量。 */
      text: string;
    }
  | {
      /** 追加 Assistant 思考文本。 */
      kind: 'append-reasoning';
      /** 目标思考 Part ID。 */
      partId: string;
      /** 思考增量。 */
      text: string;
    }
  | {
      /** 追加流式工具输入文本。 */
      kind: 'append-tool-input';
      /** 目标工具调用 ID。 */
      toolCallId: string;
      /** 工具输入文本增量。 */
      text: string;
    };

/** 不含 Runtime 地址的 Assistant 实时增量。 */
export interface ChatRuntimeMessageDelta {
  /** Assistant 消息 ID。 */
  messageId: string;
  /** 当前批次之前的修订号。 */
  baseRevision: number;
  /** 当前批次之后的修订号。 */
  revision: number;
  /** 有序追加变更。 */
  mutations: ChatRuntimeMessageMutation[];
}

/** 带完整 Runtime 地址的 Assistant 实时增量事件。 */
export interface ChatRuntimeMessageDeltaEvent extends ChatRuntimeEventBase, ChatRuntimeMessageDelta {}

/** Message event emitted when a runtime-owned message is deleted. */
export interface ChatRuntimeMessageDeletedEvent extends ChatRuntimeEventBase {
  /** Deleted message id. */
  messageId: string;
}

/** Current model-input context usage snapshot. */
export interface ChatRuntimeContextUsageSnapshot {
  /** Estimated tokens in the current model request projection. */
  usedTokens: number;
  /** Maximum context window captured for the selected model. */
  contextWindow: number;
}

/** Context usage event emitted after the runtime projects model input. */
export interface ChatRuntimeContextUsageEvent extends ChatRuntimeEventBase {
  /** Context usage snapshot for the addressed session. */
  snapshot: ChatRuntimeContextUsageSnapshot;
}

/** Runtime tool execution request sent to renderer. */
export interface ChatRuntimeToolRequestEvent extends ChatRuntimeEventBase {
  /** Tool call id. */
  toolCallId: string;
  /** Tool name. */
  toolName: string;
  /** Tool input. */
  input: unknown;
}

/** Runtime renderer tool cancellation sent to renderer. */
export interface ChatRuntimeToolCancelledEvent extends ChatRuntimeEventBase {
  /** Tool call id to abort locally. */
  toolCallId: string;
}

/** Runtime confirmation request sent to renderer. */
export interface ChatRuntimeConfirmationRequestEvent extends ChatRuntimeEventBase {
  /** Confirmation request id. */
  confirmationId: string;
  /** Related tool call id. */
  toolCallId?: string;
  /** Confirmation request shown by UI. */
  request: ChatRuntimeConfirmationRequest;
}

/** Runtime renderer bridge request sent to renderer. */
export interface ChatRuntimeBridgeRequestEvent extends ChatRuntimeEventBase {
  /** Bridge request id. */
  requestId: string;
  /** Related tool call id. */
  toolCallId?: string;
  /** Bridge request kind. */
  kind: string;
  /** JSON-cloneable bridge request payload. */
  payload?: unknown;
}

/** Recoverable renderer request retained while the main-process runtime waits. */
export type ChatRuntimeRecoveryPendingRequest =
  | { type: 'tool'; event: ChatRuntimeToolRequestEvent }
  | { type: 'confirmation'; event: ChatRuntimeConfirmationRequestEvent }
  | { type: 'bridge'; event: ChatRuntimeBridgeRequestEvent };

/** Cloneable active-runtime projection used to rebuild renderer actor state. */
export interface ChatRuntimeRecoverySnapshot extends ChatRuntimeEventBase {
  /** Current runtime execution phase. */
  phase: 'streaming' | 'compacting';
  /** Main-process runtime creation timestamp. */
  createdAt: number;
  /** Renderer capability identity captured at runtime start. */
  capabilities?: ChatRuntimeCapabilityDescriptor;
  /** Renderer requests that were emitted but not answered. */
  pendingRequests: ChatRuntimeRecoveryPendingRequest[];
}

/** Runtime error event. */
export interface ChatRuntimeErrorEvent extends ChatRuntimeEventBase {
  /** Normalized AI or runtime error. */
  error: AIServiceError;
  /** Main failed to persist the terminal assistant projection and Renderer should retry it. */
  messagePersistenceFailed?: boolean;
}

/** Runtime 完成原因。 */
export type ChatRuntimeCompletionReason = 'completed' | 'awaiting_user_input' | 'waiting_children';

/** Runtime complete event. */
export type ChatRuntimeCompleteEvent = ChatRuntimeEventBase &
  (
    | {
        /** Runtime 正常完成。 */
        reason: Extract<ChatRuntimeCompletionReason, 'completed'>;
        /** 正常完成不携带待处理交互。 */
        interaction?: never;
        /** Optional usage reported by provider. */
        usage?: AIUsage;
      }
    | {
        /** Runtime 已释放资源并暂停等待用户输入。 */
        reason: Extract<ChatRuntimeCompletionReason, 'awaiting_user_input'>;
        /** 等待中的持久化交互。 */
        interaction: ChatPendingInteraction;
        /** Optional usage reported by provider. */
        usage?: AIUsage;
      }
    | {
        /** Runtime A 已持久化委派并释放普通写锁。 */
        reason: Extract<ChatRuntimeCompletionReason, 'waiting_children'>;
        /** 持有逻辑 Turn fence 的 Checkpoint。 */
        checkpointId: string;
        /** Child 等待态不携带用户交互。 */
        interaction?: never;
        /** Optional usage reported by provider. */
        usage?: AIUsage;
      }
  );

/** Runtime event payload map. */
export interface ChatRuntimeEventMap {
  'chat:runtime:message-created': ChatRuntimeMessageEvent;
  'chat:runtime:message-updated': ChatRuntimeMessageEvent;
  'chat:runtime:message-delta': ChatRuntimeMessageDeltaEvent;
  'chat:runtime:message-deleted': ChatRuntimeMessageDeletedEvent;
  'chat:runtime:context-usage-updated': ChatRuntimeContextUsageEvent;
  'chat:runtime:tool-request': ChatRuntimeToolRequestEvent;
  'chat:runtime:tool-cancelled': ChatRuntimeToolCancelledEvent;
  'chat:runtime:confirmation-requested': ChatRuntimeConfirmationRequestEvent;
  'chat:runtime:bridge-requested': ChatRuntimeBridgeRequestEvent;
  'chat:runtime:error': ChatRuntimeErrorEvent;
  'chat:runtime:complete': ChatRuntimeCompleteEvent;
}
