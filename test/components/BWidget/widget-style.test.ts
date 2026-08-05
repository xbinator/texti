/**
 * @file widget-style.test.ts
 * @description 验证 BWidget 元素盒模型样式到 CSS 属性的转换规则。
 */
import { describe, expect, it } from 'vitest';
import {
  createWidgetElementCustomCssProperties,
  createWidgetElementStyleProperties,
  resolveWidgetBoxSideNumbers
} from '@/components/BWidget/utils/widgetStyle';

describe('widgetStyle', (): void => {
  it('creates CSS properties from all-side box style values', (): void => {
    const style = createWidgetElementStyleProperties({
      borderColor: '#123456',
      borderStyle: 'solid',
      borderWidth: 2,
      borderRadius: 6,
      padding: 4
    });

    expect(style).toMatchObject({
      borderColor: '#123456',
      borderStyle: 'solid',
      borderWidth: '2px',
      borderRadius: '6px',
      padding: '4px'
    });
  });

  it('creates CSS longhand properties from individual side and corner values', (): void => {
    const style = createWidgetElementStyleProperties({
      borderStyle: 'dashed',
      borderWidth: { top: 1, right: 2, bottom: 3, left: 4 },
      borderRadius: { topLeft: 5, topRight: 6, bottomRight: 7, bottomLeft: 8 },
      padding: { top: 9, right: 10, bottom: 11, left: 12 }
    });

    expect(style).toMatchObject({
      borderStyle: 'dashed',
      borderTopWidth: '1px',
      borderRightWidth: '2px',
      borderBottomWidth: '3px',
      borderLeftWidth: '4px',
      borderTopLeftRadius: '5px',
      borderTopRightRadius: '6px',
      borderBottomRightRadius: '7px',
      borderBottomLeftRadius: '8px',
      paddingTop: '9px',
      paddingRight: '10px',
      paddingBottom: '11px',
      paddingLeft: '12px'
    });
  });

  it('normalizes box side numbers for text metrics', (): void => {
    expect(resolveWidgetBoxSideNumbers({ top: -1, right: 2, bottom: 3, left: 4 }, 0)).toEqual({
      top: 0,
      right: 2,
      bottom: 3,
      left: 4
    });
    expect(resolveWidgetBoxSideNumbers(5, 0)).toEqual({
      top: 5,
      right: 5,
      bottom: 5,
      left: 5
    });
    expect(resolveWidgetBoxSideNumbers(undefined, 2)).toEqual({
      top: 2,
      right: 2,
      bottom: 2,
      left: 2
    });
  });

  it('creates CSS properties from custom CSS model text', (): void => {
    expect(
      createWidgetElementCustomCssProperties({
        css: 'filter: blur(2px); --widget-accent: #ff0000; border-block-start-width: 3px;'
      })
    ).toMatchObject({
      filter: 'blur(2px)',
      '--widget-accent': '#ff0000',
      borderBlockStartWidth: '3px'
    });
  });
});
