import type { Extension } from '@codemirror/state';
import type { DecorationSet, EditorView, ViewUpdate } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { Decoration, ViewPlugin } from '@codemirror/view';
import { castArray, flatten, isString, split } from 'lodash-es';
import { common, createLowlight } from 'lowlight';

interface LowlightTextNode {
  type: 'text';
  value: string;
}

// eslint-disable-next-line no-use-before-define
type LowlightNode = LowlightElementNode | LowlightTextNode;

interface LowlightElementNode {
  type: 'element' | 'root';
  children?: LowlightNode[];
  properties?: {
    className?: string[] | string;
  };
}

interface ActiveFence {
  codeFrom: number;
  fenceChar: '`' | '~';
  fenceLength: number;
  language: string;
}

export interface SourceCodeBlockHighlightRange {
  className: string;
  from: number;
  text: string;
  to: number;
}

const lowlight = createLowlight(common);

const SOURCE_CODE_BLOCK_LANGUAGE_ALIASES: Record<string, string> = {
  cjs: 'javascript',
  htm: 'xml',
  html: 'xml',
  js: 'javascript',
  jsx: 'javascript',
  md: 'markdown',
  plaintext: 'plaintext',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  sh: 'shell',
  shellscript: 'shell',
  text: 'plaintext',
  ts: 'typescript',
  tsx: 'typescript',
  vue: 'xml',
  yml: 'yaml'
};

function getLineEnd(content: string, lineStart: number): { lineEnd: number; nextLineStart: number } {
  const newlineIndex = content.indexOf('\n', lineStart);

  if (newlineIndex === -1) {
    return {
      lineEnd: content.length,
      nextLineStart: content.length
    };
  }

  return {
    lineEnd: newlineIndex > lineStart && content[newlineIndex - 1] === '\r' ? newlineIndex - 1 : newlineIndex,
    nextLineStart: newlineIndex + 1
  };
}

function getOpeningFence(line: string): { fenceChar: '`' | '~'; fenceLength: number; info: string } | null {
  const match = line.match(/^\s{0,3}(`{3,}|~{3,})([^`]*)$/);
  if (!match) {
    return null;
  }

  return {
    fenceChar: match[1][0] as '`' | '~',
    fenceLength: match[1].length,
    info: match[2].trim()
  };
}

function isClosingFence(line: string, fence: ActiveFence): boolean {
  const match = line.match(/^\s{0,3}(`{3,}|~{3,})\s*$/);
  if (!match) {
    return false;
  }

  return match[1][0] === fence.fenceChar && match[1].length >= fence.fenceLength;
}

function getNodeClassNames(node: LowlightElementNode): string[] {
  const rawClassName = node.properties?.className;
  const classNames = flatten(castArray(rawClassName).map((item: string | string[]) => (isString(item) ? split(item, /\s+/) : [])));

  return classNames.filter((className: string) => className.startsWith('hljs-'));
}

function collectHighlightRanges(
  node: LowlightNode,
  from: number,
  activeClassNames: readonly string[]
): { nextFrom: number; ranges: SourceCodeBlockHighlightRange[] } {
  if (node.type === 'text') {
    const nextFrom = from + node.value.length;

    if (!activeClassNames.length || !node.value.length) {
      return { nextFrom, ranges: [] };
    }

    return {
      nextFrom,
      ranges: [
        {
          className: activeClassNames.join(' '),
          from,
          text: node.value,
          to: nextFrom
        }
      ]
    };
  }

  const mergedClassNames = [...new Set([...activeClassNames, ...getNodeClassNames(node)])];
  const ranges: SourceCodeBlockHighlightRange[] = [];
  let nextFrom = from;

  node.children?.forEach((child: LowlightNode): void => {
    const result = collectHighlightRanges(child, nextFrom, mergedClassNames);

    nextFrom = result.nextFrom;
    ranges.push(...result.ranges);
  });

  return { nextFrom, ranges };
}

function createHighlightDecoration(className: string): Decoration {
  return Decoration.mark({
    class: className
  });
}

export function getSourceCodeBlockLanguage(info: string): string {
  const normalizedInfo = info.trim().split(/\s+/, 1)[0]?.toLowerCase() ?? '';
  if (!normalizedInfo) {
    return '';
  }

  const language = SOURCE_CODE_BLOCK_LANGUAGE_ALIASES[normalizedInfo] ?? normalizedInfo;
  return lowlight.registered(language) ? language : '';
}

export function getSourceCodeBlockHighlightRanges(content: string): SourceCodeBlockHighlightRange[] {
  const ranges: SourceCodeBlockHighlightRange[] = [];
  let activeFence: ActiveFence | null = null;
  let lineStart = 0;

  while (lineStart <= content.length) {
    const { lineEnd, nextLineStart } = getLineEnd(content, lineStart);
    const line = content.slice(lineStart, lineEnd);

    if (!activeFence) {
      const openingFence = getOpeningFence(line);

      if (openingFence) {
        activeFence = {
          codeFrom: nextLineStart,
          fenceChar: openingFence.fenceChar,
          fenceLength: openingFence.fenceLength,
          language: getSourceCodeBlockLanguage(openingFence.info)
        };
      }
    } else if (isClosingFence(line, activeFence)) {
      if (activeFence.language && activeFence.codeFrom < lineStart) {
        const code = content.slice(activeFence.codeFrom, lineStart);
        const tree = lowlight.highlight(activeFence.language, code);
        const result = collectHighlightRanges(tree as LowlightNode, activeFence.codeFrom, []);

        ranges.push(...result.ranges);
      }

      activeFence = null;
    }

    if (nextLineStart === content.length) {
      break;
    }

    lineStart = nextLineStart;
  }

  return ranges;
}

function createSourceCodeBlockHighlightDecorations(content: string): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();

  getSourceCodeBlockHighlightRanges(content).forEach((range: SourceCodeBlockHighlightRange): void => {
    if (range.from >= range.to) {
      return;
    }

    builder.add(range.from, range.to, createHighlightDecoration(range.className));
  });

  return builder.finish();
}

export function createSourceCodeBlockHighlightExtension(): Extension {
  return ViewPlugin.fromClass(
    class SourceCodeBlockHighlightPlugin {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = createSourceCodeBlockHighlightDecorations(view.state.doc.toString());
      }

      update(update: ViewUpdate): void {
        if (update.docChanged) {
          this.decorations = createSourceCodeBlockHighlightDecorations(update.state.doc.toString());
        }
      }
    },
    {
      decorations: (plugin) => plugin.decorations
    }
  );
}
