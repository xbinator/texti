/**
 * @file classic.ts
 * @description 经典暖米白主题预设，从原 default 主题迁移 light/dark 色值。
 */
import type { ThemeTokens } from '../types/tokens';
import { createDefaultDesignTokens } from '../core/factory';
import { registerPreset } from '../core/registry';

/**
 * 主题不变色——light 和 dark 中值完全相同的颜色。
 * 提取为常量避免改一边漏一边。
 */
const SHARED = {
  usagePanelInput: '#1677ff',
  usagePanelOutput: '#18cf62',
  scrollbarLightBg: 'rgb(255 255 255 / 15%)',
  scrollbarLightHover: 'rgb(255 255 255 / 25%)',
  scrollbarLightActive: 'rgb(255 255 255 / 30%)',
  inputErrorText: '#f87171'
} as const;

/**
 * Classic 亮色主题 Token。
 */
const classicLight: ThemeTokens = {
  bg: {
    primary: '#faf9f6',
    secondary: '#f0ebe1',
    tertiary: '#f5f1e8',
    elevated: '#fffdf8',
    hover: 'rgb(107 101 96 / 8%)',
    active: 'rgb(107 101 96 / 12%)',
    selected: 'rgb(138 111 90 / 12%)',
    input: '#fffdf8',
    disabled: '#f3eee6'
  },
  text: {
    primary: '#1a1a1a',
    secondary: '#6b6560',
    tertiary: '#8a837d',
    quaternary: '#b0a8a1',
    disabled: '#b7afa7',
    placeholder: '#938b84'
  },
  border: {
    primary: '#e3dccf',
    secondary: '#d8d0c2',
    tertiary: '#ede7db',
    hover: '#8a6f5a'
  },
  color: {
    primary: '#8a6f5a',
    primaryHover: '#755d4b',
    primaryActive: '#614c3e',
    primaryBg: 'rgb(138 111 90 / 10%)',
    primaryBgHover: 'rgb(138 111 90 / 16%)',
    primaryBorder: 'rgb(138 111 90 / 24%)',
    controlOutline: 'rgb(138 111 90 / 20%)',
    success: '#10b981',
    successBg: '#d1fae5',
    warning: '#f59e0b',
    warningBg: 'rgb(250 204 21 / 28%)',
    warningBorder: '#f59e0b',
    error: '#dc2626',
    errorBg: '#fee2e2',
    danger: '#ff4d4f',
    dangerHover: '#ff7875',
    dangerActive: '#ff9c9a',
    info: '#1761d2',
    orange: '#fa8c16',
    purple: '#7c3aed',
    purpleBg: '#ede9fe',
    purpleBorder: '#c4b5fd',
    purpleHover: '#6d28d9'
  },
  usagePanel: {
    input: SHARED.usagePanelInput,
    output: SHARED.usagePanelOutput
  },
  scrollbar: {
    bg: 'rgb(0 0 0 / 10%)',
    hover: 'rgb(0 0 0 / 20%)',
    active: 'rgb(0 0 0 / 25%)',
    lightBg: SHARED.scrollbarLightBg,
    lightHover: SHARED.scrollbarLightHover,
    lightActive: SHARED.scrollbarLightActive
  },
  shadow: {
    sm: '0 1px 2px rgb(53 43 33 / 5%)',
    md: '0 4px 12px rgb(53 43 33 / 9%)',
    lg: '0 12px 32px rgb(53 43 33 / 12%)',
    dropdown: '0 4px 10px rgb(53 43 33 / 8%)'
  },
  code: {
    bg: '#f8f9fa',
    border: '#e9ecef',
    headerBg: '#f8f9fa',
    lineBg: 'rgb(0 0 0 / 4%)',
    lineHoverBg: 'rgb(9 105 218 / 8%)',
    lineNumber: '#6c757d',
    text: '#212529',
    keyword: '#dc3545',
    string: '#0d6efd',
    comment: '#6c757d',
    function: '#6f42c1',
    number: '#0dcaf0',
    operator: '#212529',
    punctuation: '#212529',
    property: '#0d6efd',
    tag: '#198754',
    attrName: '#0d6efd',
    attrValue: '#0d6efd',
    builtin: '#fd7e14',
    boolean: '#0dcaf0',
    class: '#6f42c1',
    constant: '#0dcaf0',
    deleted: '#dc3545',
    inserted: '#198754',
    regex: '#0d6efd',
    symbol: '#0dcaf0',
    variable: '#fd7e14'
  },
  richEditor: {
    text: '#212529',
    placeholder: '#6c757d',
    caret: '#212529',
    headingBorder: '#e3dccf',
    blockquoteText: '#6b6560',
    blockquoteBg: '#f5f1e8',
    blockquoteBorder: '#d8d0c2',
    link: '#8a6f5a',
    hr: '#e3dccf',
    tableHeaderBg: '#f5f1e8',
    tableBorder: '#e3dccf',
    tableEvenBg: '#f5f1e8',
    searchHighlight: 'rgb(255 239 92 / 40%)',
    searchActive: '#ffef5c',
    searchActiveBorder: 'rgb(0 0 0 / 10%)'
  },
  sourceEditor: {
    markdownBackground: '#faf9f7',
    markdownForeground: '#2a2a28',
    markdownCaret: '#3d34a8',
    markdownSelection: 'rgb(61 52 168 / 18%)',
    markdownSelectionMatch: 'rgb(61 52 168 / 30%)',
    markdownLineHighlight: 'rgb(0 0 0 / 5%)',
    markdownGutterForeground: '#8a8880',
    markdownHeading1: '#3d34a8',
    markdownHeading2: '#5f56cc',
    markdownHeading3: '#8880e0',
    markdownCode: '#7a2e10',
    markdownLink: '#0a5a40',
    markdownQuote: '#4a4840',
    markdownStrikethrough: '#4a4742',
    markdownBold: '#7a1a1a',
    markdownItalic: '#441880',
    markdownListMarker: '#302e28',
    markdownBlockquoteMarker: '#4a3e30',
    markdownHr: '#6a5a48',
    markdownLinkBracket: '#4a3820',
    markdownLinkParen: '#1a5a38',
    markdownImageMarker: '#4a3820',
    markdownCodeMarker: '#5a1e08',
    markdownCodeFence: '#3a3530',
    markdownCodeInfo: '#4a4540',
    markdownTablePipe: '#5a5450',
    markdownTableAlign: '#4a3820',
    markdownTaskBracket: '#3a3530',
    markdownTaskUnchecked: '#6a6560',
    markdownTaskChecked: '#0a7848',
    markdownEscape: '#4a4540'
  },
  monaco: {
    foreground: '#243042',
    lineHighlightBg: '#eef2f7',
    selectionBg: '#cfe3ff',
    inactiveSelectionBg: '#e6edf5',
    lineNumber: '#a0aec0',
    lineNumberActive: '#334155',
    cursor: '#2563eb',
    gutterBg: '#faf9f6',
    indentGuide: '#e5e7eb',
    indentGuideActive: '#cbd5e1'
  },
  anchor: {
    text: '#6b6560',
    hoverText: '#1a1a1a',
    hoverBg: 'rgb(138 111 90 / 10%)'
  },
  dropdown: {
    bg: '#fff',
    border: '#e9ecef',
    itemHoverBg: '#f8f9fa',
    divider: '#e9ecef'
  },
  modal: {
    text: '#212529',
    headerBg: '#f8f9fa'
  },
  input: {
    radius: '6px',
    borderWidth: '1px',
    paddingInline: '12px',
    paddingBlock: '4px',
    gap: '8px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    bg: '#fffdf8',
    border: '#d8d0c2',
    focusBorder: '#8a6f5a',
    focusShadow: 'rgb(138 111 90 / 20%)',
    placeholderColor: '#938b84',
    iconColor: '#8a837d',
    shadow: 'none',
    activeShadow: '0 0 0 2px rgb(138 111 90 / 20%)',
    keycapSize: '24px',
    keycapRadius: '4px',
    keycapBorderWidth: '1px',
    keycapBg: '#fffdf8',
    keycapColor: '#6b6560',
    keycapShadow: 'none',
    errorText: SHARED.inputErrorText,
    errorBorder: '#f59e0b',
    errorShadow: 'rgb(245 158 11 / 20%)'
  },
  tag: {
    bg: '#f8f9fa',
    hoverBg: '#e9ecef',
    text: '#495057',
    secondaryText: '#6c757d',
    placeholder: '#adb5bd'
  },
  hoverIndicator: {
    bg: 'rgb(255 253 248 / 96%)',
    border: '#e3dccf',
    text: '#6b6560',
    hoverText: '#1a1a1a',
    hoverBorder: 'rgb(138 111 90 / 24%)'
  },
  frontmatter: {
    bg: '#f5f1e8',
    border: '#e3dccf',
    divider: '#e3dccf',
    keyText: '#6b6560',
    valueText: '#3c3835'
  },
  jsonViewer: {
    nodeBg: '#fffdf8',
    nodeBorder: '#d8d0c2',
    rowDivider: '#ede7db',
    key: '#1761d2',
    value: '#1a1a1a',
    number: '#b7791f',
    boolean: '#059669',
    null: '#8a837d',
    edge: 'rgb(138 111 90 / 82%)',
    edgeLabel: '#1a1a1a'
  },
  ...createDefaultDesignTokens()
};

/**
 * 默认暗色主题 Token。
 */
const classicDark: ThemeTokens = {
  bg: {
    primary: '#13151a',
    secondary: '#0d0f12',
    tertiary: '#0f1115',
    elevated: '#1c1f26',
    hover: 'rgb(148 163 184 / 6%)',
    active: 'rgb(148 163 184 / 10%)',
    selected: 'rgb(120 120 200 / 18%)',
    input: '#181b21',
    disabled: '#1e2230'
  },
  text: {
    primary: '#e8ecf2',
    secondary: '#7a8494',
    tertiary: '#5a6272',
    quaternary: '#404858',
    disabled: '#363d4a',
    placeholder: '#4a5264'
  },
  border: {
    primary: '#252a35',
    secondary: '#2e3340',
    tertiary: '#1a1e28',
    hover: '#3d4455'
  },
  color: {
    primary: '#c8a98b',
    primaryHover: '#d4b49a',
    primaryActive: '#b09070',
    primaryBg: 'rgb(200 169 139 / 10%)',
    primaryBgHover: 'rgb(200 169 139 / 16%)',
    primaryBorder: 'rgb(200 169 139 / 22%)',
    controlOutline: 'rgb(200 169 139 / 15%)',
    success: '#34d399',
    successBg: 'rgb(16 185 129 / 16%)',
    warning: '#fbbf24',
    warningBg: 'rgb(250 204 21 / 20%)',
    warningBorder: '#f59e0b',
    error: '#f87171',
    errorBg: 'rgb(220 38 38 / 16%)',
    danger: '#ff7875',
    dangerHover: '#ff9c9a',
    dangerActive: '#ffa8a6',
    info: '#60a5fa',
    orange: '#ffa940',
    purple: '#a78bfa',
    purpleBg: 'rgb(124 58 237 / 16%)',
    purpleBorder: 'rgb(124 58 237 / 32%)',
    purpleHover: '#8b5cf6'
  },
  usagePanel: {
    input: SHARED.usagePanelInput,
    output: SHARED.usagePanelOutput
  },
  scrollbar: {
    bg: 'rgb(255 255 255 / 10%)',
    hover: 'rgb(255 255 255 / 20%)',
    active: 'rgb(255 255 255 / 25%)',
    lightBg: SHARED.scrollbarLightBg,
    lightHover: SHARED.scrollbarLightHover,
    lightActive: SHARED.scrollbarLightActive
  },
  shadow: {
    sm: '0 1px 2px rgb(0 0 0 / 40%)',
    md: '0 4px 12px rgb(0 0 0 / 55%)',
    lg: '0 12px 32px rgb(0 0 0 / 65%)',
    dropdown: '0 8px 24px rgb(0 0 0 / 30%)'
  },
  code: {
    bg: '#0c0e12',
    border: '#1e2230',
    headerBg: '#13151a',
    lineBg: 'rgb(255 255 255 / 4%)',
    lineHoverBg: 'rgb(22 119 255 / 12%)',
    lineNumber: '#6b7280',
    text: '#e5e5e5',
    keyword: '#ff7b72',
    string: '#a5d6ff',
    comment: '#8b949e',
    function: '#d2a8ff',
    number: '#79c0ff',
    operator: '#e5e5e5',
    punctuation: '#e5e5e5',
    property: '#79c0ff',
    tag: '#7ee787',
    attrName: '#79c0ff',
    attrValue: '#a5d6ff',
    builtin: '#ffa657',
    boolean: '#79c0ff',
    class: '#d2a8ff',
    constant: '#79c0ff',
    deleted: '#ff7b72',
    inserted: '#7ee787',
    regex: '#a5d6ff',
    symbol: '#79c0ff',
    variable: '#ffa657'
  },
  richEditor: {
    text: '#f3efe8',
    placeholder: '#8a827a',
    caret: '#f3efe8',
    headingBorder: '#4a453f',
    blockquoteText: '#b7aea6',
    blockquoteBg: '#232323',
    blockquoteBorder: '#5a554f',
    link: '#d6b79a',
    hr: '#4a453f',
    tableHeaderBg: '#232323',
    tableBorder: '#4a453f',
    tableEvenBg: '#1a1a1a',
    searchHighlight: 'rgb(255 239 92 / 30%)',
    searchActive: '#ffef5c',
    searchActiveBorder: 'rgb(0 0 0 / 20%)'
  },
  sourceEditor: {
    markdownBackground: '#1a1916',
    markdownForeground: '#e8e6dc',
    markdownCaret: '#b8b0f0',
    markdownSelection: 'rgb(60 52 137 / 30%)',
    markdownSelectionMatch: 'rgb(60 52 137 / 40%)',
    markdownLineHighlight: 'rgb(136 135 128 / 10%)',
    markdownGutterForeground: '#a8a6a0',
    markdownHeading1: '#b8b0f0',
    markdownHeading2: '#ccc7f4',
    markdownHeading3: '#e2e0fa',
    markdownCode: '#f5a882',
    markdownLink: '#3dc99a',
    markdownQuote: '#a8bfcf',
    markdownStrikethrough: '#e89090',
    markdownBold: '#f08888',
    markdownItalic: '#d8a8f8',
    markdownListMarker: '#d8d0c8',
    markdownBlockquoteMarker: '#a8d8ee',
    markdownHr: '#c0b8b0',
    markdownLinkBracket: '#f0d0b0',
    markdownLinkParen: '#70e0b0',
    markdownImageMarker: '#f0d0b0',
    markdownCodeMarker: '#f09868',
    markdownCodeFence: '#c8c0b8',
    markdownCodeInfo: '#c0b8b0',
    markdownTablePipe: '#c0b8b0',
    markdownTableAlign: '#f0d0b0',
    markdownTaskBracket: '#c8c0b8',
    markdownTaskUnchecked: '#c0b8b0',
    markdownTaskChecked: '#60f0b0',
    markdownEscape: '#c0b8b0'
  },
  monaco: {
    foreground: '#dbe4f0',
    lineHighlightBg: '#1a1d24',
    selectionBg: '#3a4e69',
    inactiveSelectionBg: '#2a3544',
    lineNumber: '#64748b',
    lineNumberActive: '#e2e8f0',
    cursor: '#93c5fd',
    gutterBg: '#13151a',
    indentGuide: '#223045',
    indentGuideActive: '#475569'
  },
  anchor: {
    text: '#b7aea6',
    hoverText: '#f3efe8',
    hoverBg: 'rgb(200 169 139 / 16%)'
  },
  dropdown: {
    bg: '#0d0d0d',
    border: '#2a2a2a',
    itemHoverBg: '#1a1a1a',
    divider: '#1e1e1e'
  },
  modal: {
    text: '#f3efe8',
    headerBg: '#232323'
  },
  input: {
    radius: '6px',
    borderWidth: '1px',
    paddingInline: '12px',
    paddingBlock: '4px',
    gap: '8px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    bg: '#0d0f12',
    border: '#2a303d',
    focusBorder: '#c8a98b',
    focusShadow: 'rgb(200 169 139 / 12%)',
    placeholderColor: '#4a5264',
    iconColor: '#5a6272',
    shadow: 'none',
    activeShadow: '0 0 0 2px rgb(200 169 139 / 12%)',
    keycapSize: '24px',
    keycapRadius: '4px',
    keycapBorderWidth: '1px',
    keycapBg: '#13151a',
    keycapColor: '#7a8494',
    keycapShadow: 'none',
    errorText: SHARED.inputErrorText,
    errorBorder: '#f59e0b',
    errorShadow: 'rgb(245 158 11 / 20%)'
  },
  tag: {
    bg: '#353535',
    hoverBg: '#404040',
    text: '#f3efe8',
    secondaryText: '#b7aea6',
    placeholder: '#8a827a'
  },
  hoverIndicator: {
    bg: 'rgb(26 26 26 / 96%)',
    border: '#5a554f',
    text: '#b7aea6',
    hoverText: '#f3efe8',
    hoverBorder: 'rgb(200 169 139 / 32%)'
  },
  frontmatter: {
    bg: '#232323',
    border: '#4a453f',
    divider: '#3a3530',
    keyText: '#b7aea6',
    valueText: '#f3efe8'
  },
  jsonViewer: {
    nodeBg: '#292929',
    nodeBorder: '#4b4b4b',
    rowDivider: '#3b3b3b',
    key: '#57b8ff',
    value: '#e5e7eb',
    number: '#f8d777',
    boolean: '#00e785',
    null: '#9ca3af',
    edge: 'rgb(200 169 139 / 82%)',
    edgeLabel: '#f3efe8'
  },
  ...createDefaultDesignTokens()
};

/**
 * 注册经典暖米白主题预设。
 * classic 预设使用手工定义的完整 ThemeTokens，
 * 不走 createThemeTokens 工厂，保留原始色值的精确控制。
 */
registerPreset({
  id: 'classic',
  label: '经典「Classic」',
  light: classicLight,
  dark: classicDark
});

export { classicLight, classicDark };
