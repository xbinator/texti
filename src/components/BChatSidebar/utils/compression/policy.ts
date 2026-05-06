/**
 * @file policy.ts
 * @description 压缩策略判断：上下文字符体积估算、双阈值触发判断。
 */
import type { CompressionPolicyResult, ConversationSummaryRecord, TriggerReason } from './types';
import type { ModelMessage } from 'ai';
import { sumBy } from 'lodash-es';
import { convert } from '@/components/BChatSidebar/utils/messageHelper';
import type { Message } from '@/components/BChatSidebar/utils/types';
import { COMPRESSION_CHAR_THRESHOLD, COMPRESSION_ROUND_THRESHOLD } from './constant';

/**
 * 估算单条 ModelMessage 的字符数。
 */
function estimateMessageCharCount(msg: ModelMessage): number {
  if (typeof msg.content === 'string') {
    return msg.content.length;
  }
  if (Array.isArray(msg.content)) {
    let count = 0;
    for (const part of msg.content) {
      if (part && typeof part === 'object') {
        count += JSON.stringify(part).length;
      }
    }
    return count;
  }
  return 0;
}

/**
 * 估算 ModelMessage[] 的字符体积。
 * 遍历所有消息的 content，将其序列化为字符串后累加字符数。
 * @param modelMessages - 模型消息列表
 * @returns 总字符数
 */
export function estimateContextSize(modelMessages: ModelMessage[]): number {
  return sumBy(modelMessages, estimateMessageCharCount);
}

/**
 * 计算会话中有效的消息轮数。
 * 一轮定义为一条 user 消息 + 一条 assistant 消息。
 * @param messages - 全量消息列表
 * @returns 消息轮数
 */
export function countMessageRounds(messages: Message[]): number {
  const userAndAssistant = messages.filter((m) => m.role === 'user' || m.role === 'assistant');
  // 每对 user+assistant 算一轮
  return Math.ceil(userAndAssistant.length / 2);
}

/**
 * 判断是否应该触发压缩。
 * 基于双阈值：消息轮数和上下文字符体积，任一超限即触发。
 * 如果有有效摘要，只计算摘要覆盖范围之外的消息。
 * @param messages - 全量消息列表
 * @param currentSummary - 当前有效摘要（若有）
 * @returns 压缩策略判断结果
 */
export function evaluateCompression(messages: Message[], currentSummary?: ConversationSummaryRecord): CompressionPolicyResult {
  // 如果有摘要，只计算摘要覆盖范围之外的消息
  let messagesToEvaluate = messages;
  if (currentSummary && currentSummary.status === 'valid') {
    const coveredIndex = messages.findIndex((m) => m.id === currentSummary.coveredUntilMessageId);
    if (coveredIndex !== -1) {
      messagesToEvaluate = messages.slice(coveredIndex + 1);
    }
  }

  // 将消息转换为 ModelMessage 以进行准确的体积估算
  const modelMessages = convert.toModelMessages(messagesToEvaluate);
  const charCount = estimateContextSize(modelMessages);
  const roundCount = countMessageRounds(messagesToEvaluate);

  const roundExceeded = roundCount >= COMPRESSION_ROUND_THRESHOLD;
  const charExceeded = charCount >= COMPRESSION_CHAR_THRESHOLD;

  let shouldCompress = false;
  let triggerReason: TriggerReason = 'message_count';

  if (roundExceeded) {
    shouldCompress = true;
    triggerReason = 'message_count';
  } else if (charExceeded) {
    shouldCompress = true;
    triggerReason = 'context_size';
  }

  return {
    shouldCompress,
    triggerReason,
    roundCount,
    charCount,
    currentSummary
  };
}
