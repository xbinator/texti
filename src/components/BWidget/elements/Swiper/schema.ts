/**
 * @file schema.ts
 * @description BWidget 轮播图元素注册配置。
 */
import type { WidgetMetadata } from '../../types';
import type { WidgetImageFit } from '../Image/schema';
import type { WidgetElementSchema } from '../types';
import type { BSmartSelectOption, BSmartValue } from '@/components/BSmart/types';
import { createLiteralValue } from '@/components/BSmart/utils/value';
import { WIDGET_DEFAULT_ELEMENT_STYLE } from '../../constants/style';
import { WIDGET_IMAGE_DEFAULT_FIT, WIDGET_IMAGE_FIT_OPTIONS } from '../Image/schema';

/**
 * 轮播图图片项。
 */
export interface WidgetSwiperImageItem {
  /** 图片项标题，用于设置面板展示 */
  title?: string;
  /** 图片地址 */
  src: BSmartValue<string>;
  /** 替代文本，用于无障碍 */
  alt: BSmartValue<string>;
}

/**
 * 轮播图指示器形状。
 */
export type WidgetSwiperIndicatorShape = 'dot' | 'line' | 'active-line';

/**
 * 轮播图元素自定义元数据。
 */
export interface WidgetSwiperElementMetadata extends WidgetMetadata {
  /** 图片列表 */
  images: WidgetSwiperImageItem[];
  /** 图片填充模式 */
  fit?: WidgetImageFit;
  /** 是否自动轮播 */
  autoplay: BSmartValue<boolean>;
  /** 自动轮播间隔，单位 ms */
  autoplayInterval: number;
  /** 切换动画时长，单位 ms */
  animationDuration: number;
  /** 初始位置索引值 */
  initialIndex: number;
  /** 是否开启循环播放 */
  loop: BSmartValue<boolean>;
  /** 是否显示指示器 */
  showIndicator: BSmartValue<boolean>;
  /** 是否为纵向滚动 */
  vertical: BSmartValue<boolean>;
  /** 指示器颜色 */
  indicatorColor: string;
  /** 指示器形状 */
  indicatorShape: WidgetSwiperIndicatorShape;
}

/** 轮播图自动播放默认间隔，单位 ms。 */
export const WIDGET_SWIPER_DEFAULT_AUTOPLAY_INTERVAL = 3000;

/** 轮播图默认动画时长，单位 ms。 */
export const WIDGET_SWIPER_DEFAULT_ANIMATION_DURATION = 300;

/** 轮播图默认指示器颜色。 */
export const WIDGET_SWIPER_DEFAULT_INDICATOR_COLOR = '#ffffff';

/** 轮播图默认指示器形状。 */
export const WIDGET_SWIPER_DEFAULT_INDICATOR_SHAPE: WidgetSwiperIndicatorShape = 'dot';

/** 轮播图布尔配置选项。 */
export const WIDGET_SWIPER_BOOLEAN_OPTIONS: BSmartSelectOption<boolean>[] = [
  { label: '关闭', value: false },
  { label: '开启', value: true }
];

/** 轮播图指示器形状选项。 */
export const WIDGET_SWIPER_INDICATOR_SHAPE_OPTIONS: Array<{ label: string; value: WidgetSwiperIndicatorShape }> = [
  { label: '圆点', value: 'dot' },
  { label: '短线', value: 'line' },
  { label: '激活短线', value: 'active-line' }
];

/** 轮播图填充模式选项。 */
export const WIDGET_SWIPER_FIT_OPTIONS = WIDGET_IMAGE_FIT_OPTIONS;

/**
 * 轮播图元素注册配置。
 */
export const swiperElementSchema: WidgetElementSchema<WidgetSwiperElementMetadata> = {
  role: 'basic',
  name: 'swiper',
  label: '轮播图',
  icon: 'lucide:gallery-horizontal-end',
  metadata: {
    autoplay: createLiteralValue(false),
    autoplayInterval: WIDGET_SWIPER_DEFAULT_AUTOPLAY_INTERVAL,
    animationDuration: WIDGET_SWIPER_DEFAULT_ANIMATION_DURATION,
    fit: WIDGET_IMAGE_DEFAULT_FIT,
    images: [
      {
        alt: createLiteralValue(''),
        src: createLiteralValue('')
      }
    ],
    indicatorColor: WIDGET_SWIPER_DEFAULT_INDICATOR_COLOR,
    indicatorShape: WIDGET_SWIPER_DEFAULT_INDICATOR_SHAPE,
    initialIndex: 0,
    loop: createLiteralValue(true),
    showIndicator: createLiteralValue(true),
    vertical: createLiteralValue(false)
  },
  style: WIDGET_DEFAULT_ELEMENT_STYLE,
  resize: {
    enabled: true
  },
  createAnchor: 'center',
  createCursor: 'grab'
};
