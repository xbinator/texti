/**
 * @file pasteHandler.ts
 * @description Paste and drop handler extension for CodeMirror editor
 */

import type { PasteImageContext } from '../types';
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

/**
 * 文件粘贴回调类型。
 * 当前仅支持同步返回——返回 string 时插入，返回 null 时跳过。
 * 返回 Promise 时会打 warning 并跳过（异步场景下位置可能因用户编辑而失效）。
 */
type OnPasteFiles = (files: File[]) => Promise<string | null> | string | null;
/**
 * 图片粘贴接管回调类型。
 */
type OnPasteImages = (context: PasteImageContext) => Promise<void> | void;
/**
 * 图片接收能力判断函数。
 */
type CanAcceptImages = () => boolean;

/**
 * 判断文件是否为图片。
 * @param file - 浏览器 File 对象
 * @returns 是否为图片
 */
function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

/**
 * 向编辑器指定位置插入文本。
 * @param view - 编辑器视图
 * @param from - 插入位置
 * @param text - 待插入文本
 * @returns 插入后的光标位置
 */
function insertText(view: EditorView, from: number, text: string): number {
  view.dispatch({
    changes: { from, insert: text },
    selection: { anchor: from + text.length }
  });
  return from + text.length;
}

/**
 * Creates a paste handler extension that delegates to the onPasteFiles callback.
 * @param onPasteFiles - Callback for constructing tokens from pasted/dropped files
 * @param onPasteImages - Callback for handling pasted/dropped images
 * @param canAcceptImages - Capability guard for images
 * @returns Extension instance
 */
export function createPasteHandlerExtension(onPasteFiles?: OnPasteFiles, onPasteImages?: OnPasteImages, canAcceptImages?: CanAcceptImages): Extension {
  return EditorView.domEventHandlers({
    paste(event: Event, view: EditorView): boolean {
      if (event instanceof ClipboardEvent) {
        const { clipboardData } = event;
        if (!clipboardData) return false;

        const files = Array.from(clipboardData.files);
        const imageFiles = files.filter((file) => isImageFile(file));
        const otherFiles = files.filter((file) => !isImageFile(file));
        const text = clipboardData.getData('text/plain') || undefined;
        const html = clipboardData.getData('text/html') || undefined;

        if (imageFiles.length > 0) {
          event.preventDefault();
          const pos = view.state.selection.main.head;
          if (canAcceptImages && !canAcceptImages()) {
            let nextPos = pos;
            if (typeof text === 'string' && text.length > 0) {
              nextPos = insertText(view, pos, text);
            }

            if (otherFiles.length > 0 && onPasteFiles) {
              const result = onPasteFiles(otherFiles);

              if (result instanceof Promise) {
                console.warn('[pasteHandler] Async onPasteFiles not supported — position may be stale. Insertion skipped.');
                return true;
              }
              if (typeof result === 'string') {
                insertText(view, nextPos, result);
              }
            }
            return true;
          }

          if (typeof text === 'string' && text.length > 0) {
            insertText(view, pos, text);
          }

          onPasteImages?.({
            text,
            html,
            imageFiles,
            otherFiles
          });

          if (otherFiles.length > 0 && onPasteFiles) {
            const nextPos = text ? pos + text.length : pos;
            const result = onPasteFiles(otherFiles);

            if (result instanceof Promise) {
              console.warn('[pasteHandler] Async onPasteFiles not supported — position may be stale. Insertion skipped.');
              return true;
            }
            if (typeof result === 'string') {
              insertText(view, nextPos, result);
            }
          }
          return true;
        }

        if (files.length > 0 && onPasteFiles) {
          event.preventDefault();
          const pos = view.state.selection.main.head;
          const result = onPasteFiles(files);

          if (result instanceof Promise) {
            console.warn('[pasteHandler] Async onPasteFiles not supported — position may be stale. Insertion skipped.');
            return true;
          }
          if (typeof result === 'string') {
            insertText(view, pos, result);
          }
          return true;
        }

        return false;
      }
      return false;
    },
    drop(event: Event, view: EditorView): boolean {
      if (event instanceof DragEvent) {
        const { dataTransfer } = event;
        if (!dataTransfer) return false;

        const files = Array.from(dataTransfer.files);
        const imageFiles = files.filter((file) => isImageFile(file));
        const otherFiles = files.filter((file) => !isImageFile(file));

        if (imageFiles.length > 0) {
          event.preventDefault();
          const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
          if (pos === null) return true;

          if (canAcceptImages && !canAcceptImages()) {
            if (otherFiles.length > 0 && onPasteFiles) {
              const result = onPasteFiles(otherFiles);

              if (result instanceof Promise) {
                console.warn('[pasteHandler] Async onPasteFiles not supported — position may be stale. Insertion skipped.');
                return true;
              }
              if (typeof result === 'string') {
                insertText(view, pos, result);
              }
            }
            return true;
          }

          onPasteImages?.({
            imageFiles,
            otherFiles
          });

          if (otherFiles.length > 0 && onPasteFiles) {
            const result = onPasteFiles(otherFiles);

            if (result instanceof Promise) {
              console.warn('[pasteHandler] Async onPasteFiles not supported — position may be stale. Insertion skipped.');
              return true;
            }
            if (typeof result === 'string') {
              insertText(view, pos, result);
            }
          }
          return true;
        }

        if (files.length > 0 && onPasteFiles) {
          event.preventDefault();
          const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
          if (pos === null) return true;

          const result = onPasteFiles(files);

          if (result instanceof Promise) {
            console.warn('[pasteHandler] Async onPasteFiles not supported — position may be stale. Insertion skipped.');
            return true;
          }
          if (typeof result === 'string') {
            insertText(view, pos, result);
          }
          return true;
        }
      }
      return false;
    },
    dragover(event: Event): boolean {
      if (event instanceof DragEvent && event.dataTransfer?.types.includes('Files')) {
        event.preventDefault();
        return true;
      }
      return false;
    }
  });
}
