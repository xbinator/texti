/**
 * @file widgetStyleCss.ts
 * @description Widget 元素结构化样式与 CSS 声明文本之间的转换工具。
 */
import type {
  WidgetBorderStyle,
  WidgetBoxSides,
  WidgetBoxSideValue,
  WidgetCornerRadius,
  WidgetCornerRadiusValue,
  WidgetElementStyle,
  WidgetFontStyle,
  WidgetTextDecoration
} from '@/components/BWidget/types';

/**
 * CSS 解析结果。
 */
export interface WidgetStyleCssParseResult {
  /** CSS 中可应用到 WidgetElementStyle 的结构化样式 */
  style: WidgetElementStyle;
  /** 已忽略的不支持 CSS 属性；原始 CSS 模式下通常为空 */
  ignoredProperties: string[];
}

/**
 * CSS 声明项。
 */
interface CssDeclaration {
  /** CSS 属性名，小写横线格式 */
  property: string;
  /** CSS 属性值原文 */
  value: string;
}

/**
 * 盒模型边名。
 */
type BoxSideName = keyof WidgetBoxSides;

/**
 * 圆角角名。
 */
type RadiusCornerName = keyof WidgetCornerRadius;

const NUMBER_PATTERN = /^-?(?:\d+|\d*\.\d+)$/u;
const PX_PATTERN = /^(-?(?:\d+|\d*\.\d+))px$/u;
const BORDER_STYLE_VALUES: readonly WidgetBorderStyle[] = ['none', 'solid', 'dashed', 'dotted'];
const FONT_STYLE_VALUES: readonly WidgetFontStyle[] = ['normal', 'italic'];
const TEXT_DECORATION_VALUES: readonly WidgetTextDecoration[] = ['none', 'underline', 'line-through'];
const TEXT_ALIGN_VALUES: readonly NonNullable<WidgetElementStyle['textAlign']>[] = ['left', 'center', 'right', 'justify'];
const CSS_ROOT_SELECTOR = ':root';

/**
 * 文本纵向对齐到 CSS align-items 的映射。
 */
const TEXT_VERTICAL_ALIGN_TO_CSS: Record<NonNullable<WidgetElementStyle['textVerticalAlign']>, string> = {
  top: 'flex-start',
  middle: 'center',
  bottom: 'flex-end'
};

/**
 * CSS align-items 到文本纵向对齐的映射。
 */
const CSS_TO_TEXT_VERTICAL_ALIGN: Record<string, NonNullable<WidgetElementStyle['textVerticalAlign']>> = {
  'flex-start': 'top',
  center: 'middle',
  'flex-end': 'bottom'
};

/**
 * 移除 CSS 块注释。
 * @param source - CSS 源码
 * @returns 无注释 CSS
 */
function stripCssComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//gu, '');
}

/**
 * 判断 CSS 源码是否已经包含规则块。
 * @param source - CSS 源码
 * @returns 是否存在规则块
 */
function hasCssRuleBlock(source: string): boolean {
  const trimmedSource = stripCssComments(source).trim();
  const openIndex = trimmedSource.indexOf('{');
  if (openIndex < 0) {
    return false;
  }

  const closeIndex = trimmedSource.indexOf('}', openIndex + 1);
  return closeIndex > openIndex;
}

/**
 * 缩进 CSS 声明源码。
 * @param source - CSS 声明源码
 * @returns 缩进后的 CSS 声明源码
 */
function indentCssDeclarationSource(source: string): string {
  return source
    .split('\n')
    .map((line: string): string => {
      const trimmedLine = line.trim();
      return trimmedLine ? `  ${trimmedLine}` : '';
    })
    .join('\n');
}

/**
 * 将声明列表包裹为完整 CSS 规则。
 * @param source - CSS 源码
 * @returns 可供 Monaco CSS 语言服务解析的 CSS 源码
 */
function wrapStyleCssSource(source: string): string {
  const trimmedSource = source.trim();
  if (!trimmedSource) {
    return `${CSS_ROOT_SELECTOR} {\n}`;
  }

  if (hasCssRuleBlock(trimmedSource)) {
    return trimmedSource;
  }

  return `${CSS_ROOT_SELECTOR} {\n${indentCssDeclarationSource(trimmedSource)}\n}`;
}

/**
 * 添加 CSS 声明。
 * @param declarations - 声明列表
 * @param property - CSS 属性名
 * @param value - CSS 属性值
 */
function addDeclaration(declarations: string[], property: string, value: string | number | undefined): void {
  if (value === undefined || value === '') {
    return;
  }

  declarations.push(`${property}: ${value};`);
}

/**
 * 归一化非负数值。
 * @param value - 原始数值
 * @returns 非负数值
 */
function normalizeNumber(value: number): number {
  return Math.max(0, value);
}

/**
 * 格式化 px 数值。
 * @param value - 原始数值
 * @returns CSS px 值
 */
function formatPixel(value: number): string {
  return `${normalizeNumber(value)}px`;
}

/**
 * 判断盒模型值是否为四边对象。
 * @param value - 盒模型值
 * @returns 是否为四边对象
 */
function isBoxSides(value: WidgetBoxSideValue | undefined): value is WidgetBoxSides {
  return typeof value === 'object' && value !== null;
}

/**
 * 判断圆角值是否为四角对象。
 * @param value - 圆角值
 * @returns 是否为四角对象
 */
function isCornerRadius(value: WidgetCornerRadiusValue | undefined): value is WidgetCornerRadius {
  return typeof value === 'object' && value !== null;
}

/**
 * 序列化四边 CSS。
 * @param declarations - 声明列表
 * @param property - 简写属性名
 * @param value - 盒模型值
 */
function serializeBoxValue(declarations: string[], property: 'border-width' | 'padding', value: WidgetBoxSideValue | undefined): void {
  if (value === undefined) {
    return;
  }

  if (!isBoxSides(value)) {
    addDeclaration(declarations, property, formatPixel(value));
    return;
  }

  addDeclaration(declarations, `${property.split('-')[0]}-top${property === 'border-width' ? '-width' : ''}`, formatPixel(value.top));
  addDeclaration(declarations, `${property.split('-')[0]}-right${property === 'border-width' ? '-width' : ''}`, formatPixel(value.right));
  addDeclaration(declarations, `${property.split('-')[0]}-bottom${property === 'border-width' ? '-width' : ''}`, formatPixel(value.bottom));
  addDeclaration(declarations, `${property.split('-')[0]}-left${property === 'border-width' ? '-width' : ''}`, formatPixel(value.left));
}

/**
 * 序列化圆角 CSS。
 * @param declarations - 声明列表
 * @param value - 圆角值
 */
function serializeRadiusValue(declarations: string[], value: WidgetCornerRadiusValue | undefined): void {
  if (value === undefined) {
    return;
  }

  if (!isCornerRadius(value)) {
    addDeclaration(declarations, 'border-radius', formatPixel(value));
    return;
  }

  addDeclaration(declarations, 'border-top-left-radius', formatPixel(value.topLeft));
  addDeclaration(declarations, 'border-top-right-radius', formatPixel(value.topRight));
  addDeclaration(declarations, 'border-bottom-right-radius', formatPixel(value.bottomRight));
  addDeclaration(declarations, 'border-bottom-left-radius', formatPixel(value.bottomLeft));
}

/**
 * 将 WidgetElementStyle 序列化为 CSS 声明。
 * @param style - Widget 元素样式
 * @returns CSS 声明文本
 */
export function serializeWidgetStyleCss(style: WidgetElementStyle): string {
  if (style.css !== undefined) {
    return wrapStyleCssSource(style.css);
  }

  const declarations: string[] = [];

  addDeclaration(declarations, 'background-color', style.backgroundColor);
  addDeclaration(declarations, 'border-color', style.borderColor);
  addDeclaration(declarations, 'border-style', style.borderStyle);
  serializeBoxValue(declarations, 'border-width', style.borderWidth);
  serializeRadiusValue(declarations, style.borderRadius);
  serializeBoxValue(declarations, 'padding', style.padding);
  addDeclaration(declarations, 'color', style.color);
  addDeclaration(declarations, 'font-size', style.fontSize === undefined ? undefined : formatPixel(style.fontSize));
  addDeclaration(declarations, 'font-weight', style.fontWeight);
  addDeclaration(declarations, 'font-style', style.fontStyle);
  addDeclaration(declarations, 'line-height', style.lineHeight);
  addDeclaration(declarations, 'text-decoration', style.textDecoration);
  addDeclaration(declarations, 'text-align', style.textAlign);
  addDeclaration(declarations, 'align-items', style.textVerticalAlign ? TEXT_VERTICAL_ALIGN_TO_CSS[style.textVerticalAlign] : undefined);
  addDeclaration(declarations, 'opacity', style.opacity);

  return wrapStyleCssSource(declarations.join('\n'));
}

/**
 * 读取声明列表源码。
 * @param source - CSS 源码
 * @returns 声明列表源码
 */
function readDeclarationSource(source: string): string {
  const trimmedSource = stripCssComments(source).trim();
  const openIndex = trimmedSource.indexOf('{');

  if (openIndex < 0) {
    return trimmedSource;
  }

  const closeIndex = trimmedSource.indexOf('}', openIndex + 1);
  if (closeIndex < 0) {
    return trimmedSource;
  }

  return trimmedSource.slice(openIndex + 1, closeIndex).trim();
}

/**
 * 拆分 CSS 声明。
 * @param source - CSS 声明源码
 * @returns 声明列表
 */
function splitDeclarations(source: string): CssDeclaration[] {
  return source.split(';').reduce<CssDeclaration[]>((declarations: CssDeclaration[], segment: string): CssDeclaration[] => {
    const normalizedSegment = segment.trim();
    if (!normalizedSegment) {
      return declarations;
    }

    const colonIndex = segment.indexOf(':');
    if (colonIndex < 0) {
      return declarations;
    }

    const property = segment.slice(0, colonIndex).trim().toLowerCase();
    const value = segment.slice(colonIndex + 1).trim();
    if (!property || !value) {
      return declarations;
    }

    declarations.push({ property, value });
    return declarations;
  }, []);
}

/**
 * 解析 CSS 数值。
 * @param value - CSS 属性值
 * @param property - CSS 属性名
 * @param allowPx - 是否允许 px 单位
 * @param nonNegative - 是否要求非负
 * @returns 数值
 */
function parseCssNumber(value: string, property: string, allowPx: boolean, nonNegative: boolean): number {
  const normalizedValue = value.trim().toLowerCase();
  const pxMatch = PX_PATTERN.exec(normalizedValue);
  const numberSource = pxMatch && allowPx ? pxMatch[1] : normalizedValue;

  if (!numberSource || !NUMBER_PATTERN.test(numberSource)) {
    throw new Error(`${property} 仅支持${allowPx ? '数字或 px 数值' : '数字'}`);
  }

  const parsedValue = Number(numberSource);
  if (!Number.isFinite(parsedValue) || (nonNegative && parsedValue < 0)) {
    throw new Error(`${property} 数值无效`);
  }

  return parsedValue;
}

/**
 * 解析枚举属性。
 * @param value - CSS 属性值
 * @param values - 允许值列表
 * @param property - CSS 属性名
 * @returns 命中的枚举值
 */
function parseEnumValue<TValue extends string>(value: string, values: readonly TValue[], property: string): TValue {
  const normalizedValue = value.trim().toLowerCase();
  const matchedValue = values.find((item: TValue): boolean => item === normalizedValue);

  if (!matchedValue) {
    throw new Error(`${property} 不支持 ${value}`);
  }

  return matchedValue;
}

/**
 * 折叠四边数值。
 * @param sides - 四边数值
 * @returns 可写入 WidgetElementStyle 的盒模型值
 */
function collapseBoxSides(sides: WidgetBoxSides): WidgetBoxSideValue {
  if (sides.top === sides.right && sides.right === sides.bottom && sides.bottom === sides.left) {
    return sides.top;
  }

  return sides;
}

/**
 * 折叠四角圆角。
 * @param radius - 四角圆角
 * @returns 可写入 WidgetElementStyle 的圆角值
 */
function collapseRadius(radius: WidgetCornerRadius): WidgetCornerRadiusValue {
  if (radius.topLeft === radius.topRight && radius.topRight === radius.bottomRight && radius.bottomRight === radius.bottomLeft) {
    return radius.topLeft;
  }

  return radius;
}

/**
 * 扩展盒模型值为四边对象。
 * @param value - 盒模型值
 * @returns 四边对象
 */
function expandBoxSide(value: WidgetBoxSideValue | undefined): WidgetBoxSides {
  if (isBoxSides(value)) {
    return { ...value };
  }

  const normalizedValue = normalizeNumber(value ?? 0);
  return {
    top: normalizedValue,
    right: normalizedValue,
    bottom: normalizedValue,
    left: normalizedValue
  };
}

/**
 * 扩展圆角值为四角对象。
 * @param value - 圆角值
 * @returns 四角对象
 */
function expandRadiusValue(value: WidgetCornerRadiusValue | undefined): WidgetCornerRadius {
  if (isCornerRadius(value)) {
    return { ...value };
  }

  const normalizedValue = normalizeNumber(value ?? 0);
  return {
    topLeft: normalizedValue,
    topRight: normalizedValue,
    bottomRight: normalizedValue,
    bottomLeft: normalizedValue
  };
}

/**
 * 解析盒模型简写。
 * @param value - CSS 属性值
 * @param property - CSS 属性名
 * @returns 盒模型值
 */
function parseBoxValue(value: string, property: string): WidgetBoxSideValue {
  const tokens = value.split(/\s+/u).filter((token: string): boolean => token.length > 0);
  if (tokens.length < 1 || tokens.length > 4) {
    throw new Error(`${property} 仅支持 1 到 4 个数值`);
  }

  const numbers = tokens.map((token: string): number => parseCssNumber(token, property, true, true));
  const top = numbers[0] ?? 0;
  const right = numbers[1] ?? top;
  const bottom = numbers[2] ?? top;
  const left = numbers[3] ?? right;

  return collapseBoxSides({ top, right, bottom, left });
}

/**
 * 解析圆角简写。
 * @param value - CSS 属性值
 * @returns 圆角值
 */
function parseRadiusValue(value: string): WidgetCornerRadiusValue {
  if (value.includes('/')) {
    throw new Error('border-radius 暂不支持椭圆圆角语法');
  }

  const parsedValue = parseBoxValue(value, 'border-radius');
  if (!isBoxSides(parsedValue)) {
    return parsedValue;
  }

  return collapseRadius({
    topLeft: parsedValue.top,
    topRight: parsedValue.right,
    bottomRight: parsedValue.bottom,
    bottomLeft: parsedValue.left
  });
}

/**
 * 更新盒模型单边值。
 * @param style - 当前结构化样式
 * @param key - 目标样式字段
 * @param side - 目标边
 * @param value - 单边数值
 */
function assignBoxSide(style: WidgetElementStyle, key: 'borderWidth' | 'padding', side: BoxSideName, value: number): void {
  const sides = expandBoxSide(style[key]);
  sides[side] = value;
  style[key] = collapseBoxSides(sides);
}

/**
 * 更新圆角单角值。
 * @param style - 当前结构化样式
 * @param corner - 目标角
 * @param value - 单角数值
 */
function assignRadiusCorner(style: WidgetElementStyle, corner: RadiusCornerName, value: number): void {
  const radius = expandRadiusValue(style.borderRadius);
  radius[corner] = value;
  style.borderRadius = collapseRadius(radius);
}

/**
 * 解析字重。
 * @param value - CSS 属性值
 * @returns 数字字重
 */
function parseFontWeight(value: string): number {
  const normalizedValue = value.trim().toLowerCase();
  if (normalizedValue === 'normal') {
    return 400;
  }

  if (normalizedValue === 'bold') {
    return 700;
  }

  return parseCssNumber(normalizedValue, 'font-weight', false, true);
}

/**
 * 解析透明度。
 * @param value - CSS 属性值
 * @returns 透明度
 */
function parseOpacity(value: string): number {
  const opacity = parseCssNumber(value, 'opacity', false, true);
  if (opacity > 1) {
    throw new Error('opacity 必须在 0 到 1 之间');
  }

  return opacity;
}

/**
 * 添加不支持属性。
 * @param ignoredProperties - 不支持属性列表
 * @param property - CSS 属性名
 */
function addIgnoredProperty(ignoredProperties: string[], property: string): void {
  if (ignoredProperties.includes(property)) {
    return;
  }

  ignoredProperties.push(property);
}

/**
 * 应用单条 CSS 声明。
 * @param style - 当前结构化样式
 * @param declaration - CSS 声明
 * @param ignoredProperties - 不支持属性列表
 */
function applyDeclaration(style: WidgetElementStyle, declaration: CssDeclaration, ignoredProperties: string[]): void {
  const { property, value } = declaration;

  switch (property) {
    case 'background-color':
      style.backgroundColor = value;
      break;
    case 'border-color':
      style.borderColor = value;
      break;
    case 'border-style':
      style.borderStyle = parseEnumValue(value, BORDER_STYLE_VALUES, property);
      break;
    case 'border-width':
      style.borderWidth = parseBoxValue(value, property);
      break;
    case 'border-top-width':
      assignBoxSide(style, 'borderWidth', 'top', parseCssNumber(value, property, true, true));
      break;
    case 'border-right-width':
      assignBoxSide(style, 'borderWidth', 'right', parseCssNumber(value, property, true, true));
      break;
    case 'border-bottom-width':
      assignBoxSide(style, 'borderWidth', 'bottom', parseCssNumber(value, property, true, true));
      break;
    case 'border-left-width':
      assignBoxSide(style, 'borderWidth', 'left', parseCssNumber(value, property, true, true));
      break;
    case 'border-radius':
      style.borderRadius = parseRadiusValue(value);
      break;
    case 'border-top-left-radius':
      assignRadiusCorner(style, 'topLeft', parseCssNumber(value, property, true, true));
      break;
    case 'border-top-right-radius':
      assignRadiusCorner(style, 'topRight', parseCssNumber(value, property, true, true));
      break;
    case 'border-bottom-right-radius':
      assignRadiusCorner(style, 'bottomRight', parseCssNumber(value, property, true, true));
      break;
    case 'border-bottom-left-radius':
      assignRadiusCorner(style, 'bottomLeft', parseCssNumber(value, property, true, true));
      break;
    case 'padding':
      style.padding = parseBoxValue(value, property);
      break;
    case 'padding-top':
      assignBoxSide(style, 'padding', 'top', parseCssNumber(value, property, true, true));
      break;
    case 'padding-right':
      assignBoxSide(style, 'padding', 'right', parseCssNumber(value, property, true, true));
      break;
    case 'padding-bottom':
      assignBoxSide(style, 'padding', 'bottom', parseCssNumber(value, property, true, true));
      break;
    case 'padding-left':
      assignBoxSide(style, 'padding', 'left', parseCssNumber(value, property, true, true));
      break;
    case 'color':
      style.color = value;
      break;
    case 'font-size':
      style.fontSize = parseCssNumber(value, property, true, true);
      break;
    case 'font-weight':
      style.fontWeight = parseFontWeight(value);
      break;
    case 'font-style':
      style.fontStyle = parseEnumValue(value, FONT_STYLE_VALUES, property);
      break;
    case 'line-height':
      style.lineHeight = parseCssNumber(value, property, false, true);
      break;
    case 'text-decoration':
      style.textDecoration = parseEnumValue(value, TEXT_DECORATION_VALUES, property);
      break;
    case 'text-align':
      style.textAlign = parseEnumValue(value, TEXT_ALIGN_VALUES, property);
      break;
    case 'align-items': {
      const normalizedValue = value.trim().toLowerCase();
      const textVerticalAlign = CSS_TO_TEXT_VERTICAL_ALIGN[normalizedValue];
      if (!textVerticalAlign) {
        throw new Error(`${property} 不支持 ${value}`);
      }
      style.textVerticalAlign = textVerticalAlign;
      break;
    }
    case 'opacity':
      style.opacity = parseOpacity(value);
      break;
    default:
      if (property.length === 0) {
        addIgnoredProperty(ignoredProperties, property);
      }
      break;
  }
}

/**
 * 将 CSS 声明解析为 WidgetElementStyle。
 * @param source - CSS 源码
 * @returns CSS 解析结果
 */
export function parseWidgetStyleCss(source: string): WidgetStyleCssParseResult {
  const style: WidgetElementStyle = {
    css: source.trim()
  };
  const ignoredProperties: string[] = [];
  const declarationSource = readDeclarationSource(source);
  const declarations = splitDeclarations(declarationSource);

  declarations.forEach((declaration: CssDeclaration): void => {
    try {
      applyDeclaration(style, declaration, ignoredProperties);
    } catch (_error: unknown) {
      // 原始 CSS 已写入 style.css；结构化字段无法解析时忽略，避免阻断完整 CSS 保存。
    }
  });

  return {
    style,
    ignoredProperties
  };
}

/**
 * 将 CSS 解析后的样式应用为当前元素样式。
 * @param _baseStyle - 应用前样式，保留参数用于表达调用意图
 * @param cssStyle - CSS 解析后的样式
 * @returns 应用后的元素样式
 */
export function applyWidgetStyleCss(_baseStyle: WidgetElementStyle, cssStyle: WidgetElementStyle): WidgetElementStyle {
  return { ...cssStyle };
}
