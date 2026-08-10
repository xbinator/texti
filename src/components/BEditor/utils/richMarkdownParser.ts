/**
 * @file richMarkdownParser.ts
 * @description Rich 编辑器 Markdown 解析统一异步接口。
 * 第一阶段：主线程同步解析（Promise 包装，通过 setTimeout 0 yield 主线程让 UI 先行）。
 * 第二阶段：切 Web Worker 解析，调用方零改动。
 *
 * 性能优化：扩展集合和 MarkdownManager 按 editorInstanceId 缓存复用，
 * 避免每次解析重建 18+ 个 Tiptap 扩展（节省 200-400ms）。
 */
import type { JSONContent } from '@tiptap/core';
import { MarkdownManager } from '@tiptap/markdown';
import { createSourceLineTracker, resetSourceLineTracker } from '../adapters/sourceLineMapping';
import { createRichMarkdownSchemaExtensions } from '../hooks/useExtensions';
import { normalizeLooseMermaidClosingFences } from './mermaidMarkdown';

/**
 * 解析接口返回结果
 */
export interface RichParseResult {
  json: JSONContent;
  stats: {
    durationMs: number;
    nodeCount: number;
    headingCount: number;
    cacheHit: boolean;
  };
}

/**
 * Rich 解析缓存项
 */
interface RichParseCacheEntry {
  /** 编辑器实例 ID，影响 heading id 前缀 */
  editorInstanceId: string;
  /** 原始 Markdown 内容 */
  markdown: string;
  /** 解析后的 JSON */
  json: JSONContent;
  /** JSON 节点总数 */
  nodeCount: number;
  /** 标题节点数量 */
  headingCount: number;
}

/**
 * 扩展+MarkdownManager 缓存项。
 * 扩展集合完全由 editorInstanceId 决定，与 markdown 内容无关，可按实例复用。
 */
interface RichParseEngineCache {
  /** 解析扩展集合（纯 schema+parse，无 DOM/NodeView） */
  schemaExtensions: ReturnType<typeof createRichMarkdownSchemaExtensions>;
  /** MarkdownManager 实例，parse() 幂等可复用 */
  markdownManager: MarkdownManager;
  /** 源码行号游标（被扩展闭包捕获，每次解析前需重置） */
  sourceLineTracker: ReturnType<typeof createSourceLineTracker>;
}

/**
 * Rich 解析缓存最大条目数。
 * 仅保留最近两个文档，避免大文档 JSON 长期占用过多内存。
 */
const RICH_PARSE_CACHE_LIMIT = 2;

/** 解析引擎 LRU 上限，作为编辑器显式释放之外的异常路径兜底。 */
export const RICH_PARSE_ENGINE_CACHE_LIMIT = 8;

/** 已解析文档的结果缓存（LRU） */
const richParseCache: RichParseCacheEntry[] = [];

/** 扩展+MarkdownManager 缓存，按 editorInstanceId 索引 */
const parseEngineCache = new Map<string, RichParseEngineCache>();

/**
 * 获取或创建解析引擎缓存。
 * 扩展集合完全无状态（sourceLineTracker 在每次解析前通过 resetSourceLineTracker 重置），
 * MarkdownManager.parse() 本身不保留跨次调用状态。
 * @param editorInstanceId - 编辑器实例 ID
 * @returns 解析引擎缓存
 */
function getOrCreateParseEngine(editorInstanceId: string): RichParseEngineCache {
  const cached = parseEngineCache.get(editorInstanceId);
  if (cached) {
    parseEngineCache.delete(editorInstanceId);
    parseEngineCache.set(editorInstanceId, cached);
    return cached;
  }

  const sourceLineTracker = createSourceLineTracker();
  const schemaExtensions = createRichMarkdownSchemaExtensions(editorInstanceId, sourceLineTracker);
  const markdownManager = new MarkdownManager({
    indentation: { style: 'space', size: 2 },
    extensions: schemaExtensions.extensions
  });

  const entry: RichParseEngineCache = { schemaExtensions, markdownManager, sourceLineTracker };
  parseEngineCache.set(editorInstanceId, entry);
  while (parseEngineCache.size > RICH_PARSE_ENGINE_CACHE_LIMIT) {
    const oldestEditorId = parseEngineCache.keys().next().value;
    if (typeof oldestEditorId !== 'string') break;
    parseEngineCache.delete(oldestEditorId);
  }
  return entry;
}

/**
 * 释放指定编辑器的解析引擎和结果缓存。
 * @param editorInstanceId - 编辑器实例 ID
 */
export function releaseRichParseEngine(editorInstanceId: string): void {
  parseEngineCache.delete(editorInstanceId);
  for (let index = richParseCache.length - 1; index >= 0; index -= 1) {
    if (richParseCache[index]?.editorInstanceId === editorInstanceId) richParseCache.splice(index, 1);
  }
}

/**
 * 获取当前解析引擎数量，用于生命周期诊断与压力验证。
 * @returns 解析引擎数量
 */
export function getRichParseEngineCacheSize(): number {
  return parseEngineCache.size;
}

/**
 * 查找未变化文档的解析缓存。
 * @param markdown - 原始 Markdown 字符串
 * @param editorInstanceId - 编辑器实例 ID
 * @returns 命中时返回缓存项，否则返回 null
 */
function findCachedParseResult(markdown: string, editorInstanceId: string): RichParseCacheEntry | null {
  const index = richParseCache.findIndex((entry) => entry.editorInstanceId === editorInstanceId && entry.markdown === markdown);
  if (index < 0) {
    return null;
  }

  const [entry] = richParseCache.splice(index, 1);
  if (!entry) {
    return null;
  }

  richParseCache.unshift(entry);
  return entry;
}

/**
 * 写入解析缓存，并按 LRU 淘汰旧项。
 * @param entry - 待缓存的解析结果
 */
function rememberParsedMarkdown(entry: RichParseCacheEntry): void {
  const existingIndex = richParseCache.findIndex((item) => item.editorInstanceId === entry.editorInstanceId && item.markdown === entry.markdown);
  if (existingIndex >= 0) {
    richParseCache.splice(existingIndex, 1);
  }

  richParseCache.unshift(entry);
  if (richParseCache.length > RICH_PARSE_CACHE_LIMIT) {
    richParseCache.length = RICH_PARSE_CACHE_LIMIT;
  }
}

/**
 * 递归统计 JSON 中的节点总数
 * @param json - 待统计的 JSON 节点
 * @returns 节点总数
 */
function countNodes(json: JSONContent): number {
  let count = 1;
  if (Array.isArray(json.content)) {
    for (const child of json.content) {
      count += countNodes(child);
    }
  }
  return count;
}

/**
 * 在主线程上解析 Markdown 为 Tiptap JSON。
 * 不创建 Editor/View/DOM，仅走 MarkdownManager 的 lexer → token → JSON 管线。
 * 扩展集合和 MarkdownManager 按 editorInstanceId 缓存复用。
 * @param markdown - 原始 Markdown 字符串
 * @param editorInstanceId - 编辑器实例 ID
 * @returns 解析后的 JSON 和标题数量
 */
function parseMarkdownOnMainThread(markdown: string, editorInstanceId: string): { json: JSONContent; headingCount: number } {
  const engine = getOrCreateParseEngine(editorInstanceId);
  const normalizedMarkdown = normalizeLooseMermaidClosingFences(markdown);

  // 每次解析前重置扩展内部状态（headingIndex、sourceLineTracker）
  engine.schemaExtensions.resetHeadingIndex();
  resetSourceLineTracker(engine.sourceLineTracker);

  const json = engine.markdownManager.parse(normalizedMarkdown);
  const headingCount = engine.schemaExtensions.getHeadingIndex();

  return { json, headingCount };
}

/**
 * 解析 Markdown 为 Tiptap JSON。
 *
 * 关键：在开始 CPU 密集型解析前通过 setTimeout 0 yield 主线程，
 * 确保 UI 已渲染 loading 状态，用户不会感知到"点击后无反应"的卡死。
 *
 * @param markdown - 原始 Markdown 字符串
 * @param editorInstanceId - 编辑器实例 ID（用于 heading ID 前缀等）
 * @param requestId - 请求 ID（用于取消校验，与 loadToken 分开）
 * @param signal - AbortSignal（解析前后检查）
 * @returns 解析结果
 */
export async function parseMarkdownForRichLoad(markdown: string, editorInstanceId: string, _requestId: string, signal?: AbortSignal): Promise<RichParseResult> {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  const cached = findCachedParseResult(markdown, editorInstanceId);
  if (cached) {
    return {
      json: cached.json,
      stats: {
        durationMs: 0,
        nodeCount: cached.nodeCount,
        headingCount: cached.headingCount,
        cacheHit: true
      }
    };
  }

  // YIELD：让出主线程给 UI 渲染（loading 遮罩等），然后再执行 CPU 密集解析
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

  // 再次检查是否已被取消
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  const startTime = performance.now();
  const { json, headingCount } = parseMarkdownOnMainThread(markdown, editorInstanceId);
  const parseDuration = performance.now() - startTime;
  const nodeCount = countNodes(json);

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  rememberParsedMarkdown({
    editorInstanceId,
    markdown,
    json,
    nodeCount,
    headingCount
  });

  return {
    json,
    stats: {
      durationMs: parseDuration,
      nodeCount,
      headingCount,
      cacheHit: false
    }
  };
}
