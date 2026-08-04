/**
 * @file stream/message-parts.mts
 * @description ChatRuntime assistant 消息片段写入。
 */
import type {
  RuntimeToolCallChunk,
  RuntimeToolInputDeltaChunk,
  RuntimeToolInputEndChunk,
  RuntimeToolInputStartChunk,
  RuntimeToolResultChunk
} from './types.mjs';
import type { AIUsage, ChatToolActivitySnapshot } from 'types/ai';
import type { ChatMessageRecord, ChatMessageToolPart } from 'types/chat';
import { nanoid } from 'nanoid';

/**
 * 将文本增量写入 assistant 消息。
 * @param message - assistant 消息
 * @param text - 文本增量
 */
export function appendTextDelta(message: ChatMessageRecord, text: string): void {
  const lastPart = message.parts[message.parts.length - 1];
  if (lastPart?.type === 'text') {
    lastPart.text += text;
  } else {
    message.parts.push({ id: nanoid(), type: 'text', text });
  }

  message.content = `${message.content}${text}`;
  message.loading = false;
  message.finished = false;
}

/**
 * 将 reasoning 增量写入 assistant 消息。
 * @param message - assistant 消息
 * @param thinking - reasoning 增量
 */
export function appendReasoningDelta(message: ChatMessageRecord, thinking: string): void {
  const lastPart = message.parts[message.parts.length - 1];
  if (lastPart?.type === 'thinking') {
    lastPart.thinking += thinking;
  } else {
    message.parts.push({ id: nanoid(), type: 'thinking', thinking });
  }

  message.thinking = `${message.thinking ?? ''}${thinking}`;
  message.loading = false;
  message.finished = false;
}

/**
 * 查找或创建 assistant 工具片段。
 * @param message - assistant 消息
 * @param toolCallId - 工具调用 ID
 * @param toolName - 工具名称
 * @returns 工具片段
 */
function ensureToolPart(message: ChatMessageRecord, toolCallId: string, toolName: string): ChatMessageToolPart {
  const existingPart = message.parts.find((part): part is ChatMessageToolPart => part.type === 'tool' && part.toolCallId === toolCallId);
  if (existingPart) {
    existingPart.toolName = toolName;
    return existingPart;
  }

  const toolPart: ChatMessageToolPart = {
    id: nanoid(),
    type: 'tool',
    toolCallId,
    toolName,
    status: 'inputting',
    input: null,
    inputText: ''
  };
  message.parts.push(toolPart);

  return toolPart;
}

/**
 * 写入工具输入开始片段。
 * @param message - assistant 消息
 * @param chunk - 工具输入开始 chunk
 */
export function appendToolInputStart(message: ChatMessageRecord, chunk: RuntimeToolInputStartChunk): void {
  const toolPart = ensureToolPart(message, chunk.toolCallId, chunk.toolName);
  if (chunk.providerMetadata !== undefined) {
    toolPart.providerMetadata = chunk.providerMetadata;
  }
  message.loading = false;
  message.finished = false;
}

/**
 * 写入工具输入增量片段。
 * @param message - assistant 消息
 * @param chunk - 工具输入增量 chunk
 */
export function appendToolInputDelta(message: ChatMessageRecord, chunk: RuntimeToolInputDeltaChunk): void {
  const existingPart = message.parts.find((part): part is ChatMessageToolPart => part.type === 'tool' && part.toolCallId === chunk.toolCallId);
  if (!existingPart) return;

  existingPart.inputText = `${existingPart.inputText ?? ''}${chunk.inputTextDelta}`;
  try {
    existingPart.input = JSON.parse(existingPart.inputText) as unknown;
  } catch {
    // 流式 JSON 在未闭合前 parse 失败是正常状态，保留上一次成功解析的值，
    // 避免 UI 在增量之间出现“突然清空又恢复”的闪烁。
  }
  message.loading = false;
  message.finished = false;
}

/**
 * 写入工具输入结束片段。
 * @param message - assistant 消息
 * @param chunk - 工具输入结束 chunk
 */
export function appendToolInputEnd(message: ChatMessageRecord, chunk: RuntimeToolInputEndChunk): void {
  const existingPart = message.parts.find((part): part is ChatMessageToolPart => part.type === 'tool' && part.toolCallId === chunk.toolCallId);
  if (!existingPart) return;

  existingPart.status = 'executing';
  message.loading = false;
  message.finished = false;
}

/**
 * 写入可执行工具调用片段。
 * @param message - assistant 消息
 * @param chunk - 工具调用 chunk
 */
export function appendToolCall(message: ChatMessageRecord, chunk: RuntimeToolCallChunk): void {
  const toolPart = ensureToolPart(message, chunk.toolCallId, chunk.toolName);
  toolPart.status = 'executing';
  toolPart.input = chunk.input;
  if (chunk.providerMetadata !== undefined) {
    toolPart.providerMetadata = chunk.providerMetadata;
  }
  message.loading = false;
  message.finished = false;
}

/**
 * 将 Watchdog 安全活动快照投影到目标工具 Part。
 * @param message - assistant 消息
 * @param toolCallId - 工具调用 ID
 * @param activity - Watchdog 已验证的活动快照
 * @returns 是否找到并更新了目标 Part
 */
export function applyToolActivity(message: ChatMessageRecord, toolCallId: string, activity: ChatToolActivitySnapshot): boolean {
  const toolPart = message.parts.find((part): part is ChatMessageToolPart => part.type === 'tool' && part.toolCallId === toolCallId);
  if (!toolPart || toolPart.status === 'done') return false;

  toolPart.activity = structuredClone(activity);
  message.loading = false;
  message.finished = false;
  return true;
}

/**
 * 写入工具结果片段。
 * @param message - assistant 消息
 * @param chunk - 工具结果 chunk
 */
export function appendToolResult(message: ChatMessageRecord, chunk: RuntimeToolResultChunk): void {
  const toolPart = ensureToolPart(message, chunk.toolCallId, chunk.toolName);
  toolPart.status = 'done';
  toolPart.result = chunk.result;
  delete toolPart.activity;
  message.finished = false;
}

/**
 * 标记 assistant 消息完成。
 * @param message - assistant 消息
 * @param usage - usage
 */
export function finishAssistantMessage(message: ChatMessageRecord, usage?: AIUsage): void {
  message.loading = false;
  message.finished = true;
  if (usage) {
    message.usage = usage;
  }
}
