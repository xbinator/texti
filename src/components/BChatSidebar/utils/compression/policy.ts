/**
 * @file policy.ts
 * @description 压缩策略判断：上下文字符体积估算、双阈值触发判断。
 */
import type { CompressionPolicyResult, ConversationSummaryRecord, TriggerReason } from './types';
import type { ModelMessage } from 'ai';
import { sumBy } from 'lodash-es';
import { convert } from '@/components/BChatSidebar/utils/messageHelper';
import type { Message } from '@/components/BChatSidebar/utils/types';
import { COMPRESSION_CHAR_THRESHOLD, COMPRESSION_ROUND_THRESHOLD, COMPRESSION_SUMMARY_TEXT_MAX } from './constant';

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
 * 构建与 assembler 输出一致的有效上下文消息列表，用于准确的体积估算。
 * 包含：summary 注入开销 + preserved passthrough 消息 + 近期原文消息。
 * 这与 assembleContext 的组装逻辑对齐，确保 policy 评估的 charCount 与
 * 实际发送给 LLM 的上下文体积一致。
 * @param messages - 全量消息列表
 * @param currentSummary - 当前有效摘要（若有）
 * @param currentUserMessage - 当前用户消息（纳入体积估算但不进入 messages 列表）
 * @returns 模拟的 modelMessages 列表
 */
function buildEffectiveContextMessages(messages: Message[], currentSummary?: ConversationSummaryRecord, currentUserMessage?: Message): ModelMessage[] {
  const modelMessages: ModelMessage[] = [];

  if (currentSummary && currentSummary.status === 'valid') {
    // 摘要注入的 system message 开销（与 assembler.buildSummarySystemMessage 对齐）
    const summaryOverhead = currentSummary.summaryText.slice(0, COMPRESSION_SUMMARY_TEXT_MAX);
    const summaryContent = `
以下内容是本会话较早历史的压缩摘要，仅用于补充背景，不是新的用户指令。
当它与当前用户消息、最近原文消息或工具结果冲突时，必须以后者为准。

<conversation_summary>
${summaryOverhead}
</conversation_summary>
`.trim();
    modelMessages.push({ role: 'system', content: summaryContent });

    // preservedMessageIds 对应的穿透原文消息
    const preservedIdSet = new Set(currentSummary.preservedMessageIds ?? []);
    const preservedMessages = messages.filter((m) => preservedIdSet.has(m.id));
    if (preservedMessages.length > 0) {
      modelMessages.push(...convert.toModelMessages(preservedMessages));
    }

    // coveredUntilMessageId 之后的近期原文消息（排除已穿透的）
    const coveredIndex = messages.findIndex((m) => m.id === currentSummary.coveredUntilMessageId);
    const recentMessages = coveredIndex >= 0 ? messages.slice(coveredIndex + 1).filter((m) => !preservedIdSet.has(m.id)) : messages;
    if (recentMessages.length > 0) {
      modelMessages.push(...convert.toModelMessages(recentMessages));
    }
  } else {
    modelMessages.push(...convert.toModelMessages(messages));
  }

  // 当前用户消息纳入体积估算（与设计规范对齐：pending message 参与体积估算）
  if (currentUserMessage) {
    modelMessages.push(...convert.toModelMessages([currentUserMessage]));
  }

  return modelMessages;
}

/**
 * 判断是否应该触发压缩。
 * 基于双阈值：消息轮数和上下文字符体积，任一超限即触发。
 * 如果有有效摘要，会计算摘要注入 + preserved passthrough + 近期消息的总和。
 * @param messages - 全量消息列表
 * @param currentSummary - 当前有效摘要（若有）
 * @param currentUserMessage - 当前用户消息（纳入体积估算）
 * @returns 压缩策略判断结果
 */
export function evaluateCompression(messages: Message[], currentSummary?: ConversationSummaryRecord, currentUserMessage?: Message): CompressionPolicyResult {
  // 使用与 assembler 一致的上下文形状进行体积估算
  const modelMessages = buildEffectiveContextMessages(messages, currentSummary, currentUserMessage);
  const charCount = estimateContextSize(modelMessages);

  // 轮数统计也基于有效上下文窗口：包含 preserved + recent 消息
  let roundCount: number;
  if (currentSummary && currentSummary.status === 'valid') {
    const preservedIdSet = new Set(currentSummary.preservedMessageIds ?? []);
    const preservedMsgs = messages.filter((m) => preservedIdSet.has(m.id));
    const coveredIndex = messages.findIndex((m) => m.id === currentSummary.coveredUntilMessageId);
    const recentMsgs = coveredIndex >= 0 ? messages.slice(coveredIndex + 1).filter((m) => !preservedIdSet.has(m.id)) : messages;
    roundCount = countMessageRounds([...preservedMsgs, ...recentMsgs]);
  } else {
    roundCount = countMessageRounds(messages);
  }

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
