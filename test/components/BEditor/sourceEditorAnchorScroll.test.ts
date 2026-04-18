import { describe, expect, it } from 'vitest';
import { getRenderedSourceAnchorOffsetTop } from '@/components/BEditor/adapters/sourceEditorAnchorScroll';

describe('getRenderedSourceAnchorOffsetTop', () => {
  it('returns the rendered anchor offset relative to the source editor host', () => {
    const anchorElement = {
      getBoundingClientRect: () => ({ top: 420 })
    } as HTMLElement;
    const hostElement = {
      querySelector: () => anchorElement,
      getBoundingClientRect: () => ({ top: 120 })
    } as unknown as HTMLElement;

    expect(getRenderedSourceAnchorOffsetTop(hostElement, 'editor-heading-10')).toBe(300);
  });
});
