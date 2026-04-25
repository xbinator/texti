/**
 * @file useVariableEncoder.ts
 * @description Prompt editor variable and file-reference chip encoding helpers.
 */
export const CARET_SPACER = '\u00A0';
export const ZERO_WIDTH_SPACE = '\u200B';

/**
 * File-reference chip data used by the prompt editor.
 */
export interface FileReferenceChip {
  /** Stable reference id used by `{{file-ref:...}}` tokens. */
  referenceId: string;
  /** Stable document id that scopes the reference to a draft. */
  documentId: string;
  /** Full file path when available, otherwise `null` for unsaved references. */
  filePath: string | null;
  /** Display name shown inside the chip. */
  fileName: string;
  /** Line number or line range label. */
  line: number | string;
}

/**
 * Encoder configuration for regular variable tokens.
 */
export interface VariableEncoderOptions {
  /** Returns the display label for a regular variable token. */
  getVariableLabel: (value: string) => string | undefined;
}

/**
 * Normalizes editor text by removing caret placeholders and zero-width artifacts.
 * @param content - Encoded editor content.
 * @returns Normalized content used for empty-state checks.
 */
export function normalizePromptEditorContent(content: string): string {
  return content.replace(new RegExp(CARET_SPACER, 'g'), '').replace(new RegExp(ZERO_WIDTH_SPACE, 'g'), '').trim();
}

/**
 * Returns whether the editor content is effectively empty after stripping artifacts.
 * @param content - Encoded editor content.
 * @returns `true` when the editor should show its placeholder.
 */
export function isPromptEditorEffectivelyEmpty(content: string): boolean {
  return normalizePromptEditorContent(content).length === 0;
}

/**
 * Escapes HTML so token text can be inserted safely when no chip match is available.
 * @param text - Raw text to escape.
 * @returns Escaped HTML text.
 */
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };

  return text.replace(/[&<>"']/g, (m) => map[m]);
}

/**
 * Infers a file name from a file path.
 * @param filePath - Full file path.
 * @returns The last path segment or the original path.
 */
function inferFileName(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).pop() ?? filePath;
}

/**
 * Creates a file-reference chip and remembers it inside the current encoder instance.
 * @param reference - File reference metadata.
 * @param registry - Instance-local registry used for later token resolution.
 * @returns Chip element ready for contenteditable insertion.
 */
function createFileReferenceSpan(reference: FileReferenceChip, registry: Map<string, FileReferenceChip>): HTMLElement {
  registry.set(reference.referenceId, reference);

  const element = document.createElement('span');
  element.className = 'b-prompt-editor-tag b-prompt-editor-tag--file-reference';
  element.setAttribute('data-value', 'file-reference');
  element.setAttribute('data-reference-id', reference.referenceId);
  element.setAttribute('data-document-id', reference.documentId);
  element.setAttribute('data-file-name', reference.fileName);
  element.setAttribute('data-line', String(reference.line));

  if (reference.filePath) {
    element.setAttribute('data-file-path', reference.filePath);
  } else {
    element.setAttribute('data-temporary', 'true');
  }

  element.setAttribute('contenteditable', 'false');
  element.textContent = `${reference.fileName}:${reference.line}`;
  return element;
}

/**
 * Reads a file reference chip back into serializable metadata.
 * @param element - File reference chip element.
 * @returns File reference metadata or `null` when the chip is incomplete.
 */
function readFileReferenceChip(element: HTMLElement): FileReferenceChip | null {
  const referenceId = element.getAttribute('data-reference-id') ?? '';
  const documentId = element.getAttribute('data-document-id') ?? '';
  const filePath = element.getAttribute('data-file-path');
  const fileName = element.getAttribute('data-file-name') || (filePath ? inferFileName(filePath) : '');
  const line = element.getAttribute('data-line') ?? '';

  if (!referenceId || !documentId || !fileName || !line) {
    return null;
  }

  return {
    referenceId,
    documentId,
    filePath,
    fileName,
    line
  };
}

/**
 * Creates a regular variable chip element.
 * @param variableName - Variable token name without braces.
 * @param getVariableLabel - Label lookup used for display text.
 * @returns Chip element ready for contenteditable insertion.
 */
function createVariableSpan(variableName: string, getVariableLabel: (value: string) => string | undefined): HTMLElement {
  const element = document.createElement('span');
  element.className = 'b-prompt-editor-tag';
  element.setAttribute('data-value', 'variable');
  element.setAttribute('data-content', variableName);
  element.setAttribute('contenteditable', 'false');
  element.textContent = getVariableLabel(variableName) || variableName;
  return element;
}

/**
 * Encodes plain text and regular variables while preserving HTML safety.
 * @param content - Raw text content.
 * @param getVariableLabel - Variable label resolver.
 * @returns HTML string with variable chips inserted.
 */
function encodeVariableTokens(content: string, getVariableLabel: (value: string) => string | undefined): string {
  return escapeHtml(content).replace(/\{\{([^{}]+)\}\}/g, (_, name: string) => createVariableSpan(name.trim(), getVariableLabel).outerHTML);
}

/**
 * Decodes editor HTML back into stable model text.
 * @param content - Editor HTML.
 * @returns Plain text prompt value.
 */
function decodeContent(content: string, registry: Map<string, FileReferenceChip>): string {
  if (!content) return '';

  const temp = document.createElement('div');
  temp.innerHTML = content.split(CARET_SPACER).join('');

  temp.querySelectorAll('span[data-value="file-reference"]').forEach((element) => {
    const reference = readFileReferenceChip(element as HTMLElement);
    if (!reference) {
      element.replaceWith(document.createTextNode(element.textContent ?? ''));
      return;
    }

    registry.set(reference.referenceId, reference);
    element.replaceWith(document.createTextNode(`{{file-ref:${reference.referenceId}}}`));
  });

  temp.querySelectorAll('span[data-value="variable"][data-content]').forEach((element) => {
    element.replaceWith(document.createTextNode(`{{${element.getAttribute('data-content') ?? ''}}}`));
  });

  temp.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  temp.querySelectorAll('div, p').forEach((block) => {
    block.parentNode?.insertBefore(document.createTextNode('\n'), block);
    while (block.firstChild) block.parentNode?.insertBefore(block.firstChild, block);
    block.remove();
  });

  return temp.textContent || '';
}

/**
 * Determines whether a DOM node is a variable chip.
 * @param node - Node to inspect.
 * @returns `true` when the node is a variable chip.
 */
function isVariableElement(node: Node | null): node is HTMLElement {
  return node instanceof HTMLElement && node.dataset.value === 'variable';
}

/**
 * Determines whether a DOM node is a prompt-editor chip.
 * @param node - Node to inspect.
 * @returns `true` when the node is a variable or file-reference chip.
 */
function isChipElement(node: Node | null): node is HTMLElement {
  return node instanceof HTMLElement && (node.dataset.value === 'variable' || node.dataset.value === 'file-reference');
}

/**
 * Creates a prompt-editor encoder instance with draft-scoped file-reference lookup.
 * @param options - Encoder configuration.
 * @returns Chip helpers and token serializers scoped to this encoder instance.
 */
export function useVariableEncoder(options: VariableEncoderOptions) {
  const { getVariableLabel } = options;
  const fileReferenceRegistry = new Map<string, FileReferenceChip>();

  return {
    createVariableSpan: (variableName: string) => createVariableSpan(variableName, getVariableLabel),
    createFileReferenceSpan: (reference: FileReferenceChip) => createFileReferenceSpan(reference, fileReferenceRegistry),
    encodeVariables: (content: string) => {
      if (!content) return '';

      const fileReferencePattern = /\{\{file-ref:([A-Za-z0-9_-]+)\}\}/g;
      const parts: string[] = [];
      let lastIndex = 0;

      content.replace(fileReferencePattern, (match: string, referenceId: string, offset: number) => {
        parts.push(encodeVariableTokens(content.slice(lastIndex, offset), getVariableLabel));
        const reference = fileReferenceRegistry.get(referenceId);
        parts.push(reference ? createFileReferenceSpan(reference, fileReferenceRegistry).outerHTML : escapeHtml(match));
        lastIndex = offset + match.length;
        return match;
      });

      parts.push(encodeVariableTokens(content.slice(lastIndex), getVariableLabel));
      return parts.join('');
    },
    decodeVariables: (content: string) => decodeContent(content, fileReferenceRegistry),
    isVariableElement,
    isChipElement
  };
}
