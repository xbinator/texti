/**
 * @file schema.ts
 * @description BWidget 图片元素注册配置。
 */
import type { WidgetMetadata } from '../../types';
import type { WidgetElementSchema } from '../types';
import type { BSmartValue } from '@/components/BSmart/types';
import { createLiteralValue } from '@/components/BSmart/utils/value';
import { WIDGET_DEFAULT_ELEMENT_STYLE } from '../../constants/style';

/**
 * 图片填充模式，对应 CSS object-fit。
 */
export type WidgetImageFit = 'cover' | 'contain' | 'fill' | 'none' | 'scale-down';

/**
 * 图片元素自定义元数据。
 */
export interface WidgetImageElementMetadata extends WidgetMetadata {
  /** 图片地址 */
  src: BSmartValue<string>;
  /** 图片填充模式，未设置时使用 WIDGET_IMAGE_DEFAULT_FIT */
  fit?: WidgetImageFit;
  /** 替代文本，用于无障碍 */
  alt: BSmartValue<string>;
}

/** 图片元素默认填充模式。 */
export const WIDGET_IMAGE_DEFAULT_FIT: WidgetImageFit = 'cover';

/**
 * 图片填充模式下拉选项。
 */
export const WIDGET_IMAGE_FIT_OPTIONS: { label: string; value: WidgetImageFit }[] = [
  { label: '填充裁剪（cover）', value: 'cover' },
  { label: '完整显示（contain）', value: 'contain' },
  { label: '拉伸填充（fill）', value: 'fill' },
  { label: '原始尺寸（none）', value: 'none' },
  { label: '缩小适应（scale-down）', value: 'scale-down' }
];

/**
 * 图片元素注册配置。
 * 通过泛型参数声明专属元数据类型，metadata 字段在写入时即获得 WidgetImageElementMetadata 校验。
 */
export const imageElementSchema: WidgetElementSchema<WidgetImageElementMetadata> = {
  role: 'basic',
  name: 'image',
  label: '图片',
  icon: 'lucide:image',
  metadata: {
    alt: createLiteralValue(''),
    src: createLiteralValue(''),
    fit: WIDGET_IMAGE_DEFAULT_FIT
  },
  style: WIDGET_DEFAULT_ELEMENT_STYLE,
  resize: {
    enabled: true
  },
  createAnchor: 'center',
  createCursor: 'crosshair'
};
