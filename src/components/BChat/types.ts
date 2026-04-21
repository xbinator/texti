/**
 * @file types.ts
 * @description BChat 组件消息、服务配置与续轮保护类型定义。
 */
import type { AIUsage, AIToolContext, AIToolExecutor } from 'types/ai';
import type { ChatMessageFile, ChatMessageRole } from 'types/chat';
import type { AIToolProviderSupport } from '@/ai/tools/policy';

/**
 * assistant 工具调用记录
 */
export interface MessageToolCall {
  /** 工具调用 ID */
  toolCallId: string;
  /** 工具名称 */
  toolName: string;
  /** 工具输入参数 */
  input: unknown;
}

/**
 * 服务配置信息
 */
export interface ServiceConfig {
  /** 服务商 ID */
  providerId: string;
  /** 模型 ID */
  modelId: string;
  /** 工具支持能力 */
  toolSupport: AIToolProviderSupport;
}

/**
 * 工具续轮保护配置
 */
export interface ToolLoopGuardConfig {
  /** 最大工具续轮次数 */
  maxRounds: number;
  /** 相同工具签名允许连续重复的最大次数 */
  maxRepeatedCalls: number;
}

/**
 * 聊天消息
 */
export interface Message {
  /** 消息唯一标识 */
  id: string;
  /** 消息发送角色 */
  role: ChatMessageRole;
  /** 消息内容 */
  content: string;
  /** 思考内容 */
  thinking?: string;
  /** 附件列表 */
  files?: ChatMessageFile[];
  /** assistant 发起的工具调用记录 */
  toolCalls?: MessageToolCall[];
  /** Token 使用统计 */
  usage?: AIUsage;
  /** 创建时间 */
  createdAt: string;
  /** 是否处于加载中 */
  loading?: boolean;
  /** 是否已完成 */
  finished?: boolean;
}

/**
 * BChat 组件属性
 */
export interface BChatProps {
  /** 输入框占位文本 */
  placeholder?: string;
  /** 消息列表 */
  messages?: Message[];
  /** 发送前回调 */
  onBeforeSend?: (message: Message) => Message | Promise<Message | void> | void;
  /** 重新生成前回调 */
  onBeforeRegenerate?: (messages: Message[], triggerMessage: Message) => Promise<void> | void;
  /** 可用 AI 工具 */
  tools?: AIToolExecutor[];
  /** 获取工具上下文 */
  getToolContext?: () => AIToolContext | undefined;
}
