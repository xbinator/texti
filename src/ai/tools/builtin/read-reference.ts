/**
 * @file read-reference.ts
 * @description 内置聊天文件引用读取工具实现。
 */
import type { AIToolExecutor } from 'types/ai';
import { createToolFailureResult, createToolSuccessResult } from '../results';

/** read_reference 工具名称 */
export const READ_REFERENCE_TOOL_NAME = 'read_reference';
/** 默认读取窗口 */
const DEFAULT_REFERENCE_WINDOW = 120;
/** 默认起始行号 */
const DEFAULT_OFFSET = 1;

/**
 * 已解析的文件引用快照。
 */
export interface ResolvedReferenceSnapshot {
  /** 引用唯一标识 */
  referenceId: string;
  /** 文件名 */
  fileName: string;
  /** 本地路径 */
  path: string | null;
  /** 文档 ID */
  documentId: string;
  /** 快照 ID */
  snapshotId: string;
  /** 快照全文 */
  content: string;
  /** 引用起始行号 */
  startLine: number;
  /** 引用结束行号 */
  endLine: number;
}

/**
 * read_reference 工具输入参数。
 */
export interface ReadReferenceInput {
  /** 引用唯一标识 */
  referenceId: string;
  /** 起始行号 */
  offset?: number;
  /** 读取行数 */
  limit?: number;
}

/**
 * read_reference 工具返回结果。
 */
export interface ReadReferenceResult {
  /** 引用唯一标识 */
  referenceId: string;
  /** 文件名 */
  fileName: string;
  /** 本地路径 */
  path: string | null;
  /** 文档 ID */
  documentId: string;
  /** 快照 ID */
  snapshotId: string;
  /** 实际读取起始行 */
  offset: number;
  /** 实际读取行数 */
  readLines: number;
  /** 文件总行数 */
  totalLines: number;
  /** 是否还有后续内容 */
  hasMore: boolean;
  /** 下一次推荐起始行 */
  nextOffset: number | null;
  /** 读取内容 */
  content: string;
}

/**
 * 创建 read_reference 工具选项。
 */
export interface CreateBuiltinReadReferenceToolOptions {
  /** 根据 referenceId 解析冻结快照 */
  getReferenceSnapshot?: (referenceId: string) => Promise<ResolvedReferenceSnapshot | null>;
}

/**
 * 规范化读取范围。
 * @param input - 工具输入
 * @returns 规范化结果
 */
function normalizeReadRange(input: ReadReferenceInput): { offset: number; limit: number } {
  const offset = input.offset ?? DEFAULT_OFFSET;
  const limit = input.limit ?? DEFAULT_REFERENCE_WINDOW;

  if (!Number.isInteger(offset) || offset < 1) {
    throw new Error('offset 必须是大于等于 1 的整数');
  }

  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('limit 必须是大于等于 1 的整数');
  }

  return { offset, limit };
}

/**
 * 将冻结快照裁剪为当前读取窗口。
 * @param snapshot - 已解析快照
 * @param range - 读取范围
 * @returns 读取结果
 */
function sliceReferenceSnapshot(snapshot: ResolvedReferenceSnapshot, range: { offset: number; limit: number }): ReadReferenceResult {
  const lines = snapshot.content.split(/\r?\n/);
  const startIndex = Math.min(range.offset - 1, lines.length);
  const endIndex = Math.min(startIndex + range.limit, lines.length);
  const content = lines.slice(startIndex, endIndex).join('\n');
  const readLines = Math.max(endIndex - startIndex, 0);
  const hasMore = endIndex < lines.length;

  return {
    referenceId: snapshot.referenceId,
    fileName: snapshot.fileName,
    path: snapshot.path,
    documentId: snapshot.documentId,
    snapshotId: snapshot.snapshotId,
    offset: range.offset,
    readLines,
    totalLines: lines.length,
    hasMore,
    nextOffset: hasMore ? endIndex + 1 : null,
    content
  };
}

/**
 * 创建聊天文件引用读取工具。
 * @param options - 工具选项
 * @returns 工具执行器
 */
export function createBuiltinReadReferenceTool(options: CreateBuiltinReadReferenceToolOptions = {}): AIToolExecutor<ReadReferenceInput, ReadReferenceResult> {
  return {
    definition: {
      name: READ_REFERENCE_TOOL_NAME,
      description: '读取聊天消息中某个文件引用对应的冻结快照内容，适合按需查看用户引用的文件片段。',
      source: 'builtin',
      riskLevel: 'read',
      requiresActiveDocument: false,
      permissionCategory: 'system',
      parameters: {
        type: 'object',
        properties: {
          referenceId: { type: 'string', description: '聊天消息中文件引用的唯一标识。' },
          offset: { type: 'number', description: '起始行号；不传时从文件开头读取默认窗口。' },
          limit: { type: 'number', description: '读取行数；不传时默认读取 120 行。' }
        },
        required: ['referenceId'],
        additionalProperties: false
      }
    },
    async execute(input) {
      if (!input.referenceId.trim()) {
        return createToolFailureResult(READ_REFERENCE_TOOL_NAME, 'INVALID_INPUT', 'referenceId 不能为空');
      }

      let range: { offset: number; limit: number };
      try {
        range = normalizeReadRange(input);
      } catch (error) {
        return createToolFailureResult(READ_REFERENCE_TOOL_NAME, 'INVALID_INPUT', error instanceof Error ? error.message : '读取范围无效');
      }

      const snapshot = await (options.getReferenceSnapshot?.(input.referenceId) ?? Promise.resolve(null));
      if (!snapshot) {
        return createToolFailureResult(READ_REFERENCE_TOOL_NAME, 'EXECUTION_FAILED', '未找到对应的文件引用快照');
      }

      return createToolSuccessResult(READ_REFERENCE_TOOL_NAME, sliceReferenceSnapshot(snapshot, range));
    }
  };
}
