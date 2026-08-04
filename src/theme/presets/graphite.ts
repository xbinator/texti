/**
 * @file graphite.ts
 * @description 默认 Graphite 柔和黑白主题预设，模拟白色工作区与浅灰产品外壳的界面层级。
 */
import type { ThemeTokens } from '../types/tokens';
import { createDefaultDesignTokens } from '../core/factory';
import { registerPreset } from '../core/registry';

/**
 * 主题不变色——light 和 dark 中值完全相同的颜色。
 * 提取为常量避免改一边漏一边。
 */
const SHARED = {
  scrollbarLightBg: 'rgb(255 255 255 / 15%)',
  scrollbarLightHover: 'rgb(255 255 255 / 25%)',
  scrollbarLightActive: 'rgb(255 255 255 / 30%)',
  inputErrorText: '#d25f5f'
} as const;

/**
 * Graphite 亮色主题 Token。
 * 以白色主画布、柔和灰色侧栏和黑灰交互态还原截图中的克制产品壳质感。
 */
const graphiteLight: ThemeTokens = {
  bg: {
    primary: '#ffffff',
    secondary: '#f4f4f4',
    tertiary: '#eeeeee',
    elevated: '#ffffff',
    hover: 'rgb(31 31 31 / 6%)',
    active: 'rgb(31 31 31 / 10%)',
    selected: 'rgb(31 31 31 / 8%)',
    input: '#ffffff',
    disabled: '#eeeeee'
  },
  text: {
    primary: '#1f1f1f',
    secondary: '#5f5f5f',
    tertiary: '#8a8a8a',
    quaternary: '#b3b3b3',
    disabled: '#c7c7c7',
    placeholder: '#ababab'
  },
  border: {
    primary: '#e5e5e5',
    secondary: '#d6d6d6',
    tertiary: '#eeeeee',
    hover: '#8f8f8f'
  },
  color: {
    primary: '#1f1f1f',
    primaryHover: '#3a3a3a',
    primaryActive: '#000000',
    primaryBg: 'rgb(31 31 31 / 8%)',
    primaryBgHover: 'rgb(31 31 31 / 12%)',
    primaryBorder: 'rgb(31 31 31 / 16%)',
    controlOutline: 'rgb(31 31 31 / 14%)',
    success: '#3f7f55',
    successBg: 'rgb(63 127 85 / 12%)',
    warning: '#9a6b1f',
    warningBg: 'rgb(154 107 31 / 14%)',
    warningBorder: '#9a6b1f',
    error: '#b65b5b',
    errorBg: 'rgb(182 91 91 / 12%)',
    danger: '#b65b5b',
    dangerHover: '#9d4747',
    dangerActive: '#813636',
    info: '#5c7188',
    orange: '#8f6a3f',
    purple: '#71647f',
    purpleBg: 'rgb(113 100 127 / 12%)',
    purpleBorder: 'rgb(113 100 127 / 22%)',
    purpleHover: '#5d5368'
  },
  usagePanel: {
    input: '#6f6f6f',
    output: '#2f2f2f'
  },
  scrollbar: {
    bg: 'rgb(0 0 0 / 10%)',
    hover: 'rgb(0 0 0 / 18%)',
    active: 'rgb(0 0 0 / 24%)',
    lightBg: SHARED.scrollbarLightBg,
    lightHover: SHARED.scrollbarLightHover,
    lightActive: SHARED.scrollbarLightActive
  },
  shadow: {
    sm: '0 1px 2px rgb(0 0 0 / 4%)',
    md: '0 8px 24px rgb(0 0 0 / 8%)',
    lg: '0 18px 48px rgb(0 0 0 / 10%)',
    dropdown: '0 8px 24px rgb(0 0 0 / 10%)'
  },
  code: {
    bg: '#f7f7f7',
    border: '#e5e5e5',
    headerBg: '#ffffff',
    lineBg: 'rgb(0 0 0 / 4%)',
    lineHoverBg: 'rgb(31 31 31 / 6%)',
    lineNumber: '#9a9a9a',
    text: '#262626',
    keyword: '#4f5863',
    string: '#4d6868',
    comment: '#8a8a8a',
    function: '#3f4f63',
    number: '#756447',
    operator: '#262626',
    punctuation: '#262626',
    property: '#4f5863',
    tag: '#4c6657',
    attrName: '#4f5863',
    attrValue: '#4d6868',
    builtin: '#7a6047',
    boolean: '#756447',
    class: '#5f536b',
    constant: '#756447',
    deleted: '#b65b5b',
    inserted: '#3f7f55',
    regex: '#4d6868',
    symbol: '#756447',
    variable: '#7a6047'
  },
  richEditor: {
    text: '#262626',
    placeholder: '#ababab',
    caret: '#1f1f1f',
    headingBorder: '#e5e5e5',
    blockquoteText: '#5f5f5f',
    blockquoteBg: '#f4f4f4',
    blockquoteBorder: '#d6d6d6',
    link: '#1f1f1f',
    hr: '#e5e5e5',
    tableHeaderBg: '#f4f4f4',
    tableBorder: '#e5e5e5',
    tableEvenBg: '#f8f8f8',
    searchHighlight: 'rgb(255 239 92 / 36%)',
    searchActive: '#ffef5c',
    searchActiveBorder: 'rgb(0 0 0 / 10%)'
  },
  sourceEditor: {
    markdownBackground: '#ffffff',
    markdownForeground: '#262626',
    markdownCaret: '#1f1f1f',
    markdownSelection: 'rgb(31 31 31 / 14%)',
    markdownSelectionMatch: 'rgb(31 31 31 / 22%)',
    markdownLineHighlight: 'rgb(0 0 0 / 4%)',
    markdownGutterForeground: '#9a9a9a',
    markdownHeading1: '#1f1f1f',
    markdownHeading2: '#3a3a3a',
    markdownHeading3: '#5f5f5f',
    markdownCode: '#7a6047',
    markdownLink: '#4d6868',
    markdownQuote: '#5f5f5f',
    markdownStrikethrough: '#b65b5b',
    markdownBold: '#3a3a3a',
    markdownItalic: '#71647f',
    markdownListMarker: '#5f5f5f',
    markdownBlockquoteMarker: '#8a8a8a',
    markdownHr: '#8a8a8a',
    markdownLinkBracket: '#7a6047',
    markdownLinkParen: '#4d6868',
    markdownImageMarker: '#7a6047',
    markdownCodeMarker: '#7a6047',
    markdownCodeFence: '#8a8a8a',
    markdownCodeInfo: '#8a8a8a',
    markdownTablePipe: '#8a8a8a',
    markdownTableAlign: '#7a6047',
    markdownTaskBracket: '#8a8a8a',
    markdownTaskUnchecked: '#8a8a8a',
    markdownTaskChecked: '#3f7f55',
    markdownEscape: '#8a8a8a'
  },
  monaco: {
    foreground: '#262626',
    lineHighlightBg: '#f7f7f7',
    selectionBg: 'rgb(31 31 31 / 14%)',
    inactiveSelectionBg: '#eeeeee',
    lineNumber: '#9a9a9a',
    lineNumberActive: '#3a3a3a',
    cursor: '#1f1f1f',
    gutterBg: '#ffffff',
    indentGuide: '#e5e5e5',
    indentGuideActive: '#cfcfcf'
  },
  anchor: {
    text: '#5f5f5f',
    hoverText: '#1f1f1f',
    hoverBg: 'rgb(31 31 31 / 8%)'
  },
  dropdown: {
    bg: '#ffffff',
    border: '#e5e5e5',
    itemHoverBg: '#f4f4f4',
    divider: '#eeeeee'
  },
  modal: {
    text: '#262626',
    headerBg: '#f7f7f7'
  },
  input: {
    radius: '6px',
    borderWidth: '1px',
    paddingInline: '12px',
    paddingBlock: '4px',
    gap: '8px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    bg: '#ffffff',
    border: '#d6d6d6',
    focusBorder: '#1f1f1f',
    focusShadow: 'rgb(31 31 31 / 14%)',
    placeholderColor: '#ababab',
    iconColor: '#8a8a8a',
    shadow: 'none',
    activeShadow: '0 0 0 2px rgb(31 31 31 / 14%)',
    keycapSize: '24px',
    keycapRadius: '4px',
    keycapBorderWidth: '1px',
    keycapBg: '#ffffff',
    keycapColor: '#5f5f5f',
    keycapShadow: 'none',
    errorText: SHARED.inputErrorText,
    errorBorder: '#9a6b1f',
    errorShadow: 'rgb(154 107 31 / 18%)'
  },
  tag: {
    bg: '#eeeeee',
    hoverBg: '#e5e5e5',
    text: '#262626',
    secondaryText: '#5f5f5f',
    placeholder: '#8a8a8a'
  },
  hoverIndicator: {
    bg: 'rgb(255 255 255 / 96%)',
    border: '#e5e5e5',
    text: '#5f5f5f',
    hoverText: '#1f1f1f',
    hoverBorder: 'rgb(31 31 31 / 18%)'
  },
  frontmatter: {
    bg: '#f4f4f4',
    border: '#e5e5e5',
    divider: '#eeeeee',
    keyText: '#5f5f5f',
    valueText: '#262626'
  },
  jsonViewer: {
    nodeBg: '#ffffff',
    nodeBorder: '#d6d6d6',
    rowDivider: '#eeeeee',
    key: '#5c7188',
    value: '#262626',
    number: '#756447',
    boolean: '#3f7f55',
    null: '#8a8a8a',
    edge: 'rgb(31 31 31 / 72%)',
    edgeLabel: '#262626'
  },
  ...createDefaultDesignTokens()
};

/**
 * Graphite 暗色主题 Token。
 * 反相保留柔灰产品壳层次，用深灰面板和浅灰文字降低夜间高对比刺眼感。
 */
const graphiteDark: ThemeTokens = {
  bg: {
    primary: '#121212',
    secondary: '#1a1a1a',
    tertiary: '#222222',
    elevated: '#2a2a2a',
    hover: 'rgb(245 245 245 / 7%)',
    active: 'rgb(245 245 245 / 11%)',
    selected: 'rgb(245 245 245 / 13%)',
    input: '#1f1f1f',
    disabled: '#242424'
  },
  text: {
    primary: '#f5f5f5',
    secondary: '#c6c6c6',
    tertiary: '#8f8f8f',
    quaternary: '#666666',
    disabled: '#555555',
    placeholder: '#777777'
  },
  border: {
    primary: '#2f2f2f',
    secondary: '#3a3a3a',
    tertiary: '#242424',
    hover: '#d6d6d6'
  },
  color: {
    primary: '#f5f5f5',
    primaryHover: '#ffffff',
    primaryActive: '#dcdcdc',
    primaryBg: 'rgb(245 245 245 / 8%)',
    primaryBgHover: 'rgb(245 245 245 / 13%)',
    primaryBorder: 'rgb(245 245 245 / 18%)',
    controlOutline: 'rgb(245 245 245 / 14%)',
    success: '#8dc8a1',
    successBg: 'rgb(141 200 161 / 16%)',
    warning: '#d2b36d',
    warningBg: 'rgb(210 179 109 / 18%)',
    warningBorder: '#d2b36d',
    error: '#d88989',
    errorBg: 'rgb(216 137 137 / 16%)',
    danger: '#d88989',
    dangerHover: '#ef9c9c',
    dangerActive: '#c97070',
    info: '#9aacbf',
    orange: '#c6a172',
    purple: '#b7a9c4',
    purpleBg: 'rgb(183 169 196 / 16%)',
    purpleBorder: 'rgb(183 169 196 / 28%)',
    purpleHover: '#c7bbd2'
  },
  usagePanel: {
    input: '#9a9a9a',
    output: '#e0e0e0'
  },
  scrollbar: {
    bg: 'rgb(255 255 255 / 10%)',
    hover: 'rgb(255 255 255 / 18%)',
    active: 'rgb(255 255 255 / 24%)',
    lightBg: SHARED.scrollbarLightBg,
    lightHover: SHARED.scrollbarLightHover,
    lightActive: SHARED.scrollbarLightActive
  },
  shadow: {
    sm: '0 1px 2px rgb(0 0 0 / 45%)',
    md: '0 8px 24px rgb(0 0 0 / 55%)',
    lg: '0 18px 48px rgb(0 0 0 / 65%)',
    dropdown: '0 8px 24px rgb(0 0 0 / 42%)'
  },
  code: {
    bg: '#181818',
    border: '#2f2f2f',
    headerBg: '#121212',
    lineBg: 'rgb(255 255 255 / 4%)',
    lineHoverBg: 'rgb(245 245 245 / 7%)',
    lineNumber: '#777777',
    text: '#e8e8e8',
    keyword: '#c9d0d8',
    string: '#aec8c8',
    comment: '#8f8f8f',
    function: '#b8c5d5',
    number: '#d0be93',
    operator: '#e8e8e8',
    punctuation: '#e8e8e8',
    property: '#c9d0d8',
    tag: '#b4cbbd',
    attrName: '#c9d0d8',
    attrValue: '#aec8c8',
    builtin: '#d2b993',
    boolean: '#d0be93',
    class: '#d2c7dd',
    constant: '#d0be93',
    deleted: '#d88989',
    inserted: '#8dc8a1',
    regex: '#aec8c8',
    symbol: '#d0be93',
    variable: '#d2b993'
  },
  richEditor: {
    text: '#e8e8e8',
    placeholder: '#777777',
    caret: '#f5f5f5',
    headingBorder: '#2f2f2f',
    blockquoteText: '#c6c6c6',
    blockquoteBg: '#222222',
    blockquoteBorder: '#3a3a3a',
    link: '#f5f5f5',
    hr: '#2f2f2f',
    tableHeaderBg: '#222222',
    tableBorder: '#2f2f2f',
    tableEvenBg: '#1a1a1a',
    searchHighlight: 'rgb(255 239 92 / 28%)',
    searchActive: '#ffef5c',
    searchActiveBorder: 'rgb(0 0 0 / 20%)'
  },
  sourceEditor: {
    markdownBackground: '#121212',
    markdownForeground: '#e8e8e8',
    markdownCaret: '#f5f5f5',
    markdownSelection: 'rgb(245 245 245 / 18%)',
    markdownSelectionMatch: 'rgb(245 245 245 / 26%)',
    markdownLineHighlight: 'rgb(255 255 255 / 5%)',
    markdownGutterForeground: '#777777',
    markdownHeading1: '#f5f5f5',
    markdownHeading2: '#d6d6d6',
    markdownHeading3: '#b3b3b3',
    markdownCode: '#d2b993',
    markdownLink: '#aec8c8',
    markdownQuote: '#c6c6c6',
    markdownStrikethrough: '#d88989',
    markdownBold: '#f5f5f5',
    markdownItalic: '#d2c7dd',
    markdownListMarker: '#c6c6c6',
    markdownBlockquoteMarker: '#8f8f8f',
    markdownHr: '#8f8f8f',
    markdownLinkBracket: '#d2b993',
    markdownLinkParen: '#aec8c8',
    markdownImageMarker: '#d2b993',
    markdownCodeMarker: '#d2b993',
    markdownCodeFence: '#8f8f8f',
    markdownCodeInfo: '#8f8f8f',
    markdownTablePipe: '#8f8f8f',
    markdownTableAlign: '#d2b993',
    markdownTaskBracket: '#8f8f8f',
    markdownTaskUnchecked: '#8f8f8f',
    markdownTaskChecked: '#8dc8a1',
    markdownEscape: '#8f8f8f'
  },
  monaco: {
    foreground: '#e8e8e8',
    lineHighlightBg: '#1a1a1a',
    selectionBg: 'rgb(245 245 245 / 18%)',
    inactiveSelectionBg: '#2a2a2a',
    lineNumber: '#777777',
    lineNumberActive: '#d6d6d6',
    cursor: '#f5f5f5',
    gutterBg: '#121212',
    indentGuide: '#2f2f2f',
    indentGuideActive: '#4a4a4a'
  },
  anchor: {
    text: '#c6c6c6',
    hoverText: '#f5f5f5',
    hoverBg: 'rgb(245 245 245 / 10%)'
  },
  dropdown: {
    bg: '#1a1a1a',
    border: '#2f2f2f',
    itemHoverBg: '#242424',
    divider: '#2a2a2a'
  },
  modal: {
    text: '#e8e8e8',
    headerBg: '#222222'
  },
  input: {
    radius: '6px',
    borderWidth: '1px',
    paddingInline: '12px',
    paddingBlock: '4px',
    gap: '8px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    bg: '#1f1f1f',
    border: '#3a3a3a',
    focusBorder: '#f5f5f5',
    focusShadow: 'rgb(245 245 245 / 14%)',
    placeholderColor: '#777777',
    iconColor: '#8f8f8f',
    shadow: 'none',
    activeShadow: '0 0 0 2px rgb(245 245 245 / 14%)',
    keycapSize: '24px',
    keycapRadius: '4px',
    keycapBorderWidth: '1px',
    keycapBg: '#121212',
    keycapColor: '#c6c6c6',
    keycapShadow: 'none',
    errorText: SHARED.inputErrorText,
    errorBorder: '#d2b36d',
    errorShadow: 'rgb(210 179 109 / 20%)'
  },
  tag: {
    bg: '#2a2a2a',
    hoverBg: '#333333',
    text: '#e8e8e8',
    secondaryText: '#c6c6c6',
    placeholder: '#8f8f8f'
  },
  hoverIndicator: {
    bg: 'rgb(26 26 26 / 96%)',
    border: '#2f2f2f',
    text: '#c6c6c6',
    hoverText: '#f5f5f5',
    hoverBorder: 'rgb(245 245 245 / 22%)'
  },
  frontmatter: {
    bg: '#222222',
    border: '#2f2f2f',
    divider: '#2a2a2a',
    keyText: '#c6c6c6',
    valueText: '#e8e8e8'
  },
  jsonViewer: {
    nodeBg: '#222222',
    nodeBorder: '#3a3a3a',
    rowDivider: '#2f2f2f',
    key: '#9aacbf',
    value: '#e8e8e8',
    number: '#d0be93',
    boolean: '#8dc8a1',
    null: '#8f8f8f',
    edge: 'rgb(245 245 245 / 72%)',
    edgeLabel: '#e8e8e8'
  },
  ...createDefaultDesignTokens()
};

/**
 * 注册默认 Graphite 柔和黑白主题预设。
 * 预设使用手工定义的完整 ThemeTokens，确保白色主画布与柔灰产品外壳层级足够精确。
 */
registerPreset({
  id: 'default',
  label: '默认「Graphite」',
  light: graphiteLight,
  dark: graphiteDark
});

export { graphiteLight, graphiteDark, graphiteLight as defaultLight, graphiteDark as defaultDark };
