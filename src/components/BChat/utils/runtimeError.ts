/**
 * @file runtimeError.ts
 * @description ChatRuntime 错误处理与用户展示工具。
 */
import type { Message } from './types';
import type { AIServiceError } from 'types/ai';
import type { ChatRuntimeHandlerResult } from 'types/chat-runtime';
import { create } from './messageHelper';

/**
 * Runtime IPC 请求错误。
 */
export interface RuntimeRequestError extends Error {
  /** 主进程返回的稳定错误码。 */
  code?: string;
}

/**
 * Runtime 错误文案输入。
 */
export interface RuntimeErrorMessageInput {
  /** 稳定错误码。 */
  code?: string;
  /** 原始错误文案。 */
  message?: string;
}

/**
 * Runtime 错误消息追加选项。
 */
export interface RuntimeErrorAppendOptions {
  /** 当前会话 ID。 */
  sessionId: string;
  /** 错误展示内容。 */
  content: string;
  /** 当前视图中的可见消息。 */
  visibleMessages: Message[];
  /** 需要先补入视图的消息，通常是启动失败前的用户消息。 */
  precedingMessage?: Message;
  /** 读取当前可见消息之前的完整历史。 */
  fetchAllPriorHistory: (sessionId: string) => Promise<Message[]>;
  /** 持久化合并后的完整消息列表。 */
  persistMessages: (sessionId: string, messages: Message[]) => Promise<void>;
  /** 刷新当前可见消息。 */
  setLoadedMessages: (messages: Message[]) => void;
  /** 判断错误所属会话是否仍在当前视图。 */
  isSessionActive?: (sessionId: string) => boolean;
  /** 可选的视图更新后回调，用于等待 nextTick、滚动到底部等 UI 操作。 */
  afterMessagesUpdated?: () => Promise<void> | void;
}

/**
 * 从 Node 文件系统错误文案中提取路径。
 * @param message - 原始错误文案
 * @returns 文件路径，不存在时返回 null
 */
function extractPathFromNodeFileError(message: string): string | null {
  const matched = message.match(/(?:stat|open|access|lstat|readlink)\s+['"]([^'"]+)['"]$/);
  return matched?.[1] ?? null;
}

/**
 * 将 Runtime 错误转换为面向用户的中文文案。
 * @param input - Runtime 错误信息
 * @returns 用户可读错误文案
 */
export function localizeRuntimeErrorMessage(input: RuntimeErrorMessageInput): string {
  const rawMessage = input.message ?? 'ChatRuntime 请求失败';
  const code = input.code ?? '';

  if (code === 'ENOENT' || rawMessage.startsWith('ENOENT:')) {
    const path = extractPathFromNodeFileError(rawMessage);
    return path ? `文件不存在或已被移动：${path}` : '文件不存在或已被移动';
  }

  return rawMessage;
}

/**
 * 将 Runtime 异步错误事件转换为用户可读错误。
 * @param error - Runtime 异步错误事件
 * @returns 保留错误码的本地化错误事件
 */
export function localizeRuntimeServiceError(error: AIServiceError): AIServiceError {
  return {
    ...error,
    message: localizeRuntimeErrorMessage({ code: error.code, message: error.message })
  };
}

/**
 * 创建带稳定错误码的 Renderer Runtime 错误。
 * @param input - Runtime 错误信息
 * @returns 可沿请求准备链路传播的错误对象
 */
export function createRuntimeError(input: RuntimeErrorMessageInput): RuntimeRequestError {
  const error = new Error(localizeRuntimeErrorMessage(input)) as RuntimeRequestError;
  error.code = input.code;
  return error;
}

/**
 * 创建 Runtime IPC 请求错误。
 * @param result - handler 结果
 * @returns 带稳定错误码的错误对象
 */
export function createRuntimeRequestError(result: ChatRuntimeHandlerResult<unknown>): RuntimeRequestError {
  return createRuntimeError({ code: result.code, message: result.error });
}

/**
 * 判断消息片段是否已经展示同一条错误内容。
 * @param part - 待检查消息片段
 * @param content - 错误内容
 * @returns 是否已经展示同一条错误内容
 */
function isSameVisibleErrorPart(part: Message['parts'][number], content: string): boolean {
  if (part.type === 'error') {
    return part.text === content;
  }

  if (part.type === 'tool' && part.result?.status === 'failure') {
    return part.result.error.message === content;
  }

  return false;
}

/**
 * 判断最后一条可见消息是否已经展示同一条错误内容。
 * @param message - 待检查消息
 * @param content - 错误内容
 * @returns 是否已经是同内容错误消息
 */
function isSameVisibleErrorMessage(message: Message | undefined, content: string): boolean {
  if (!message) {
    return false;
  }

  return message.parts.some((part) => isSameVisibleErrorPart(part, content));
}

/**
 * 将 runtime 错误写入当前会话消息流，并同步持久化到会话历史。
 * @param options - 错误消息追加选项
 */
export async function appendRuntimeErrorMessage(options: RuntimeErrorAppendOptions): Promise<void> {
  const visibleMessages = [...options.visibleMessages];
  const lastVisibleMessage = visibleMessages[visibleMessages.length - 1];
  if (isSameVisibleErrorMessage(lastVisibleMessage, options.content)) {
    return;
  }

  if (options.precedingMessage && !visibleMessages.some((message) => message.id === options.precedingMessage?.id)) {
    visibleMessages.push(options.precedingMessage);
  }

  visibleMessages.push(create.errorMessage(options.content));
  const historyMessages = await options.fetchAllPriorHistory(options.sessionId);
  await options.persistMessages(options.sessionId, [...historyMessages, ...visibleMessages]);
  if (options.isSessionActive && !options.isSessionActive(options.sessionId)) return;
  options.setLoadedMessages(visibleMessages);
  await options.afterMessagesUpdated?.();
}
