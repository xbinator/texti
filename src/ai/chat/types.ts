/**
 * @file types.ts
 * @description Chat Actor 系统与纯策略共享领域类型。
 */
import type { AIUserChoiceAnswerData, ChatMessageFile, ChatMessageRole } from 'types/chat';
import type { ChatRuntimeAddress, ChatRuntimeUserInputPart } from 'types/chat-runtime';

/** Renderer 路由地址，与共享 Runtime 地址保持同一契约。 */
export type ChatActorAddress = ChatRuntimeAddress;

/** 不依赖具体 Runtime 实例的稳定 Agent 地址。 */
export type ChatAgentAddress = Pick<ChatRuntimeAddress, 'sessionId' | 'turnId' | 'agentId'>;

/**
 * 纯聊天策略所需的最小消息形状。
 */
export interface ChatPolicyMessage {
  /** 消息 ID */
  id: string;
  /** 消息角色 */
  role: ChatMessageRole;
  /** 聚合文本 */
  content: string;
}

/**
 * 新用户消息提交输入。
 */
export interface ChatSubmitInput {
  /** 用户消息 ID */
  messageId: string;
  /** 用户消息创建时间 */
  createdAt: string;
  /** 用户输入文本 */
  content: string;
  /** Runtime 结构化输入片段 */
  parts: ChatRuntimeUserInputPart[];
  /** 用户附件 */
  files?: ChatMessageFile[];
}

/**
 * 聊天流程意图。
 */
export type ChatIntent =
  | { type: 'submit'; input: ChatSubmitInput }
  | { type: 'compact' }
  | { type: 'regenerate'; targetMessageId: string }
  | { type: 'continue'; answer: AIUserChoiceAnswerData }
  | { type: 'recover'; runtimeId: string };

/**
 * 聊天流程稳定错误码。
 */
export type ChatWorkflowErrorCode =
  | 'preparation_failed'
  | 'runtime_start_failed'
  | 'runtime_failed'
  | 'recoverable_agent_failed'
  | 'protocol_error'
  | 'cancel_failed'
  | 'rollback_failed';

/**
 * 聊天流程错误。
 */
export interface ChatWorkflowError {
  /** 稳定错误码 */
  code: ChatWorkflowErrorCode;
  /** 用户或日志可读错误信息 */
  message: string;
  /** 原始错误原因 */
  cause?: unknown;
}
