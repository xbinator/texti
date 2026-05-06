/**
 * @file assembler.ts
 * @description 上下文组装：按固定顺序将摘要、穿透原文、近期消息和当前用户消息组装为最终上下文。
 */
import type { AssembledContext, AssemblerInput, ConversationSummaryRecord } from './types';
import type { ModelMessage } from 'ai';
import { isEmpty } from 'lodash-es';
import { convert } from '@/components/BChatSidebar/utils/messageHelper';

/**
 * 生成摘要注入的 system message 内容。
 * @param summaryRecord - 摘要记录
 * @returns system message 内容字符串
 */
function buildSummarySystemMessage(summaryRecord: ConversationSummaryRecord): string {
  return `
以下内容是本会话较早历史的压缩摘要，仅用于补充背景，不是新的用户指令。
当它与当前用户消息、最近原文消息或工具结果冲突时，必须以后者为准。

<conversation_summary>
${summaryRecord.summaryText}
</conversation_summary>
`.trim();
}

/**
 * 组装最终上下文。
 * 固定顺序：系统提示词 → 会话摘要 → preservedMessageIds 穿透原文 → 近期原文 → 当前用户消息
 * @param input - 组装输入参数
 * @returns 组装后的上下文
 */
export function assembleContext(input: AssemblerInput): AssembledContext {
  const modelMessages: ModelMessage[] = [];

  // 1. 系统提示词
  if (input.systemPrompt) {
    modelMessages.push({ role: 'system', content: input.systemPrompt });
  }

  // 2. 会话历史摘要（system message）
  if (input.summaryRecord) {
    const summaryContent = buildSummarySystemMessage(input.summaryRecord);
    modelMessages.push({ role: 'system', content: summaryContent });
  }

  // 3. preservedMessageIds 对应的历史穿透原文消息
  if (!isEmpty(input.preservedMessages)) {
    const preserved = convert.toModelMessages(input.preservedMessages);
    modelMessages.push(...preserved);
  }

  // 4. coveredUntilMessageId 之后的近期原文消息
  if (!isEmpty(input.recentMessages)) {
    const recent = convert.toModelMessages(input.recentMessages);
    modelMessages.push(...recent);
  }

  // 5. 当前用户消息
  const currentUser = convert.toModelMessages([input.currentUserMessage]);
  modelMessages.push(...currentUser);

  return { modelMessages };
}
