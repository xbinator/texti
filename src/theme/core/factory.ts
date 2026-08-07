/**
 * @file core/factory.ts
 * @description 预设工厂函数，从 BasePalette 基础色板派生完整的 ThemeTokens。
 */
import type { ThemeTokens } from '../types/tokens';
import { merge } from 'lodash-es';

/**
 * 主题基础色板——预设作者唯一需要填写的结构。
 * 每个主题官方仓库提供约 30 个基础色。
 */
export interface BasePalette {
  /** 背景色层级（从深到浅） */
  bg0: string;
  bg1: string;
  bg2: string;
  bg3: string;
  bg4: string;
  /** 前景色层级（从浅到深） */
  fg0: string;
  fg1: string;
  fg2: string;
  /** 语义色 */
  red: string;
  green: string;
  yellow: string;
  blue: string;
  purple: string;
  orange: string;
  cyan: string;
  /** 语法高亮色 */
  syntaxComment: string;
  syntaxKeyword: string;
  syntaxString: string;
  syntaxFunction: string;
  syntaxNumber: string;
  syntaxType: string;
  syntaxVariable: string;
  syntaxOperator: string;
  syntaxTag: string;
  syntaxAttribute: string;
  /** 主色调（用于链接、选中态等） */
  accent: string;
  /** 边框色 */
  border: string;
  /** 选中/高亮背景色 */
  selectionBg: string;
}

/**
 * 深度可选类型，用于主题预设只覆盖少量 Token。
 */
type PartialDeep<T> = T extends object
  ? {
      [K in keyof T]?: PartialDeep<T[K]>;
    }
  : T;

/**
 * 主题 Token 覆盖结构。
 */
export type ThemeTokenOverrides = PartialDeep<ThemeTokens>;

/**
 * 非颜色设计 Token 集合。
 */
type DesignTokens = Pick<ThemeTokens, 'radius' | 'borderWidth' | 'font' | 'motion' | 'control' | 'surface' | 'overlay' | 'interaction' | 'button'>;

/**
 * 主题不变色——所有预设共享的常量。
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
 * 创建现代默认设计 Token。
 * @returns 设计 Token 集合
 */
export function createDefaultDesignTokens(): DesignTokens {
  return {
    radius: {
      none: '0',
      xs: '4px',
      sm: '6px',
      md: '8px',
      lg: '12px',
      xl: '16px',
      full: '9999px'
    },
    borderWidth: {
      hairline: '1px',
      thin: '1px',
      strong: '2px'
    },
    font: {
      sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace'
    },
    motion: {
      durationFast: '150ms',
      durationBase: '200ms',
      durationSlow: '300ms',
      easingStandard: 'ease',
      easingPress: 'ease'
    },
    control: {
      radius: '6px',
      borderWidth: '1px',
      focusRingWidth: '2px'
    },
    surface: {
      radius: '8px',
      borderWidth: '1px'
    },
    overlay: {
      radius: '8px',
      borderWidth: '1px'
    },
    interaction: {
      pressOffset: '0px',
      raisedShadow: 'none',
      pressedShadow: 'none'
    },
    button: {
      border: 'transparent',
      borderWidth: '0px',
      shadow: 'none',
      activeShadow: 'none',
      pressedShadow: 'none'
    }
  };
}

/**
 * 生成透明叠加色值。
 * @param r - 红色分量 0-255
 * @param g - 绿色分量 0-255
 * @param b - 蓝色分量 0-255
 * @param alpha - 透明度 0-1
 * @returns rgb(r g b / alpha%) 格式色值
 */
function rgba(r: number, g: number, b: number, alpha: number): string {
  return `rgb(${r} ${g} ${b} / ${Math.round(alpha * 100)}%)`;
}

/**
 * 解析 hex 颜色为 RGB 分量。
 * @param hex - #rrggbb 格式色值
 * @returns [r, g, b] 元组
 */
function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/**
 * 在指定颜色上叠加指定透明度。
 * @param hex - 基础 hex 颜色
 * @param alpha - 叠加透明度
 * @returns rgb(r g b / alpha%) 格式色值
 */
function overlay(hex: string, alpha: number): string {
  const [r, g, b] = parseHex(hex);
  return rgba(r, g, b, alpha);
}

/**
 * 从基础色板派生出完整的 ThemeTokens。
 * 所有预设共享同一套派生规则，保证一致性。
 * @param palette - 基础色板（约 30 个色值）
 * @param mode - 明暗模式，影响透明叠加方向
 * @returns 完整的 ThemeTokens 对象
 */
export function createThemeTokens(palette: BasePalette, mode: 'light' | 'dark', overrides?: ThemeTokenOverrides): ThemeTokens {
  const isDark = mode === 'dark';
  const designTokens = createDefaultDesignTokens();
  const fgOverlay = (a: number) => overlay(palette.fg0, a);
  const accentOverlay = (a: number) => overlay(palette.accent, a);
  const borderOverlay = (a: number) => overlay(palette.border, a);
  const bgOverlay = (a: number) => overlay(palette.bg0, a);

  const tokens: ThemeTokens = {
    bg: {
      primary: palette.bg0,
      secondary: palette.bg1,
      tertiary: palette.bg2,
      elevated: palette.bg3,
      hover: fgOverlay(isDark ? 0.06 : 0.08),
      active: fgOverlay(isDark ? 0.1 : 0.12),
      selected: accentOverlay(isDark ? 0.18 : 0.12),
      input: palette.bg2,
      disabled: fgOverlay(0.04)
    },
    text: {
      primary: palette.fg0,
      secondary: palette.fg1,
      tertiary: palette.fg2,
      quaternary: fgOverlay(isDark ? 0.35 : 0.45),
      disabled: fgOverlay(isDark ? 0.3 : 0.35),
      placeholder: fgOverlay(isDark ? 0.4 : 0.42)
    },
    border: {
      primary: palette.border,
      secondary: borderOverlay(isDark ? 0.6 : 0.7),
      tertiary: borderOverlay(isDark ? 0.4 : 0.5),
      hover: borderOverlay(isDark ? 0.8 : 0.9)
    },
    color: {
      primary: palette.accent,
      primaryHover: palette.accent,
      primaryActive: palette.accent,
      primaryBg: accentOverlay(0.1),
      primaryBgHover: accentOverlay(0.16),
      primaryBorder: accentOverlay(isDark ? 0.22 : 0.24),
      controlOutline: accentOverlay(isDark ? 0.15 : 0.2),
      success: palette.green,
      successBg: overlay(palette.green, isDark ? 0.16 : 0.1),
      warning: palette.yellow,
      warningBg: overlay(palette.yellow, isDark ? 0.2 : 0.28),
      warningBorder: palette.yellow,
      error: palette.red,
      errorBg: overlay(palette.red, isDark ? 0.16 : 0.1),
      danger: palette.red,
      dangerHover: palette.red,
      dangerActive: palette.red,
      info: palette.blue,
      orange: palette.orange,
      purple: palette.purple,
      purpleBg: overlay(palette.purple, isDark ? 0.16 : 0.1),
      purpleBorder: overlay(palette.purple, isDark ? 0.32 : 0.24),
      purpleHover: palette.purple
    },
    usagePanel: {
      input: SHARED.usagePanelInput,
      output: SHARED.usagePanelOutput
    },
    scrollbar: {
      bg: isDark ? 'rgb(255 255 255 / 10%)' : 'rgb(0 0 0 / 10%)',
      hover: isDark ? 'rgb(255 255 255 / 20%)' : 'rgb(0 0 0 / 20%)',
      active: isDark ? 'rgb(255 255 255 / 25%)' : 'rgb(0 0 0 / 25%)',
      lightBg: SHARED.scrollbarLightBg,
      lightHover: SHARED.scrollbarLightHover,
      lightActive: SHARED.scrollbarLightActive
    },
    shadow: {
      sm: isDark ? '0 1px 2px rgb(0 0 0 / 40%)' : '0 1px 2px rgb(0 0 0 / 5%)',
      md: isDark ? '0 4px 12px rgb(0 0 0 / 55%)' : '0 4px 12px rgb(0 0 0 / 9%)',
      lg: isDark ? '0 12px 32px rgb(0 0 0 / 65%)' : '0 12px 32px rgb(0 0 0 / 12%)',
      dropdown: isDark ? '0 4px 10px rgb(0 0 0 / 34%)' : '0 8px 24px rgb(0 0 0 / 30%)'
    },
    code: {
      bg: palette.bg1,
      border: borderOverlay(isDark ? 0.5 : 0.6),
      headerBg: palette.bg0,
      lineBg: isDark ? 'rgb(255 255 255 / 4%)' : 'rgb(0 0 0 / 4%)',
      lineHoverBg: overlay(palette.blue, isDark ? 0.12 : 0.08),
      lineNumber: palette.fg2,
      text: palette.fg0,
      keyword: palette.syntaxKeyword,
      string: palette.syntaxString,
      comment: palette.syntaxComment,
      function: palette.syntaxFunction,
      number: palette.syntaxNumber,
      operator: palette.syntaxOperator,
      punctuation: palette.fg0,
      property: palette.blue,
      tag: palette.syntaxTag,
      attrName: palette.syntaxAttribute,
      attrValue: palette.syntaxString,
      builtin: palette.orange,
      boolean: palette.syntaxNumber,
      class: palette.syntaxType,
      constant: palette.syntaxNumber,
      deleted: palette.red,
      inserted: palette.green,
      regex: palette.syntaxString,
      symbol: palette.syntaxNumber,
      variable: palette.syntaxVariable
    },
    richEditor: {
      text: palette.fg0,
      placeholder: palette.fg2,
      caret: palette.fg0,
      headingBorder: palette.border,
      blockquoteText: palette.fg1,
      blockquoteBg: palette.bg2,
      blockquoteBorder: borderOverlay(0.7),
      link: palette.accent,
      hr: palette.border,
      tableHeaderBg: palette.bg2,
      tableBorder: palette.border,
      tableEvenBg: palette.bg2,
      searchHighlight: isDark ? 'rgb(255 239 92 / 30%)' : 'rgb(255 239 92 / 40%)',
      searchActive: '#ffef5c',
      searchActiveBorder: isDark ? 'rgb(0 0 0 / 20%)' : 'rgb(0 0 0 / 10%)'
    },
    sourceEditor: {
      markdownBackground: palette.bg0,
      markdownForeground: palette.fg0,
      markdownCaret: palette.accent,
      markdownSelection: accentOverlay(isDark ? 0.3 : 0.18),
      markdownSelectionMatch: accentOverlay(isDark ? 0.4 : 0.3),
      markdownLineHighlight: isDark ? 'rgb(136 135 128 / 10%)' : 'rgb(0 0 0 / 5%)',
      markdownGutterForeground: palette.fg2,
      markdownHeading1: palette.accent,
      markdownHeading2: palette.accent,
      markdownHeading3: palette.accent,
      markdownCode: palette.orange,
      markdownLink: palette.green,
      markdownQuote: palette.fg1,
      markdownStrikethrough: palette.red,
      markdownBold: palette.red,
      markdownItalic: palette.purple,
      markdownListMarker: palette.fg1,
      markdownBlockquoteMarker: palette.cyan,
      markdownHr: palette.fg2,
      markdownLinkBracket: palette.orange,
      markdownLinkParen: palette.green,
      markdownImageMarker: palette.orange,
      markdownCodeMarker: palette.orange,
      markdownCodeFence: palette.fg2,
      markdownCodeInfo: palette.fg2,
      markdownTablePipe: palette.fg2,
      markdownTableAlign: palette.orange,
      markdownTaskBracket: palette.fg2,
      markdownTaskUnchecked: palette.fg2,
      markdownTaskChecked: palette.green,
      markdownEscape: palette.fg2
    },
    monaco: {
      foreground: palette.fg0,
      lineHighlightBg: palette.bg1,
      // 浅色 Monaco 选区使用低透明度强调色，避免高饱和主题压暗语法高亮。
      selectionBg: isDark ? palette.selectionBg : accentOverlay(0.18),
      inactiveSelectionBg: bgOverlay(isDark ? 0.3 : 0.15),
      lineNumber: palette.fg2,
      lineNumberActive: palette.fg1,
      cursor: palette.accent,
      gutterBg: palette.bg0,
      indentGuide: borderOverlay(isDark ? 0.4 : 0.3),
      indentGuideActive: borderOverlay(isDark ? 0.6 : 0.5)
    },
    anchor: {
      text: palette.fg1,
      hoverText: palette.fg0,
      hoverBg: accentOverlay(isDark ? 0.16 : 0.1)
    },
    dropdown: {
      bg: isDark ? palette.bg3 : palette.bg0,
      border: isDark ? palette.border : borderOverlay(isDark ? 1 : 0.8),
      itemHoverBg: isDark ? palette.bg2 : palette.bg3,
      divider: isDark ? palette.border : borderOverlay(0.6)
    },
    modal: {
      text: palette.fg0,
      headerBg: palette.bg2
    },
    input: {
      radius: designTokens.control.radius,
      borderWidth: designTokens.control.borderWidth,
      paddingInline: '12px',
      paddingBlock: '4px',
      gap: '8px',
      bg: palette.bg2,
      border: palette.border,
      focusBorder: palette.accent,
      focusShadow: accentOverlay(isDark ? 0.12 : 0.2),
      placeholderColor: fgOverlay(isDark ? 0.4 : 0.42),
      iconColor: palette.fg2,
      shadow: 'none',
      activeShadow: `0 0 0 ${designTokens.control.focusRingWidth} ${accentOverlay(isDark ? 0.12 : 0.2)}`,
      keycapSize: '24px',
      keycapRadius: designTokens.radius.xs,
      keycapBorderWidth: designTokens.borderWidth.hairline,
      keycapBg: palette.bg0,
      keycapColor: palette.fg1,
      keycapShadow: 'none',
      errorText: SHARED.inputErrorText,
      errorBorder: palette.yellow,
      errorShadow: overlay(palette.yellow, 0.2)
    },
    tag: {
      bg: palette.bg2,
      hoverBg: palette.bg3,
      text: palette.fg0,
      secondaryText: palette.fg1,
      placeholder: palette.fg2
    },
    hoverIndicator: {
      bg: isDark ? 'rgb(26 26 26 / 96%)' : 'rgb(255 253 248 / 96%)',
      border: palette.border,
      text: palette.fg1,
      hoverText: palette.fg0,
      hoverBorder: accentOverlay(isDark ? 0.32 : 0.24)
    },
    frontmatter: {
      bg: palette.bg2,
      border: palette.border,
      divider: borderOverlay(0.6),
      keyText: palette.fg1,
      valueText: palette.fg0
    },
    jsonViewer: {
      nodeBg: palette.bg3,
      nodeBorder: borderOverlay(0.7),
      rowDivider: fgOverlay(isDark ? 0.15 : 0.2),
      key: palette.blue,
      value: palette.fg0,
      number: palette.yellow,
      boolean: palette.green,
      null: palette.fg2,
      edge: accentOverlay(0.82),
      edgeLabel: palette.fg0
    },
    ...designTokens
  };

  return merge({}, tokens, overrides ?? {}) as ThemeTokens;
}

/**
 * Creates a theme token object by applying partial overrides to an existing token object.
 * @param baseTokens - Base theme tokens
 * @param overrides - Partial token overrides
 * @returns Merged theme tokens
 */
export function createThemeTokensFromBase(baseTokens: ThemeTokens, overrides?: ThemeTokenOverrides): ThemeTokens {
  return merge({}, baseTokens, overrides ?? {}) as ThemeTokens;
}
