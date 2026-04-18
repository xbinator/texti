import { describe, expect, it } from 'vitest';
import { SOURCE_EDITOR_LAYOUT_THEME } from '@/components/BEditor/adapters/sourceEditorLayoutTheme';

describe('SOURCE_EDITOR_LAYOUT_THEME', () => {
  it('lets the outer BScrollbar own source editor scrolling', () => {
    expect(SOURCE_EDITOR_LAYOUT_THEME['&']).toMatchObject({
      height: 'auto',
      minHeight: '100%'
    });
    expect(SOURCE_EDITOR_LAYOUT_THEME['.cm-scroller']).toMatchObject({
      overflow: 'visible'
    });
  });
});
