/**
 * @file fileReferenceContext.ts
 * @description 基于结构化文件引用片段构建模型可读的引用索引上下文。
 */
import type { FileReference } from '../types';
import type { Message } from './types';
import { recentFilesStorage } from '@/shared/storage';

// ─── 类型定义 ────────────────────────────────────────────────────────────────

/**
 * 消息文件引用解析结果
 */
export interface MessageFileReferencesResult {
  /** 替换后的消息内容 */
  message: string;
  /** 所有文件引用的解析结果 */
  references: FileReference[];
}

// ─── 常量定义 ────────────────────────────────────────────────────────────────

/** 文件引用正则表达式（不含双花括号），尾部可选携带渲染行号。 */
export const FILE_REF_PATTERN = /^#(?<filePath>\S+)\s+(?<startLine>\d+)-(?<endLine>\d+)(?:\|(?<renderStartLine>\d+)-(?<renderEndLine>\d+))?$/;

/** 消息中的文件引用正则表达式（含双花括号），尾部可选携带渲染行号。 */
export const MESSAGE_REF_PATTERN = /\{\{#(\S+)\s+(\d+)-(\d+)(?:\|(\d+)-(\d+))?\}\}/g;

// ─── 内部工具函数 ────────────────────────────────────────────────────────────

/**
 * 从文件中提取指定行号范围的内容和完整内容
 * 支持两种格式：
 * - unsaved://id/fileName - 未保存文件，从路径中提取 id
 * - 实际文件路径 - 已保存文件，通过路径查找
 * @param path - 文件路径或 unsaved:// 引用
 * @param startLine - 起始行号（从 1 开始）
 * @param endLine - 结束行号
 * @returns 文件引用解析结果，文件不存在时返回空内容
 */
export async function extractFileReferenceLines(token: string, references: string[]): Promise<FileReference> {
  const [path, startLine, endLine, renderStartLine, renderEndLine] = references;

  if (!path || !startLine || !endLine) return { token, path, startLine: 0, endLine: 0, selectedContent: '', fullContent: '' };

  let storedFile: Awaited<ReturnType<typeof recentFilesStorage.getRecentFile>> = null;

  // 检查是否为 unsaved:// 格式
  if (path.startsWith('unsaved://')) {
    // 从 unsaved://id/fileName 中提取 id
    const id = path.replace(/^unsaved:\/\/([^/]+)\/.*$/, '$1');
    storedFile = await recentFilesStorage.getRecentFile(id);
  } else {
    // 通过文件路径查找
    const files = await recentFilesStorage.getAllRecentFiles();
    storedFile = files.find((file) => file.path === path) || null;
  }

  if (!storedFile) return { token, path, startLine: 0, endLine: 0, selectedContent: '', fullContent: '' };

  const _startLine = parseInt(startLine, 10);
  const _endLine = parseInt(endLine, 10);

  const lines = storedFile.content.split('\n');

  const selectedContent = lines.slice(Math.max(0, _startLine - 1), Math.min(lines.length, _endLine)).join('\n');

  return {
    token,
    selectedContent,
    fullContent: storedFile.content,
    path,
    startLine: _startLine,
    endLine: _endLine,
    renderStartLine: renderStartLine ? parseInt(renderStartLine, 10) : _startLine,
    renderEndLine: renderEndLine ? parseInt(renderEndLine, 10) : _endLine
  };
}

function buildReferenceBlock(ref: FileReference): string {
  const { path, startLine, endLine, fullContent } = ref;

  const lines = fullContent.split('\n');
  const CONTEXT_LINES = 0;

  const sliceStart = Math.max(0, startLine - 1 - CONTEXT_LINES);
  const sliceEnd = Math.min(lines.length, endLine + CONTEXT_LINES);
  const contextLines = lines.slice(sliceStart, sliceEnd);

  // 先算好两个位置再插入
  const selectionStartIndex = startLine - 1 - sliceStart;
  const selectionEndIndex = endLine - 1 - sliceStart;

  // 从后往前插入，避免前插导致后续下标错位
  contextLines.splice(selectionEndIndex + 1, 0, '// [SELECTION_END]');
  contextLines.splice(selectionStartIndex, 0, '// [SELECTION_START]');

  return [`<QUOTED_FRAGMENT path="${path}" startLine="${startLine}" endLine="${endLine}">`, contextLines.join('\n'), `</QUOTED_FRAGMENT>`].join('\n');
}

export function buildChatMessageReferences(messages: Message[]): Message[] {
  return messages.map((message) => {
    if (message.role !== 'user') return message;

    const references = message.references || [];

    const content = references.reduce((acc, ref) => acc.replaceAll(ref.token, buildReferenceBlock(ref)), message.content);

    return { ...message, content, parts: [{ type: 'text', text: content }] };
  });
}
