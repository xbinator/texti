/**
 * @file useChatRuntime.ts
 * @description BChat 到主进程 ChatRuntime 的无状态 IPC 命令适配器。
 */
import type { Message } from '../utils/types';
import type { ChatMessageRecord } from 'types/chat';
import type {
  ChatRuntimeAbortResult,
  ChatRuntimeAddress,
  ChatRuntimeCompactInput,
  ChatRuntimeContinueInput,
  ChatRuntimeControlToolInput,
  ChatRuntimeHandlerResult,
  ChatRuntimeMessageSnapshot,
  ChatRuntimeSendInput,
  ChatRuntimeStartResult,
  ChatRuntimeSubmitMessagePartInput,
  ChatRuntimeSubmitUserChoiceInput
} from 'types/chat-runtime';
import { toRaw } from 'vue';
import { getElectronAPI } from '@/shared/platform/electron-api';
import { createRuntimeRequestError } from '../utils/runtimeError';

/** Runtime 命令适配器选项。 */
interface UseChatRuntimeOptions {
  /** renderer client id。 */
  clientId?: string;
  /** 当前 agent id。 */
  agentId?: string;
}

/** ChatRuntime 发送输入。 */
export type BChatRuntimeSendInput = Omit<ChatRuntimeAddress, 'agentId'> &
  Pick<
    ChatRuntimeSendInput,
    | 'content'
    | 'parts'
    | 'files'
    | 'userMessageId'
    | 'userMessageCreatedAt'
    | 'model'
    | 'contextWindow'
    | 'system'
    | 'workspaceRoot'
    | 'tools'
    | 'skillContentHashes'
    | 'runtimeContext'
    | 'tavily'
    | 'mcp'
    | 'capabilities'
  >;

/** ChatRuntime 续轮输入。 */
export type BChatRuntimeContinueInput = Omit<ChatRuntimeAddress, 'agentId'> &
  Pick<
    ChatRuntimeContinueInput,
    'model' | 'contextWindow' | 'system' | 'workspaceRoot' | 'tools' | 'skillContentHashes' | 'runtimeContext' | 'tavily' | 'mcp' | 'capabilities'
  > & {
    /** renderer 消息列表，发送到主进程前转换为纯快照。 */
    messages: Message[];
  };

/** ChatRuntime 手动压缩输入。 */
export type BChatRuntimeCompactInput = Omit<ChatRuntimeCompactInput, 'clientId' | 'agentId'>;

/** ChatRuntime 用户选择提交输入。 */
export type BChatRuntimeSubmitUserChoiceInput = Omit<ChatRuntimeAddress, 'agentId'> &
  Pick<
    ChatRuntimeSubmitUserChoiceInput,
    'model' | 'contextWindow' | 'system' | 'workspaceRoot' | 'tools' | 'skillContentHashes' | 'runtimeContext' | 'tavily' | 'mcp' | 'capabilities' | 'answer'
  >;

/** ChatRuntime renderer 消息片段提交输入。 */
export type BChatRuntimeSubmitMessagePartInput = ChatRuntimeSubmitMessagePartInput;

/** 可能包含主进程扩展字段的 renderer 消息。 */
interface RuntimeMessageLike extends Message {
  /** 所属会话 ID。 */
  sessionId?: string;
  /** Runtime 扩展元数据。 */
  meta?: ChatMessageRecord['meta'];
}

/**
 * 将值转换为 Electron IPC 可克隆数据。
 * @param value - 原始值
 * @returns 可克隆值
 */
function toCloneableData<T>(value: T): T {
  if (value === undefined) return value;
  const rawValue = toRaw(value);
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(rawValue) as T;
    } catch {
      // 嵌套 Vue Proxy 无法 structuredClone 时回退到 JSON 纯数据。
    }
  }
  return JSON.parse(JSON.stringify(rawValue)) as T;
}

/**
 * 将 renderer 消息转换为续轮快照。
 * @param message - renderer 消息
 * @param sessionId - 当前会话 ID
 * @returns Runtime 消息快照
 */
function toRuntimeMessageSnapshot(message: Message, sessionId: string): ChatRuntimeMessageSnapshot {
  const rawMessage = toRaw(message) as RuntimeMessageLike;
  return {
    id: rawMessage.id,
    sessionId: rawMessage.sessionId ?? sessionId,
    role: rawMessage.role,
    content: rawMessage.content,
    parts: toCloneableData(rawMessage.parts),
    ...(rawMessage.thinking !== undefined ? { thinking: rawMessage.thinking } : {}),
    ...(rawMessage.files !== undefined ? { files: toCloneableData(rawMessage.files) } : {}),
    ...(rawMessage.usage !== undefined ? { usage: toCloneableData(rawMessage.usage) } : {}),
    ...(rawMessage.agentId !== undefined ? { agentId: rawMessage.agentId } : {}),
    ...(rawMessage.runtimeId !== undefined ? { runtimeId: rawMessage.runtimeId } : {}),
    ...(rawMessage.parentRuntimeId !== undefined ? { parentRuntimeId: rawMessage.parentRuntimeId } : {}),
    ...(rawMessage.meta !== undefined ? { meta: toCloneableData(rawMessage.meta) } : {}),
    createdAt: rawMessage.createdAt,
    ...(rawMessage.loading !== undefined ? { loading: rawMessage.loading } : {}),
    ...(rawMessage.finished !== undefined ? { finished: rawMessage.finished } : {})
  };
}

/** 解包 Runtime IPC 结果。 */
function unwrapRuntimeResult<T>(result: ChatRuntimeHandlerResult<T>): T {
  if (!result.ok || result.data === undefined) throw createRuntimeRequestError(result);
  return result.data;
}

/** 确保无返回值 Runtime IPC 成功。 */
function assertRuntimeResult(result: ChatRuntimeHandlerResult<void>): void {
  if (!result.ok) throw createRuntimeRequestError(result);
}

/**
 * 创建 BChat ChatRuntime 命令适配器。
 * @param options - client 与 agent 标识
 * @returns Runtime IPC 命令
 */
export function useChatRuntime(options: UseChatRuntimeOptions = {}) {
  const clientId = options.clientId ?? 'bchat';
  const agentId = options.agentId ?? 'primary';
  const electronAPI = getElectronAPI();

  /** 启动一轮新消息。 */
  async function send(input: BChatRuntimeSendInput): Promise<ChatRuntimeStartResult> {
    return unwrapRuntimeResult(await electronAPI.chatRuntimeSend(toCloneableData({ ...input, clientId, agentId })));
  }

  /** 继续已有消息。 */
  async function continueTurn(input: BChatRuntimeContinueInput): Promise<ChatRuntimeStartResult> {
    const messages = input.messages.map((message) => toRuntimeMessageSnapshot(message, input.sessionId));
    return unwrapRuntimeResult(await electronAPI.chatRuntimeContinue(toCloneableData({ ...input, clientId, agentId, messages })));
  }

  /** 手动压缩当前会话上下文。 */
  async function compact(input: BChatRuntimeCompactInput): Promise<ChatRuntimeStartResult> {
    return unwrapRuntimeResult(await electronAPI.chatRuntimeCompact(toCloneableData({ ...input, clientId, agentId })));
  }

  /** 提交用户选择并续跑。 */
  async function submitUserChoice(input: BChatRuntimeSubmitUserChoiceInput): Promise<ChatRuntimeStartResult> {
    return unwrapRuntimeResult(await electronAPI.chatRuntimeSubmitUserChoice(toCloneableData({ ...input, clientId, agentId })));
  }

  /** 提交 renderer 消息片段。 */
  async function submitMessagePart(input: BChatRuntimeSubmitMessagePartInput): Promise<void> {
    assertRuntimeResult(await electronAPI.chatRuntimeSubmitMessagePart(toCloneableData(input)));
  }

  /** 控制一个明确的在途工具。 */
  async function controlTool(input: ChatRuntimeControlToolInput): Promise<void> {
    assertRuntimeResult(await electronAPI.chatRuntimeControlTool(toCloneableData(input)));
  }

  /** 中止明确指定的 Runtime。 */
  async function abort(runtimeId: string): Promise<ChatRuntimeAbortResult> {
    return unwrapRuntimeResult(await electronAPI.chatRuntimeAbort({ runtimeId }));
  }

  return { abort, compact, continueTurn, controlTool, send, submitMessagePart, submitUserChoice };
}
