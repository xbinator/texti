/**
 * @file sourceLineMapping.test.ts
 * @description Markdown 源码行号映射工具测试。
 */
import { Schema } from '@tiptap/pm/model';
import { describe, expect, it } from 'vitest';
import {
  captureSourceLineRange,
  createSourceLineTracker,
  getNodeSourceLineRange,
  getSelectionSourceLineRange,
  resetSourceLineTracker
} from '@/components/BEditor/adapters/sourceLineMapping';

/**
 * 仅用于测试源码行号聚合逻辑的最小 ProseMirror schema。
 */
const testSchema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    text: { group: 'inline' },
    paragraph: {
      group: 'block',
      content: 'inline*',
      attrs: {
        sourceLineStart: { default: null },
        sourceLineEnd: { default: null }
      },
      toDOM: () => ['p', 0]
    }
  }
});

describe('sourceLineMapping', () => {
  it('tracks covered lines separately from consumed trailing blank lines', () => {
    const tracker = createSourceLineTracker();

    expect(captureSourceLineRange(tracker, '# Title\n\n')).toEqual({ startLine: 1, endLine: 1 });
    expect(tracker.currentLine).toBe(3);

    expect(captureSourceLineRange(tracker, 'Paragraph line 1\nParagraph line 2\n')).toEqual({ startLine: 3, endLine: 4 });
    expect(tracker.currentLine).toBe(5);
  });

  it('resets the source line tracker back to the first line', () => {
    const tracker = createSourceLineTracker();

    captureSourceLineRange(tracker, '```ts\nconst value = 1\n```\n');
    expect(tracker.currentLine).toBe(4);

    resetSourceLineTracker(tracker);
    expect(tracker.currentLine).toBe(1);
  });

  it('reads valid source line attrs from block nodes', () => {
    const paragraph = testSchema.nodes.paragraph.create({ sourceLineStart: 7, sourceLineEnd: 9 });

    expect(getNodeSourceLineRange(paragraph)).toEqual({ startLine: 7, endLine: 9 });
    expect(getNodeSourceLineRange(testSchema.nodes.paragraph.create())).toBeNull();
  });

  it('aggregates real source lines across the selected block nodes', () => {
    const doc = testSchema.node('doc', undefined, [
      testSchema.node('paragraph', { sourceLineStart: 2, sourceLineEnd: 2 }, [testSchema.text('alpha')]),
      testSchema.node('paragraph', { sourceLineStart: 4, sourceLineEnd: 6 }, [testSchema.text('beta')]),
      testSchema.node('paragraph', { sourceLineStart: 8, sourceLineEnd: 8 }, [testSchema.text('gamma')])
    ]);

    expect(getSelectionSourceLineRange(doc, 1, 12)).toEqual({ startLine: 2, endLine: 6 });
    expect(getSelectionSourceLineRange(doc, 8, 14)).toEqual({ startLine: 4, endLine: 8 });
    expect(getSelectionSourceLineRange(doc, 1, 1)).toBeNull();
  });
});
