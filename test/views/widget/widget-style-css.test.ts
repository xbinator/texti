/**
 * @file widget-style-css.test.ts
 * @description 验证 Widget 元素样式与 CSS 声明之间的转换工具。
 */
import { describe, expect, it } from 'vitest';
import type { WidgetElementStyle } from '@/components/BWidget/types';
import { applyWidgetStyleCss, parseWidgetStyleCss, serializeWidgetStyleCss } from '@/views/widget/utils/widgetStyleCss';

describe('widgetStyleCss', (): void => {
  it('serializes widget element style as stable CSS declarations', (): void => {
    const style: WidgetElementStyle = {
      backgroundColor: '#ffffff',
      borderColor: '#e5e7eb',
      borderStyle: 'solid',
      borderWidth: { top: 1, right: 2, bottom: 3, left: 4 },
      borderRadius: 6,
      padding: { top: 8, right: 10, bottom: 12, left: 14 },
      color: '#111827',
      fontSize: 14,
      fontWeight: 600,
      fontStyle: 'italic',
      lineHeight: 1.5,
      textDecoration: 'underline',
      textAlign: 'center',
      textVerticalAlign: 'middle',
      opacity: 0.8
    };

    expect(serializeWidgetStyleCss(style)).toBe(
      [
        ':root {',
        '  background-color: #ffffff;',
        '  border-color: #e5e7eb;',
        '  border-style: solid;',
        '  border-top-width: 1px;',
        '  border-right-width: 2px;',
        '  border-bottom-width: 3px;',
        '  border-left-width: 4px;',
        '  border-radius: 6px;',
        '  padding-top: 8px;',
        '  padding-right: 10px;',
        '  padding-bottom: 12px;',
        '  padding-left: 14px;',
        '  color: #111827;',
        '  font-size: 14px;',
        '  font-weight: 600;',
        '  font-style: italic;',
        '  line-height: 1.5;',
        '  text-decoration: underline;',
        '  text-align: center;',
        '  align-items: center;',
        '  opacity: 0.8;',
        '}'
      ].join('\n')
    );
  });

  it('wraps custom declaration CSS without wrapping full CSS rules again', (): void => {
    expect(serializeWidgetStyleCss({ css: 'filter: blur(2px);\ncolor: #0f172a;' })).toBe(
      [':root {', '  filter: blur(2px);', '  color: #0f172a;', '}'].join('\n')
    );
    expect(serializeWidgetStyleCss({ css: ':root {\n  filter: blur(2px);\n}' })).toBe(':root {\n  filter: blur(2px);\n}');
  });

  it('parses selector-wrapped CSS and expands shorthand values', (): void => {
    const result = parseWidgetStyleCss(`
      .selected-element {
        background-color: #f8fafc;
        padding: 4px 8px;
        border-width: 1px 2px 3px 4px;
        border-radius: 5px 6px 7px 8px;
        color: #0f172a;
        font-size: 16px;
        font-weight: bold;
        font-style: italic;
        line-height: 1.4;
        text-decoration: line-through;
        text-align: right;
        align-items: flex-end;
        opacity: 0.5;
        transform: scale(1.2);
      }
    `);

    expect(result.style.css).toContain('transform: scale(1.2);');
    expect(result.style).toMatchObject({
      backgroundColor: '#f8fafc',
      padding: { top: 4, right: 8, bottom: 4, left: 8 },
      borderWidth: { top: 1, right: 2, bottom: 3, left: 4 },
      borderRadius: { topLeft: 5, topRight: 6, bottomRight: 7, bottomLeft: 8 },
      color: '#0f172a',
      fontSize: 16,
      fontWeight: 700,
      fontStyle: 'italic',
      lineHeight: 1.4,
      textDecoration: 'line-through',
      textAlign: 'right',
      textVerticalAlign: 'bottom',
      opacity: 0.5
    });
    expect(result.ignoredProperties).toEqual([]);
  });

  it('lets longhand declarations override earlier shorthand declarations', (): void => {
    const result = parseWidgetStyleCss(`
      padding: 2px;
      padding-left: 10px;
      border-radius: 4px;
      border-bottom-right-radius: 12px;
    `);

    expect(result.style.css).toContain('padding-left: 10px;');
    expect(result.style).toMatchObject({
      padding: { top: 2, right: 2, bottom: 2, left: 10 },
      borderRadius: { topLeft: 4, topRight: 4, bottomRight: 12, bottomLeft: 4 }
    });
  });

  it('keeps full CSS text even when structured fields cannot parse a value', (): void => {
    expect(parseWidgetStyleCss('font-size: 2rem;').style).toEqual({
      css: 'font-size: 2rem;'
    });
    expect(parseWidgetStyleCss('border-style: double;').style).toEqual({
      css: 'border-style: double;'
    });
    expect(parseWidgetStyleCss('opacity: 2;').style).toEqual({
      css: 'opacity: 2;'
    });
  });

  it('applies CSS-managed style as the selected element style', (): void => {
    const baseStyle: WidgetElementStyle = {
      backgroundColor: '#ffffff',
      color: '#111827',
      fontSize: 14,
      textVerticalAlign: 'top'
    };
    const cssStyle: WidgetElementStyle = {
      color: '#0f172a'
    };

    expect(applyWidgetStyleCss(baseStyle, cssStyle)).toEqual({
      color: '#0f172a'
    });
  });

  it('keeps arbitrary CSS declarations in the model while parsing known fields', (): void => {
    const result = parseWidgetStyleCss('filter: blur(2px);\ntransform: scale(1.1);\ncolor: #334155;');

    expect(result.style).toEqual({
      css: 'filter: blur(2px);\ntransform: scale(1.1);\ncolor: #334155;',
      color: '#334155'
    });
    expect(result.ignoredProperties).toEqual([]);
  });
});
