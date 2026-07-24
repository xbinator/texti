/**
 * @file widgetStyle.ts
 * @description BWidget 元素样式到 CSS 属性的转换工具。
 */
import type { WidgetBoxSideValue, WidgetCornerRadiusValue, WidgetElementStyle } from '../types';
import type { CSSProperties } from 'vue';

/**
 * 可动态写入任意 CSS 属性的样式对象。
 */
type MutableCssProperties = CSSProperties & Record<string, string | number | undefined>;

/**
 * 归一化非负盒模型数值。
 * @param value - 原始数值
 * @returns 可用于 CSS 的非负数值
 */
function normalizeBoxNumber(value: number | undefined): number {
  return Math.max(0, value ?? 0);
}

/**
 * 将数值转换为 px 单位。
 * @param value - 原始数值
 * @returns px 字符串
 */
function toPixelValue(value: number): string {
  return `${normalizeBoxNumber(value)}px`;
}

/**
 * 移除 CSS 块注释。
 * @param source - CSS 源码
 * @returns 无注释 CSS
 */
function stripCssComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//gu, '');
}

/**
 * 读取可作为 inline style 的声明源码。
 * @param source - CSS 源码
 * @returns CSS 声明源码
 */
function readInlineDeclarationSource(source: string): string {
  const trimmedSource = stripCssComments(source).trim();
  const openIndex = trimmedSource.indexOf('{');

  if (openIndex < 0) {
    return trimmedSource;
  }

  const closeIndex = trimmedSource.indexOf('}', openIndex + 1);
  return closeIndex < 0 ? '' : trimmedSource.slice(openIndex + 1, closeIndex).trim();
}

/**
 * 将 CSS 属性名转换为 Vue style 对象 key。
 * @param property - CSS 属性名
 * @returns Vue style key
 */
function toVueStyleKey(property: string): string {
  if (property.startsWith('--')) {
    return property;
  }

  return property.replace(/-([a-z])/gu, (_match: string, character: string): string => character.toUpperCase());
}

/**
 * 将 CSS 声明文本解析为 Vue style 对象。
 * @param source - CSS 声明源码
 * @returns Vue style 对象
 */
function parseCssDeclarations(source: string): CSSProperties {
  const properties: MutableCssProperties = {};
  const declarationSource = readInlineDeclarationSource(source);

  declarationSource
    .split(';')
    .map((segment: string): string => segment.trim())
    .filter((segment: string): boolean => segment.length > 0)
    .forEach((segment: string): void => {
      const colonIndex = segment.indexOf(':');
      if (colonIndex <= 0) {
        return;
      }

      const property = segment.slice(0, colonIndex).trim();
      const value = segment.slice(colonIndex + 1).trim();
      if (!property || !value) {
        return;
      }

      properties[toVueStyleKey(property)] = value;
    });

  return properties;
}

/**
 * 判断盒模型值是否为四边对象。
 * @param value - 盒模型值
 * @returns 是否为四边对象
 */
function isWidgetBoxSides(value: WidgetBoxSideValue | undefined): value is Exclude<WidgetBoxSideValue, number> {
  return typeof value === 'object' && value !== null;
}

/**
 * 判断圆角值是否为四角对象。
 * @param value - 圆角值
 * @returns 是否为四角对象
 */
function isWidgetCornerRadius(value: WidgetCornerRadiusValue | undefined): value is Exclude<WidgetCornerRadiusValue, number> {
  return typeof value === 'object' && value !== null;
}

/**
 * 解析四边数值，供渲染和文本测量共用。
 * @param value - 盒模型数值
 * @param fallback - 缺省数值
 * @returns 归一化后的四边数值
 */
export function resolveWidgetBoxSideNumbers(value: WidgetBoxSideValue | undefined, fallback: number): Exclude<WidgetBoxSideValue, number> {
  if (isWidgetBoxSides(value)) {
    return {
      top: normalizeBoxNumber(value.top),
      right: normalizeBoxNumber(value.right),
      bottom: normalizeBoxNumber(value.bottom),
      left: normalizeBoxNumber(value.left)
    };
  }

  const normalizedValue = normalizeBoxNumber(value ?? fallback);

  return {
    top: normalizedValue,
    right: normalizedValue,
    bottom: normalizedValue,
    left: normalizedValue
  };
}

/**
 * 应用边框宽度 CSS 属性。
 * @param properties - CSS 属性对象
 * @param borderWidth - 边框宽度
 */
function assignBorderWidthProperties(properties: CSSProperties, borderWidth: WidgetBoxSideValue | undefined): void {
  if (borderWidth === undefined) {
    return;
  }

  if (isWidgetBoxSides(borderWidth)) {
    properties.borderTopWidth = toPixelValue(borderWidth.top);
    properties.borderRightWidth = toPixelValue(borderWidth.right);
    properties.borderBottomWidth = toPixelValue(borderWidth.bottom);
    properties.borderLeftWidth = toPixelValue(borderWidth.left);
    return;
  }

  properties.borderWidth = toPixelValue(borderWidth);
}

/**
 * 应用圆角 CSS 属性。
 * @param properties - CSS 属性对象
 * @param borderRadius - 圆角数值
 */
function assignBorderRadiusProperties(properties: CSSProperties, borderRadius: WidgetCornerRadiusValue | undefined): void {
  if (borderRadius === undefined) {
    return;
  }

  if (isWidgetCornerRadius(borderRadius)) {
    properties.borderTopLeftRadius = toPixelValue(borderRadius.topLeft);
    properties.borderTopRightRadius = toPixelValue(borderRadius.topRight);
    properties.borderBottomRightRadius = toPixelValue(borderRadius.bottomRight);
    properties.borderBottomLeftRadius = toPixelValue(borderRadius.bottomLeft);
    return;
  }

  properties.borderRadius = toPixelValue(borderRadius);
}

/**
 * 应用内边距 CSS 属性。
 * @param properties - CSS 属性对象
 * @param padding - 内边距数值
 */
function assignPaddingProperties(properties: CSSProperties, padding: WidgetBoxSideValue | undefined): void {
  if (padding === undefined) {
    return;
  }

  if (isWidgetBoxSides(padding)) {
    properties.paddingTop = toPixelValue(padding.top);
    properties.paddingRight = toPixelValue(padding.right);
    properties.paddingBottom = toPixelValue(padding.bottom);
    properties.paddingLeft = toPixelValue(padding.left);
    return;
  }

  properties.padding = toPixelValue(padding);
}

/**
 * 创建Widget元素盒模型 CSS 属性。
 * @param style - 元素样式
 * @returns Vue CSS 属性对象
 */
export function createWidgetElementStyleProperties(style?: WidgetElementStyle): CSSProperties {
  const properties: CSSProperties = {
    backgroundColor: style?.backgroundColor,
    borderColor: style?.borderColor,
    borderStyle: style?.borderStyle
  };

  assignBorderWidthProperties(properties, style?.borderWidth);
  assignBorderRadiusProperties(properties, style?.borderRadius);
  assignPaddingProperties(properties, style?.padding);

  return properties;
}

/**
 * 创建 Widget 元素 CSS 源码样式属性。
 * @param style - 元素样式
 * @returns Vue CSS 属性对象
 */
export function createWidgetElementCustomCssProperties(style?: WidgetElementStyle): CSSProperties {
  if (!style?.css) {
    return {};
  }

  return parseCssDeclarations(style.css);
}

/**
 * 解析文字纵向对齐到 flex 对齐方式。
 * @param textVerticalAlign - 文字纵向对齐
 * @returns flex 交叉轴对齐方式
 */
export function resolveWidgetElementVerticalAlign(textVerticalAlign: WidgetElementStyle['textVerticalAlign']): string | undefined {
  if (textVerticalAlign === 'top') {
    return 'flex-start';
  }

  if (textVerticalAlign === 'bottom') {
    return 'flex-end';
  }

  if (textVerticalAlign === 'middle') {
    return 'center';
  }

  return undefined;
}

/**
 * 创建Widget元素内容排版 CSS 属性。
 * @param style - 元素样式
 * @returns Vue CSS 属性对象
 */
export function createWidgetElementContentStyleProperties(style?: WidgetElementStyle): CSSProperties {
  return {
    alignItems: resolveWidgetElementVerticalAlign(style?.textVerticalAlign),
    color: style?.color,
    fontSize: style?.fontSize === undefined ? undefined : `${style.fontSize}px`,
    fontStyle: style?.fontStyle,
    fontWeight: style?.fontWeight,
    lineHeight: style?.lineHeight,
    textAlign: style?.textAlign,
    textDecoration: style?.textDecoration,
    overflow: 'hidden'
  };
}
