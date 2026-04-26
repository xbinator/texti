/**
 * @file placeholder.ts
 * @description 占位符扩展，为 CodeMirror 编辑器提供占位符文本功能
 */

import { placeholder as createPlaceholder, type ViewPlugin } from '@codemirror/view';

/**
 * 创建占位符扩展
 * @description 使用 CodeMirror view 的 placeholder 函数创建占位符扩展
 * @param placeholderText - 占位符文本内容
 * @returns ViewPlugin 实例
 */
export function createPlaceholderExtension(placeholderText: string): ViewPlugin {
  return createPlaceholder(placeholderText);
}
