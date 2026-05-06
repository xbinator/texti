/**
 * @file planner.ts
 * @description 消息保留规则切分：根据保留规则将消息分为保留原文、文件语义和可摘要三类。
 */
import type { MessageClassificationResult } from './types';
import { partition } from 'lodash-es';
import type { Message } from '@/components/BChatSidebar/utils/types';

/**
 * 判断 assistant 消息是否含有未完成的工具调用（有 tool-call 但没有对应 tool-result）。
 */
function hasUnfinishedToolCalls(message: Message): boolean {
  if (message.role !== 'assistant') return false;
  const partTypes = message.parts.map((p) => p.type);
  const hasToolCall = partTypes.includes('tool-call');
  const hasToolResult = partTypes.includes('tool-result');
  return hasToolCall && !hasToolResult;
}

/**
 * 判断消息是否含有等待用户回答的 ask_user_choice 交互。
 */
function hasAwaitingUserChoice(message: Message): boolean {
  if (message.role !== 'assistant') return false;
  return message.parts.some(
    (part) =>
      part.type === 'tool-result' &&
      part.toolName === 'ask_user_choice' &&
      typeof part.result === 'object' &&
      part.result !== null &&
      (part.result as unknown as Record<string, unknown>).status === 'awaiting_user_input'
  );
}

/**
 * 判断消息是否含有未完成的确认卡片。
 */
function hasPendingConfirmation(message: Message): boolean {
  if (message.role !== 'assistant') return false;
  return message.parts.some((part) => part.type === 'confirmation' && part.confirmationStatus === 'pending');
}

/**
 * 判断消息是否必须保留原文（未完成交互或位于保留窗口内）。
 */
function mustPreserve(message: Message): boolean {
  return hasUnfinishedToolCalls(message) || hasAwaitingUserChoice(message) || hasPendingConfirmation(message);
}

/**
 * 对用户消息和助手消息列表按保留规则切分。
 * @param messages - 全量消息列表
 * @param preserveRounds - 保留的最近消息轮数
 * @param currentUserMessageId - 当前用户消息 ID（用于排除）
 * @param excludeMessageIds - 需要显式排除的消息 ID 列表
 * @returns 消息分类结果
 */
export function planCompression(
  messages: Message[],
  preserveRounds: number,
  currentUserMessageId?: string,
  excludeMessageIds?: string[]
): MessageClassificationResult {
  const excludeSet = new Set(excludeMessageIds ?? []);
  if (currentUserMessageId) {
    excludeSet.add(currentUserMessageId);
  }

  // 只处理 user 和 assistant 消息
  const eligibleMessages = messages.filter((m) => (m.role === 'user' || m.role === 'assistant') && !excludeSet.has(m.id));

  // 计算保留窗口大小（条数）
  const preserveCount = preserveRounds * 2;

  // 最近的消息保留原文；当 preserveCount 为 0 时不保留任何最近消息
  const recentMessages = preserveCount > 0 ? eligibleMessages.slice(-preserveCount) : [];
  const olderMessages = preserveCount > 0 ? eligibleMessages.slice(0, -preserveCount) : eligibleMessages;

  // 先处理旧消息
  const [toPreserve, toCompress] = partition(olderMessages, mustPreserve);
  const preservedMessages: Message[] = [...toPreserve];
  const preservedMessageIds: string[] = toPreserve.map((msg) => msg.id);
  const compressibleMessages: Message[] = [...toCompress];

  // 最近窗口内的消息全部保留原文
  for (const msg of recentMessages) {
    preservedMessages.push(msg);
  }

  return {
    preservedMessages,
    fileSemanticMessages: [],
    compressibleMessages,
    preservedMessageIds
  };
}
