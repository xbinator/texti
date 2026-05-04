/**
 * @file fileReference.ts
 * @description 聊天输入框文件引用插入事件与路径行号工具。
 */
import { isNull, isString, isNumber, isObject, isArray } from 'lodash-es';
import { emitter } from '@/utils/emitter';

/** 聊天输入框文件引用插入事件名 */
export const CHAT_FILE_REFERENCE_INSERT_EVENT = 'chat:file-reference:insert';

/**
 * 聊天输入框文件引用插入事件负载。
 */
export interface ChatFileReferenceInsertPayload {
  /** 文件引用ID */
  id: string;
  /** 文件扩展名 */
  ext: string;
  /** 完整文件路径，未保存文件为 null */
  filePath: string;
  /** 展示用文件名 */
  fileName: string;
  /** 起始行号（1-based），0 表示无行号 */
  startLine: number;
  /** 结束行号（1-based），等于 startLine 时表示单行，0 仅与 startLine=0 配对 */
  endLine: number;
  /** 渲染视图中的起始行号（1-based），0 表示无行号 */
  renderStartLine: number;
  /** 渲染视图中的结束行号（1-based），等于 renderStartLine 时表示单行，0 仅与 renderStartLine=0 配对 */
  renderEndLine: number;
}

function isValidLineRange(start: number, end: number): boolean {
  return isNumber(start) && isNumber(end) && start >= 0 && (start === end || (start > 0 && end >= start));
}

export function isChatFileReferenceInsertPayload(payload: unknown): payload is ChatFileReferenceInsertPayload {
  if (!isObject(payload) || isArray(payload)) return false;

  const { filePath, fileName, startLine, endLine, renderStartLine, renderEndLine } = payload as ChatFileReferenceInsertPayload;

  return (
    ((isString(filePath) && filePath.length > 0) || isNull(filePath)) &&
    isString(fileName) &&
    fileName.length > 0 &&
    isValidLineRange(startLine, endLine) &&
    isValidLineRange(renderStartLine, renderEndLine)
  );
}
/**
 * 发出聊天输入框文件引用插入事件。
 * @param payload - 文件引用数据
 */
export function emitChatFileReferenceInsert(payload: ChatFileReferenceInsertPayload): void {
  emitter.emit(CHAT_FILE_REFERENCE_INSERT_EVENT, payload);
}

/**
 * 监听聊天输入框文件引用插入事件。
 * @param handler - 事件处理函数
 */
export function onChatFileReferenceInsert(handler: (payload: ChatFileReferenceInsertPayload) => void): () => void {
  return emitter.on(CHAT_FILE_REFERENCE_INSERT_EVENT, (payload: unknown): void => {
    if (!isChatFileReferenceInsertPayload(payload)) {
      return;
    }

    handler(payload);
  });
}
