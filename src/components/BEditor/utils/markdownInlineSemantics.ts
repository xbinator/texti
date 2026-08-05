/**
 * @file markdownInlineSemantics.ts
 * @description 统一 Rich Markdown 解析与源码行映射使用的行内语义规则。
 */
/**
 * 源码语义处理所需的最小 Markdown token 结构。
 */
export interface MarkdownInlineToken {
  /** token 类型 */
  type?: string;
  /** token 原始 Markdown */
  raw?: unknown;
  /** token 语义文本 */
  text?: unknown;
  /** 嵌套行内 token */
  tokens?: MarkdownInlineToken[];
}

/**
 * 行内语义渲染选项。
 */
export interface RenderInlineTextOptions {
  /** 是否按顶层 Paragraph 的行为解码普通文本 HTML 实体 */
  decodeEntities?: boolean;
}

/** Rich 编辑器会转换为 htmlInline mark 的安全 HTML 标签。 */
export const INLINE_HTML_MARK_TAGS = new Set(['abbr', 'kbd', 'small', 'sub', 'sup']);

/** Rich 编辑器会转换为 mark 或硬换行节点的行内 HTML 标签。 */
export const INLINE_HTML_SUPPORTED_TAGS = new Set([...INLINE_HTML_MARK_TAGS, 'br', 'mark', 'u']);

/** Tiptap 顶层 Paragraph 解析会解码的 XML 命名实体。 */
const RICH_TEXT_ENTITIES: Readonly<Record<string, string>> = {
  '&amp;': '&',
  '&apos;': "'",
  '&gt;': '>',
  '&lt;': '<',
  '&quot;': '"'
};

/**
 * 按 Tiptap 顶层 Paragraph 的实际行为解码有限的 XML 命名实体。
 * 数字实体、HTML 扩展实体和容器子块均会保留原文。
 * @param text - 普通文本 token 内容
 * @returns Rich 文档中的顶层段落文本
 */
function decodeRichEntities(text: string): string {
  return text.replace(/&(amp|apos|gt|lt|quot);/g, (entity) => RICH_TEXT_ENTITIES[entity] ?? entity);
}

/**
 * 去除会被 Tiptap Mathematics 转换为无 textContent 原子节点的行内公式。
 * @param text - 普通文本 token 内容
 * @returns 去除行内公式后的可见文本
 */
function stripInlineMath(text: string): string {
  return text.replace(/\$[^$\n]+\$(?!\$)/g, '');
}

/**
 * 读取 token 原始 Markdown。
 * @param token - 当前行内 token
 * @returns token 原文，不存在时返回空字符串
 */
function getInlineTokenRaw(token: MarkdownInlineToken): string {
  return typeof token.raw === 'string' ? token.raw : '';
}

/**
 * 提取 token 对应的 HTML 标签名。
 * @param token - 当前行内 token
 * @returns 标签名；非完整 HTML 标签时返回 null
 */
function getInlineHtmlTag(token: MarkdownInlineToken): string | null {
  if (token.type !== 'html') {
    return null;
  }

  const match = /^<\s*\/?\s*([a-zA-Z][\w-]*)[^>]*>$/.exec(getInlineTokenRaw(token).trim());
  return match?.[1]?.toLowerCase() ?? null;
}

/**
 * 读取项目需要按原文保留的引用式链接。
 * @param token - 当前链接 token
 * @returns 引用式链接原文；非引用式链接时返回 null
 */
export function getReferenceLinkRaw(token: MarkdownInlineToken): string | null {
  if (token.type !== 'link') {
    return null;
  }

  const raw = getInlineTokenRaw(token).trim();
  return /^\[[^\]]+\]\[[^\]]+\]$/.test(raw) ? raw : null;
}

/**
 * 判断链接 token 是否来自 Rich 编辑器支持的显式链接语法。
 * @param token - 当前链接 token
 * @returns 显式链接或 HTTP(S) 自动链接返回 true
 */
export function isExplicitLinkToken(token: MarkdownInlineToken): boolean {
  const raw = getInlineTokenRaw(token).trim();
  return raw.startsWith('[') || /^<https?:\/\/[^>\s]+>$/i.test(raw);
}

/**
 * 去除行内批注包装，只保留 Rich 文档中的可见正文。
 * @param text - 已渲染的行内文本
 * @returns 去除批注属性后的可见文本
 */
function stripInlineComments(text: string): string {
  return text.replace(/\[([^\]]*)\]\{comment="[^"]*"(?:\s+id="[^"]*")?\}/g, '$1');
}

/**
 * 将单个 Markdown 行内 token 转换为 Rich 文档可见文本。
 * @param token - 当前行内 token
 * @returns Rich 文档中的可见文本
 */
function renderInlineToken(token: MarkdownInlineToken, preserveReference: boolean, decodeEntities: boolean): string {
  const raw = getInlineTokenRaw(token);

  if (token.type === 'image') {
    // 图片节点没有 textContent，块对齐时不能把 alt 文本算入可见文本。
    return '';
  }

  if (token.type === 'inlineMath') {
    return '';
  }

  if (token.type === 'br') {
    return '\n';
  }

  if (token.type === 'html') {
    const tag = getInlineHtmlTag(token);
    if (tag === 'br') {
      return '\n';
    }
    if (tag && INLINE_HTML_SUPPORTED_TAGS.has(tag)) {
      return '';
    }
    return raw || (typeof token.text === 'string' ? token.text : '');
  }

  if (token.type === 'link') {
    const referenceRaw = getReferenceLinkRaw(token);
    if (referenceRaw && preserveReference) {
      return referenceRaw;
    }
    if (!isExplicitLinkToken(token)) {
      return raw || (typeof token.text === 'string' ? token.text : '');
    }
  }

  if (Array.isArray(token.tokens) && token.tokens.length > 0) {
    // Rich 自定义引用链接拦截仅发生在统一 inline 入口；嵌套 mark 内由默认解析器处理。
    return token.tokens.map((nestedToken) => renderInlineToken(nestedToken, false, decodeEntities)).join('');
  }

  if (typeof token.text === 'string') {
    // Tiptap Markdown helper 会把普通文本中的 HTML 实体解码后写入 ProseMirror。
    if (token.type !== 'text') {
      return token.text;
    }

    const visibleText = stripInlineMath(token.text);
    return decodeEntities ? decodeRichEntities(visibleText) : visibleText;
  }

  return raw;
}

/**
 * 将 marked 行内 token 序列转换为 Rich 文档的可见语义文本。
 * @param tokens - marked 行内 token 序列
 * @param options - 与当前 Rich 块解析层级一致的实体解码选项
 * @returns 与 ProseMirror textContent 对齐的可见文本
 */
export function renderInlineText(tokens: readonly MarkdownInlineToken[], options: RenderInlineTextOptions = {}): string {
  const decodeEntities = options.decodeEntities ?? true;
  return stripInlineComments(tokens.map((token) => renderInlineToken(token, true, decodeEntities)).join(''));
}
