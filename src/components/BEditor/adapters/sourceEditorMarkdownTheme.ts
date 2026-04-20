/**
 * @file sourceEditorMarkdownTheme.ts
 * @description 提供源码编辑器 Markdown token 主题颜色与样式规格。
 */

/**
 * Markdown 主题颜色集合。
 */
export interface SourceEditorMarkdownThemeColors {
  /** 编辑器背景色 */
  background: string;
  /** 默认前景色 */
  foreground: string;
  /** 光标颜色 */
  caret: string;
  /** 选区颜色 */
  selection: string;
  /** 匹配选区颜色 */
  selectionMatch: string;
  /** 当前行高亮颜色 */
  lineHighlight: string;
  /** 行号槽前景色 */
  gutterForeground: string;
  /** 一级标题颜色 */
  heading1: string;
  /** 二级标题颜色 */
  heading2: string;
  /** 三级标题颜色 */
  heading3: string;
  /** 行内代码颜色 */
  code: string;
  /** 链接颜色 */
  link: string;
  /** 引用颜色 */
  quote: string;
  /** 删除线颜色 */
  strikethrough: string;
}

/**
 * Markdown 主题明暗色板。
 */
export interface SourceEditorMarkdownThemePalette {
  /** 亮色主题 */
  light: SourceEditorMarkdownThemeColors;
  /** 暗色主题 */
  dark: SourceEditorMarkdownThemeColors;
}

/**
 * Markdown token 样式规格。
 */
export interface SourceEditorMarkdownStyleSpec {
  /** token 颜色 */
  color: string;
  /** token 字重 */
  fontWeight?: string;
  /** token 字体样式 */
  fontStyle?: string;
}

/**
 * Markdown token 颜色 CSS 变量。
 */
export const SOURCE_EDITOR_MARKDOWN_COLOR_VARS = {
  foreground: 'var(--source-editor-markdown-foreground)',
  heading1: 'var(--source-editor-markdown-heading-1)',
  heading2: 'var(--source-editor-markdown-heading-2)',
  heading3: 'var(--source-editor-markdown-heading-3)',
  code: 'var(--source-editor-markdown-code)',
  link: 'var(--source-editor-markdown-link)',
  quote: 'var(--source-editor-markdown-quote)',
  strikethrough: 'var(--source-editor-markdown-strikethrough)'
} as const;

/**
 * Markdown token 明暗主题色板。
 */
export const SOURCE_EDITOR_MARKDOWN_THEME_COLORS: SourceEditorMarkdownThemePalette = {
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
};

/**
 * Markdown token 样式规格列表。
 */
export const SOURCE_EDITOR_MARKDOWN_STYLE_SPECS: SourceEditorMarkdownStyleSpec[] = [
  { color: SOURCE_EDITOR_MARKDOWN_COLOR_VARS.foreground },
  { color: SOURCE_EDITOR_MARKDOWN_COLOR_VARS.heading1, fontWeight: '600' },
  { color: SOURCE_EDITOR_MARKDOWN_COLOR_VARS.heading2, fontWeight: '600' },
  { color: SOURCE_EDITOR_MARKDOWN_COLOR_VARS.heading3, fontWeight: '600' },
  { color: SOURCE_EDITOR_MARKDOWN_COLOR_VARS.foreground, fontStyle: 'italic' },
  { color: SOURCE_EDITOR_MARKDOWN_COLOR_VARS.code },
  { color: SOURCE_EDITOR_MARKDOWN_COLOR_VARS.link },
  { color: SOURCE_EDITOR_MARKDOWN_COLOR_VARS.quote },
  { color: SOURCE_EDITOR_MARKDOWN_COLOR_VARS.strikethrough }
];
