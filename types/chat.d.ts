/**
 * @file chat.d.ts
 * @description 聊天会话、消息与附件类型定义
 */
import type { AIUsage } from './ai';

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
  /** 思考内容 */
  thinking?: string;
  /** 文件列表 */
  files?: ChatMessageFile[];
  /** Token 使用统计 */
  usage?: AIUsage;
  /** 创建时间 */
  createdAt: string;
}
