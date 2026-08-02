/**
 * @file message.ts
 * @description BChat 消息创建、转换与持久化过滤工具。
 */
import type { Message } from './types';
import type { FileReference } from '../types';
import type { JSONValue, ModelMessage } from 'ai';
import type { AIAwaitingUserChoiceQuestion, AIToolExecutionAwaitingUserInputResult, AIToolExecutionCancelledResult } from 'types/ai';
import type {
  AIUserChoiceAnswerData,
  ChatMessageFilePart,
  ChatMessagePart,
  ChatMessageRole,
  ChatMessageShellRunState,
  ChatMessageShellOutputChunk,
  ChatMessageToolPart,
  ChatMessageWidgetResultPart
} from 'types/chat';
import type { ElectronShellRunEventEnvelope } from 'types/electron-api';
import type { WidgetDisplayPayload } from 'types/widget';
import dayjs from 'dayjs';
import { nanoid } from 'nanoid';
import { isPendingUserChoicePart } from '@/ai/chat/policies/pendingInteraction';
import { OPEN_WIDGET_TOOL_NAME } from '@/ai/tools/builtin/WidgetTool';
import { isWidgetDisplayPayload } from '@/shared/widget/protocol';
import { asyncTo } from '@/utils/asyncTo';
import { extractFileReferenceLines, findFileReferenceTokens } from '@/utils/file/reference';

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

/** User 模型消息内容片段 */
type UserModelMessageContent = Array<{ type: 'text'; text: string } | { type: 'image'; image: string; mediaType?: string }>;

/** 创建中断消息时可继承的 runtime 关联字段。 */
type InterruptSourceMessage = Pick<Message, 'agentId' | 'runtimeId' | 'parentRuntimeId'>;

/** 工具结果类型 */
export type ToolResult = NonNullable<ChatMessageToolPart['result']>;

/** 可渲染的 open_widget 工具片段。 */
export type WidgetToolPart = ChatMessageToolPart & { result: ToolResult & { status: 'success'; data: WidgetDisplayPayload } };

/** Shell 命令实时输出最多保留片段数量。 */
const MAX_SHELL_OUTPUT_CHUNK_COUNT = 80;

// ─── 内部工具函数 ────────────────────────────────────────────────────────────

/**
 * 将任意值转换为 JSON 可序列化值。
 * @param value - 任意值
 * @returns JSON 值
 */
function toJsonValue(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}

/**
 * 判断工具片段是否为可渲染的小组件运行态。
 * @param part - 消息片段
 * @returns 是否为 open_widget 小组件片段
 */
export function isWidgetToolPart(part: ChatMessagePart): part is WidgetToolPart {
  return part.type === 'tool' && part.toolName === OPEN_WIDGET_TOOL_NAME && part.result?.status === 'success' && isWidgetDisplayPayload(part.result.data);
}

/**
 * 创建模型可见的工具结果，避免把 UI 专用快照长期塞回模型上下文。
 * @param part - 工具消息片段
 * @returns 模型可见工具结果
 */
function createModelVisibleToolResult(part: ChatMessageToolPart & { result: ToolResult }): ToolResult {
  if (part.toolName !== OPEN_WIDGET_TOOL_NAME || part.result.status !== 'success' || !isWidgetDisplayPayload(part.result.data)) {
    return part.result;
  }

  return {
    ...part.result,
    data: {
      sessionId: part.result.data.sessionId,
      widgetId: part.result.data.widgetId,
      execution: part.result.data.execution
    }
  };
}

/**
 * 构建消息中的文件引用列表
 * @param content - 消息内容
 * @returns 文件引用数组，无引用时返回 undefined
 */
export async function buildMessageReferences(content: string) {
  const matches = findFileReferenceTokens(content);
  if (!matches.length) return undefined;

  // 去重：相同 token 只处理一次，避免重复读取文件
  const uniqueMatches = [...new Map(matches.map((match) => [match.token, match])).values()];

  const values = uniqueMatches.map(extractFileReferenceLines);

  const [, result] = await asyncTo(Promise.all(values));

  return result;
}

// ─── finalize —— 消息终态处理 ──────────────────────────────────────────────

/**
 * 将消息中所有未完成的运行态 part 标记为已取消。
 * 用于中止流式传输等非正常完成场景，避免 part 永远停留在运行中状态。
 * @param message - 待处理的助手消息
 */
export function finalizeInterruptedPartsAsCancelled(message: Message): void {
  for (const part of message.parts) {
    if (part.type === 'tool' && part.status !== 'done') {
      part.status = 'done';
      part.result = {
        toolName: part.toolName,
        status: 'cancelled',
        error: { code: 'USER_CANCELLED', message: '用户中止了操作' }
      } satisfies AIToolExecutionCancelledResult;
      delete part.inputText;
    }
  }
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
    return ['user', 'assistant', 'error', 'interrupt'].includes(message.role);
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
      message.parts.push({ id: nanoid(), type: 'text', text });
    }
    message.content = `${message.content ?? ''}${text}`;
  },

  /**
   * 将思考增量追加到消息片段。
   */
  thinkingPart(message: Message, thinking: string): void {
    const lastPart = message.parts[message.parts.length - 1];
    if (lastPart?.type === 'thinking') {
      lastPart.thinking += thinking;
    } else {
      message.parts.push({ id: nanoid(), type: 'thinking', thinking });
    }
    message.thinking = (message.thinking ?? '') + thinking;
  },

  /**
   * 将工具调用追加到消息片段。
   * 若未找到已有 tool-input 片段则新建，否则将同一 toolCallId 的片段状态从 inputting 切换为 executing。
   */
  toolCallPart(message: Message, toolCallId: string, toolName: string, input: unknown): void {
    const existingPart = message.parts.find((part): part is ChatMessageToolPart => part.type === 'tool' && part.toolCallId === toolCallId);
    if (existingPart) {
      existingPart.status = 'executing';
      existingPart.toolName = toolName;
      existingPart.input = input;
      delete existingPart.inputText;
      return;
    }

    message.parts.push({ id: nanoid(), type: 'tool', toolCallId, toolName, status: 'executing', input });
  },

  /**
   * 追加 Shell 命令实时输出片段。
   */
  shellOutputPart(message: Message, commandId: string, chunk: ChatMessageShellOutputChunk): void {
    const existingPart = message.parts.find((part): part is ChatMessageToolPart => part.type === 'tool' && part.toolCallId === commandId);
    if (!existingPart) {
      return;
    }

    const output = [...(existingPart.shellOutput ?? []), chunk];
    existingPart.shellOutput = output.slice(Math.max(0, output.length - MAX_SHELL_OUTPUT_CHUNK_COUNT));
  },

  /**
   * 将有序 Shell PTY 事件应用到对应工具片段。
   * @param message - 目标 assistant 消息
   * @param envelope - Shell 运行事件
   */
  shellRunEventPart(message: Message, envelope: ElectronShellRunEventEnvelope): void {
    const part = message.parts.find(
      (item): item is ChatMessageToolPart => item.type === 'tool' && item.toolCallId === envelope.commandId && item.toolName === 'run_shell_command'
    );
    if (!part) return;

    const state: ChatMessageShellRunState = part.shellRunState ?? {
      terminalContent: '',
      autoAnswers: [],
      lastSequence: 0,
      finished: false
    };
    if (state.finished || envelope.sequence <= state.lastSequence) return;

    if (envelope.event.type === 'terminal_update') state.terminalContent = envelope.event.content;
    if (envelope.event.type === 'auto_answer') {
      state.autoAnswers = [...state.autoAnswers, envelope.event.count].slice(-20);
    }
    state.lastSequence = envelope.sequence;
    if (envelope.event.type === 'finished') state.finished = true;
    part.shellRunState = state;
  },

  /**
   * 追加工具输入预览片段。
   * 流式开始时新建 type: 'tool'，status: 'inputting' 的片段。
   */
  toolInputStartPart(message: Message, toolCallId: string, toolName: string): void {
    const existingPart = message.parts.find((part): part is ChatMessageToolPart => part.type === 'tool' && part.toolCallId === toolCallId);
    if (existingPart) {
      existingPart.toolName = toolName;
      return;
    }

    message.parts.push({ id: nanoid(), type: 'tool', toolCallId, toolName, status: 'inputting', input: null, inputText: '' });
  },

  /**
   * 更新工具输入预览片段。
   */
  toolInputDeltaPart(message: Message, toolCallId: string, inputTextDelta: string, input: unknown): void {
    const existingPart = message.parts.find((part): part is ChatMessageToolPart => part.type === 'tool' && part.toolCallId === toolCallId);
    if (!existingPart) {
      return;
    }

    existingPart.inputText = (existingPart.inputText ?? '') + inputTextDelta;
    if (input !== undefined) {
      existingPart.input = input;
    }
  },

  /**
   * 将工具结果更新到对应 tool 片段。
   * 将同一 toolCallId 的片段状态从 executing 切换为 done，并写入执行结果。
   */
  toolResultPart(message: Message, toolCallId: string, toolName: string, result: ToolResult): void {
    const existingPart = message.parts.find((part): part is ChatMessageToolPart => part.type === 'tool' && part.toolCallId === toolCallId);
    if (existingPart) {
      existingPart.status = 'done';
      existingPart.toolName = toolName;
      existingPart.result = result;
      delete existingPart.inputText;
      return;
    }

    message.parts.push({ id: nanoid(), type: 'tool', toolCallId, toolName, status: 'done', input: null, result });
  }
} as const;

// ── 对外 ─────────────────────────────────────────────
export function createBase(overrides: Partial<Message>): Message {
  const message = { id: nanoid(), parts: [], loading: false, createdAt: dayjs().toISOString(), ...overrides } as Message;
  return message;
}

export const create = {
  /**
   * 创建 assistant 消息占位符。
   * @returns assistant 占位消息
   */
  assistantPlaceholder(): Message {
    return createBase({ role: 'assistant', content: '', thinking: '', loading: true, finished: false });
  },
  /**
   * 创建错误消息。
   * @param content - 错误内容
   * @returns 错误消息
   */
  errorMessage(content: string): Message {
    return createBase({ role: 'error', content, parts: [{ id: nanoid(), type: 'error', text: content }], finished: true });
  },
  /**
   * 创建中断消息。
   * @param sourceMessage - 可选的源消息，用于继承 runtime 关联字段
   * @returns 中断消息
   */
  interruptMessage(sourceMessage?: InterruptSourceMessage): Message {
    return createBase({
      role: 'interrupt',
      content: '已中断',
      parts: [],
      loading: false,
      finished: true,
      ...(sourceMessage?.agentId !== undefined ? { agentId: sourceMessage.agentId } : {}),
      ...(sourceMessage?.runtimeId !== undefined ? { runtimeId: sourceMessage.runtimeId } : {}),
      ...(sourceMessage?.parentRuntimeId !== undefined ? { parentRuntimeId: sourceMessage.parentRuntimeId } : {})
    });
  },
  /**
   * 创建用户消息。
   * @param content - 用户输入文本
   * @param references - 文件引用列表
   * @returns 用户消息
   */
  userMessage(content: string, references?: FileReference[]): Message {
    const parts: ChatMessagePart[] = content ? [{ id: nanoid(), type: 'text', text: content }] : [];

    return createBase({ role: 'user', content, parts, references, finished: true });
  }
} as const;

// ─── find / submit —— 用户选择题流程 ─────────────────────────────────────────

export function isAwaitingUserChoiceResult(part: ChatMessagePart): part is ChatMessageToolPart & { result: AIToolExecutionAwaitingUserInputResult } {
  return isPendingUserChoicePart(part);
}

export const userChoice = {
  /**
   * 将等待用户选择的消息归一化为未完成的 loading 状态。
   * @param sourceMessage - 待归一化消息
   * @returns 状态一致的消息
   */
  normalizePendingState(sourceMessage: Message): Message {
    if (!sourceMessage.parts.some(isAwaitingUserChoiceResult)) return sourceMessage;
    if (sourceMessage.loading === true && sourceMessage.finished === false) return sourceMessage;
    return { ...sourceMessage, loading: true, finished: false };
  },

  /**
   * 将最后一个等待用户输入的问题标记为已取消。
   * @param sourceMessages - 待更新的消息列表
   * @returns 被更新的 assistant 消息；不存在待取消问题时返回 null
   */
  cancelPending(sourceMessages: Message[]): Message | null {
    for (let i = sourceMessages.length - 1; i >= 0; i -= 1) {
      const sourceMessage = sourceMessages[i];
      const pendingPart = sourceMessage.parts.find(isAwaitingUserChoiceResult);

      if (!pendingPart) continue;

      const resultPart: ChatMessageToolPart = pendingPart;
      resultPart.status = 'done';
      resultPart.result = {
        toolName: resultPart.toolName,
        status: 'cancelled',
        error: { code: 'USER_CANCELLED', message: '用户中止了操作' }
      } satisfies AIToolExecutionCancelledResult;
      delete resultPart.inputText;
      sourceMessage.loading = false;
      sourceMessage.finished = true;
      return sourceMessage;
    }

    return null;
  },

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

      if (resultPart?.type !== 'tool') continue;

      const isUserCancelled =
        answer.answers.length === 0 &&
        answer.otherText === '' &&
        (answer.questionAnswers ?? []).every((qa) => qa.answers.length === 0 && (qa.text ?? '') === '');

      if (isUserCancelled) {
        resultPart.result = { toolName: resultPart.toolName, status: 'cancelled', error: { code: 'USER_CANCELLED', message: '用户取消了选择' } };
      } else {
        resultPart.result = { toolName: resultPart.toolName, status: 'success', data: answer };
      }

      return true;
    }
    return false;
  }
} as const;

// ─── convert —— 消息格式转换 ─────────────────────────────────────────────────

/** 收集当前 assistant 片段中已完成配对的 tool-call ID */
function collectCompletedToolCallIds(parts: ChatMessagePart[]): Set<string> {
  const completed = new Set<string>();

  for (const part of parts) {
    if (part.type === 'tool' && part.result) {
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

    if (part.type === 'tool') {
      // inputting 阶段（流式输入中）暂不生成任何模型消息
      if (part.status === 'inputting') {
        continue;
      }

      // 已完成且有结果的 tool 片段需同时生成 tool-call 和 tool-result
      if (part.status === 'done' && part.result && completedToolCallIds.has(part.toolCallId)) {
        flushToolResults();
        assistantParts.push({
          type: 'tool-call',
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          input: part.input
        });
        flushAssistant();
        toolResultParts.push({
          type: 'tool-result',
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          output: { type: 'json', value: toJsonValue(createModelVisibleToolResult({ ...part, result: part.result })) }
        });
        continue;
      }

      // executing 阶段（等待结果），若有结果则生成 tool-call
      if (completedToolCallIds.has(part.toolCallId)) {
        flushToolResults();
        assistantParts.push({
          type: 'tool-call',
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          input: part.input
        });
      }
    }
  }

  flushAssistant();
  flushToolResults();
  return modelMessages;
}

/** 生成参与模型转换的消息签名，用于判断缓存是否还能复用 */
function createModelMessageSignature(message: Message): string {
  return JSON.stringify({
    role: message.role,
    content: message.content,
    parts: message.parts,
    files: message.files?.map((file) => ({
      id: file.id,
      type: file.type,
      mimeType: file.mimeType,
      size: file.size,
      contentHash: file.contentHash
    }))
  });
}

/** 判断单条消息是否可以直接复用已有缓存条目 */
function canReuseCachedEntry(entry: CachedModelMessageEntry, message: Message): boolean {
  return entry.sourceMessage.id === message.id && entry.sourceMessage.role === message.role && entry.signature === createModelMessageSignature(message);
}

/**
 * 判断消息片段是否为 file part。
 * @param part - 消息片段
 * @returns 是否为 file part
 */
function isFilePart(part: ChatMessagePart): part is ChatMessageFilePart {
  return part.type === 'file';
}

/**
 * 判断消息片段是否为 Widget 提交结果。
 * @param part - 消息片段
 * @returns 是否为 Widget 提交结果
 */
function isWidgetResultPart(part: ChatMessagePart): part is ChatMessageWidgetResultPart {
  return part.type === 'widget_result';
}

/**
 * 判断用户消息是否包含需要以 content part 传递的结构化文本片段。
 * @param message - 用户消息
 * @returns 是否包含结构化文本片段
 */
function hasStructuredUserTextPart(message: ModelCompatibleMessage): boolean {
  return message.parts.some(isWidgetResultPart);
}

/**
 * 将结构化用户片段转为模型可读文本。
 * @param value - 结构化片段
 * @returns JSON 文本
 */
function stringifyUserModelTextValue(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * 转义 XML 属性值。
 * @param value - 原始属性值
 * @returns 转义后的属性值
 */
function escapeXmlAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * 将文件片段转为模型兼容的 XML 文本。
 * @param part - 文件片段
 * @returns XML 文本片段
 */
function toUserFileXmlText(part: ChatMessageFilePart): string {
  const lines = `${part.snapshot.startLine}-${part.snapshot.endLine}`;
  return `<file path="${escapeXmlAttribute(part.path)}" lines="${lines}">\n${part.snapshot.content}\n</file>`;
}

/**
 * 将用户消息片段合并为单个模型文本。
 * @param message - 用户消息
 * @returns 模型文本
 */
function createUserModelText(message: ModelCompatibleMessage): string {
  if (message.parts.length) {
    let text = '';
    for (const part of message.parts) {
      if (part.type === 'text' && part.text) {
        text += part.text;
      } else if (isFilePart(part)) {
        text += toUserFileXmlText(part);
      } else if (isWidgetResultPart(part)) {
        text += `${text ? '\n' : ''}${stringifyUserModelTextValue(part)}`;
      } else if (part.type === 'skill_reference') {
        text += `$${part.name}`;
      }
    }
    return text;
  }

  return message.content;
}

/**
 * 将用户消息转换为模型内容片段。
 * @param message - 用户消息
 * @returns 模型内容片段
 */
function toUserContentParts(message: ModelCompatibleMessage): UserModelMessageContent {
  const contentParts: UserModelMessageContent = [];
  const userText = createUserModelText(message);
  if (userText) contentParts.push({ type: 'text', text: userText });

  const imageFiles = message.files?.filter((file) => file.type === 'image' && file.url) ?? [];
  for (const file of imageFiles) {
    contentParts.push({ type: 'image', image: file.url!, mediaType: file.mimeType });
  }

  return contentParts;
}

/** 将单条组件消息转换为 AI SDK 的 ModelMessage 列表 */
function toModelMessagesForMessage(message: Message): ModelMessage[] {
  if (!is.modelMessage(message)) return [];
  if (message.role === 'user') {
    const imageFiles = message.files?.filter((file) => file.type === 'image' && file.url) ?? [];
    if (!imageFiles.length && !hasStructuredUserTextPart(message)) {
      const userText = createUserModelText(message);
      return userText ? [{ role: 'user', content: userText }] : [];
    }

    const contentParts = toUserContentParts(message);
    if (!contentParts.length) return [];
    return [{ role: 'user', content: contentParts }];
  }
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

/**
 * 提取消息中最后一个文本片段的内容
 * @param message - 聊天消息
 * @returns 最后一个文本片段的内容，不存在时返回消息聚合内容
 */
export function extractLastTextPart(message: Message): string {
  for (let i = message.parts.length - 1; i >= 0; i -= 1) {
    const part = message.parts[i];
    if (part.type === 'text') {
      return part.text;
    }
  }
  return message.content;
}
