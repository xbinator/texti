import { describe, expect, it } from 'vitest';
import {
  SOURCE_EDITOR_MARKDOWN_COLOR_VARS,
  SOURCE_EDITOR_MARKDOWN_THEME_COLORS,
  SOURCE_EDITOR_MARKDOWN_STYLE_SPECS
} from '@/components/BEditor/adapters/sourceEditorMarkdownTheme';

describe('SOURCE_EDITOR_MARKDOWN_THEME_COLORS', () => {
  it('matches the Claude markdown token palettes', () => {
    expect(SOURCE_EDITOR_MARKDOWN_THEME_COLORS).toEqual({
      light: {
        background: '#FAF9F7',
        foreground: '#444441',
        caret: '#534AB7',
        selection: '#534AB726',
        selectionMatch: '#534AB740',
        lineHighlight: '#44444108',
        gutterForeground: '#B4B2A9',
        heading1: '#534AB7',
        heading2: '#7F77DD',
        heading3: '#AFA9EC',
        code: '#993C1D',
        link: '#0F6E56',
        quote: '#B4B2A9',
        strikethrough: '#D3D1C7'
      },
      dark: {
        background: '#1A1916',
        foreground: '#D3D1C7',
        caret: '#9F97E8',
        selection: '#3C348926',
        selectionMatch: '#3C348940',
        lineHighlight: '#88878010',
        gutterForeground: '#888780',
        heading1: '#9F97E8',
        heading2: '#AFA9EC',
        heading3: '#CECBF6',
        code: '#F0997B',
        link: '#1D9E75',
        quote: '#888780',
        strikethrough: '#5F5E5A'
      }
    });
  });
});

describe('SOURCE_EDITOR_MARKDOWN_STYLE_SPECS', () => {
  it('defines markdown token styles for the source editor', () => {
    expect(SOURCE_EDITOR_MARKDOWN_STYLE_SPECS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ color: SOURCE_EDITOR_MARKDOWN_COLOR_VARS.foreground }),
        expect.objectContaining({ color: SOURCE_EDITOR_MARKDOWN_COLOR_VARS.heading1, fontWeight: '600' }),
        expect.objectContaining({ color: SOURCE_EDITOR_MARKDOWN_COLOR_VARS.heading2, fontWeight: '600' }),
        expect.objectContaining({ color: SOURCE_EDITOR_MARKDOWN_COLOR_VARS.heading3, fontWeight: '600' }),
        expect.objectContaining({ color: SOURCE_EDITOR_MARKDOWN_COLOR_VARS.foreground, fontStyle: 'italic' }),
        expect.objectContaining({ color: SOURCE_EDITOR_MARKDOWN_COLOR_VARS.code }),
        expect.objectContaining({ color: SOURCE_EDITOR_MARKDOWN_COLOR_VARS.link }),
        expect.objectContaining({ color: SOURCE_EDITOR_MARKDOWN_COLOR_VARS.quote }),
        expect.objectContaining({ color: SOURCE_EDITOR_MARKDOWN_COLOR_VARS.strikethrough })
      ])
    );
  });
});
