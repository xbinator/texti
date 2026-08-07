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
  fontSize: number;
  controlHeight: number;
  controlHeightSM: number;
  controlHeightLG: number;
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
const DEFAULT_ROOT_FONT_SIZE = 14;
const CSS_VAR_REM_PRECISION = 4;
const CSS_VAR_MIN_PIXEL_VALUE = 1;

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
 * 格式化 rem 数值，移除无意义尾随 0。
 * @param value - rem 数值
 * @returns rem 数值字符串
 */
function formatRem(value: number): string {
  return Number(value.toFixed(CSS_VAR_REM_PRECISION)).toString();
}

/**
 * 判断主题 CSS 变量是否属于可缩放尺寸语义。
 * @param groupKey - ThemeTokens 顶层分组
 * @param propKey - 分组内属性名
 * @returns 是否需要把 px 单位转换为 rem
 */
function isScalableToken(groupKey: string, propKey: string): boolean {
  if (groupKey === 'radius' || groupKey === 'borderWidth' || groupKey === 'shadow') return true;
  if (groupKey === 'control' || groupKey === 'surface' || groupKey === 'overlay' || groupKey === 'interaction') return true;
  if (groupKey === 'button') return ['borderWidth', 'shadow', 'activeShadow', 'pressedShadow'].includes(propKey);

  if (groupKey === 'input') {
    return [
      'radius',
      'borderWidth',
      'paddingInline',
      'paddingBlock',
      'gap',
      'shadow',
      'activeShadow',
      'keycapSize',
      'keycapRadius',
      'keycapBorderWidth',
      'keycapShadow'
    ].includes(propKey);
  }

  return false;
}

/**
 * 将 CSS 值中的可缩放 px 尺寸转换为 rem。
 * @param value - CSS token 值
 * @returns 转换后的 CSS token 值
 */
function convertPxToRem(value: string): string {
  return value.replace(/(-?\d*\.?\d+)px\b/giu, (source: string, rawValue: string): string => {
    const pxValue = Number.parseFloat(rawValue);
    if (!Number.isFinite(pxValue) || Math.abs(pxValue) <= CSS_VAR_MIN_PIXEL_VALUE) return source;

    return `${formatRem(pxValue / DEFAULT_ROOT_FONT_SIZE)}rem`;
  });
}

/**
 * 按 14px 设计基准比例缩放 Ant Design 数字尺寸。
 * @param value - 14px 设计基准下的 px 尺寸
 * @param rootFontSize - 当前根字号
 * @returns Ant Design 数字 token
 */
function scaleMetric(value: number, rootFontSize: number): number {
  return Number(((value / DEFAULT_ROOT_FONT_SIZE) * rootFontSize).toFixed(4));
}

/**
 * 缩放 Ant Design 数字尺寸，同时保留 1px 发丝线。
 * @param value - 14px 设计基准下的 px 尺寸
 * @param rootFontSize - 当前根字号
 * @returns Ant Design 数字 token
 */
function scaleDimension(value: number, rootFontSize: number): number {
  if (Math.abs(value) <= CSS_VAR_MIN_PIXEL_VALUE) return value;

  return scaleMetric(value, rootFontSize);
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
      result[cssVarName] = isScalableToken(groupKey, propKey) ? convertPxToRem(value) : value;
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
 * @param rootFontSize - 当前应用根字号，作为 14px 设计基准的缩放目标
 * @returns Ant Design 完整主题配置（全局 token + 组件级 token）
 */
export function toAntdToken(tokens: ThemeTokens, rootFontSize: number = DEFAULT_ROOT_FONT_SIZE): AntdThemeConfig {
  const inputComponentTokens: AntdComponentTokens = {};
  const rawControlRadius = parseDimension(tokens.control.radius, 6);
  const rawControlLineWidth = parseDimension(tokens.control.borderWidth, 1);
  const controlRadius = scaleDimension(rawControlRadius, rootFontSize);
  const surfaceRadius = scaleDimension(parseDimension(tokens.surface.radius, 8), rootFontSize);
  const overlayRadius = scaleDimension(parseDimension(tokens.overlay.radius, 8), rootFontSize);
  const controlLineWidth = scaleDimension(rawControlLineWidth, rootFontSize);
  const overlayLineWidth = scaleDimension(parseDimension(tokens.overlay.borderWidth, 1), rootFontSize);
  const inputRadius = scaleDimension(parseDimension(tokens.input.radius, rawControlRadius), rootFontSize);
  const inputLineWidth = scaleDimension(parseDimension(tokens.input.borderWidth, rawControlLineWidth), rootFontSize);
  const inputPaddingInline = scaleDimension(parseDimension(tokens.input.paddingInline, 12), rootFontSize);
  const fontSize = scaleMetric(14, rootFontSize);
  const controlHeight = scaleMetric(32, rootFontSize);
  const controlHeightSM = scaleMetric(26, rootFontSize);
  const controlHeightLG = scaleMetric(38, rootFontSize);
  const borderRadiusSM = scaleDimension(parseDimension(tokens.radius.xs, 4), rootFontSize);

  for (const component of INPUT_COMPONENTS) {
    inputComponentTokens[component] = {
      colorBgContainer: tokens.bg.primary,
      borderRadius: controlRadius,
      lineWidth: controlLineWidth,
      controlHeight,
      controlHeightSM,
      controlHeightLG
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
    fontFamily: tokens.font.display,
    fontSize,
    controlHeight,
    controlHeightSM,
    controlHeightLG
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
      borderRadiusSM,
      lineWidth: controlLineWidth,
      fontFamily: tokens.font.sans,
      fontSize,
      controlHeight,
      controlHeightSM,
      controlHeightLG
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
