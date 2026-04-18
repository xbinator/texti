import { describe, expect, it } from 'vitest';
import {
  getSourceCodeBlockHighlightRanges,
  getSourceCodeBlockLanguage
} from '@/components/BEditor/adapters/sourceEditorCodeBlockHighlight';

describe('getSourceCodeBlockLanguage', () => {
  it('normalizes common fenced code block aliases', () => {
    expect(getSourceCodeBlockLanguage('typescript')).toBe('typescript');
    expect(getSourceCodeBlockLanguage('ts')).toBe('typescript');
    expect(getSourceCodeBlockLanguage('js')).toBe('javascript');
    expect(getSourceCodeBlockLanguage('vue')).toBe('xml');
    expect(getSourceCodeBlockLanguage('unknown')).toBe('');
    expect(getSourceCodeBlockLanguage('')).toBe('');
  });
});

describe('getSourceCodeBlockHighlightRanges', () => {
  it('returns highlight ranges for fenced javascript code blocks', () => {
    const content = ['```js', 'const answer = 42', '```'].join('\n');
    const ranges = getSourceCodeBlockHighlightRanges(content);

    expect(ranges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          className: expect.stringContaining('hljs-keyword'),
          text: 'const'
        }),
        expect.objectContaining({
          className: expect.stringContaining('hljs-number'),
          text: '42'
        })
      ])
    );
  });

  it('ignores unknown fenced code block languages', () => {
    const content = ['```madeuplang', 'value', '```'].join('\n');

    expect(getSourceCodeBlockHighlightRanges(content)).toEqual([]);
  });

  it('ignores inline code and unclosed fences', () => {
    const inlineCode = 'Here is `const answer = 42` inline.';
    const unclosedFence = ['```js', 'const answer = 42'].join('\n');

    expect(getSourceCodeBlockHighlightRanges(inlineCode)).toEqual([]);
    expect(getSourceCodeBlockHighlightRanges(unclosedFence)).toEqual([]);
  });
});
