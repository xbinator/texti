/**
 * @file messageSafety.ts
 * @description BMessage 在 Markdown 解析前执行的线性体积与容器深度扫描。
 */
import type { MessageNodeRenderMode } from '../types';

/** Markdown 转为纯文本的最大 UTF-8 字节边界。 */
export const MESSAGE_TEXT_LIMIT_BYTES = 2 * 1024 * 1024;
/** Markdown 转入 Worker 的 UTF-8 字节阈值。 */
export const MESSAGE_WORKER_THRESHOLD_BYTES = 32 * 1024;
/** Markdown 容器允许的最大推算嵌套深度。 */
const MESSAGE_CONTAINER_DEPTH_LIMIT = 128;

/** BMessage 解析安全扫描结果。 */
export interface MessageSafetyResult {
  /** 实际解析模式。 */
  mode: MessageNodeRenderMode;
  /** 降级原因。 */
  reason?: 'content-too-large' | 'container-depth';
}

/**
 * 计算字符串 UTF-8 字节数，并避免创建同尺寸临时数组。
 * @param content - 待测文本
 * @returns UTF-8 字节数
 */
export function getMessageByteLength(content: string): number {
  let byteLength = 0;
  for (let index = 0; index < content.length; index += 1) {
    const codePoint = content.codePointAt(index) ?? 0;
    if (codePoint <= 0x7f) byteLength += 1;
    else if (codePoint <= 0x7ff) byteLength += 2;
    else if (codePoint <= 0xffff) byteLength += 3;
    else {
      byteLength += 4;
      index += 1;
    }
  }
  return byteLength;
}

/**
 * 跳过一段行内空白。
 * @param content - 完整消息文本
 * @param start - 起始位置
 * @param end - 当前行结束位置
 * @returns 第一个非空白位置
 */
function skipLineWhitespace(content: string, start: number, end: number): number {
  let index = start;
  while (index < end && (content[index] === ' ' || content[index] === '\t')) index += 1;
  return index;
}

/**
 * 推算单行连续 Markdown 引用和列表容器深度。
 * @param content - 完整消息文本
 * @param start - 行起始位置
 * @param end - 行结束位置
 * @returns 推算容器深度
 */
function estimateLineDepth(content: string, start: number, end: number): number {
  const firstMarker = skipLineWhitespace(content, start, end);
  let index = firstMarker;
  let depth = Math.floor((firstMarker - start) / 2);

  while (index < end) {
    if (content[index] === '>') {
      depth += 1;
      index = skipLineWhitespace(content, index + 1, end);
      continue;
    }

    const character = content[index];
    if ((character === '-' || character === '+' || character === '*') && index + 1 < end && /\s/u.test(content[index + 1])) {
      depth += 1;
      index = skipLineWhitespace(content, index + 2, end);
      continue;
    }

    let digitEnd = index;
    while (digitEnd < end && content[digitEnd] >= '0' && content[digitEnd] <= '9') digitEnd += 1;
    const delimiter = content[digitEnd];
    if (digitEnd > index && (delimiter === '.' || delimiter === ')') && digitEnd + 1 < end && /\s/u.test(content[digitEnd + 1])) {
      depth += 1;
      index = skipLineWhitespace(content, digitEnd + 2, end);
      continue;
    }
    break;
  }

  return depth;
}

/**
 * 在调用 marked 前检查消息体积与潜在递归容器深度。
 * @param content - 待解析消息正文
 * @returns Markdown 或纯文本安全模式
 */
export function inspectMessageSafety(content: string): MessageSafetyResult {
  if (getMessageByteLength(content) > MESSAGE_TEXT_LIMIT_BYTES) return { mode: 'text', reason: 'content-too-large' };

  let lineStart = 0;
  for (let index = 0; index <= content.length; index += 1) {
    if (index < content.length && content[index] !== '\n') continue;
    if (estimateLineDepth(content, lineStart, index) > MESSAGE_CONTAINER_DEPTH_LIMIT) return { mode: 'text', reason: 'container-depth' };
    lineStart = index + 1;
  }
  return { mode: 'markdown' };
}
