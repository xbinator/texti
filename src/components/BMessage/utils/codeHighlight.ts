/**
 * @file codeHighlight.ts
 * @description BMessage 代码块共享语法高亮器与安全节点转换。
 */
/* eslint-disable no-use-before-define -- Lowlight 与渲染节点类型是递归结构。 */
import { common, createLowlight } from 'lowlight';

/**
 * Lowlight 文本节点。
 */
interface LowlightTextNode {
  /** 节点类型。 */
  type: 'text';
  /** 文本内容。 */
  value: string;
}

/**
 * Lowlight 元素节点。
 */
interface LowlightElementNode {
  /** 节点类型。 */
  type: 'element' | 'root';
  /** 子节点。 */
  children?: LowlightNode[];
  /** 节点属性。 */
  properties?: {
    /** CSS 类名。 */
    className?: string[] | string;
  };
}

/**
 * Lowlight 节点。
 */
type LowlightNode = LowlightElementNode | LowlightTextNode;

/**
 * 代码高亮文本渲染节点。
 */
export interface CodeHighlightTextNode {
  /** 节点类型。 */
  type: 'text';
  /** 文本内容。 */
  value: string;
}

/**
 * 代码高亮元素渲染节点。
 */
export interface CodeHighlightElementNode {
  /** 节点类型。 */
  type: 'element';
  /** 安全 CSS 类名。 */
  className: string;
  /** 子节点。 */
  children: CodeHighlightRenderNode[];
}

/**
 * 代码高亮渲染节点。
 */
export type CodeHighlightRenderNode = CodeHighlightElementNode | CodeHighlightTextNode;

/**
 * Markdown 代码围栏语言别名。
 */
const LANGUAGE_ALIASES: Readonly<Record<string, string>> = {
  bash: 'bash',
  cjs: 'javascript',
  htm: 'xml',
  html: 'xml',
  js: 'javascript',
  jsx: 'javascript',
  md: 'markdown',
  plaintext: 'plaintext',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  sh: 'bash',
  shellscript: 'bash',
  text: 'plaintext',
  ts: 'typescript',
  tsx: 'typescript',
  vue: 'xml',
  yml: 'yaml',
  zsh: 'bash'
};

const lowlight = createLowlight(common);
const HIGHLIGHT_CACHE_LIMIT = 100;
const highlightCache = new Map<string, CodeHighlightRenderNode[]>();

/**
 * 读取并刷新高亮缓存项的最近使用顺序。
 * @param key - 缓存键
 * @returns 缓存节点
 */
function getCachedHighlight(key: string): CodeHighlightRenderNode[] | undefined {
  const cached = highlightCache.get(key);
  if (!cached) return undefined;

  highlightCache.delete(key);
  highlightCache.set(key, cached);
  return cached;
}

/**
 * 写入有界高亮缓存。
 * @param key - 缓存键
 * @param nodes - 高亮节点
 */
function cacheHighlight(key: string, nodes: CodeHighlightRenderNode[]): void {
  highlightCache.set(key, nodes);
  if (highlightCache.size <= HIGHLIGHT_CACHE_LIMIT) return;

  const oldestKey = highlightCache.keys().next().value as string | undefined;
  if (oldestKey) highlightCache.delete(oldestKey);
}

/**
 * 将纯文本转为代码高亮文本节点。
 * @param text - 代码文本
 * @returns 高亮渲染节点列表
 */
function textToHighlightNodes(text: string): CodeHighlightRenderNode[] {
  return text ? [{ type: 'text', value: text }] : [];
}

/**
 * 归一化代码块声明语言。
 * @param rawLanguage - 原始语言名
 * @returns lowlight 语言名
 */
function normalizeLanguage(rawLanguage: string): string {
  const language = rawLanguage.trim().toLowerCase();
  return LANGUAGE_ALIASES[language] ?? language;
}

/**
 * 查找 Markdown 文件头部 YAML frontmatter 的结束位置。
 * @param code - Markdown 源码
 * @returns frontmatter 片段结束下标，未找到时返回 -1
 */
function findFrontmatterEnd(code: string): number {
  let openingLength = -1;
  if (code.startsWith('---\r\n')) {
    openingLength = 5;
  } else if (code.startsWith('---\n')) {
    openingLength = 4;
  }

  if (openingLength === -1) return -1;

  // closing delimiter 必须独占一行，避免普通 Markdown 分隔线被当成 frontmatter。
  const closingPattern = /\r?\n---(?:\r?\n|$)/g;
  closingPattern.lastIndex = openingLength - 1;
  const match = closingPattern.exec(code);

  return match ? match.index + match[0].length : -1;
}

/**
 * 读取 Lowlight 元素节点的安全类名。
 * @param node - Lowlight 元素节点
 * @returns 安全类名
 */
function getSafeClassName(node: LowlightElementNode): string {
  const rawClassName = node.properties?.className;
  const classNames = Array.isArray(rawClassName) ? rawClassName : rawClassName?.split(/\s+/) ?? [];

  return classNames.filter((className: string): boolean => className.startsWith('hljs-')).join(' ');
}

/**
 * 将 Lowlight 节点转为可控的 Vue 渲染节点。
 * @param node - Lowlight 节点
 * @returns 高亮渲染节点列表
 */
function lowlightNodeToHighlightNodes(node: LowlightNode): CodeHighlightRenderNode[] {
  if (node.type === 'text') return textToHighlightNodes(node.value);

  const children = node.children?.flatMap((child: LowlightNode): CodeHighlightRenderNode[] => lowlightNodeToHighlightNodes(child)) ?? [];
  if (node.type === 'root') return children;

  return [
    {
      type: 'element',
      className: getSafeClassName(node),
      children
    }
  ];
}

/**
 * 使用已注册的 lowlight 语言执行高亮。
 * @param language - lowlight 语言名
 * @param code - 代码文本
 * @returns 安全高亮节点
 */
function highlightRegistered(language: string, code: string): CodeHighlightRenderNode[] {
  if (!lowlight.registered(language)) return textToHighlightNodes(code);

  try {
    return lowlightNodeToHighlightNodes(lowlight.highlight(language, code) as LowlightNode);
  } catch {
    return textToHighlightNodes(code);
  }
}

/**
 * 高亮带可选 YAML frontmatter 的 Markdown 文本。
 * @param code - Markdown 源码
 * @returns 安全高亮节点
 */
function highlightMarkdown(code: string): CodeHighlightRenderNode[] {
  const frontmatterEnd = findFrontmatterEnd(code);
  if (frontmatterEnd === -1 || !lowlight.registered('yaml')) return highlightRegistered('markdown', code);

  const frontmatterNodes = highlightRegistered('yaml', code.slice(0, frontmatterEnd));
  const markdownNodes = highlightRegistered('markdown', code.slice(frontmatterEnd));

  return [...frontmatterNodes, ...markdownNodes];
}

/**
 * 高亮 BMessage 代码块。
 * @param rawLanguage - Markdown 原始语言
 * @param code - 代码文本
 * @param complete - 围栏是否闭合
 * @returns 安全高亮节点
 */
export function highlightMessageCode(rawLanguage: string, code: string, complete: boolean): CodeHighlightRenderNode[] {
  if (!complete) return textToHighlightNodes(code);

  const language = normalizeLanguage(rawLanguage);
  if (!language || !lowlight.registered(language)) return textToHighlightNodes(code);

  const cacheKey = `${language}\u0000${code}`;
  const cached = getCachedHighlight(cacheKey);
  if (cached) return cached;

  const nodes = language === 'markdown' ? highlightMarkdown(code) : highlightRegistered(language, code);
  cacheHighlight(cacheKey, nodes);
  return nodes;
}
