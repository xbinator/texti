/**
 * @file fileReferenceContext.ts
 * @description 从持久化的快照构建仅面向模型的文件引用上下文，同时保持可见的聊天内容不变。
 */
import type { ChatMessageFileReference, ChatReferenceSnapshot } from 'types/chat';
import { isEmpty, groupBy, flatMap, join, compact, min, max } from 'lodash-es';
import type { Message } from '@/components/BChatSidebar/utils/types';

const SMALL_DOCUMENT_LINE_THRESHOLD = 200;
const MEDIUM_DOCUMENT_LINE_THRESHOLD = 800;
const CONTEXT_WINDOW_LINES = 120;

export interface ParsedLineRange {
  start: number;
  end: number;
}

export function parseLineRange(line: string): ParsedLineRange | null {
  const singleMatch = /^(\d+)$/.exec(line);
  if (singleMatch) {
    const value = Number(singleMatch[1]);
    return value > 0 ? { start: value, end: value } : null;
  }

  const rangeMatch = /^(\d+)-(\d+)$/.exec(line);
  if (!rangeMatch) return null;

  const start = Number(rangeMatch[1]);
  const end = Number(rangeMatch[2]);
  return start > 0 && end >= start ? { start, end } : null;
}

function buildDocumentOverview(snapshot: ChatReferenceSnapshot, lines: string[]): string {
  const firstMeaningfulLine = lines.find((line) => line.trim().length > 0) ?? '';
  return join(compact([`文档标题：${snapshot.title}`, `总行数：${lines.length}`, firstMeaningfulLine && `首个非空行：${firstMeaningfulLine}`]), '\n');
}

function buildReferenceContextBlock(snapshot: ChatReferenceSnapshot, references: ChatMessageFileReference[]): string {
  const lines = snapshot.content.split(/\r?\n/);
  const totalLines = lines.length;
  const pathLabel = references[0]?.path ?? `未保存文件（${snapshot.title}）`;
  const header = `引用文件：${pathLabel}\n引用行：${references.map((r) => r.line).join('、')}`;

  if (totalLines <= SMALL_DOCUMENT_LINE_THRESHOLD) {
    return `${header}\n全文内容：\n${snapshot.content}`;
  }

  const parsedRanges = compact(references.map((r) => parseLineRange(r.line)));
  if (isEmpty(parsedRanges)) {
    return `${header}\n${buildDocumentOverview(snapshot, lines)}`;
  }

  const startLine = Math.max(1, (min(parsedRanges.map((r) => r.start)) ?? 1) - CONTEXT_WINDOW_LINES);
  const endLine = Math.min(totalLines, (max(parsedRanges.map((r) => r.end)) ?? totalLines) + CONTEXT_WINDOW_LINES);
  const excerpt = lines.slice(startLine - 1, endLine).join('\n');
  const excerptBlock = `附近片段（第 ${startLine}-${endLine} 行）：\n${excerpt}`;

  if (totalLines <= MEDIUM_DOCUMENT_LINE_THRESHOLD) {
    return `${header}\n${excerptBlock}`;
  }

  return `${header}\n${buildDocumentOverview(snapshot, lines)}\n${excerptBlock}`;
}

export function buildModelReadyMessages(sourceMessages: Message[], snapshotsById: Map<string, ChatReferenceSnapshot>): Message[] {
  return sourceMessages.map((message) => {
    if (message.role !== 'user' || isEmpty(message.references)) return message;

    const collection = groupBy(message.references, (ref) => ref.snapshotId);

    const contextBlocks = flatMap(collection, (references, snapshotId) => {
      const snapshot = snapshotsById.get(snapshotId);
      return snapshot ? [buildReferenceContextBlock(snapshot, references)] : [];
    });

    // 没有上下文块，直接返回
    if (isEmpty(contextBlocks)) return message;

    const modelContent = join([message.content, ...contextBlocks], '\n\n');
    console.log('🚀 ~ buildModelReadyMessages ~ modelContent:', modelContent);
    return { ...message, content: modelContent, parts: [{ type: 'text', text: modelContent }] };
  });
}
