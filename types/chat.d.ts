/**
 * @file chat.d.ts
 * @description 聊天会话、消息与附件类型定义
 */
import type { AIProviderType, AIToolExecutionResult, AIUsage } from './ai';
import type { WidgetSubmitPayload } from './widget';

/**
 * 聊天会话类型
 */
export type ChatSessionType = 'assistant';

/**
 * 聊天消息角色
 */
export type ChatMessageRole = 'user' | 'system' | 'assistant' | 'error' | 'interrupt';

/** 持久化用户交互状态。 */
export type ChatPendingInteractionStatus = 'pending' | 'submitting' | 'resolved' | 'cancelled' | 'failed';

/** 可跨刷新恢复的用户选择交互。 */
export interface ChatPendingInteraction {
  /** 交互类型。 */
  type: 'userChoice';
  /** 当前交互状态。 */
  status: ChatPendingInteractionStatus;
  /** 所属会话 ID。 */
  sessionId: string;
  /** 承载交互的 assistant 消息 ID。 */
  messageId: string;
  /** 产生交互的 Runtime ID。 */
  runtimeId: string;
  /** 产生交互的 Agent ID。 */
  agentId: string;
  /** 工具调用 ID。 */
  toolCallId: string;
  /** Question 业务 ID。 */
  questionId: string;
}

/**
 * 聊天消息附件类型
 */
export type ChatMessageFileType = 'image' | 'document' | 'audio' | 'video' | 'binary';

/**
 * 聊天消息文件引用
 */
export interface ChatMessageFileReference {
  /** 引用唯一标识 */
  id: string;
  /** 引用 token */
  token: string;
  /** 引用对应的文档 ID */
  documentId: string;
  /** 文件名 */
  fileName: string;
  /** 行范围，使用字符串保留原始输入 */
  line: string;
  /** 本地路径，不存在时为 null */
  path: string | null;
  /** 引用快照 ID */
  snapshotId: string;
  /** 引用摘录 */
  excerpt?: string;
}

/**
 * 聊天消息附件
 */
export interface ChatMessageFile {
  /** 文件唯一标识 */
  id: string;
  /** 文件名 */
  name: string;
  /** 文件类型 */
  type: ChatMessageFileType;
  /** MIME 类型 */
  mimeType?: string;
  /** 文件大小（字节） */
  size?: number;
  /** 文件扩展名 */
  extension?: string;
  /** 本地路径 */
  path?: string;
  /** 远程地址 */
  url?: string;
  /** 内容哈希 */
  contentHash?: string;
  /** 图片宽度 */
  width?: number;
  /** 图片高度 */
  height?: number;
}

/**
 * 聊天消息结构化片段基础字段。
 */
export interface ChatMessagePartBase {
  /** 片段唯一标识，创建后保持稳定。 */
  id: string;
}

/**
 * 压缩摘要使用的模型脱敏快照。
 */
export interface CompactionModelSnapshot {
  /** Provider 类型。 */
  providerType: AIProviderType;
  /** Provider 稳定标识。 */
  providerId: string;
  /** 模型标识。 */
  modelId: string;
  /** 触发压缩时使用的上下文窗口。 */
  contextWindow?: number;
  /** 触发压缩时使用的最大输出 Token。 */
  maxOutputTokens?: number;
}

/**
 * 压缩规划使用的预算快照。
 */
export interface CompactionBudgetSnapshot {
  /** 模型输出预留。 */
  outputReserve: number;
  /** 估算误差和 Provider 包装安全预留。 */
  safetyReserve: number;
  /** 可用于输入的 Token。 */
  usableInputTokens: number;
  /** 自动压缩触发阈值。 */
  triggerTokens: number;
  /** 压缩后的目标输入 Token。 */
  targetTokens: number;
  /** 结构化摘要最大输出 Token。 */
  summaryMaxTokens: number;
  /** boundary 后原始 tail 最大 Token。 */
  rawTailMaxTokens: number;
}

/**
 * 结构化上下文中的目标状态。
 */
export interface ObjectiveState {
  /** 目标稳定标识。 */
  id: string;
  /** 目标描述。 */
  description: string;
  /** 目标生命周期状态。 */
  status: 'active' | 'completed' | 'blocked' | 'superseded' | 'abandoned';
  /** 判断目标完成的明确标准。 */
  successCriteria: string[];
  /** 上级目标标识。 */
  parentId?: string;
  /** 替代当前目标的新目标标识。 */
  supersededById?: string;
  /** 支撑目标状态的消息 Part 标识。 */
  sourcePartIds: string[];
}

/**
 * 待办或问题的责任主体。
 */
export interface ContextOwner {
  /** 主体类型。 */
  type: 'user' | 'assistant' | 'tool' | 'external';
  /** 具体主体标识。 */
  id?: string;
}

/**
 * 结构化上下文中的动作。
 */
export interface ContextAction {
  /** 动作稳定标识。 */
  id: string;
  /** 动作描述。 */
  description: string;
  /** 应执行动作的主体。 */
  owner: ContextOwner;
  /** 支撑动作状态的消息 Part 标识。 */
  sourcePartIds: string[];
}

/**
 * 结构化上下文中的开放问题。
 */
export interface OpenQuestion {
  /** 问题稳定标识。 */
  id: string;
  /** 问题内容。 */
  question: string;
  /** 应回答问题的主体。 */
  owner: ContextOwner;
  /** 支撑问题状态的消息 Part 标识。 */
  sourcePartIds: string[];
}

/**
 * 结构化上下文事实。
 */
export interface ContextFact {
  /** 事实稳定标识。 */
  id: string;
  /** 事实语义类型。 */
  type: 'requirement' | 'preference' | 'constraint' | 'decision' | 'critical_fact' | 'conversation_continuity';
  /** 事实内容。 */
  content: string;
  /** 支撑事实的消息 Part 标识。 */
  sourcePartIds: string[];
}

/**
 * 结构化上下文中的失败记录。
 */
export interface ContextFailure {
  /** 失败稳定标识。 */
  id: string;
  /** 失败描述。 */
  description: string;
  /** 失败是否已经解决。 */
  resolved: boolean;
  /** 支撑失败状态的消息 Part 标识。 */
  sourcePartIds: string[];
}

/**
 * 结构化上下文中的文件或文档产物状态。
 */
export interface ArtifactState {
  /** 不随路径变化的产物稳定标识。 */
  id: string;
  /** 产物当前路径。 */
  path?: string;
  /** 产物用途。 */
  purpose: string;
  /** 最近观察到的产物状态。 */
  status: 'read' | 'created' | 'modified' | 'deleted';
  /** 需要继续保留的关键修改。 */
  keyChanges: string[];
  /** 后续使用前是否应重新读取。 */
  shouldReload: boolean;
  /** 支撑产物状态的消息 Part 标识。 */
  sourcePartIds: string[];
}

/**
 * 可跨多次滚动压缩继承的结构化上下文摘要。
 */
export interface StructuredContextSummary {
  /** 摘要 schema 版本。 */
  schemaVersion: 1;
  /** 当前活动目标标识。 */
  activeObjectiveId?: string;
  /** 目标状态列表。 */
  objectives: ObjectiveState[];
  /** 关键事实列表。 */
  facts: ContextFact[];
  /** 产物状态列表。 */
  artifacts: ArtifactState[];
  /** 已完成动作列表。 */
  completedActions: ContextAction[];
  /** 待完成动作列表。 */
  pendingActions: ContextAction[];
  /** 尚未解决的问题列表。 */
  openQuestions: OpenQuestion[];
  /** 失败与恢复状态列表。 */
  failures: ContextFailure[];
}

/**
 * 结构化摘要运行时校验的脱敏子错误码。
 */
export type CompactionValidationErrorCode = 'INVALID_SHAPE' | 'INVALID_REFERENCE' | 'INVALID_OBJECTIVE_RELATION';

/**
 * 聊天消息上下文压缩 checkpoint 片段。
 */
export interface ChatMessageCompactionPart extends ChatMessagePartBase {
  /** 片段类型。 */
  type: 'compaction';
  /** 压缩生命周期状态。 */
  status: 'pending' | 'success' | 'failed' | 'cancelled' | 'skipped';
  /** 压缩触发方式。 */
  trigger: 'automatic' | 'manual';
  /** 被覆盖范围内最后一个 immutable Part 标识。 */
  boundaryPartId?: string;
  /** 上一个成功 checkpoint 标识。 */
  parentCheckpointId?: string;
  /** 当前源拓扑、模型与预算生成的指纹。 */
  sourceFingerprint?: string;
  /** 生成摘要时使用的脱敏模型快照。 */
  modelSnapshot?: CompactionModelSnapshot;
  /** 生成摘要时使用的预算快照。 */
  budgetSnapshot?: CompactionBudgetSnapshot;
  /** 仅成功 checkpoint 持有的结构化摘要。 */
  summary?: StructuredContextSummary;
  /** 失败、取消或跳过时使用的稳定原因码。 */
  errorCode?: string;
  /** 摘要 schema 失败时保留的脱敏校验子错误码。 */
  validationErrorCode?: CompactionValidationErrorCode;
  /** checkpoint 创建时间戳。 */
  createdAt: number;
  /** checkpoint 进入终态的时间戳。 */
  completedAt?: number;
}

/**
 * 聊天消息文件输入片段。
 * Renderer 发送前使用该形态，不包含 snapshot。
 */
export interface ChatMessageFilePartInput extends ChatMessagePartBase {
  /** 片段类型 */
  type: 'file';
  /** 展示文件名 */
  filename: string;
  /** MIME 类型 */
  mime: string;
  /** 规范化资源 URL */
  url: string;
  /** 用户输入来源路径 */
  path: string;
  /** 用户原始输入中的引用文本及位置 */
  sourceText: {
    /** token 起始 offset */
    start: number;
    /** token 结束 offset */
    end: number;
    /** 原始 token 文本 */
    value: string;
  };
}

/**
 * 聊天消息文件内容快照。
 */
export interface ChatMessageFilePartSnapshot {
  /** 固化后的文件内容 */
  content: string;
  /** 快照起始行号 */
  startLine: number;
  /** 快照结束行号 */
  endLine: number;
  /** 文件总行数 */
  totalLines: number;
  /** 快照内容哈希 */
  contentHash: string;
  /** 快照创建时间 */
  capturedAt: string;
  /** 是否被截断 */
  truncated?: boolean;
}

/**
 * 聊天消息文件片段。
 * 进入聊天历史前必须包含 snapshot。
 */
export interface ChatMessageFilePart extends ChatMessageFilePartInput {
  /** 发送时固化的文件内容快照 */
  snapshot: ChatMessageFilePartSnapshot;
}

/**
 * 聊天消息 Skill 引用片段。
 * 仅持久化稳定名称与原始 Token，不保存 Skill 完整内容。
 */
export interface ChatMessageSkillReferencePart extends ChatMessagePartBase {
  /** 片段类型 */
  type: 'skill_reference';
  /** Skill frontmatter 名称 */
  name: string;
  /** 用户原始输入中的引用文本及位置 */
  sourceText: {
    /** Token 起始 offset */
    start: number;
    /** Token 结束 offset */
    end: number;
    /** 原始 Token 文本 */
    value: string;
  };
}

/**
 * 聊天消息文本片段
 */
export interface ChatMessageTextPart extends ChatMessagePartBase {
  /** 片段类型 */
  type: 'text';
  /** 文本内容 */
  text: string;
}

/**
 * 聊天消息思考片段
 */
export interface ChatMessageThinkingPart extends ChatMessagePartBase {
  /** 片段类型 */
  type: 'thinking';
  /** 思考内容 */
  thinking: string;
}

/**
 * 聊天消息 Shell 命令输出片段
 */
export interface ChatMessageShellOutputChunk {
  /** 命令唯一标识 */
  commandId: string;
  /** 输出流 */
  stream: 'stdout' | 'stderr';
  /** 输出文本 */
  text: string;
  /** 输出序号 */
  sequence: number;
  /** 创建时间 */
  createdAt: string;
}

/** Shell PTY 在 renderer 中维护的临时显示状态。 */
export interface ChatMessageShellRunState {
  /** 最新当前屏幕快照。 */
  terminalContent: string;
  /** 已展示的累计自动回答次数，最多 20 条。 */
  autoAnswers: number[];
  /** 已应用的最后事件序号。 */
  lastSequence: number;
  /** 是否已收到 finished。 */
  finished: boolean;
}

/**
 * 聊天消息统一工具片段。
 * 合并原 tool-input / tool-call / tool-result 为同一片段，通过 status 追踪工具执行生命周期。
 */
export interface ChatMessageToolPart extends ChatMessagePartBase {
  /** 片段类型 */
  type: 'tool';
  /** 工具调用 ID */
  toolCallId: string;
  /** 工具名称 */
  toolName: string;
  /** 工具执行生命周期：inputting（流式输入中）→ executing（执行中）→ done（已完成） */
  status: 'inputting' | 'executing' | 'done';
  /** 工具输入参数（inputting 阶段可能不完整） */
  input: unknown;
  /** Provider 返回的工具调用元数据，供精确续接和完整性校验使用。 */
  providerMetadata?: unknown;
  /** 流式输入文本片段，仅 inputting 阶段使用 */
  inputText?: string;
  /** 工具执行结果，仅 status === 'done' 时存在 */
  result?: AIToolExecutionResult;
  /** Shell 命令实时输出缓冲，仅 run_shell_command 使用 */
  shellOutput?: ChatMessageShellOutputChunk[];
  /** Shell PTY 临时 UI 状态，不进入模型工具结果。 */
  shellRunState?: ChatMessageShellRunState;
}

/**
 * 聊天消息 Widget 提交结果片段。
 */
export interface ChatMessageWidgetResultPart extends ChatMessagePartBase, WidgetSubmitPayload {
  /** 片段类型 */
  type: 'widget_result';
  /** 提交时间 */
  submittedAt: string;
}

/**
 * 用户选择题单题答案。
 */
export interface AIUserChoiceQuestionAnswer {
  /** 问题文本 */
  question: string;
  /** 选中的选项值列表 */
  answers: string[];
  /** 输入框模式的文本答案 */
  text?: string;
}

/**
 * 用户选择题答案数据
 */
export interface AIUserChoiceAnswerData {
  /** 对应问题 ID */
  questionId: string;
  /** 对应工具调用 ID */
  toolCallId: string;
  /** 选中的选项值列表 */
  answers: string[];
  /** 批量问题的逐题答案 */
  questionAnswers?: AIUserChoiceQuestionAnswer[];
  /** 其他手动输入文本 */
  otherText?: string;
}

/**
 * 确认卡片状态
 */
export type ChatMessageConfirmationStatus = 'pending' | 'approved' | 'cancelled' | 'expired';

/**
 * 确认卡片执行状态
 */
export type ChatMessageConfirmationExecutionStatus = 'idle' | 'running' | 'success' | 'failure';

/**
 * 确认卡片操作类型
 */
export type ChatMessageConfirmationAction = 'approve' | 'approve-session' | 'approve-always' | 'cancel';

/**
 * 确认卡片操作事件载荷
 */
export interface ChatMessageConfirmationActionPayload {
  /** 确认项 ID */
  confirmationId: string;
  /** 确认操作 */
  action: ChatMessageConfirmationAction;
}

/**
 * 确认卡片自定义输入事件载荷
 */
export interface ChatMessageConfirmationCustomInputPayload {
  /** 确认项 ID */
  confirmationId: string;
  /** 用户自定义输入内容 */
  text: string;
}

/**
 * 确认卡片自定义输入配置
 */
export interface ChatMessageConfirmationCustomInputConfig {
  /** 是否允许用户绕过当前建议，自行输入内容 */
  enabled: boolean;
  /** 输入区提示文案 */
  placeholder?: string;
  /** 触发按钮文案 */
  triggerLabel?: string;
}

/**
 * 聊天消息确认卡片片段
 */
export interface ChatMessageConfirmationPart extends ChatMessagePartBase {
  /** 片段类型 */
  type: 'confirmation';
  /** 关联的工具调用 ID，用于在展示确认卡时抑制对应 tool-call 的展示（可选） */
  toolCallId?: string;
  /** 确认项唯一标识 */
  confirmationId: string;
  /** 工具名称 */
  toolName: string;
  /** 标题 */
  title: string;
  /** 描述 */
  description: string;
  /** 风险级别 */
  riskLevel: 'write' | 'dangerous';
  /** 原始文本 */
  beforeText?: string;
  /** 新文本 */
  afterText?: string;
  /** 是否允许记住本次授权 */
  allowRemember?: boolean;
  /** 可选的记忆授权范围 */
  rememberScopes?: Array<'session' | 'always'>;
  /** 与当前确认卡关联的自定义输入配置 */
  customInput?: ChatMessageConfirmationCustomInputConfig;
  /** 确认状态 */
  confirmationStatus: ChatMessageConfirmationStatus;
  /** 执行状态 */
  executionStatus: ChatMessageConfirmationExecutionStatus;
  /** 执行失败信息 */
  executionError?: string;
}

export interface ChatMessageErrorPart extends ChatMessagePartBase {
  /** 片段类型 */
  type: 'error';
  /** 错误内容 */
  text: string;
}

/**
 * 聊天消息结构化片段
 */
export type ChatMessagePart =
  | ChatMessageTextPart
  | ChatMessageFilePart
  | ChatMessageSkillReferencePart
  | ChatMessageErrorPart
  | ChatMessageThinkingPart
  | ChatMessageToolPart
  | ChatMessageWidgetResultPart
  | ChatMessageConfirmationPart
  | ChatMessageCompactionPart;

/**
 * 单个聊天会话持久化的模型标识。
 */
export interface ChatSessionModelMetadata {
  /** Provider 稳定标识。 */
  providerId: string;
  /** Provider 内的模型标识。 */
  modelId: string;
}

/**
 * 可扩展的聊天会话元数据。
 */
export interface ChatSessionMetadata {
  /** 会话后续 Runtime 使用的模型。 */
  model?: ChatSessionModelMetadata;
  /** 当前会话覆盖默认工作区的真实目录路径。 */
  workspaceRoot?: string;
  /** 主进程更新模型时需要保留的其他元数据字段。 */
  [key: string]: unknown;
}

/**
 * 聊天会话
 */
export interface ChatSession {
  /** 会话唯一标识 */
  id: string;
  /** 会话类型 */
  type: ChatSessionType;
  /** 会话标题 */
  title: string;
  /** 创建时间 */
  createdAt: string;
  /** 更新时间 */
  updatedAt: string;
  /** 最后一条消息时间 */
  lastMessageAt: string;
  /** 会话累计 Token 使用统计 */
  usage?: AIUsage;
  /** 会话级可扩展元数据。 */
  metadata?: ChatSessionMetadata;
}

/**
 * 聊天消息记录
 */
export interface ChatMessageRecord {
  /** 消息唯一标识 */
  id: string;
  /** 所属会话 ID */
  sessionId: string;
  /** 角色 */
  role: ChatMessageRole;
  /** 消息内容 */
  content: string;
  /** 结构化消息片段 */
  parts: ChatMessagePart[];
  /** 思考内容 */
  thinking?: string;
  /** 文件列表 */
  files?: ChatMessageFile[];
  /** Token 使用统计 */
  usage?: AIUsage;
  /** 执行该消息的 agent ID */
  agentId?: string;
  /** 创建或更新该消息的 runtime ID */
  runtimeId?: string;
  /** 父 runtime ID，预留给多 agent 调度 */
  parentRuntimeId?: string;
  /** runtime 扩展元数据 */
  meta?: ChatMessageRuntimeMeta;
  /** 创建时间 */
  createdAt: string;
  /** 是否处于加载中，用于恢复硬中断前的 assistant 草稿 */
  loading?: boolean;
  /** 是否已完成，用于区分流式草稿与终态消息 */
  finished?: boolean;
}

/**
 * 聊天历史消息加载游标
 */
export interface ChatMessageHistoryCursor {
  /** 仅加载早于该创建时间的消息 */
  beforeCreatedAt: string;
  /** 同创建时间下的边界消息角色，用于保持分页顺序与展示顺序一致 */
  beforeRole: ChatMessageRole;
  /** 同创建时间下的边界消息 ID，用于规避时间戳精度冲突 */
  beforeId: string;
}

/**
 * 会话分页游标，基于时间戳实现游标分页
 */
export interface SessionCursor {
  /** 最后一条消息时间戳，用于主排序游标 */
  lastMessageAt: string;
  /** 创建时间戳，用于相同 lastMessageAt 时的二级排序游标 */
  createdAt: string;
}

/**
 * 会话分页查询参数
 */
export interface SessionPaginationParams {
  /** 每页数量 */
  limit: number;
  /** 游标（可选，不传时加载第一页） */
  cursor?: SessionCursor;
}

/**
 * 会话分页查询结果
 */
export interface PaginatedSessionsResult {
  /** 当前页会话列表 */
  items: ChatSession[];
  /** 是否还有更多数据可加载 */
  hasMore: boolean;
  /** 下一页游标，无更多数据时为 undefined */
  nextCursor?: SessionCursor;
}
