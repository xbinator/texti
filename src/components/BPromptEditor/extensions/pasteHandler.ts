/**
 * @file pasteHandler.ts
 * @description Paste and drop handler extension for CodeMirror editor
 */

import { EditorView, type ViewPlugin } from '@codemirror/view';

/**
 * Creates a paste handler extension that:
 * - For paste: prioritizes ClipboardData.files, generates file reference tokens
 * - For drop: positions at the drop location using posAtCoords
 * - For plain text: returns false to let CodeMirror handle it
 * @returns ViewPlugin instance
 */
export function createPasteHandlerExtension(): ViewPlugin {
  return EditorView.domEventHandlers(
    (event, view) => {
      if (event instanceof ClipboardEvent) {
        // Handle paste event
        const clipboardData = event.clipboardData;
        if (!clipboardData) return false;

        // Prioritize files from clipboard
        const files = clipboardData.files;
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

      if (event instanceof DragEvent) {
        // Handle drop event
        if (event.type === 'drop') {
          const dataTransfer = event.dataTransfer;
          if (!dataTransfer) return false;

          // Prioritize files from drag data
          const files = dataTransfer.files;
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

          // Let CodeMirror handle plain text
          return false;
        }

        // Let CodeMirror handle dragover (for cursor positioning)
        if (event.type === 'dragover') {
          return false;
        }
      }

      // Let other events pass through
      return false;
    },
    {
      // Use capture phase to intercept before Vue handlers
      capture: true
    }
  );
}
