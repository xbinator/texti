/**
 * @file message.ts
 * @description BChat 消息创建、转换与持久化过滤工具。
 */
import type { Message } from './types';
import type { JSONValue, ModelMessage } from 'ai';
import type { AIAwaitingUserChoiceQuestion, AIToolExecutionAwaitingUserInputResult } from 'types/ai';
import type { AIUserChoiceAnswerData, ChatMessagePart, ChatMessageRole, ChatMessageToolResultPart } from 'types/chat';
import { nanoid } from 'nanoid';

/**
 * 可传给模型的消息
 */
export type ModelCompatibleMessage = Message & { role: Extract<ChatMessageRole, 'user' | 'assistant'> };

/**
 * 可持久化的消息
 */
export type PersistableMessage = Message & { role: ChatMessageRole };

/**
 * 单条消息的模型转换缓存条目
 */
export interface CachedModelMessageEntry {
  /** 缓存生成时对应的原始消息引用 */
  sourceMessage: Message;
  /** 参与模型转换的消息签名 */
  signature: string;
  /** 转换后的模型消息列表；不可传给模型的消息为空数组 */
  modelMessages: ModelMessage[];
}

/** 模型消息转换缓存结果 */
export interface CachedModelMessagesResult {
  /** 每条原始消息对应的缓存条目 */
  entries: CachedModelMessageEntry[];
  /** 过滤后的模型消息列表 */
  modelMessages: ModelMessage[];
}

/** Assistant 模型消息内容片段 */
export type AssistantModelMessageContent = Array<{ type: 'text'; text: string } | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown }>;

/** Tool 模型消息内容片段 */
export type ToolModelMessageContent = Array<{ type: 'tool-result'; toolCallId: string; toolName: string; output: { type: 'json'; value: JSONValue } }>;

/** 工具结果类型 */
export type ToolResult = Extract<ChatMessagePart, { type: 'tool-result' }>['result'];

/**
 * 判断消息是否可传给模型
 * @param message - 待判断的消息
 */
export function isModelMessage(message: Message): message is ModelCompatibleMessage {
  return message.role === 'user' || message.role === 'assistant';
}

/**
 * 判断消息是否可持久化
 * @param message - 待判断的消息
 */
export function isPersistableMessage(message: Message): message is PersistableMessage {
  return message.role === 'user' || message.role === 'assistant' || message.role === 'error';
}

/**
 * 判断 assistant 消息是否仍可视为空占位
 * @param message - 待判断的消息
 */
export function isRemovableAssistantPlaceholder(message: Message | undefined): boolean {
  if (!message || message.role !== 'assistant') {
    return false;
  }

  return !message.content && !message.usage && !message.parts.length;
}

/**
 * 将任意值转换为 JSON 可序列化值。
 * @param value - 待转换的值
 */
function toJsonValue(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}

/**
 * 根据文本片段聚合纯文本内容。
 * @param parts - 结构化消息片段
 */
export function getMessagePlainText(parts: ChatMessagePart[]): string {
  return parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('');
}

/**
 * 将文本增量追加到消息片段。
 * @param message - 待更新的消息
 * @param text - 文本增量
 */
export function appendTextPart(message: Message, text: string): void {
  const lastPart = message.parts[message.parts.length - 1];
  if (lastPart?.type === 'text') {
    lastPart.text += text;
  } else {
    message.parts.push({ type: 'text', text });
  }

  message.content = getMessagePlainText(message.parts);
}

/**
 * 将思考增量追加到消息片段。
 * @param message - 待更新的消息
 * @param thinking - 思考增量
 */
export function appendThinkingPart(message: Message, thinking: string): void {
  const lastPart = message.parts[message.parts.length - 1];
  if (lastPart?.type === 'thinking') {
    lastPart.thinking += thinking;
  } else {
    message.parts.push({ type: 'thinking', thinking });
  }

  message.thinking = (message.thinking ?? '') + thinking;
}

/**
 * 将工具调用追加到消息片段。
 * @param message - 待更新的消息
 * @param toolCallId - 工具调用 ID
 * @param toolName - 工具名称
 * @param input - 工具输入参数
 */
export function appendToolCallPart(message: Message, toolCallId: string, toolName: string, input: unknown): void {
  message.parts.push({ type: 'tool-call', toolCallId, toolName, input });
}

/**
 * 将工具结果追加到消息片段。
 * @param message - 待更新的消息
 * @param toolCallId - 工具调用 ID
 * @param toolName - 工具名称
 * @param result - 工具执行结果
 */
export function appendToolResultPart(message: Message, toolCallId: string, toolName: string, result: ToolResult) {
  const resultPart: Extract<ChatMessagePart, { type: 'tool-result' }> = { type: 'tool-result', toolCallId, toolName, result };
  const toolCallIndex = message.parts.findIndex((part) => part.type === 'tool-call' && part.toolCallId === toolCallId);

  if (toolCallIndex === -1) {
    message.parts.push(resultPart);
    return;
  }

  message.parts.splice(toolCallIndex + 1, 0, resultPart);
}

/**
 * 判断工具结果是否为等待用户选择的问题。
 * @param part - 消息片段
 */
function isAwaitingUserChoiceResult(part: ChatMessagePart): part is ChatMessageToolResultPart & { result: AIToolExecutionAwaitingUserInputResult } {
  return part.type === 'tool-result' && part.toolName === 'ask_user_choice' && part.result.status === 'awaiting_user_input';
}

/**
 * 查找消息历史中尚未回答的用户选择问题。
 * @param sourceMessages - 组件内部消息
 */
export function findPendingUserChoiceQuestion(sourceMessages: Message[]): AIAwaitingUserChoiceQuestion | null {
  for (let messageIndex = sourceMessages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = sourceMessages[messageIndex];
    const pendingPart = message.parts.find((part) => isAwaitingUserChoiceResult(part));

    if (pendingPart?.result.status === 'awaiting_user_input') {
      return pendingPart.result.data;
    }
  }

  return null;
}

/**
 * 将等待用户选择的工具结果替换为用户答案。
 * @param sourceMessages - 组件内部消息
 * @param answer - 用户提交的答案
 */
export function submitUserChoiceAnswer(sourceMessages: Message[], answer: AIUserChoiceAnswerData): boolean {
  for (let messageIndex = sourceMessages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = sourceMessages[messageIndex];
    const resultPart = message.parts.find(
      (part) => isAwaitingUserChoiceResult(part) && part.toolCallId === answer.toolCallId && part.result.data.questionId === answer.questionId
    );

    if (resultPart?.type !== 'tool-result') {
      continue;
    }

    resultPart.result = {
      toolName: 'ask_user_choice',
      status: 'success',
      data: answer
    };
    return true;
  }

  return false;
}

/**
 * 生成参与模型转换的消息签名，用于判断缓存是否还能复用。
 * @param message - 待签名的消息
 */
function createModelMessageSignature(message: Message): string {
  return JSON.stringify({
    role: message.role,
    content: message.content,
    parts: message.parts
  });
}

/**
 * 创建 assistant 模型消息。
 * @param content - assistant 内容片段
 */
function createAssistantModelMessage(content: AssistantModelMessageContent): ModelMessage | undefined {
  if (!content.length) {
    return undefined;
  }

  return { role: 'assistant', content };
}

/**
 * 创建 tool 模型消息。
 * @param content - 工具结果内容片段
 */
function createToolModelMessage(content: ToolModelMessageContent): ModelMessage | undefined {
  if (!content.length) {
    return undefined;
  }

  return { role: 'tool', content };
}

/**
 * 将 assistant 消息片段转换为 AI SDK 所需的多条模型消息。
 * @param parts - assistant 结构化片段
 */
function toAssistantModelMessages(parts: ChatMessagePart[]): ModelMessage[] {
  const modelMessages: ModelMessage[] = [];
  let assistantParts: Array<{ type: 'text'; text: string } | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown }> = [];
  let toolResultParts: Array<{ type: 'tool-result'; toolCallId: string; toolName: string; output: { type: 'json'; value: JSONValue } }> = [];

  const flushAssistantParts = (): void => {
    const message = createAssistantModelMessage(assistantParts);
    if (message) {
      modelMessages.push(message);
    }
    assistantParts = [];
  };

  const flushToolResultParts = (): void => {
    const message = createToolModelMessage(toolResultParts);
    if (message) {
      modelMessages.push(message);
    }
    toolResultParts = [];
  };

  parts.forEach((part) => {
    if (part.type === 'text') {
      flushToolResultParts();
      assistantParts.push({ type: 'text', text: part.text });
      return;
    }

    if (part.type === 'tool-call') {
      flushToolResultParts();
      assistantParts.push({ type: 'tool-call', toolCallId: part.toolCallId, toolName: part.toolName, input: part.input });
      return;
    }

    if (part.type === 'tool-result') {
      flushAssistantParts();
      toolResultParts.push({
        type: 'tool-result',
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        output: {
          type: 'json',
          value: toJsonValue(part.result)
        }
      });
    }
  });

  flushAssistantParts();
  flushToolResultParts();

  return modelMessages;
}

/**
 * 将单条组件消息转换为 AI SDK 的 ModelMessage 列表。
 * @param message - 组件内部消息
 */
function toModelMessagesForMessage(message: Message): ModelMessage[] {
  if (!isModelMessage(message)) {
    return [];
  }

  if (message.role === 'user') {
    return [{ role: 'user', content: message.content }];
  }

  return toAssistantModelMessages(message.parts);
}

/**
 * 判断单条消息是否可以直接复用已有缓存条目。
 * @param entry - 旧缓存条目
 * @param message - 当前消息
 */
function canReuseCachedEntry(entry: CachedModelMessageEntry, message: Message): boolean {
  if (entry.sourceMessage.id !== message.id || entry.sourceMessage.role !== message.role) {
    return false;
  }

  return entry.signature === createModelMessageSignature(message);
}

/**
 * 将组件消息转换为带缓存的模型消息结果，尽量复用前缀历史。
 * @param sourceMessages - 组件内部消息
 * @param previousCache - 上一次转换得到的缓存
 */
export function toCachedModelMessages(sourceMessages: Message[], previousCache?: CachedModelMessagesResult): CachedModelMessagesResult {
  const entries: CachedModelMessageEntry[] = [];
  const modelMessages: ModelMessage[] = [];
  let reuseCount = 0;

  if (previousCache) {
    const maxReusableLength = Math.min(sourceMessages.length, previousCache.entries.length);

    while (reuseCount < maxReusableLength) {
      const previousEntry = previousCache.entries[reuseCount];
      const message = sourceMessages[reuseCount];
      if (!canReuseCachedEntry(previousEntry, message)) {
        break;
      }

      entries.push(previousEntry);
      modelMessages.push(...previousEntry.modelMessages);
      reuseCount += 1;
    }
  }

  for (let index = reuseCount; index < sourceMessages.length; index += 1) {
    const sourceMessage = sourceMessages[index];
    const nextModelMessages = toModelMessagesForMessage(sourceMessage);
    const entry: CachedModelMessageEntry = {
      sourceMessage,
      signature: createModelMessageSignature(sourceMessage),
      modelMessages: nextModelMessages
    };

    entries.push(entry);
    modelMessages.push(...nextModelMessages);
  }

  return { entries, modelMessages };
}

/**
 * 将组件消息转换为 AI SDK 的 ModelMessage
 * @param sourceMessages - 组件内部消息
 */
export function toModelMessages(sourceMessages: Message[]): ModelMessage[] {
  return toCachedModelMessages(sourceMessages).modelMessages;
}

/**
 * 创建 assistant 占位消息
 */
export function createAssistantPlaceholder(): Message {
  return { id: nanoid(), role: 'assistant', content: '', parts: [], thinking: '', createdAt: '', loading: true };
}

/**
 * 创建错误消息
 * @param content - 错误说明
 */
export function createErrorMessage(content: string): Message {
  return {
    id: nanoid(),
    role: 'error',
    content,
    parts: [{ type: 'text', text: content }],
    createdAt: new Date().toISOString(),
    loading: false,
    finished: true
  };
}
