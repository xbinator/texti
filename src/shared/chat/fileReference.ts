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
  filePath: string | null;
  /** 展示用文件名 */
  fileName: string;
  /** 起始行号（1-based），0 表示无行号 */
  startLine: number;
  /** 结束行号（1-based），等于 startLine 时表示单行，0 仅与 startLine=0 配对 */
  endLine: number;
}

/**
 * 从文件路径中提取展示文件名。
 * @param filePath - 完整文件路径
 */
export function getFileNameFromPath(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).pop() ?? filePath;
}

/**
 * 根据选区起止位置前的文本计算行号，空字符串视为第 1 行开头。
 * @param textBeforeStart - 选区起点之前的文本
 * @param textBeforeEnd - 选区终点之前的文本
 * @returns 包含 startLine 和 endLine 的对象
 */
export function getLineRangeFromTextBeforeSelection(textBeforeStart: string, textBeforeEnd: string): { startLine: number; endLine: number } {
  const startLine = textBeforeStart.split(/\r?\n/).length;
  const endLine = textBeforeEnd.split(/\r?\n/).length;

  return { startLine, endLine };
}

export function isChatFileReferenceInsertPayload(payload: unknown): payload is ChatFileReferenceInsertPayload {
  if (!isObject(payload) || isArray(payload)) return false;

  const { filePath, fileName, startLine, endLine } = payload as Partial<ChatFileReferenceInsertPayload>;

  const isValidFilePath = (isString(filePath) && filePath.length > 0) || isNull(filePath);
  const isValidFileName = isString(fileName) && fileName.length > 0;
  const isValidLines = isNumber(startLine) && isNumber(endLine) && startLine >= 0 && (startLine === endLine || (startLine > 0 && endLine >= startLine));

  return isValidFilePath && isValidFileName && isValidLines;
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
