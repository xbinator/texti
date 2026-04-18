import type { AnchorRecord } from '../../../src/components/BEditor/hooks/useAnchors';
import { describe, expect, it, vi } from 'vitest';
import { handleEditorAnchorNavigation } from '../../../src/components/BEditor/adapters/editorAnchorNavigation';

function createAnchorRecord(id: string): AnchorRecord {
  return {
    id,
    level: 1,
    text: 'Heading'
  };
}

describe('handleEditorAnchorNavigation', () => {
  it('uses only editor-controlled anchor scrolling in source mode', () => {
    const setActiveAnchorId = vi.fn();
    const scrollToTop = vi.fn();
    const scrollRichAnchor = vi.fn();
    const scrollEditorAnchor = vi.fn(() => true);

    handleEditorAnchorNavigation({
      record: createAnchorRecord('editor-heading-1'),
      isRichMode: false,
      setActiveAnchorId,
      scrollToTop,
      scrollRichAnchor,
      scrollEditorAnchor
    });

    expect(setActiveAnchorId).toHaveBeenCalledWith('editor-heading-1');
    expect(scrollEditorAnchor).toHaveBeenCalledWith('editor-heading-1');
    expect(scrollRichAnchor).not.toHaveBeenCalled();
    expect(scrollToTop).not.toHaveBeenCalled();
  });
});
