/**
 * @file chat.d.ts
 * @description 聊天会话、消息与附件类型定义
 */
import type { AIToolExecutionResult, AIUsage } from './ai';

/**
 * 聊天会话类型
 */
export type ChatSessionType = 'assistant';

/**
 * 聊天消息角色
 */
export type ChatMessageRole = 'user' | 'assistant' | 'error';

/**
 * 聊天消息附件类型
 */
export type ChatMessageFileType = 'image' | 'document' | 'audio' | 'video' | 'binary';

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
  /** 图片宽度 */
  width?: number;
  /** 图片高度 */
  height?: number;
}

/**
 * 聊天消息文本片段
 */
export interface ChatMessageTextPart {
  /** 片段类型 */
  type: 'text';
  /** 文本内容 */
  text: string;
}

/**
 * 聊天消息思考片段
 */
export interface ChatMessageThinkingPart {
  /** 片段类型 */
  type: 'thinking';
  /** 思考内容 */
  thinking: string;
}

/**
 * 聊天消息工具调用片段
 */
export interface ChatMessageToolCallPart {
  /** 片段类型 */
  type: 'tool-call';
  /** 工具调用 ID */
  toolCallId: string;
  /** 工具名称 */
  toolName: string;
  /** 工具输入参数 */
  input: unknown;
}

/**
 * 聊天消息工具结果片段
 */
export interface ChatMessageToolResultPart {
  /** 片段类型 */
  type: 'tool-result';
  /** 工具调用 ID */
  toolCallId: string;
  /** 工具名称 */
  toolName: string;
  /** 工具执行结果 */
  result: AIToolExecutionResult;
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
 * 聊天消息确认卡片片段
 */
export interface ChatMessageConfirmationPart {
  /** 片段类型 */
  type: 'confirmation';
  /** 确认项唯一标识 */
  confirmationId: string;
  /** 工具名称 */
  toolName: string;
  /** 标题 */
  title: string;
  /** 描述 */
  description: string;
  /** 权限级别 */
  permission: 'write' | 'dangerous';
  /** 原始文本 */
  beforeText?: string;
  /** 新文本 */
  afterText?: string;
  /** 确认状态 */
  confirmationStatus: ChatMessageConfirmationStatus;
  /** 执行状态 */
  executionStatus: ChatMessageConfirmationExecutionStatus;
  /** 执行失败信息 */
  executionError?: string;
}

/**
 * 聊天消息结构化片段
 */
export type ChatMessagePart =
  | ChatMessageTextPart
  | ChatMessageThinkingPart
  | ChatMessageToolCallPart
  | ChatMessageToolResultPart
  | ChatMessageConfirmationPart;

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
  /** 创建时间 */
  createdAt: string;
}
