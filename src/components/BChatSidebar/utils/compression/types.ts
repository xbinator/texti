/**
 * @file types.ts
 * @description 上下文压缩模块类型定义，包含摘要结构、压缩记录、状态枚举等。
 */
import type { ModelMessage } from 'ai';
import type { Message } from '@/components/BChatSidebar/utils/types';

// ─── 摘要构建模式 ─────────────────────────────────────────────────────────────

/** 摘要构建模式 */
export type SummaryBuildMode = 'incremental' | 'full_rebuild';

// ─── 压缩状态 ─────────────────────────────────────────────────────────────────

/** 压缩运行态状态（内存级，不持久化） */
export type CompressionStatus = 'idle' | 'compressing';

/** 摘要记录状态 */
export type SummaryRecordStatus = 'valid' | 'superseded' | 'invalid';

// ─── 触发原因 ─────────────────────────────────────────────────────────────────

/** 压缩触发原因 */
export type TriggerReason = 'message_count' | 'context_size' | 'manual';

// ─── 文件上下文摘要 ──────────────────────────────────────────────────────────

/**
 * 文件上下文摘要，记录历史文件引用的关键信息。
 */
export interface FileContextSummary {
  /** 文件路径 */
  filePath: string;
  /** 起始行号 */
  startLine?: number;
  /** 结束行号 */
  endLine?: number;
  /** 用户操作意图描述 */
  userIntent: string;
  /** 关键摘录摘要 */
  keySnippetSummary: string;
  /** 后续是否需要按需重新加载原文 */
  shouldReloadOnDemand: boolean;
}

// ─── 结构化摘要 ──────────────────────────────────────────────────────────────

/**
 * 结构化会话摘要，由 AI 摘要模型产出。
 */
export interface StructuredConversationSummary {
  /** 用户目标 */
  goal: string;
  /** 最近话题 */
  recentTopic: string;
  /** 用户偏好列表 */
  userPreferences: string[];
  /** 约束条件列表 */
  constraints: string[];
  /** 已做出的决策列表 */
  decisions: string[];
  /** 重要事实列表 */
  importantFacts: string[];
  /** 文件上下文摘要列表 */
  fileContext: FileContextSummary[];
  /** 待解决问题列表 */
  openQuestions: string[];
  /** 待处理操作列表 */
  pendingActions: string[];
}

// ─── 摘要记录 ────────────────────────────────────────────────────────────────

/**
 * 会话摘要持久化记录。
 */
export interface ConversationSummaryRecord {
  /** 摘要记录唯一标识 */
  id: string;
  /** 所属会话 ID */
  sessionId: string;
  /** 摘要构建模式 */
  buildMode: SummaryBuildMode;
  /** 继承的上一条摘要 ID（增量模式下使用） */
  derivedFromSummaryId?: string;
  /** 摘要覆盖区间起点消息 ID */
  coveredStartMessageId: string;
  /** 摘要覆盖区间终点消息 ID（摘要实际分析到的最后一条消息） */
  coveredEndMessageId: string;
  /** 上下文截断边界消息 ID（ID 在此之后的消息作为原文注入） */
  coveredUntilMessageId: string;
  /** 实际进入摘要的消息 ID 列表 */
  sourceMessageIds: string[];
  /** 位于覆盖区间内但必须原文穿透的消息 ID 列表 */
  preservedMessageIds: string[];
  /** 可读摘要文本 */
  summaryText: string;
  /** 结构化摘要 */
  structuredSummary: StructuredConversationSummary;
  /** 触发原因 */
  triggerReason: TriggerReason;
  /** 生成时的消息轮数快照 */
  messageCountSnapshot: number;
  /** 生成时的字符体积快照 */
  charCountSnapshot: number;
  /** 摘要 schema 版本 */
  schemaVersion: number;
  /** 摘要状态 */
  status: SummaryRecordStatus;
  /** 失效原因 */
  invalidReason?: string;
  /** 创建时间 */
  createdAt: string;
  /** 更新时间 */
  updatedAt: string;
}

// ─── 压缩计划 ─────────────────────────────────────────────────────────────────

/**
 * Policy 模块输出的压缩策略判断结果。
 */
export interface CompressionPolicyResult {
  /** 是否应该触发压缩 */
  shouldCompress: boolean;
  /** 触发原因 */
  triggerReason: TriggerReason;
  /** 当前消息轮数 */
  roundCount: number;
  /** 当前上下文字符估算体积 */
  charCount: number;
  /** 有效摘要（若有） */
  currentSummary?: ConversationSummaryRecord;
}

// ─── 消息分类 ─────────────────────────────────────────────────────────────────

/**
 * Planner 模块输出的消息切分结果。
 */
export interface MessageClassificationResult {
  /** 必须保留原文的消息列表（最近窗口 + 未完成交互） */
  preservedMessages: Message[];
  /** 保留轻量文件语义的历史消息列表 */
  fileSemanticMessages: Message[];
  /** 可进入摘要的消息列表 */
  compressibleMessages: Message[];
  /** 必须原文穿透的消息 ID 列表（在压缩覆盖区间内但必须保留原文） */
  preservedMessageIds: string[];
}

// ─── 规则裁剪 ─────────────────────────────────────────────────────────────────

/**
 * 规则裁剪后的一条压缩消息项。
 */
export interface TrimmedMessageItem {
  /** 原始消息 ID */
  messageId: string;
  /** 消息角色 */
  role: 'user' | 'assistant';
  /** 裁剪后的文本内容 */
  trimmedText: string;
}

/**
 * Summarizer 规则裁剪阶段的输出。
 */
export interface RuleTrimResult {
  /** 裁剪后的消息项列表 */
  items: TrimmedMessageItem[];
  /** 裁剪后的总字符数 */
  charCount: number;
  /** 是否触发了硬截断 */
  truncated: boolean;
}

// ─── 上下文组装 ─────────────────────────────────────────────────────────────────

/**
 * Assembler 的输入参数。
 */
export interface AssemblerInput {
  /** 系统提示词（若有） */
  systemPrompt?: string;
  /** 会话摘要记录（若有有效摘要） */
  summaryRecord?: ConversationSummaryRecord;
  /** 穿透的历史原文消息列表 */
  preservedMessages: Message[];
  /** coveredUntilMessageId 之后的近期原文消息列表 */
  recentMessages: Message[];
  /** 当前用户消息 */
  currentUserMessage: Message;
}

/**
 * Assembler 的输出结果。
 */
export interface AssembledContext {
  /** 组装后的模型消息列表 */
  modelMessages: ModelMessage[];
}

// ─── Compressor（协调层）─────────────────────────────────────────────────────

/**
 * Coordinator 的 prepareMessagesBeforeSend 输入参数。
 */
export interface PrepareMessagesInput {
  /** 会话 ID */
  sessionId: string;
  /** 全量消息列表 */
  messages: Message[];
  /** 当前用户消息 */
  currentUserMessage: Message;
  /** 需要在压缩时排除的消息 ID 列表 */
  excludeMessageIds?: string[];
}

/**
 * Coordinator 的 prepareMessagesBeforeSend 输出结果。
 */
export interface PrepareMessagesOutput {
  /** 组装后的模型消息列表，可直接传入 stream */
  modelMessages: ModelMessage[];
  /** 是否发生了压缩 */
  compressed: boolean;
}

// ─── 存储层接口 ───────────────────────────────────────────────────────────────

/**
 * 摘要存储层接口。
 */
export interface SummaryStorage {
  /** 获取会话的最新有效摘要 */
  getValidSummary(sessionId: string): Promise<ConversationSummaryRecord | undefined>;
  /** 创建摘要记录 */
  createSummary(record: Omit<ConversationSummaryRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<ConversationSummaryRecord>;
  /** 更新摘要状态 */
  updateSummaryStatus(id: string, status: SummaryRecordStatus, invalidReason?: string): Promise<void>;
  /** 获取会话的所有摘要记录 */
  getAllSummaries(sessionId: string): Promise<ConversationSummaryRecord[]>;
}
