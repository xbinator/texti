/**
 * @file fileReferenceContext.ts
 * @description Builds model-only file-reference context from persisted snapshots while keeping visible chat content unchanged.
 */
import type { Message } from '../types';
import type { ChatMessageFileReference, ChatReferenceSnapshot } from 'types/chat';

const SMALL_DOCUMENT_LINE_THRESHOLD = 200;
const MEDIUM_DOCUMENT_LINE_THRESHOLD = 800;
const CONTEXT_WINDOW_LINES = 120;

/**
 * Parsed 1-based line range used for local reference context extraction.
 */
export interface ParsedLineRange {
  /** Inclusive start line. */
  start: number;
  /** Inclusive end line. */
  end: number;
}

/**
 * Parses a stored line label such as `12` or `12-18`.
 * @param line - Stored line label.
 * @returns Parsed range or `null` when the label is invalid.
 */
export function parseLineRange(line: string): ParsedLineRange | null {
  const singleLineMatch = /^(\d+)$/.exec(line);
  if (singleLineMatch) {
    const value = Number(singleLineMatch[1]);
    return value > 0 ? { start: value, end: value } : null;
  }

  const rangeMatch = /^(\d+)-(\d+)$/.exec(line);
  if (!rangeMatch) {
    return null;
  }

  const start = Number(rangeMatch[1]);
  const end = Number(rangeMatch[2]);
  if (start <= 0 || end <= 0 || end < start) {
    return null;
  }

  return { start, end };
}

/**
 * Builds a lightweight overview for long documents before appending a local excerpt.
 * @param snapshot - Persisted reference snapshot.
 * @param lines - Snapshot document lines.
 * @returns Human-readable overview text for the model.
 */
function buildDocumentOverview(snapshot: ChatReferenceSnapshot, lines: string[]): string {
  const firstMeaningfulLine = lines.find((line) => line.trim().length > 0) ?? '';
  const summaryParts = [`文档标题：${snapshot.title}`, `总行数：${lines.length}`];

  if (firstMeaningfulLine) {
    summaryParts.push(`首个非空行：${firstMeaningfulLine}`);
  }

  return summaryParts.join('\n');
}

/**
 * Groups references by their snapshot id while preserving insertion order.
 * @param references - Message references.
 * @returns Snapshot-id keyed references.
 */
function groupReferencesBySnapshot(references: ChatMessageFileReference[]): Map<string, ChatMessageFileReference[]> {
  const groupedReferences = new Map<string, ChatMessageFileReference[]>();

  references.forEach((reference) => {
    if (!reference.snapshotId) {
      return;
    }

    const existing = groupedReferences.get(reference.snapshotId) ?? [];
    existing.push(reference);
    groupedReferences.set(reference.snapshotId, existing);
  });

  return groupedReferences;
}

/**
 * Builds a hidden context block for one snapshot and the references that point to it.
 * @param snapshot - Persisted document snapshot.
 * @param references - References that share the snapshot.
 * @returns Model-only context block.
 */
function buildReferenceContextBlock(snapshot: ChatReferenceSnapshot, references: ChatMessageFileReference[]): string {
  const lines = snapshot.content.split(/\r?\n/);
  const totalLines = lines.length;
  const lineLabels = references.map((reference) => reference.line).join('、');
  const pathLabel = references[0]?.path ?? `未保存文件（${snapshot.title}）`;
  const header = `引用文件：${pathLabel}\n引用行：${lineLabels}`;
  const parsedRanges = references.map((reference) => parseLineRange(reference.line)).filter((range): range is ParsedLineRange => range !== null);

  if (totalLines <= SMALL_DOCUMENT_LINE_THRESHOLD) {
    return `${header}\n全文内容：\n${snapshot.content}`;
  }

  if (!parsedRanges.length) {
    return `${header}\n${buildDocumentOverview(snapshot, lines)}`;
  }

  const startLine = Math.max(1, Math.min(...parsedRanges.map((range) => range.start)) - CONTEXT_WINDOW_LINES);
  const endLine = Math.min(totalLines, Math.max(...parsedRanges.map((range) => range.end)) + CONTEXT_WINDOW_LINES);
  const excerpt = lines.slice(startLine - 1, endLine).join('\n');

  if (totalLines <= MEDIUM_DOCUMENT_LINE_THRESHOLD) {
    return `${header}\n附近片段（第 ${startLine}-${endLine} 行）：\n${excerpt}`;
  }

  return `${header}\n${buildDocumentOverview(snapshot, lines)}\n附近片段（第 ${startLine}-${endLine} 行）：\n${excerpt}`;
}

/**
 * Builds the model-facing message list while keeping visible user messages unchanged in the UI.
 * @param sourceMessages - Visible chat history.
 * @param snapshotsById - Persisted reference snapshots keyed by snapshot id.
 * @returns Model-facing messages with hidden context appended to user text.
 */
export function buildModelReadyMessages(sourceMessages: Message[], snapshotsById: Map<string, ChatReferenceSnapshot>): Message[] {
  return sourceMessages.map((message) => {
    if (message.role !== 'user' || !message.references?.length) {
      return message;
    }

    const referenceGroups = groupReferencesBySnapshot(message.references);
    if (!referenceGroups.size) {
      return message;
    }

    const contextBlocks: string[] = [];
    referenceGroups.forEach((references, snapshotId) => {
      const snapshot = snapshotsById.get(snapshotId);
      if (!snapshot) {
        return;
      }

      contextBlocks.push(buildReferenceContextBlock(snapshot, references));
    });

    if (!contextBlocks.length) {
      return message;
    }

    const modelContent = `${message.content}\n\n${contextBlocks.join('\n\n')}`;
    return {
      ...message,
      content: modelContent,
      parts: [{ type: 'text', text: modelContent }]
    };
  });
}
