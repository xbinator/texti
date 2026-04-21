import type { AIUsage, AIToolContext, AIToolExecutor } from 'types/ai';
import type { ChatMessageFile, ChatMessageRole } from 'types/chat';

/**
 * 聊天消息
 */
export interface Message {
  /** 消息唯一标识 */
  id: string;
  /** 消息发送者角色 */
  role: ChatMessageRole;
  /** 消息内容 */
  content: string;
  /** 思考内容（可选） */
  thinking?: string;
  /** 附件文件列表（可选） */
  files?: ChatMessageFile[];
  /** AI 使用情况统计（可选） */
  usage?: AIUsage;
  /** 创建时间 */
  createdAt: string;
  /** 是否正在加载（可选） */
  loading?: boolean;
  /** 是否完成（可选） */
  finished?: boolean;
  /** 错误信息（可选） */
  error?: string;
}

/**
 * BChat 组件属性
 */
export interface BChatProps {
  /** 输入框占位文本（可选） */
  placeholder?: string;
  /** 消息列表（可选） */
  messages?: Message[];
  /** 发送消息前的回调函数（可选） */
  onBeforeSend?: (message: Message) => Message | Promise<Message | void> | void;
  /** 重新生成消息前的回调函数（可选） */
  onBeforeRegenerate?: (messages: Message[], triggerMessage: Message) => Promise<void> | void;
  /** AI 工具执行器列表（可选） */
  tools?: AIToolExecutor[];
  /** 获取工具上下文的函数（可选） */
  getToolContext?: () => AIToolContext | undefined;
}
