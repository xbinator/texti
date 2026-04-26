/**
 * @file pasteHandler.ts
 * @description Paste and drop handler extension for CodeMirror editor
 */

import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

/**
 * Creates a paste handler extension that:
 * - For paste: prioritizes ClipboardData.files, generates file reference tokens
 * - For drop: positions at the drop location using posAtCoords
 * - For plain text: returns false to let CodeMirror handle it
 * @returns Extension instance
 */
export function createPasteHandlerExtension(): Extension {
  return EditorView.domEventHandlers({
    paste(event: Event, view: EditorView): boolean {
      if (event instanceof ClipboardEvent) {
        // Handle paste event
        const { clipboardData } = event;
        if (!clipboardData) return false;

        // Prioritize files from clipboard
        const { files } = clipboardData;
        if (files.length > 0) {
          event.preventDefault();
          const file = files[0];
          const encodedName = encodeURIComponent(file.name);
          const fileRef = `{{file-ref:${encodedName}|${encodedName}}}`;

          const pos = view.state.selection.main.head;
          view.dispatch({
            changes: { from: pos, insert: fileRef }
          });
          return true;
        }

        // Let CodeMirror handle plain text
        return false;
      }
      return false;
    },
    drop(event: Event, view: EditorView): boolean {
      if (event instanceof DragEvent) {
        const { dataTransfer } = event;
        if (!dataTransfer) return false;

        // Prioritize files from drag data
        const { files } = dataTransfer;
        if (files.length > 0) {
          event.preventDefault();
          const file = files[0];
          const encodedName = encodeURIComponent(file.name);
          const fileRef = `{{file-ref:${encodedName}|${encodedName}}}`;

          // Position at drop location
          const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
          if (pos !== null) {
            view.dispatch({
              changes: { from: pos, insert: fileRef }
            });
          }
          return true;
        }
      }
      return false;
    },
    dragover(): boolean {
      // Let CodeMirror handle dragover (for cursor positioning)
      return false;
    }
  });
}
