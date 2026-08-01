/**
 * @file core/derive.ts
 * @description 从 ThemeTokens 派生各消费方所需格式的映射函数。
 */

import type { ThemeTokens } from '../types/tokens';

/**
 * Ant Design 全局主题 Token 结构。
 */
interface AntdThemeToken {
  colorBgBase: string;
  colorBgContainer: string;
  colorBgElevated: string;
  colorText: string;
  colorTextSecondary: string;
  colorBorder: string;
  colorPrimary: string;
  colorPrimaryBg: string;
  colorPrimaryBorder: string;
  controlOutline: string;
  borderRadius: number;
  borderRadiusLG: number;
  borderRadiusSM: number;
  lineWidth: number;
  fontFamily: string;
}

/**
 * Ant Design 组件级 Token 覆盖结构。
 * 每个键对应一个 Ant Design 组件名，值为该组件的 token 覆盖。
 */
interface AntdComponentTokens {
  [component: string]: Record<string, string | number>;
}

/**
 * Ant Design 完整主题配置，包含全局 token 和组件级 token。
 */
interface AntdThemeConfig {
  token: AntdThemeToken;
  components: AntdComponentTokens;
}

/**
 * 需要使用输入容器背景色的 Ant Design 组件列表。
 * 这些组件的 colorBgContainer 应映射到 tokens.bg.primary，
 * 而非全局的 tokens.bg.secondary，以保持输入区域与卡片容器的视觉层次。
 */
const INPUT_COMPONENTS = ['Input', 'InputNumber', 'Select', 'DatePicker', 'TimePicker', 'Cascader', 'TreeSelect', 'AutoComplete', 'Mentions'] as const;

/**
 * 文本输入类 Ant Design 组件列表。
 * 这些组件额外映射 input 专属 Token，以支持 Overworld 等高风格输入框。
 */
const TEXT_INPUT_COMPONENTS = ['Input', 'InputNumber', 'Mentions'] as const;

/**
 * 带下拉弹出层的 Ant Design 组件列表。
 * 这些组件的弹出层背景色应映射到 tokens.dropdown.bg，
 * 以保持下拉面板与主题 dropdown 语义一致。
 */
const DROPDOWN_COMPONENTS = ['Select', 'Cascader', 'TreeSelect', 'AutoComplete'] as const;

/**
 * Ant Design 接收无单位 px 数值；相对单位在主题层按 CSS 默认字号归一化。
 */
const CSS_RELATIVE_UNIT_BASE_PX = 16;

/**
 * camelCase 转 kebab-case。
 * @param s - 输入字符串
 * @returns kebab-case 字符串
 */
function toKebab(s: string): string {
  return s.replace(/[A-Z]/g, (m: string): string => `-${m.toLowerCase()}`);
}

/**
 * 解析 CSS 尺寸值为 Ant Design 需要的 px number。
 * @param value - CSS 尺寸值
 * @param fallback - 解析失败时使用的兜底值
 * @returns Ant Design number token
 */
function parseDimension(value: string, fallback: number): number {
  const trimmed = value.trim();
  if (trimmed === '0') {
    return 0;
  }

  const match = /^(-?\d+(?:\.\d+)?)(px|rem|em)$/u.exec(trimmed);
  if (!match) {
    return fallback;
  }

  const parsed = Number.parseFloat(match[1] ?? '');
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const unit = match[2];
  return unit === 'px' ? parsed : parsed * CSS_RELATIVE_UNIT_BASE_PX;
}

/**
 * 分组名到 CSS 变量前缀的映射。
 * richEditor 组保持 --editor- 前缀以兼容现有 Less 引用。
 * usagePanel 组保持 --usage- 前缀以兼容现有 Less 引用。
 */
const GROUP_PREFIX_MAP: Record<string, string> = {
  richEditor: 'editor',
  usagePanel: 'usage'
};

/**
 * 将结构化 Token 扁平化为 CSS 变量映射。
 * @param tokens - 主题 Token 对象
 * @returns CSS 变量名到色值的映射（键名含 -- 前缀）
 */
export function toCssVars(tokens: ThemeTokens): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [groupKey, group] of Object.entries(tokens)) {
    const prefix = GROUP_PREFIX_MAP[groupKey] ?? groupKey;

    for (const [propKey, value] of Object.entries(group as Record<string, string>)) {
      const cssVarName = `--${toKebab(prefix)}-${toKebab(propKey)}`;
      result[cssVarName] = value;
    }
  }

  return result;
}

/**
 * 从 Token 派生 Ant Design 主题配置。
 * 全局 token 中 colorBgContainer 映射到 bg.secondary（用于 Card/Table 等容器），
 * 输入类组件（Input/Select/DatePicker 等）单独覆盖 colorBgContainer 为 bg.primary，
 * 以保持输入区域更亮的背景与卡片容器的视觉层次。
 * 带下拉弹出层的组件额外覆盖 colorBgElevated 为 dropdown.bg，
 * 使弹出面板背景与主题 dropdown 语义保持一致。
 * Drawer 单独覆盖 colorBgElevated 为 bg.primary，使其与页面主背景保持一致。
 * @param tokens - 主题 Token 对象
 * @returns Ant Design 完整主题配置（全局 token + 组件级 token）
 */
export function toAntdToken(tokens: ThemeTokens): AntdThemeConfig {
  const inputComponentTokens: AntdComponentTokens = {};
  const controlRadius = parseDimension(tokens.control.radius, 6);
  const surfaceRadius = parseDimension(tokens.surface.radius, 8);
  const overlayRadius = parseDimension(tokens.overlay.radius, 8);
  const controlLineWidth = parseDimension(tokens.control.borderWidth, 1);
  const overlayLineWidth = parseDimension(tokens.overlay.borderWidth, 1);
  const inputRadius = parseDimension(tokens.input.radius, controlRadius);
  const inputLineWidth = parseDimension(tokens.input.borderWidth, controlLineWidth);
  const inputPaddingInline = parseDimension(tokens.input.paddingInline, 12);

  for (const component of INPUT_COMPONENTS) {
    inputComponentTokens[component] = {
      colorBgContainer: tokens.bg.primary,
      borderRadius: controlRadius,
      lineWidth: controlLineWidth
    };
  }

  for (const component of TEXT_INPUT_COMPONENTS) {
    inputComponentTokens[component] = {
      ...inputComponentTokens[component],
      colorBgContainer: tokens.input.bg,
      colorBorder: tokens.input.border,
      activeBorderColor: tokens.input.focusBorder,
      hoverBorderColor: tokens.border.hover,
      colorTextPlaceholder: tokens.input.placeholderColor,
      activeShadow: tokens.input.activeShadow,
      borderRadius: inputRadius,
      lineWidth: inputLineWidth,
      paddingInline: inputPaddingInline,
      fontFamily: tokens.input.fontFamily
    };
  }

  for (const component of DROPDOWN_COMPONENTS) {
    const existing = inputComponentTokens[component] ?? {};
    inputComponentTokens[component] = {
      ...existing,
      colorBgElevated: tokens.dropdown.bg
    };
  }

  // Drawer 背景使用 bg.primary，使其与页面主背景保持一致。
  inputComponentTokens.Drawer = {
    colorBgElevated: tokens.bg.primary,
    borderRadiusLG: overlayRadius
  };

  inputComponentTokens.Button = {
    borderRadius: controlRadius,
    lineWidth: controlLineWidth,
    fontFamily: tokens.font.display
  };
  inputComponentTokens.Modal = {
    borderRadiusLG: overlayRadius
  };
  inputComponentTokens.Dropdown = {
    borderRadiusLG: overlayRadius,
    lineWidth: overlayLineWidth
  };
  inputComponentTokens.Segmented = {
    borderRadius: controlRadius
  };
  inputComponentTokens.Tooltip = {
    borderRadius: surfaceRadius
  };

  return {
    token: {
      colorBgBase: tokens.bg.primary,
      colorBgContainer: tokens.bg.secondary,
      colorBgElevated: tokens.bg.elevated,
      colorText: tokens.text.primary,
      colorTextSecondary: tokens.text.secondary,
      colorBorder: tokens.border.primary,
      colorPrimary: tokens.color.primary,
      colorPrimaryBg: tokens.color.primaryBg,
      colorPrimaryBorder: tokens.color.primaryBorder,
      controlOutline: tokens.color.controlOutline,
      borderRadius: controlRadius,
      borderRadiusLG: surfaceRadius,
      borderRadiusSM: parseDimension(tokens.radius.xs, 4),
      lineWidth: controlLineWidth,
      fontFamily: tokens.font.sans
    },
    components: inputComponentTokens
  };
}

/**
 * 从 Token 派生 Monaco 编辑器主题颜色。
 * @param tokens - 主题 Token 对象
 * @returns Monaco 主题颜色映射
 */
export function toMonacoColors(tokens: ThemeTokens): Record<string, string> {
  return {
    'editor.background': tokens.bg.primary,
    'editor.foreground': tokens.monaco.foreground,
    'editor.lineHighlightBackground': tokens.monaco.lineHighlightBg,
    'editor.selectionBackground': tokens.monaco.selectionBg,
    'editor.inactiveSelectionBackground': tokens.monaco.inactiveSelectionBg,
    'editor.selectionHighlightBackground': tokens.color.primaryBg,
    'editor.findMatchBackground': tokens.richEditor.searchActive,
    'editor.findMatchHighlightBackground': tokens.richEditor.searchHighlight,
    'editor.findMatchBorder': tokens.richEditor.searchActiveBorder,
    'editor.findMatchHighlightBorder': tokens.richEditor.searchActiveBorder,
    'editor.rangeHighlightBackground': tokens.color.primaryBg,
    'editorLineNumber.foreground': tokens.monaco.lineNumber,
    'editorLineNumber.activeForeground': tokens.monaco.lineNumberActive,
    'editorCursor.foreground': tokens.monaco.cursor,
    'editorGutter.background': tokens.monaco.gutterBg,
    'editorIndentGuide.background1': tokens.monaco.indentGuide,
    'editorIndentGuide.activeBackground1': tokens.monaco.indentGuideActive
  };
}
