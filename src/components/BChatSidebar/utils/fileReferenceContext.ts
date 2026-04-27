/**
 * @file fileReferenceContext.ts
 * @description 从持久化的快照构建仅面向模型的文件引用上下文，同时保持可见的聊天内容不变。
 */
import type { ChatMessageFileReference, ChatReferenceSnapshot } from 'types/chat';
import { isEmpty, join, compact, min, max } from 'lodash-es';
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

/**
 * 构建面向模型的就绪消息列表，将 {{file-ref:...}} 令牌原位替换为文件内容片段。
 * 同文件多引用场景：首个 token 替换为完整引用块，后续 token 替换为简洁标注，避免内容重复。
 * @param sourceMessages - 原始聊天消息
 * @param snapshotsById - snapshotId → 快照的映射
 * @returns 替换后的消息列表
 */
export function buildModelReadyMessages(sourceMessages: Message[], snapshotsById: Map<string, ChatReferenceSnapshot>): Message[] {
  return sourceMessages.map((message) => {
    if (message.role !== 'user' || isEmpty(message.references)) return message;

    // 构建 referenceId → ChatMessageFileReference 的快速查找映射
    const referenceById = new Map((message.references ?? []).map((ref) => [ref.id, ref]));

    // 追踪已完成首次替换的 snapshotId，用于同文件后续 token 的简洁标注
    const replacedSnapshotIds = new Set<string>();

    // 正则匹配 {{file-ref:referenceId|...}} 令牌，采用宽松匹配（三个可选管道段）
    // 兼容完整和不完整的 token 格式——向后兼容设计
    // 注意：regex 为函数局部变量，不会受 /g 标志的 lastIndex 陷阱影响
    const regex = /\{\{file-ref:([A-Za-z0-9_-]+)(?:\|[^|}]*)?(?:\|[^|}]*)?(?:\|[^|}]*)?\}\}/g;

    const modelContent = message.content.replace(regex, (match, referenceId) => {
      const reference = referenceById.get(referenceId);

      // 引用记录不存在或快照尚未生成（snapshotId 为空），保留原文
      if (!reference || !reference.snapshotId) return match;

      const snapshot = snapshotsById.get(reference.snapshotId);

      // 快照未加载，保留原文
      if (!snapshot) return match;

      // 同文件首次出现：替换为完整内容块，仅使用当前 token 的行号
      if (!replacedSnapshotIds.has(reference.snapshotId)) {
        replacedSnapshotIds.add(reference.snapshotId);
        const context = buildReferenceContextBlock(snapshot, [reference]);
        return `\n${context}\n`;
      }

      // 后续出现：简洁标注，避免重复内容块
      // TODO: i18n — 中文硬编码，后续国际化时需抽取为资源字符串
      const lineLabel = reference.line ? ` 第${reference.line}行` : '';
      return `[引用：${reference.fileName}${lineLabel}]`;
    });

    // 内容无变化，返回原始消息
    if (modelContent === message.content) return message;

    return { ...message, content: modelContent, parts: [{ type: 'text', text: modelContent }] };
  });
}
