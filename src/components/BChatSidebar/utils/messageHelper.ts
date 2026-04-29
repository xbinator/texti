/**
 * @file message.ts
 * @description BChatSidebar 消息创建、转换与持久化过滤工具。
 */
import type { Message } from './types';
import type { JSONValue, ModelMessage } from 'ai';
import type { AIAwaitingUserChoiceQuestion, AIToolExecutionAwaitingUserInputResult } from 'types/ai';
import type { AIUserChoiceAnswerData, ChatMessagePart, ChatMessageRole, ChatMessageToolResultPart } from 'types/chat';
import { nanoid } from 'nanoid';

// ─── 公开类型 ────────────────────────────────────────────────────────────────

/** 可传给模型的消息 */
export type ModelCompatibleMessage = Message & { role: Extract<ChatMessageRole, 'user' | 'assistant'> };

/** 可持久化的消息 */
export type PersistableMessage = Message & { role: ChatMessageRole };

/** 单条消息的模型转换缓存条目 */
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
export type ToolModelMessageContent = Array<{
  type: 'tool-result';
  toolCallId: string;
  toolName: string;
  output: { type: 'json'; value: JSONValue };
}>;

/** 工具结果类型 */
export type ToolResult = Extract<ChatMessagePart, { type: 'tool-result' }>['result'];

// ─── 内部工具函数 ────────────────────────────────────────────────────────────

/**
 * 判断未知值是否为普通对象。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 将任意值转换为 JSON 可序列化值。
 */
function toJsonValue(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}

/**
 * 根据文本片段聚合纯文本内容。
 */
function getMessagePlainText(parts: ChatMessagePart[]): string {
  return parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('');
}

/**
 * 将文件引用占位符展开为模型可读文本。
 */
export function expandFileReferencesForModel(content: string): string {
  return content.replace(/\{\{file-ref:(\{.*?\})\}\}/g, (match: string, payload: string): string => {
    try {
      const parsed: unknown = JSON.parse(payload);
      if (!isRecord(parsed) || (typeof parsed.path !== 'string' && parsed.path !== null)) {
        return match;
      }

      const line = typeof parsed.line === 'number' || typeof parsed.line === 'string' ? String(parsed.line) : '';
      if (!line) return match;

      if (parsed.path === null) {
        const fileName = typeof parsed.name === 'string' && parsed.name ? parsed.name : '未保存文件';
        return `引用未保存文件：${fileName}，第 ${line} 行`;
      }

      return `引用文件：${parsed.path}，第 ${line} 行`;
    } catch {
      return match;
    }
  });
}

// ─── is —— 消息类型判断 ──────────────────────────────────────────────────────

export const is = {
  /**
   * 判断消息是否可传给模型。
   */
  modelMessage(message: Message): message is ModelCompatibleMessage {
    return message.role === 'user' || message.role === 'assistant';
  },

  /**
   * 判断消息是否可持久化。
   */
  persistableMessage(message: Message): message is PersistableMessage {
    return message.role === 'user' || message.role === 'assistant' || message.role === 'error';
  },

  /**
   * 判断 assistant 消息是否仍可视为空占位。
   */
  removableAssistantPlaceholder(message: Message | undefined): boolean {
    if (!message || message.role !== 'assistant') return false;
    return !message.content && !message.usage && !message.parts.length;
  }
} as const;

// ─── append —— 消息片段追加 ──────────────────────────────────────────────────

export const append = {
  /**
   * 将文本增量追加到消息片段。
   */
  textPart(message: Message, text: string): void {
    const lastPart = message.parts[message.parts.length - 1];
    if (lastPart?.type === 'text') {
      lastPart.text += text;
    } else {
      message.parts.push({ type: 'text', text });
    }
    message.content = getMessagePlainText(message.parts);
  },

  /**
   * 将思考增量追加到消息片段。
   */
  thinkingPart(message: Message, thinking: string): void {
    const lastPart = message.parts[message.parts.length - 1];
    if (lastPart?.type === 'thinking') {
      lastPart.thinking += thinking;
    } else {
      message.parts.push({ type: 'thinking', thinking });
    }
    message.thinking = (message.thinking ?? '') + thinking;
  },

  /**
   * 将工具调用追加到消息片段。
   */
  toolCallPart(message: Message, toolCallId: string, toolName: string, input: unknown): void {
    message.parts.push({ type: 'tool-call', toolCallId, toolName, input });
  },

  /**
   * 将工具结果追加到消息片段。
   * 结果会被插入到对应 tool-call 之后；若找不到则追加到末尾。
   */
  toolResultPart(message: Message, toolCallId: string, toolName: string, result: ToolResult): void {
    const resultPart: Extract<ChatMessagePart, { type: 'tool-result' }> = {
      type: 'tool-result',
      toolCallId,
      toolName,
      result
    };
    const toolCallIndex = message.parts.findIndex((part) => part.type === 'tool-call' && part.toolCallId === toolCallId);

    if (toolCallIndex === -1) {
      message.parts.push(resultPart);
    } else {
      message.parts.splice(toolCallIndex + 1, 0, resultPart);
    }
  }
} as const;

// ── 对外 ─────────────────────────────────────────────
function createBase(overrides: Partial<Message>): Message {
  return { id: nanoid(), parts: [], loading: false, createdAt: new Date().toISOString(), ...overrides } as Message;
}

export const create = {
  // 创建 assistant 消息占位符
  assistantPlaceholder(): Message {
    return createBase({ role: 'assistant', content: '', thinking: '', createdAt: '', loading: true });
  },
  // 创建错误消息
  errorMessage(content: string): Message {
    return createBase({ role: 'assistant', content, parts: [{ type: 'error', text: content }], finished: true });
  },
  // 创建用户消息
  userMessage(content: string, references?: Message['references']): Message {
    return createBase({ role: 'user', content, references, parts: [{ type: 'text', text: content }], finished: true });
  }
} as const;

// ─── find / submit —— 用户选择题流程 ─────────────────────────────────────────

function isAwaitingUserChoiceResult(part: ChatMessagePart): part is ChatMessageToolResultPart & { result: AIToolExecutionAwaitingUserInputResult } {
  return part.type === 'tool-result' && part.toolName === 'ask_user_choice' && part.result.status === 'awaiting_user_input';
}

export const userChoice = {
  /**
   * 查找消息历史中尚未回答的用户选择问题。
   */
  findPending(sourceMessages: Message[]): AIAwaitingUserChoiceQuestion | null {
    for (let i = sourceMessages.length - 1; i >= 0; i -= 1) {
      const pendingPart = sourceMessages[i].parts.find(isAwaitingUserChoiceResult);
      if (pendingPart?.result.status === 'awaiting_user_input') {
        return pendingPart.result.data;
      }
    }
    return null;
  },

  /**
   * 将等待用户选择的工具结果替换为用户答案。
   * @returns 是否成功提交
   */
  submitAnswer(sourceMessages: Message[], answer: AIUserChoiceAnswerData): boolean {
    for (let i = sourceMessages.length - 1; i >= 0; i -= 1) {
      const resultPart = sourceMessages[i].parts.find(
        (part) => isAwaitingUserChoiceResult(part) && part.toolCallId === answer.toolCallId && part.result.data.questionId === answer.questionId
      );

      if (resultPart?.type !== 'tool-result') continue;

      resultPart.result = { toolName: 'ask_user_choice', status: 'success', data: answer };
      return true;
    }
    return false;
  }
} as const;

// ─── convert —— 消息格式转换 ─────────────────────────────────────────────────

/** 收集当前 assistant 片段中已完成配对的 tool-call ID */
function collectCompletedToolCallIds(parts: ChatMessagePart[]): Set<string> {
  const completed = new Set<string>();
  const pending = new Set<string>();

  for (const part of parts) {
    if (part.type === 'tool-call') {
      pending.add(part.toolCallId);
    } else if (part.type === 'tool-result' && pending.has(part.toolCallId)) {
      completed.add(part.toolCallId);
    }
  }
  return completed;
}

/** 将 assistant 消息片段转换为 AI SDK 所需的多条模型消息 */
function toAssistantModelMessages(parts: ChatMessagePart[]): ModelMessage[] {
  const modelMessages: ModelMessage[] = [];
  const completedToolCallIds = collectCompletedToolCallIds(parts);

  let assistantParts: AssistantModelMessageContent = [];
  let toolResultParts: ToolModelMessageContent = [];

  const flushAssistant = (): void => {
    if (assistantParts.length) {
      modelMessages.push({ role: 'assistant', content: assistantParts });
      assistantParts = [];
    }
  };

  const flushToolResults = (): void => {
    if (toolResultParts.length) {
      modelMessages.push({ role: 'tool', content: toolResultParts });
      toolResultParts = [];
    }
  };

  for (const part of parts) {
    if (part.type === 'text') {
      flushToolResults();
      assistantParts.push({ type: 'text', text: part.text });
      continue;
    }

    if (part.type === 'tool-call') {
      flushToolResults();
      if (completedToolCallIds.has(part.toolCallId)) {
        assistantParts.push({
          type: 'tool-call',
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          input: part.input
        });
      }
      continue;
    }

    if (part.type === 'tool-result') {
      flushAssistant();
      toolResultParts.push({
        type: 'tool-result',
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        output: { type: 'json', value: toJsonValue(part.result) }
      });
    }
  }

  flushAssistant();
  flushToolResults();
  return modelMessages;
}

/** 生成参与模型转换的消息签名，用于判断缓存是否还能复用 */
function createModelMessageSignature(message: Message): string {
  return JSON.stringify({ role: message.role, content: message.content, parts: message.parts });
}

/** 判断单条消息是否可以直接复用已有缓存条目 */
function canReuseCachedEntry(entry: CachedModelMessageEntry, message: Message): boolean {
  return entry.sourceMessage.id === message.id && entry.sourceMessage.role === message.role && entry.signature === createModelMessageSignature(message);
}

/** 将单条组件消息转换为 AI SDK 的 ModelMessage 列表 */
function toModelMessagesForMessage(message: Message): ModelMessage[] {
  if (!is.modelMessage(message)) return [];
  if (message.role === 'user') return [{ role: 'user', content: message.content }];
  return toAssistantModelMessages(message.parts);
}

export const convert = {
  /**
   * 将组件消息转换为带缓存的模型消息结果，尽量复用前缀历史。
   */
  toCachedModelMessages(sourceMessages: Message[], previousCache?: CachedModelMessagesResult): CachedModelMessagesResult {
    const entries: CachedModelMessageEntry[] = [];
    const modelMessages: ModelMessage[] = [];
    let reuseCount = 0;

    if (previousCache) {
      const maxReuse = Math.min(sourceMessages.length, previousCache.entries.length);
      while (reuseCount < maxReuse) {
        const prev = previousCache.entries[reuseCount];
        const msg = sourceMessages[reuseCount];
        if (!canReuseCachedEntry(prev, msg)) break;

        entries.push(prev);
        modelMessages.push(...prev.modelMessages);
        reuseCount += 1;
      }
    }

    for (let i = reuseCount; i < sourceMessages.length; i += 1) {
      const sourceMessage = sourceMessages[i];
      const nextModelMessages = toModelMessagesForMessage(sourceMessage);
      entries.push({
        sourceMessage,
        signature: createModelMessageSignature(sourceMessage),
        modelMessages: nextModelMessages
      });
      modelMessages.push(...nextModelMessages);
    }

    return { entries, modelMessages };
  },

  /**
   * 将组件消息转换为 AI SDK 的 ModelMessage 列表（无缓存版）。
   */
  toModelMessages(sourceMessages: Message[]): ModelMessage[] {
    return convert.toCachedModelMessages(sourceMessages).modelMessages;
  }
} as const;
