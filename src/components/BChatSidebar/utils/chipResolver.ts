/**
 * @file chipResolver.ts
 * @description 聊天输入框 Chip 解析器，将 file-ref token 解析为渲染 Widget。
 */
import { WidgetType } from '@codemirror/view';
import type { ChipResolver } from '@/components/BPromptEditor/extensions/variableChip';

/**
 * 文件引用 Chip Widget，由 chipResolver 返回。
 * 有行号 → 显示 `fileName:startLine-endLine` 或 `fileName:startLine`
 * 无行号 → 仅显示 `fileName`
 */
class FileRefWidget extends WidgetType {
  constructor(private fileName: string, private startLine: number, private endLine: number) {
    super();
  }

  eq(other: FileRefWidget): boolean {
    return this.fileName === other.fileName && this.startLine === other.startLine && this.endLine === other.endLine;
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'b-prompt-chip b-prompt-chip--file';

    span.innerHTML = `<span class="truncate" style="max-width: 150px;">${this.fileName}</span> <span>${this.startLine}-${this.endLine}</span>`;
    return span;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

export function parseFileRef(input: string) {
  const reg = /^#\[([^\]]+)\]\(([^)]*)\)\s*(\d+)-(\d+)$/;

  const match = input.match(reg);

  if (!match) return null;

  const [, id, filePath, startLine, endLine] = match;

  return { id, filePath: filePath.trim(), startLine: Number(startLine), endLine: Number(endLine) };
}

/**
 * Chip 解析器，将 {{...}} 内部的 body 解析为渲染指令。
 * 格式: @fileName 或 @fileName:startLine 或 @fileName:startLine-endLine
 * 其他 → null（不渲染为 chip）。
 */
export const chipResolver: ChipResolver = (content) => {
  if (!content.startsWith('#')) {
    return null;
  }

  const match = /^#\[([^\]]+)\]\(([^)]*)\)\s+(\d+)-(\d+)$/.exec(content);

  if (!match) return { widget: new FileRefWidget(content, 0, 0) };

  const [, , filePath, startLine, endLine] = match;

  const fileName = filePath.split(/[\\/]/).filter(Boolean).pop() ?? filePath;

  return { widget: new FileRefWidget(fileName, Number(startLine), Number(endLine)) };
};
