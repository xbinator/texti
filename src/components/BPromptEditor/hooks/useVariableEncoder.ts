export const CARET_SPACER = '\u00A0';

export interface VariableEncoderOptions {
  getVariableLabel: (value: string) => string | undefined;
}

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

export function useVariableEncoder(options: VariableEncoderOptions) {
  const { getVariableLabel } = options;

  function createVariableSpan(variableName: string): HTMLElement {
    const element = document.createElement('span');
    element.className = 'b-prompt-variable-tag';
    element.setAttribute('data-value', 'variable');
    element.setAttribute('data-content', variableName);
    element.setAttribute('contenteditable', 'false');
    element.textContent = getVariableLabel(variableName) || variableName;
    return element;
  }

  function encodeVariables(content: string): string {
    if (!content) return '';
    return escapeHtml(content).replace(/\{\{([^{}]+)\}\}/g, (_, name) => createVariableSpan(name.trim()).outerHTML);
  }

  function decodeVariables(content: string): string {
    if (!content) return '';

    const decoded = content
      .replace(/<span[^>]*data-content="([^"]+)"[^>]*>.*?<\/span>/g, '{{$1}}')
      .split(CARET_SPACER)
      .join('');

    const temp = document.createElement('div');
    temp.innerHTML = decoded;

    temp.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
    temp.querySelectorAll('div, p').forEach((block) => {
      block.parentNode?.insertBefore(document.createTextNode('\n'), block);
      while (block.firstChild) block.parentNode?.insertBefore(block.firstChild, block);
      block.remove();
    });

    return temp.textContent || '';
  }

  function isVariableElement(node: Node | null): node is HTMLElement {
    return node instanceof HTMLElement && node.dataset.value === 'variable';
  }

  return {
    createVariableSpan,
    encodeVariables,
    decodeVariables,
    isVariableElement
  };
}
