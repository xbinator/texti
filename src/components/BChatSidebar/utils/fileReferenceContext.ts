/**
 * @file fileReferenceContext.ts
 * @description 基于结构化文件引用片段构建模型可读的引用索引上下文。
 */
import { recentFilesStorage } from '@/shared/storage';

// ─── 类型定义 ────────────────────────────────────────────────────────────────

/**
 * 文件引用解析结果
 */
export interface FileReferenceResult {
  /** 文件路径 */
  path: string;
  /** 起始行号（从 1 开始） */
  startLine: number;
  /** 结束行号（从 1 开始） */
  endLine: number;
  /** 指定行号范围的内容 */
  selectedContent: string;
  /** 文件完整内容 */
  fullContent: string;
}

/**
 * 消息文件引用解析结果
 */
export interface MessageFileReferencesResult {
  /** 替换后的消息内容 */
  message: string;
  /** 所有文件引用的解析结果 */
  references: FileReferenceResult[];
}

// ─── 常量定义 ────────────────────────────────────────────────────────────────

/** 文件引用正则表达式（不含双花括号） */
export const FILE_REF_PATTERN = /^#(?<filePath>\S+)\s+(?<startLine>\d+)-(?<endLine>\d+)$/;

/** 消息中的文件引用正则表达式（含双花括号） */
export const MESSAGE_REF_PATTERN = /\{\{#(\S+)\s+(\d+)-(\d+)\}\}/g;

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
export async function extractFileReferenceLines(path: string, startLine: string, endLine: string): Promise<FileReferenceResult> {
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

  if (!storedFile) return { path, startLine: 0, endLine: 0, selectedContent: '', fullContent: '' };

  const _startLine = parseInt(startLine, 10);
  const _endLine = parseInt(endLine, 10);

  const lines = storedFile.content.split('\n');
  const selectedContent = lines.slice(Math.max(0, _startLine - 1), Math.min(lines.length, _endLine)).join('\n');

  return { selectedContent, fullContent: storedFile.content, path, startLine: _startLine, endLine: _endLine };
}
