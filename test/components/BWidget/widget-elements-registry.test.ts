/**
 * @file widget-elements-registry.test.ts
 * @description 验证 BWidget 元素注册表公开工具、视图和设置面板映射。
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { WidgetElementSchema } from '@/components/BWidget/elements';
import { getWidgetElementSchema, getWidgetElementSetter, getWidgetElementView, WIDGET_ELEMENT_SCHEMAS } from '@/components/BWidget/elements';
import type { WidgetElementRole } from '@/components/BWidget/elements/roles';
import { WIDGET_ELEMENT_ROLES } from '@/components/BWidget/elements/roles';

describe('BWidget element registry', (): void => {
  it('registers the button element schema for the sidebar tool list', (): void => {
    const schemaNames = WIDGET_ELEMENT_SCHEMAS.map((schema: WidgetElementSchema): string => schema.name);
    const buttonSchema = getWidgetElementSchema('button');

    expect(schemaNames).toContain('button');
    expect(buttonSchema).toMatchObject({
      name: 'button',
      label: '按钮',
      icon: 'lucide:mouse-pointer-click',
      createAnchor: 'center',
      createCursor: 'pointer',
      metadata: {
        actions: [],
        disabled: false,
        loading: false,
        text: '按钮'
      }
    });
  });

  it('registers button view and setter components', (): void => {
    expect(getWidgetElementView('button')).not.toBeNull();
    expect(getWidgetElementSetter('button')).not.toBeNull();
  });

  it('registers the swiper element schema for the sidebar tool list', (): void => {
    const schemaNames = WIDGET_ELEMENT_SCHEMAS.map((schema: WidgetElementSchema): string => schema.name);
    const swiperSchema = getWidgetElementSchema('swiper');

    expect(schemaNames).toContain('swiper');
    expect(swiperSchema).toMatchObject({
      name: 'swiper',
      label: '轮播图',
      icon: 'lucide:gallery-horizontal-end',
      createAnchor: 'center',
      createCursor: 'grab',
      metadata: {
        autoplay: false,
        autoplayInterval: 3000,
        animationDuration: 300,
        fit: 'cover',
        images: [
          {
            alt: '',
            src: ''
          }
        ],
        indicatorColor: '#ffffff',
        indicatorShape: 'dot',
        initialIndex: 0,
        loop: true,
        showIndicator: true,
        vertical: false
      }
    });
  });

  it('registers swiper view and setter components', (): void => {
    expect(getWidgetElementView('swiper')).not.toBeNull();
    expect(getWidgetElementSetter('swiper')).not.toBeNull();
  });

  it('registers ordered sidebar categories and assigns every element', (): void => {
    expect(WIDGET_ELEMENT_ROLES).toEqual([
      { key: 'basic', label: '基础' },
      { key: 'interaction', label: '交互' }
    ]);

    const categoriesByElementName = Object.fromEntries(
      WIDGET_ELEMENT_SCHEMAS.map((schema: WidgetElementSchema): [string, WidgetElementRole] => [schema.name, schema.role])
    );

    expect(categoriesByElementName).toEqual({
      rect: 'basic',
      text: 'basic',
      image: 'basic',
      swiper: 'basic',
      button: 'interaction'
    });
  });

  it('derives role keys from the ordered role definitions', (): void => {
    expectTypeOf<WidgetElementRole>().toEqualTypeOf<(typeof WIDGET_ELEMENT_ROLES)[number]['key']>();

    const roleKeys = new Set<WidgetElementRole>(WIDGET_ELEMENT_ROLES.map((role): WidgetElementRole => role.key));

    expect(WIDGET_ELEMENT_SCHEMAS.every((schema: WidgetElementSchema): boolean => roleKeys.has(schema.role))).toBe(true);
  });
});
