/**
 * @file chipResolver.ts
 * @description 聊天输入框 Chip 解析器，将 file-ref token 解析为渲染 Widget。
 */
import type { FileLocation } from '../types';
import { WidgetType } from '@codemirror/view';
import type { ChipResolver } from '@/components/BPromptEditor/extensions/variableChip';

/**
 * 文件引用 Chip Widget，由 chipResolver 返回。
 * 有行号 → 显示 `fileName:line` 或 `fileName:startLine-endLine`
 * 无行号 → 仅显示 `fileName`
 */
class FileRefWidget extends WidgetType {
  constructor(private location: FileLocation) {
    super();
  }

  eq(other: FileRefWidget): boolean {
    return (
      this.location.fileName === other.location.fileName &&
      this.location.startLine === other.location.startLine &&
      this.location.endLine === other.location.endLine &&
      this.location.renderStartLine === other.location.renderStartLine &&
      this.location.renderEndLine === other.location.renderEndLine
    );
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'b-prompt-chip b-prompt-chip--file';

    const { fileName, startLine, endLine, renderStartLine, renderEndLine } = this.location;

    const lineText = renderStartLine && renderEndLine ? `${renderStartLine}-${renderEndLine}` : `${startLine}-${endLine}`;

    span.innerHTML = `<span class="truncate" style="max-width: 120px;">${fileName}</span> <span>${lineText}</span>`;

    return span;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/**
 * 解析文件引用字符串
 * 格式: #filePath startLine-endLine|renderStartLine-renderEndLine
 * @param input - 待解析的字符串
 * @returns 解析结果，解析失败时返回默认值
 */
export function parseFileRef(input: string): Required<FileLocation> {
  const reg = /^#(\S+)\s+(\d+)-(\d+)(?:\|(\d+)-(\d+))?$/;

  const match = input.match(reg);

  if (!match) {
    return { filePath: null, fileName: input, startLine: 0, endLine: 0, renderStartLine: 0, renderEndLine: 0 };
  }

  const [, filePath, startLine, endLine, renderStartLine, renderEndLine] = match;
  const trimmedPath = filePath.trim();
  const fileName = trimmedPath.split(/[\\/]/).filter(Boolean).pop() ?? trimmedPath;

  return {
    filePath: trimmedPath,
    fileName,
    startLine: Number(startLine),
    endLine: Number(endLine),
    renderStartLine: renderStartLine ? Number(renderStartLine) : Number(startLine),
    renderEndLine: renderEndLine ? Number(renderEndLine) : Number(endLine)
  };
}

/**
 * Chip 解析器，将 {{...}} 内部的 body 解析为渲染指令。
 * 格式: #filePath startLine-endLine|renderStartLine-renderEndLine
 * 其他 → null（不渲染为 chip）。
 */
export const chipResolver: ChipResolver = (content) => {
  if (!content.startsWith('#')) return null;

  const parsed = parseFileRef(content);

  return { widget: new FileRefWidget(parsed) };
};
