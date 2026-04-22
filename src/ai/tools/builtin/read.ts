/**
 * @file read.ts
 * @description 内置文档只读工具实现
 */
import type { AIToolContext, AIToolExecutor, EditorSelection } from 'types/ai';
import { createToolFailureResult, createToolSuccessResult } from '../results';

/**
 * 读取当前文档的结果
 */
export interface ReadCurrentDocumentResult {
  /** 文档 ID */
  id: string;
  /** 文档标题 */
  title: string;
  /** 文档路径 */
  path: string | null;
  /** 文档内容 */
  content: string;
}

/**
 * 搜索当前文档的输入参数
 */
export interface SearchCurrentDocumentInput {
  /** 搜索关键词 */
  query: string;
}

/**
 * 搜索匹配项
 */
export interface SearchCurrentDocumentMatch {
  /** 匹配位置 */
  index: number;
  /** 匹配预览文本 */
  preview: string;
}

/**
 * 搜索当前文档的结果
 */
export interface SearchCurrentDocumentResult {
  /** 搜索关键词 */
  query: string;
  /** 匹配数量 */
  matchCount: number;
  /** 匹配列表 */
  matches: SearchCurrentDocumentMatch[];
}

/**
 * 内置只读工具集合
 */
export interface BuiltinReadTools {
  /** 读取当前文档工具 */
  readCurrentDocument: AIToolExecutor<Record<string, never>, ReadCurrentDocumentResult>;
  /** 获取当前选区工具 */
  getCurrentSelection: AIToolExecutor<Record<string, never>, EditorSelection>;
  /** 搜索当前文档工具 */
  searchCurrentDocument: AIToolExecutor<SearchCurrentDocumentInput, SearchCurrentDocumentResult>;
}

/** 最大搜索匹配数量 */
const MAX_SEARCH_MATCHES = 20;

/** 搜索预览文本半径 */
const SEARCH_PREVIEW_RADIUS = 80;

/**
 * 构建匹配预览文本
 * @param content - 文档内容
 * @param index - 匹配位置
 * @returns 预览文本
 */
function buildPreview(content: string, index: number): string {
  const start = Math.max(0, index - SEARCH_PREVIEW_RADIUS);
  const end = Math.min(content.length, index + SEARCH_PREVIEW_RADIUS);

  return content.slice(start, end);
}

/**
 * 在内容中搜索关键词
 * @param content - 文档内容
 * @param query - 搜索关键词
 * @returns 匹配列表
 */
function searchContent(content: string, query: string): SearchCurrentDocumentMatch[] {
  const lowerContent = content.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const matches: SearchCurrentDocumentMatch[] = [];
  let index = lowerContent.indexOf(lowerQuery);

  while (index !== -1 && matches.length < MAX_SEARCH_MATCHES) {
    matches.push({ index, preview: buildPreview(content, index) });
    index = lowerContent.indexOf(lowerQuery, index + lowerQuery.length);
  }

  return matches;
}

/**
 * 创建内置只读工具
 * @returns 只读工具执行器对象
 */
export function createBuiltinReadTools(): BuiltinReadTools {
  return {
    readCurrentDocument: {
      definition: {
        name: 'read_current_document',
        description: '读取当前编辑器文档的标题、路径和 Markdown 内容。',
        source: 'builtin',
        permission: 'read',
        parameters: { type: 'object', properties: {}, additionalProperties: false }
      },
      async execute(_input: Record<string, never>, context: AIToolContext) {
        return createToolSuccessResult('read_current_document', {
          id: context.document.id,
          title: context.document.title,
          path: context.document.path,
          content: context.document.getContent()
        });
      }
    },
    getCurrentSelection: {
      definition: {
        name: 'get_current_selection',
        description: '读取当前编辑器选区文本和范围。',
        source: 'builtin',
        permission: 'read',
        parameters: { type: 'object', properties: {}, additionalProperties: false }
      },
      async execute(_input: Record<string, never>, context: AIToolContext) {
        return createToolSuccessResult('get_current_selection', context.editor.getSelection() ?? { from: 0, to: 0, text: '' });
      }
    },
    searchCurrentDocument: {
      definition: {
        name: 'search_current_document',
        description: '在当前文档中搜索关键词并返回匹配片段。',
        source: 'builtin',
        permission: 'read',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '要搜索的关键词。' }
          },
          required: ['query'],
          additionalProperties: false
        }
      },
      async execute(input: SearchCurrentDocumentInput, context: AIToolContext) {
        const query = typeof input.query === 'string' ? input.query.trim() : '';
        if (!query) {
          return createToolFailureResult('search_current_document', 'INVALID_INPUT', '搜索关键词不能为空');
        }

        const matches = searchContent(context.document.getContent(), query);

        return createToolSuccessResult('search_current_document', {
          query: input.query,
          matchCount: matches.length,
          matches
        });
      }
    }
  };
}
