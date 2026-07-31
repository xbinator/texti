/**
 * @file types.ts
 * @description BChat 组件消息、服务配置与续轮保护类型定义。
 */
import type { FileReference } from '../types';
import type { AIUsage } from 'types/ai';
import type { ChatMessageFile, ChatMessagePart, ChatMessageRole } from 'types/chat';
import type { AIToolProviderSupport } from '@/ai/tools/policy';

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
  /** 消息内容，由文本片段聚合得到，用于复制、标题和搜索 */
  content: string;
  /** 有序结构化消息片段，用于界面展示、模型上下文和工具链恢复 */
  parts: ChatMessagePart[];
  /** 文件引用列表 */
  references?: FileReference[];
  /** 思考内容 */
  thinking?: string;
  /** 附件列表 */
  files?: ChatMessageFile[];
  /** Token 使用统计 */
  usage?: AIUsage;
  /** 执行该消息的 agent ID */
  agentId?: string;
  /** 创建或更新该消息的 runtime ID */
  runtimeId?: string;
  /** 父 runtime ID，预留给多 agent 调度 */
  parentRuntimeId?: string;
  /** 创建时间 */
  createdAt: string;
  /** 是否处于加载中 */
  loading?: boolean;
  /** 是否已完成 */
  finished?: boolean;
  /** 估算的 token 数（per-message 缓存） */
  tokenCount?: number;
  /** token 计数来源 */
  tokenCountSource?: 'estimated' | 'usage_observed';
  /** token 计数对应的模型 ID */
  tokenCountModelId?: string;
  /** token 计数对应的内容哈希 */
  tokenCountContentHash?: string;
}

/**
 * BChat 组件属性
 */
export interface BChatProps {
  /** 当前聊天会话 ID，空值表示新会话草稿态 */
  sessionId?: string | null;
  /** 是否显示当前会话的工作区选择与恢复入口。 */
  workspaceControlEnabled?: boolean;
}

/**
 * BChat 草稿重置选项。
 */
export interface BChatResetDraftOptions {
  /** 是否在重置后聚焦输入编辑器，默认聚焦。 */
  focus?: boolean;
}

/**
 * BChat 向页面宿主发布的持续运行状态。
 */
export type BChatRuntimeSourceStatus = 'idle' | 'running' | 'waiting' | 'error';

/**
 * BChat 向页面宿主发布的完整运行状态。
 */
export type BChatRuntimeStatus = BChatRuntimeSourceStatus | 'completed';

/**
 * BChat 运行状态变化事件。
 */
export type BChatRuntimeStatusChange =
  | {
      /** 当前持续运行状态。 */
      status: BChatRuntimeSourceStatus;
    }
  | {
      /** 成功完成状态。 */
      status: 'completed';
      /** 完成时所属的会话 ID。 */
      sessionId: string;
    };
