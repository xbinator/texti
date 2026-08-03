/**
 * @file index.ts
 * @description BWidget 元素注册入口。
 */
import type { WidgetElementSchema } from './types';
import type { Component } from 'vue';
import ButtonView from './Button/index.vue';
import { buttonElementSchema } from './Button/schema';
import ButtonSetter from './Button/Setter.vue';
import GroupSetter from './group/Setter.vue';
import ImageView from './Image/index.vue';
import { imageElementSchema } from './Image/schema';
import ImageSetter from './Image/Setter.vue';
import RectView from './Rect/index.vue';
import { rectElementSchema } from './Rect/schema';
import SwiperView from './Swiper/index.vue';
import { swiperElementSchema } from './Swiper/schema';
import SwiperSetter from './Swiper/Setter.vue';
import TextView from './Text/index.vue';
import { textElementSchema } from './Text/schema';
import TextSetter from './Text/Setter.vue';

/**
 * BWidget 侧边栏可创建元素注册表。
 */
export const WIDGET_ELEMENT_SCHEMAS: WidgetElementSchema[] = [
  rectElementSchema,
  textElementSchema,
  imageElementSchema,
  swiperElementSchema,
  buttonElementSchema
];

/** 元素配置索引。 */
const widgetElementSchemaByName = new Map<string, WidgetElementSchema>(
  WIDGET_ELEMENT_SCHEMAS.map((schema: WidgetElementSchema): [string, WidgetElementSchema] => [schema.name, schema])
);

/** 元素中间Widget视图索引。 */
const widgetElementViewByName = new Map<string, Component>([
  [rectElementSchema.name, RectView],
  [textElementSchema.name, TextView],
  [imageElementSchema.name, ImageView],
  [swiperElementSchema.name, SwiperView],
  [buttonElementSchema.name, ButtonView]
]);

/** 元素专属属性设置面板索引。 */
const widgetElementSetterByName = new Map<string, Component>([
  ['group', GroupSetter],
  [textElementSchema.name, TextSetter],
  [imageElementSchema.name, ImageSetter],
  [swiperElementSchema.name, SwiperSetter],
  [buttonElementSchema.name, ButtonSetter]
]);

/**
 * 根据注册名称读取元素展示配置。
 * @param name - 元素注册名称
 * @returns 元素展示配置
 */
export function getWidgetElementSchema(name: string): WidgetElementSchema | null {
  return widgetElementSchemaByName.get(name) ?? null;
}

/**
 * 根据注册名称读取元素中间Widget视图。
 * @param name - 元素注册名称
 * @returns 元素中间Widget视图组件
 */
export function getWidgetElementView(name: string): Component | null {
  return widgetElementViewByName.get(name) ?? null;
}

/**
 * 根据注册名称读取元素专属属性设置面板。
 * @param name - 元素注册名称
 * @returns 元素专属属性设置面板组件
 */
export function getWidgetElementSetter(name: string): Component | null {
  return widgetElementSetterByName.get(name) ?? null;
}

export type { WidgetElementRenderSizeConfig, WidgetElementRenderSizeSource, WidgetElementSchema } from './types';
