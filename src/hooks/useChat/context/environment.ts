/**
 * @file environment.ts
 * @description 页面环境上下文 section 的通用组装与规范化。
 */
import type { ChatRuntimeEnvironmentSection, ChatRuntimePageEnvironmentContext } from 'types/chat-runtime';

/** 环境 section 最大数量。 */
const MAX_ENVIRONMENT_SECTION_COUNT = 8;

/** 单个环境 section 最大行数。 */
const MAX_ENVIRONMENT_SECTION_LINE_COUNT = 80;

/** 单行环境上下文最大长度。 */
const MAX_ENVIRONMENT_LINE_LENGTH = 2_000;

/** 环境 section 标签规则，避免生成非法 XML 标签。 */
const ENVIRONMENT_SECTION_TAG_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/u;

/** 环境上下文单行中的换行符。 */
const ENVIRONMENT_LINE_BREAK_PATTERN = /\r\n|\r|\n/gu;

/** 可选环境上下文行。 */
type EnvironmentLineInput = string | null | undefined | false;

/**
 * 判断值是否为对象记录。
 * @param value - 待判断值
 * @returns 是否为记录对象
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * 截断环境上下文行，避免页面上下文无限膨胀。
 * @param line - 原始行
 * @returns 限长后的行
 */
function truncateLine(line: string): string {
  return line.length > MAX_ENVIRONMENT_LINE_LENGTH ? `${line.slice(0, MAX_ENVIRONMENT_LINE_LENGTH)}...` : line;
}

/**
 * 将环境上下文输入压缩为单行文本。
 * @param value - 原始文本
 * @returns 单行文本
 */
function normalizeInlineText(value: string): string {
  return value.replace(ENVIRONMENT_LINE_BREAK_PATTERN, ' ');
}

/**
 * 规范化环境上下文行。
 * @param value - 原始行
 * @returns 规范化后的行
 */
function normalizeLine(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const line = normalizeInlineText(value).trim();
  if (!line) return undefined;
  return truncateLine(line);
}

/**
 * 规范化环境 section。
 * @param value - 原始 section
 * @returns 规范化后的 section
 */
function normalizeSection(value: unknown): ChatRuntimeEnvironmentSection | undefined {
  if (!isRecord(value)) return undefined;
  const tag = typeof value.tag === 'string' ? value.tag.trim() : '';
  if (!ENVIRONMENT_SECTION_TAG_PATTERN.test(tag)) return undefined;
  if (!Array.isArray(value.lines)) return undefined;
  const lines = value.lines
    .map(normalizeLine)
    .filter((line): line is string => Boolean(line))
    .slice(0, MAX_ENVIRONMENT_SECTION_LINE_COUNT);
  return lines.length ? { tag, lines } : undefined;
}

/**
 * 创建可选环境上下文行。
 * @param label - 行标签
 * @param value - 行值
 * @returns 可注入行
 */
export function createEnvironmentLine(label: string, value: string | null | undefined): string | undefined {
  const normalizedLabel = normalizeInlineText(label).trim();
  const normalizedValue = value ? normalizeInlineText(value).trim() : '';
  return normalizedLabel && normalizedValue ? `${normalizedLabel}: ${normalizedValue}` : undefined;
}

/**
 * 创建环境 section。
 * @param tag - section 标签
 * @param lines - 原始行列表
 * @returns 规范化后的 section
 */
export function createEnvironmentSection(tag: string, lines: readonly EnvironmentLineInput[]): ChatRuntimeEnvironmentSection | undefined {
  return normalizeSection({ tag, lines });
}

/**
 * 规范化页面环境上下文。
 * @param context - 页面注册的环境上下文
 * @returns 规范化后的页面环境上下文
 */
export function normalizeEnvironmentContext(context: ChatRuntimePageEnvironmentContext | undefined): ChatRuntimePageEnvironmentContext | undefined {
  if (!isRecord(context)) return undefined;
  if (!Array.isArray(context.sections)) return undefined;
  const sections = context.sections
    .map(normalizeSection)
    .filter((section): section is ChatRuntimeEnvironmentSection => Boolean(section))
    .slice(0, MAX_ENVIRONMENT_SECTION_COUNT);
  return sections.length ? { sections } : undefined;
}
