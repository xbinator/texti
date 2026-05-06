/**
 * @file summarizer.ts
 * @description 摘要生成：规则裁剪 + AI 结构化摘要生成。
 */
import type { RuleTrimResult, TrimmedMessageItem } from './types';
import { compact, sumBy } from 'lodash-es';
import type { Message } from '@/components/BChatSidebar/utils/types';
import { COMPRESSION_INPUT_CHAR_LIMIT, COMPRESSION_SUMMARY_TEXT_MAX } from './constant';

/**
 * 判断是否为可移除的空 assistant 占位消息。
 */
function isEmptyAssistantPlaceholder(message: Message): boolean {
  return message.role === 'assistant' && !message.content && !message.usage && !message.parts.length;
}

/**
 * 从消息中提取裁剪后的文本内容。
 */
function extractTrimmedText(message: Message): string {
  // 处理 parts 内容生成摘要
  const partsText = compact(
    message.parts.map((part) => {
      if (part.type === 'text') return part.text;
      if (part.type === 'thinking') {
        return part.thinking.length > 100 ? `[thinking: ${part.thinking.slice(0, 100)}...]` : `[thinking: ${part.thinking}]`;
      }
      if (part.type === 'tool-call') {
        return `[tool-call: ${part.toolName}]`;
      }
      if (part.type === 'tool-result') {
        return `[tool-result: ${part.toolName}]`;
      }
      if (part.type === 'error') {
        return `[error: ${part.text}]`;
      }
      if (part.type === 'confirmation') {
        return `[confirmation: ${part.title} (${part.confirmationStatus})]`;
      }
      return '';
    })
  ).join(' ');
  // 如果有 content 文本，合并
  if (message.content) {
    // 如果有文件引用，保留路径和行号信息
    if (message.references?.length) {
      const refInfo = message.references
        .map((ref) => {
          const lineInfo = ref.startLine ? ` (lines ${ref.startLine}-${ref.endLine})` : '';
          const fileName = ref.path.split('/').pop() || ref.path;
          return `[file: ${fileName}${lineInfo}, intent: ${message.content.slice(0, 100)}]`;
        })
        .join('; ');
      return refInfo;
    }

    // content + partsText 合并
    return partsText ? `${message.content} ${partsText}` : message.content;
  }

  return partsText;
}

/**
 * 规则裁剪：移除空占位、去重错误、裁剪长内容、控制总字符数。
 * @param messages - 待裁剪的消息列表
 * @param charLimit - 输出字符硬上限
 * @returns 裁剪结果
 */
export function ruleTrim(messages: Message[], charLimit: number = COMPRESSION_INPUT_CHAR_LIMIT): RuleTrimResult {
  let truncated = false;
  let totalChars = 0;

  // 第一步：过滤空占位消息
  const filtered = messages.filter((m) => !isEmptyAssistantPlaceholder(m));

  // 第二步：提取裁剪文本并去重连续重复错误
  const items: TrimmedMessageItem[] = [];
  for (let i = 0; i < filtered.length; i += 1) {
    const msg = filtered[i];
    const trimmedText = extractTrimmedText(msg);

    // 去重：连续重复且内容完全相同的消息只保留第一条
    if (items.length > 0) {
      const prev = items[items.length - 1];
      if (prev.trimmedText === trimmedText) {
        continue;
      }
    }

    items.push({
      messageId: msg.id,
      role: msg.role === 'user' ? 'user' : 'assistant',
      trimmedText
    });
  }

  // 第三步：计算总字符数并应用硬上限截断
  for (let i = 0; i < items.length; i += 1) {
    const itemCharCount = items[i].trimmedText.length;
    if (totalChars + itemCharCount > charLimit) {
      // 达到上限，截断当前项并丢弃后续
      const remaining = charLimit - totalChars;
      if (remaining > 0 && i < items.length) {
        items[i].trimmedText = items[i].trimmedText.slice(0, remaining);
        totalChars += remaining;
        // 标记该项被截断
        items[i].trimmedText += '...';
      }
      // 丢弃后续项
      items.splice(i + 1);
      truncated = true;
      break;
    }
    totalChars += itemCharCount;
  }

  totalChars = sumBy(items, (item) => item.trimmedText.length);

  return {
    items,
    charCount: totalChars,
    truncated
  };
}

/**
 * 截断 summaryText 到硬上限。
 * @param text - 原始摘要文本
 * @param maxChars - 最大字符数
 * @returns 截断后的文本
 */
export function truncateSummaryText(text: string, maxChars: number = COMPRESSION_SUMMARY_TEXT_MAX): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}...`;
}
