/**
 * @file continuation.mts
 * @description ChatRuntime 续轮消息快照辅助函数。
 */
import type { AgentTerminalResultEnvelope } from '../../agents/types.mjs';
import type { ChatMessageRecord, ChatMessageToolPart } from 'types/chat';
import type { AgentOrderedToolCallSnapshot } from 'types/chat-agent';
import type { ChatRuntimeContinueInput } from 'types/chat-runtime';
import { ChatRuntimeError } from '../errors.mjs';

/**
 * 创建稳定的 continuation 协议错误。
 * @param reason - 机器原因
 * @returns 可由 Runtime failure 边界持久化的错误
 */
function createContinuationError(reason: string): ChatRuntimeError {
  return new ChatRuntimeError('INVALID_CONTINUATION', `protocol_error:${reason}`);
}

/**
 * 判断消息 Part 是否为指定 delegate_task 调用。
 * @param part - 消息 Part
 * @param toolCallId - 冻结 Provider tool-call ID
 * @returns 是否为目标委派 Part
 */
function isDelegatePart(part: ChatMessageRecord['parts'][number], toolCallId: string): part is ChatMessageToolPart {
  return part.type === 'tool' && part.toolName === 'delegate_task' && part.toolCallId === toolCallId;
}

/**
 * 按冻结 Provider tool-call 顺序把 Child 结构化结果注入 Runtime B assistant。
 * 输入消息保持不变；缺失、重复、乱序或额外结果一律 fail-closed。
 * @param assistant - Runtime A 已原子持久化的 assistant
 * @param orderedToolCalls - Continuation Snapshot 的冻结调用顺序
 * @param terminalResults - Store 已交叉校验的终态结果
 * @returns 注入完整工具结果的 assistant clone
 */
export function injectAgentResults(
  assistant: ChatMessageRecord,
  orderedToolCalls: readonly AgentOrderedToolCallSnapshot[],
  terminalResults: Readonly<Record<string, AgentTerminalResultEnvelope>>
): ChatMessageRecord {
  const orderedIds = orderedToolCalls.map((toolCall): string => toolCall.toolCallId);
  if (
    orderedIds.length === 0 ||
    new Set(orderedIds).size !== orderedIds.length ||
    Object.keys(terminalResults).length !== orderedIds.length ||
    Object.keys(terminalResults).some((toolCallId): boolean => !orderedIds.includes(toolCallId))
  ) {
    throw createContinuationError('terminal_result_set_invalid');
  }

  const clone = structuredClone(assistant);
  let previousPartIndex = -1;
  orderedToolCalls.forEach((toolCall): void => {
    const matches = clone.parts.map((part, index): number => (isDelegatePart(part, toolCall.toolCallId) ? index : -1)).filter((index): boolean => index >= 0);
    const envelope = terminalResults[toolCall.toolCallId];
    if (matches.length !== 1 || !envelope || envelope.result.taskId !== toolCall.taskId || matches[0] <= previousPartIndex) {
      throw createContinuationError('ordered_tool_result_invalid');
    }
    const partIndex = matches[0];
    const part = clone.parts[partIndex];
    if (!part || !isDelegatePart(part, toolCall.toolCallId)) {
      throw createContinuationError('delegate_part_missing');
    }
    previousPartIndex = partIndex;
    clone.parts[partIndex] = {
      id: part.id,
      type: 'tool',
      toolCallId: part.toolCallId,
      toolName: part.toolName,
      status: 'done',
      input: structuredClone(part.input),
      ...(part.providerMetadata !== undefined ? { providerMetadata: structuredClone(part.providerMetadata) } : {}),
      result: {
        toolName: 'delegate_task',
        status: 'success',
        data: structuredClone(envelope.result)
      }
    };
  });
  return clone;
}

/**
 * 从消息快照中查找最后一条 user 消息。
 * @param messages - 消息快照
 * @returns user 消息
 */
export function findLastRuntimeUserMessage(messages: ChatMessageRecord[]): ChatMessageRecord | undefined {
  return [...messages].reverse().find((message) => message.role === 'user');
}

/**
 * 查找最后一条 user 消息的索引。
 * @param messages - 消息快照
 * @returns user 消息索引，不存在时返回 -1
 */
function findLastRuntimeUserMessageIndex(messages: ChatMessageRecord[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user') {
      return index;
    }
  }

  return -1;
}

/**
 * 从最后一条 user 之后查找可续跑的 assistant 消息。
 * 历史上下文中的上一轮 assistant 不能被当作当前 user 的续跑草稿。
 * @param messages - 消息快照
 * @returns assistant 消息
 */
export function findLastRuntimeAssistantMessage(messages: ChatMessageRecord[]): ChatMessageRecord | undefined {
  const userIndex = findLastRuntimeUserMessageIndex(messages);
  if (userIndex === -1) {
    return undefined;
  }

  return messages
    .slice(userIndex + 1)
    .reverse()
    .find((message) => message.role === 'assistant');
}

/**
 * 将 renderer 续轮消息快照补齐为主进程持久化消息。
 * @param input - 续轮输入
 * @returns 可写入主进程存储的消息列表
 */
export function normalizeContinuationMessages(input: ChatRuntimeContinueInput): ChatMessageRecord[] {
  return input.messages.map((message) => ({
    ...message,
    sessionId: message.sessionId ?? input.sessionId
  }));
}
