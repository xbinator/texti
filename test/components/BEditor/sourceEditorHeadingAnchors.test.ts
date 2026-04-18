import { describe, expect, it } from 'vitest';
import { getSourceActiveHeadingId, getSourceHeadingLines } from '@/components/BEditor/adapters/sourceEditorHeadingAnchors';

describe('getSourceHeadingLines', () => {
  it('assigns sidebar-compatible ids to markdown heading lines', () => {
    const content = ['# 标题一', '', '正文', '## 标题二'].join('\n');

    expect(getSourceHeadingLines(content, 'editor-a')).toEqual([
      { from: 0, id: 'editor-a-heading-0' },
      { from: 10, id: 'editor-a-heading-1' }
    ]);
  });

  it('does not count front matter comment lines as source anchors', () => {
    const content = ['---', '# YAML 注释', 'title: demo', '---', '# 正文标题'].join('\n');

    expect(getSourceHeadingLines(content, 'editor-a')).toEqual([{ from: 30, id: 'editor-a-heading-0' }]);
  });

  it('ignores fenced code block headings when building source anchors', () => {
    const content = ['# 标题一', '', '```md', '## Added', '### Hidden', '```', '', '## 标题二'].join('\n');

    expect(getSourceHeadingLines(content, 'editor-a')).toEqual([
      { from: 0, id: 'editor-a-heading-0' },
      { from: 38, id: 'editor-a-heading-1' }
    ]);
  });

  it('keeps heading ids aligned with sidebar headings after fenced code blocks', () => {
    const content = [
      '---',
      'title: demo',
      '---',
      '',
      '## File Structure',
      '',
      '### Task 1',
      '',
      '```md',
      '## Added',
      '## Changed',
      '```',
      '',
      '### Task 2',
      '',
      '## Self-Review'
    ].join('\n');

    expect(getSourceHeadingLines(content, 'editor-a')).toEqual([
      { from: 21, id: 'editor-a-heading-0' },
      { from: 40, id: 'editor-a-heading-1' },
      { from: 83, id: 'editor-a-heading-2' },
      { from: 95, id: 'editor-a-heading-3' }
    ]);
  });

  it('returns the latest heading before the source document position', () => {
    const content = ['# 标题一', '', '正文', '## 标题二', '', '更多正文'].join('\n');

    expect(getSourceActiveHeadingId(content, 'editor-a', 0)).toBe('editor-a-heading-0');
    expect(getSourceActiveHeadingId(content, 'editor-a', 12)).toBe('editor-a-heading-1');
  });

  it('returns the latest real heading before the position when fenced code blocks contain pseudo headings', () => {
    const content = ['# 标题一', '', '```md', '## Added', '```', '', '## 标题二', '', '正文'].join('\n');

    expect(getSourceActiveHeadingId(content, 'editor-a', 20)).toBe('editor-a-heading-0');
    expect(getSourceActiveHeadingId(content, 'editor-a', 28)).toBe('editor-a-heading-1');
  });
});
