/**
 * @file fileReferenceContext.ts
 * @description 文件引用 token 的结构化标记转换，将 {{file-ref:...}} 替换为 [file: ...] 标记供 LLM 参考。
 */
import { isEmpty } from 'lodash-es';
import type { Message } from '@/components/BChatSidebar/utils/types';
import { logger } from '@/shared/logger';

export interface ParsedLineRange {
  start: number;
  end: number;
}

/**
 * 解析行号范围字符串。
 * 当前 convertFileRefTokensToMarkers 使用 reference.line.replace('-', '-L') 直接生成标记，
 * 本函数保留供测试和未来可能的标记格式扩展使用。
 */
export function parseLineRange(line: string): ParsedLineRange | null {
  const singleMatch = /^(\d+)$/.exec(line);
  if (singleMatch) {
    const value = Number(singleMatch[1]);
    return value > 0 ? { start: value, end: value } : null;
  }

  const rangeMatch = /^(\d+)-(\d+)$/.exec(line);
  if (!rangeMatch) return null;

  const start = Number(rangeMatch[1]);
  const end = Number(rangeMatch[2]);
  return start > 0 && end >= start ? { start, end } : null;
}

/**
 * 将消息中的 {{file-ref:...}} token 替换为结构化标记。
 * 不读取文件内容，仅生成语言无关的标记供 LLM 参考，由 LLM 自主决定是否通过 read_file 工具读取。
 *
 * Token 格式: {{file-ref:referenceId|fileName|startLine|endLine}}
 * 标记格式（有 path）: [file: /absolute/path/to/file.ts#L3-L5]
 * 标记格式（无 path）: [file: id=abc123 name="unsaved" @L3-L5]
 *
 * reference.path 为绝对路径，因此标记中直接使用。
 * 续轮调用时幂等，已替换为 [file: ...] 的内容不含 {{file-ref: 前缀，正则不会命中。
 *
 * @param sourceMessages - 原始聊天消息
 * @returns 标记替换后的消息列表
 */
export function convertFileRefTokensToMarkers(sourceMessages: Message[]): Message[] {
  return sourceMessages.map((message) => {
    if (message.role !== 'user' || isEmpty(message.references)) {
      // 诊断：消息包含 token 但没有 references 时记录
      if (message.role === 'user' && message.content.includes('{{file-ref:')) {
        logger.info(`[file-ref] convert skipped: has token but refs=${message.references?.length ?? 0}`);
      }
      return message;
    }

    // 构建 referenceId → reference 的快速查找映射
    const referenceById = new Map((message.references ?? []).map((ref) => [ref.id, ref]));
    logger.info(`[file-ref] convert processing: refs=${message.references.length}, ids=${Array.from(referenceById.keys()).join(',')}`);

    // 正则匹配 {{file-ref:referenceId|...}} 令牌，采用宽松匹配（三个可选管道段）
    // 注意：regex 为函数局部变量，不会受 /g 标志的 lastIndex 陷阱影响
    const regex = /\{\{file-ref:([A-Za-z0-9_-]+)(?:\|[^|}]*)?(?:\|[^|}]*)?(?:\|[^|}]*)?\}\}/g;

    const modelContent = message.content.replace(regex, (match, referenceId) => {
      const reference = referenceById.get(referenceId);
      if (!reference) return match;

      if (reference.path) {
        // 有磁盘路径（绝对路径）—— [file: /absolute/path/to/file.ts#L3-L5]
        const lines = reference.line ? `#L${reference.line.replace('-', '-L')}` : '';
        return `[file: ${reference.path}${lines}]`;
      }

      // 无磁盘路径（未保存文件）—— [file: id=abc123 name="foo" @L3-L5]
      const lines = reference.line ? ` @L${reference.line.replace('-', '-L')}` : '';
      return `[file: id=${reference.documentId} name="${reference.fileName}"${lines}]`;
    });

    // 内容无变化，返回原始消息
    if (modelContent === message.content) return message;

    // 保留非 text parts（如图片），只更新 text part 的内容
    return {
      ...message,
      content: modelContent,
      parts: message.parts?.map((p) => (p.type === 'text' ? { ...p, text: modelContent } : p)) ?? [{ type: 'text', text: modelContent }]
    };
  });
}
