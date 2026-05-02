/**
 * @file fileReferenceContext.ts
 * @description 基于结构化文件引用片段构建模型可读的引用索引上下文。
 */
import type { ChatMessageFileReferencePart, ChatReferenceSnapshot } from 'types/chat';
import type { Message } from '@/components/BChatSidebar/utils/types';

/**
 * 读取消息中的文件引用片段。
 * @param message - 聊天消息
 * @returns 文件引用片段列表
 */
function collectFileReferenceParts(message: Message): ChatMessageFileReferencePart[] {
  return message.parts.filter((part): part is ChatMessageFileReferencePart => part.type === 'file-reference');
}

/**
 * 将单个文件引用片段格式化为模型侧索引文本。
 * @param reference - 文件引用片段
 * @returns 单行索引文本
 */
function formatReferenceLine(reference: ChatMessageFileReferencePart): string {
  const lineLabel =
    reference.startLine > 0
      ? `lines ${reference.startLine}${reference.endLine > reference.startLine ? `-${reference.endLine}` : ''}`
      : 'no explicit line range';
  const unsavedLabel = reference.path ? '' : ' (unsaved document)';

  return `- ${reference.referenceId}: ${reference.fileName}${unsavedLabel} (${lineLabel})`;
}

/**
 * 构建模型侧文件引用索引块。
 * @param references - 文件引用片段列表
 * @returns 引用索引文本；无引用时返回空字符串
 */
function buildReferenceIndexBlock(references: ChatMessageFileReferencePart[]): string {
  if (!references.length) {
    return '';
  }

  return [
    'Available file references for this message:',
    ...references.map(formatReferenceLine),
    '',
    'File contents are not included yet.',
    'If needed, call read_reference with the referenceId.',
    'Prefer reading a small window first.'
  ].join('\n');
}

/**
 * 构建面向模型的就绪消息列表，将结构化引用片段改写为引用索引块。
 * @param sourceMessages - 原始聊天消息
 * @param snapshotsById - snapshotId → 快照的映射；当前仅用于确保引用快照已预加载
 * @returns 模型就绪消息列表
 */
export function buildModelReadyMessages(sourceMessages: Message[], snapshotsById: Map<string, ChatReferenceSnapshot>): Message[] {
  void snapshotsById;

  return sourceMessages.map((message) => {
    if (message.role !== 'user') {
      return message;
    }

    const references = collectFileReferenceParts(message);
    const referenceIndexBlock = buildReferenceIndexBlock(references);
    if (!referenceIndexBlock) {
      return message;
    }

    const content = `${referenceIndexBlock}\n\n${message.content}`.trim();
    return {
      ...message,
      content,
      parts: [{ type: 'text', text: content }]
    };
  });
}
