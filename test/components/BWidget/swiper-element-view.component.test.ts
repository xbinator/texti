/**
 * @file swiper-element-view.component.test.ts
 * @description 验证 BWidget 轮播图元素视图渲染、变量插值、切换与指示器逻辑。
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { VueWrapper } from '@vue/test-utils';
import type { WidgetRenderContext } from 'types/widget';
import { nextTick, ref, defineComponent, h } from 'vue';
import type { VNode } from 'vue';
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLiteralValue, createVariableValue } from '@/components/BSmart/utils/value';
import SwiperElementView from '@/components/BWidget/elements/Swiper/index.vue';
import type { WidgetSwiperElementMetadata } from '@/components/BWidget/elements/Swiper/schema';
import { provideRenderContext, type WidgetRenderContextOptions } from '@/components/BWidget/hooks/useRenderContext';
import type { WidgetShapeElement } from '@/components/BWidget/types';
import { createDefaultWidgetElementLoopConfig } from '@/components/BWidget/utils/widgetLoop';

/**
 * 轮播图元素视图挂载选项。
 */
interface SwiperElementViewMountOptions {
  /** Widget 渲染上下文 */
  renderContext?: WidgetRenderContext;
  /** Widget 渲染选项 */
  renderOptions?: WidgetRenderContextOptions;
}

/**
 * 创建轮播图视图测试元素。
 * @param overrides - 元数据覆盖项
 * @returns 轮播图元素
 */
function createSwiperElement(overrides: Partial<WidgetSwiperElementMetadata> = {}): WidgetShapeElement<WidgetSwiperElementMetadata> {
  return {
    id: 'swiper-1',
    name: 'swiper',
    label: '轮播图',
    icon: 'lucide:gallery-horizontal-end',
    title: '轮播图名称',
    position: { x: 0, y: 0 },
    size: { width: 240, height: 160 },
    rotation: 0,
    style: {},
    loop: createDefaultWidgetElementLoopConfig(),
    metadata: {
      autoplay: createLiteralValue(false),
      autoplayInterval: 3000,
      animationDuration: 300,
      fit: 'cover',
      images: [
        {
          alt: createLiteralValue('第一张'),
          src: createLiteralValue('https://example.com/a.png')
        },
        {
          alt: createLiteralValue('第二张'),
          src: createLiteralValue('https://example.com/b.png')
        }
      ],
      indicatorColor: '#ffffff',
      indicatorShape: 'dot',
      initialIndex: 0,
      loop: createLiteralValue(true),
      showIndicator: createLiteralValue(true),
      vertical: createLiteralValue(false),
      ...overrides
    }
  };
}

/**
 * 挂载轮播图元素视图。
 * @param element - 轮播图元素
 * @param options - 轮播图元素视图挂载选项
 * @returns 组件包装器
 */
function mountSwiperElementView(element: WidgetShapeElement<WidgetSwiperElementMetadata>, options: SwiperElementViewMountOptions = {}): VueWrapper {
  const { renderContext, renderOptions } = options;
  const contextRef = ref<WidgetRenderContext | undefined>(renderContext);
  const Provider = defineComponent({
    name: 'SwiperElementViewProvider',
    setup(): () => VNode {
      provideRenderContext(contextRef, renderOptions);

      return (): VNode => h(SwiperElementView, { element });
    }
  });

  return mount(Provider);
}

/**
 * 读取轮播轨道样式。
 * @param wrapper - 轮播图组件包装器
 * @returns 轨道样式文本
 */
function readTrackStyle(wrapper: VueWrapper): string {
  return wrapper.find('.widget-swiper-element__track').attributes('style') ?? '';
}

/**
 * 读取轮播图视图源代码。
 * @returns 轮播图视图源代码
 */
function readViewSource(): string {
  return readFileSync(resolve(process.cwd(), 'src/components/BWidget/elements/Swiper/index.vue'), 'utf8');
}

/**
 * 读取指定 CSS 选择器的规则内容。
 * @param source - 源代码文本
 * @param selector - CSS 选择器
 * @returns CSS 规则内容
 */
function readStyleRule(source: string, selector: string): string {
  const pattern = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')} \\{(?<body>[\\s\\S]*?)\\n\\}`, 'u');

  return pattern.exec(source)?.groups?.body ?? '';
}

afterEach((): void => {
  vi.useRealTimers();
});

describe('SwiperElementView', (): void => {
  it('renders images from element metadata and starts from initial index', (): void => {
    const wrapper = mountSwiperElementView(createSwiperElement({ initialIndex: 1 }));
    const images = wrapper.findAll('.widget-swiper-element__img');

    expect(images).toHaveLength(2);
    expect(images[0].attributes('src')).toBe('https://example.com/a.png');
    expect(images[1].attributes('alt')).toBe('第二张');
    expect(readTrackStyle(wrapper)).toContain('translateX(-100%)');
    wrapper.unmount();
  });

  it('resolves image src and alt variables in runtime mode', (): void => {
    const element = createSwiperElement({
      images: [
        {
          alt: createVariableValue('label'),
          src: createVariableValue('$input.hero')
        }
      ]
    });
    const wrapper = mountSwiperElementView(element, {
      renderContext: {
        input: {
          hero: 'https://cdn.example.com/hero.png'
        },
        output: undefined,
        data: {
          label: '首图'
        }
      },
      renderOptions: { mode: 'runtime' }
    });

    expect(wrapper.find('.widget-swiper-element__img').attributes('src')).toBe('https://cdn.example.com/hero.png');
    expect(wrapper.find('.widget-swiper-element__img').attributes('alt')).toBe('首图');
    wrapper.unmount();
  });

  it('shows placeholder for variable-only src outside runtime mode', (): void => {
    const wrapper = mountSwiperElementView(
      createSwiperElement({
        images: [
          {
            alt: createLiteralValue('首图'),
            src: createVariableValue('$input.hero')
          }
        ]
      }),
      {
        renderContext: {
          input: {
            hero: 'https://cdn.example.com/hero.png'
          },
          output: undefined,
          data: {}
        }
      }
    );

    expect(wrapper.find('.widget-swiper-element__img').exists()).toBe(false);
    expect(wrapper.find('.widget-swiper-element__placeholder').exists()).toBe(true);
    wrapper.unmount();
  });

  it('shows placeholder when image list is empty', (): void => {
    const wrapper = mountSwiperElementView(createSwiperElement({ images: [] }));

    expect(wrapper.find('.widget-swiper-element__img').exists()).toBe(false);
    expect(wrapper.find('.widget-swiper-element__placeholder').exists()).toBe(true);
    wrapper.unmount();
  });

  it('uses vertical transform when vertical mode is enabled', (): void => {
    const wrapper = mountSwiperElementView(createSwiperElement({ initialIndex: 1, vertical: createLiteralValue(true) }));

    expect(readTrackStyle(wrapper)).toContain('translateY(-100%)');
    wrapper.unmount();
  });

  it('applies configured animation duration to track style', (): void => {
    const wrapper = mountSwiperElementView(createSwiperElement({ animationDuration: 450 }));

    expect(readTrackStyle(wrapper)).toContain('transition-duration: 450ms');
    wrapper.unmount();
  });

  it('does not render side navigation buttons', (): void => {
    const wrapper = mountSwiperElementView(createSwiperElement({ initialIndex: 1, loop: createLiteralValue(false) }));

    expect(wrapper.find('.widget-swiper-element__nav').exists()).toBe(false);
    expect(wrapper.find('.widget-swiper-element__nav--next').exists()).toBe(false);
    expect(wrapper.find('.widget-swiper-element__nav--prev').exists()).toBe(false);
    wrapper.unmount();
  });

  it('advances with autoplay using the configured interval', async (): Promise<void> => {
    vi.useFakeTimers();
    const wrapper = mountSwiperElementView(createSwiperElement({ autoplay: createLiteralValue(true), autoplayInterval: 1000 }));

    expect(readTrackStyle(wrapper)).toContain('translateX(0%)');
    vi.advanceTimersByTime(1000);
    await nextTick();

    expect(readTrackStyle(wrapper)).toContain('translateX(-100%)');
    wrapper.unmount();
  });

  it('resolves a variable boolean before applying vertical layout', (): void => {
    const wrapper = mountSwiperElementView(createSwiperElement({ initialIndex: 1, vertical: createVariableValue('vertical') }), {
      renderContext: {
        input: {},
        output: undefined,
        data: { vertical: true }
      },
      renderOptions: { mode: 'runtime' }
    });

    expect(readTrackStyle(wrapper)).toContain('translateY(-100%)');
    wrapper.unmount();
  });

  it('rejects historical primitive values in migrated boolean fields', (): void => {
    const wrapper = mountSwiperElementView(
      createSwiperElement({
        initialIndex: 1,
        vertical: true as unknown as WidgetSwiperElementMetadata['vertical']
      })
    );

    expect(readTrackStyle(wrapper)).toContain('translateX(-100%)');
    expect(readTrackStyle(wrapper)).not.toContain('translateY(-100%)');
    wrapper.unmount();
  });

  it('renders active-line indicator with active short line and inactive dots', (): void => {
    const wrapper = mountSwiperElementView(createSwiperElement({ indicatorColor: '#ff3366', indicatorShape: 'active-line' }));
    const indicators = wrapper.findAll('.widget-swiper-element__indicator-item');
    const source = readViewSource();
    const inactiveRule = readStyleRule(source, '.widget-swiper-element__indicator-item--active-line');
    const activeRule = readStyleRule(source, ".widget-swiper-element__indicator-item--active-line[aria-current='true']");

    expect(indicators[0].classes()).toContain('widget-swiper-element__indicator-item--active-line');
    expect(indicators[0].attributes('style')).toContain('--widget-swiper-indicator-color: #ff3366');
    expect(indicators[0].attributes('aria-current')).toBe('true');
    expect(indicators[1].attributes('aria-current')).toBeUndefined();
    expect(inactiveRule).toContain('width: 3px;');
    expect(inactiveRule).toContain('height: 3px;');
    expect(activeRule).toContain('width: 10px;');
    expect(activeRule).toContain('height: 3px;');
    wrapper.unmount();
  });

  it('renders dot indicator as 3px circles', (): void => {
    const wrapper = mountSwiperElementView(createSwiperElement({ indicatorShape: 'dot' }));
    const source = readViewSource();
    const dotRule = readStyleRule(source, '.widget-swiper-element__indicator-item--dot');

    expect(wrapper.find('.widget-swiper-element__indicator-item').classes()).toContain('widget-swiper-element__indicator-item--dot');
    expect(dotRule).toContain('width: 3px;');
    expect(dotRule).toContain('height: 3px;');
    wrapper.unmount();
  });
});
