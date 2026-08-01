<!--
  @file index.vue
  @description BColorPicker 颜色选择器组件，支持 SV 面板、色相条、透明度条拖拽选择。
-->
<template>
  <BDropdown v-model:open="visible" :get-popup-container="(triggerNode) => triggerNode" :placement="placement" :align="align">
    <div ref="triggerRef" :class="bem('trigger')">
      <slot>
        <AInput
          v-model:value="inputValue"
          :class="bem('input')"
          :placeholder="placeholder"
          :allow-clear="allowClear"
          :readonly="readonly"
          :disabled="disabled"
          :bordered="bordered"
          @update:value="handleInputUpdate"
          @blur="handleInputBlur"
          @press-enter="handleInputBlur"
        >
          <template #suffix>
            <div :class="bem('color-trigger')" :style="{ background: currentColor || 'transparent' }"></div>
          </template>
        </AInput>
      </slot>
    </div>

    <template #overlay>
      <div :class="[bem('panel')]" :style="panelStyle">
        <!-- SV 面板 + 色相条 -->
        <div :class="bem('main')">
          <!-- 饱和度/明度面板 -->
          <div ref="svPanelRef" :class="bem('sv-panel')" :style="{ background: bgColor }" @pointerdown="onSvPanelDown">
            <div :class="bem('sv-white')"></div>
            <div :class="bem('sv-black')"></div>
            <div :class="bem('sv-cursor')" :style="cursorStyle">
              <div></div>
            </div>
          </div>

          <!-- 色相条 -->
          <div ref="hueBarRef" :class="bem('hue-bar')" @pointerdown="onHueBarDown">
            <div :class="bem('hue-thumb')" :style="hueThumbStyle"></div>
          </div>
        </div>

        <!-- 透明度条 -->
        <div ref="alphaBarRef" :class="bem('alpha-bar')" @pointerdown="onAlphaBarDown">
          <div :class="bem('alpha-thumb')" :style="alphaThumbStyle"></div>
        </div>

        <!-- 预设色板 -->
        <div :class="bem('presets')">
          <div v-for="color in presetColors" :key="color" :class="bem('preset-item')" :style="{ background: color }" @click="onPresetClick(color)"></div>
        </div>
      </div>
    </template>
  </BDropdown>
</template>

<script setup lang="ts">
/**
 * @file index.vue
 * @description BColorPicker 颜色选择器组件。
 * 基于 tinycolor2 做颜色格式转换，使用 VueUse usePointer 实现拖拽交互。
 */
import type { BColorPickerProps } from './types';
import type { CSSProperties } from 'vue';
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { usePointer } from '@vueuse/core';
import { Input as AInput } from 'ant-design-vue';
import { clamp } from 'lodash-es';
import tinycolor from 'tinycolor2';
import BDropdown from '@/components/BDropdown/index.vue';
import { addCssUnit } from '@/utils/css';
import { createNamespace } from '@/utils/namespace';

/** 预设常用颜色 */
const PRESET_COLORS = [
  '#ff4d4f',
  '#ff7a45',
  '#ffa940',
  '#fadb14',
  '#52c41a',
  '#13c2c2',
  '#1890ff',
  '#2f54eb',
  '#722ed1',
  '#eb2f96',
  '#ffffff',
  '#f5f5f5',
  '#d9d9d9',
  '#bfbfbf',
  '#8c8c8c',
  '#595959',
  '#434343',
  '#262626',
  '#1f1f1f',
  '#000000'
];

defineOptions({ name: 'BColorPicker' });

const [, bem] = createNamespace('color-picker');

const props = withDefaults(defineProps<BColorPickerProps>(), {
  value: '',
  format: 'rgb',
  defaultValue: '',
  width: undefined,
  placeholder: '请输入',
  allowClear: false,
  readonly: false,
  disabled: false,
  bordered: true
});

const emit = defineEmits<{
  /** 颜色值更新（v-model） */
  'update:value': [value: string];
  /** 颜色变更 */
  change: [value: string];
}>();

/** SV 面板尺寸常量 */
const SV_PANEL_SIZE = { width: 220, height: 140 } as const;
/** 滑块指示点尺寸 */
const THUMB_SIZE = { width: 4, height: 4 } as const;
/** 弹出层可见状态 */
const visible = ref<boolean>(false);
/** trigger 元素引用，用于获取默认宽度 */
const triggerRef = ref<HTMLElement | null>(null);
/** 当前颜色（rgb 字符串） */
const currentColor = ref<string>('');
/** HSV + Alpha 状态 */
const hsva = reactive({ h: 0, s: 0, v: 0, a: 1 });
/** 预设色板列表 */
const presetColors = PRESET_COLORS;
/** 输入框显示值 */
const inputValue = ref<string>('');

/** SV 面板 DOM 引用 */
const svPanelRef = ref<HTMLElement | null>(null);
/** 色相条 DOM 引用 */
const hueBarRef = ref<HTMLElement | null>(null);
/** 透明度条 DOM 引用 */
const alphaBarRef = ref<HTMLElement | null>(null);

/** 光标样式 */
const cursorStyle = reactive<CSSProperties>({});
/** 色相滑块样式 */
const hueThumbStyle = reactive<CSSProperties>({});
/** 透明度滑块样式 */
const alphaThumbStyle = reactive<CSSProperties>({});

/** VueUse 指针状态 */
const pointer = usePointer();

/** 拖拽状态标记 */
let dragging: 'sv' | 'hue' | 'alpha' | null = null;

/** 当前拖拽的事件清理函数 */
let cleanupDragListeners: (() => void) | null = null;

/** SV 面板背景色（纯色相） */
const bgColor = computed<string>(() => `hsl(${hsva.h}, 100%, 50%)`);

/** 面板容器样式：优先使用 prop，否则取 trigger 元素宽度，兜底 220px */
const panelStyle = computed<CSSProperties>(() => ({
  width: addCssUnit(props.width ?? triggerRef.value?.offsetWidth ?? SV_PANEL_SIZE.width)
}));

/**
 * 根据输出格式格式化颜色值
 * @param value - 颜色字符串
 * @returns 格式化后的颜色字符串
 */
function formatColor(value: string): string {
  const color = tinycolor(value);
  if (!color.isValid()) return '';

  const formatters: Record<string, () => string> = {
    rgb: () => color.toRgbString(),
    hex: () => (color.getAlpha() === 1 ? color.toHexString() : color.toHex8String())
  };

  return formatters[props.format]?.() ?? '';
}

/**
 * 更新颜色并触发事件
 * @param color - 颜色源（HSVA 对象或颜色字符串）
 */
function updateColor(color: { h: number; s: number; v: number; a: number } | string): void {
  currentColor.value = color ? tinycolor(color).toRgbString() : '';
  const formattedColor = formatColor(currentColor.value);
  emit('update:value', formattedColor);
  emit('change', formattedColor);
}

/**
 * 获取元素相对指针的本地坐标
 * @param el - 目标 DOM 元素
 * @returns 本地坐标 { x, y } 和容器尺寸 { width, height }
 */
function getLocalPosition(el: HTMLElement): { x: number; y: number; width: number; height: number } {
  const rect = el.getBoundingClientRect();
  return {
    x: clamp(pointer.x.value - rect.left, 0, rect.width),
    y: clamp(pointer.y.value - rect.top, 0, rect.height),
    width: rect.width,
    height: rect.height
  };
}

/**
 * 注册拖拽事件监听，返回清理函数
 * @param type - 拖拽类型
 * @param onMove - 移动回调
 */
function startDrag(type: 'sv' | 'hue' | 'alpha', onMove: () => void): void {
  // 先清理上一次未完成的拖拽监听
  cleanupDragListeners?.();

  dragging = type;

  const handleMove = (): void => {
    if (dragging === type) onMove();
  };
  const handleUp = (): void => {
    dragging = null;
    cleanupDragListeners = null;
    window.removeEventListener('pointermove', handleMove);
    window.removeEventListener('pointerup', handleUp);
  };

  cleanupDragListeners = () => {
    dragging = null;
    window.removeEventListener('pointermove', handleMove);
    window.removeEventListener('pointerup', handleUp);
  };

  window.addEventListener('pointermove', handleMove);
  window.addEventListener('pointerup', handleUp);
}

// ==================== SV 面板拖拽 ====================

/**
 * 处理 SV 面板移动，更新饱和度和明度
 */
function handleSvMove(): void {
  if (!svPanelRef.value) return;
  const { x, y, width, height } = getLocalPosition(svPanelRef.value);

  cursorStyle.left = `${x}px`;
  cursorStyle.top = `${y}px`;

  hsva.s = x / width;
  hsva.v = clamp(-(y / height) + 1, 0, 1);

  updateColor(hsva);
}

/**
 * 处理 SV 面板指针按下
 */
function onSvPanelDown(): void {
  if (!svPanelRef.value) return;
  handleSvMove();
  startDrag('sv', handleSvMove);
}

// ==================== 色相条拖拽 ====================

/**
 * 处理色相条移动，更新色相值
 */
function handleHueMove(): void {
  if (!hueBarRef.value) return;
  const { y, height } = getLocalPosition(hueBarRef.value);

  hueThumbStyle.top = `${y}px`;

  if (y <= 0) {
    hsva.h = 360;
  } else if (y >= height) {
    hsva.h = 0;
  } else {
    hsva.h = (y / height) * 360;
  }

  updateColor(hsva);
}

/**
 * 处理色相条指针按下
 */
function onHueBarDown(): void {
  if (!hueBarRef.value) return;
  handleHueMove();
  startDrag('hue', handleHueMove);
}

// ==================== 透明度条拖拽 ====================

/**
 * 处理透明度条移动，更新透明度值
 */
function handleAlphaMove(): void {
  if (!alphaBarRef.value) return;
  const { x, width } = getLocalPosition(alphaBarRef.value);

  alphaThumbStyle.left = `${x}px`;

  if (x <= 0) {
    hsva.a = 0;
  } else if (x >= width) {
    hsva.a = 1;
  } else {
    // 保留 2 位小数，提高透明度精度
    hsva.a = +(x / width).toFixed(2);
  }

  updateColor(hsva);
}

/**
 * 处理透明度条指针按下
 */
function onAlphaBarDown(): void {
  if (!alphaBarRef.value) return;
  handleAlphaMove();
  startDrag('alpha', handleAlphaMove);
}

// ==================== 位置计算 ====================

/**
 * 计算 SV 面板光标横向位置
 */
function getCursorLeft(): number {
  if (!svPanelRef.value) return SV_PANEL_SIZE.width * hsva.s;
  return svPanelRef.value.clientWidth * hsva.s;
}

/**
 * 计算 SV 面板光标纵向位置
 */
function getCursorTop(): number {
  const height = svPanelRef.value?.clientHeight ?? SV_PANEL_SIZE.height;
  return (hsva.v - 1) * height * -1;
}

/**
 * 计算色相滑块纵向位置
 */
function getHueThumbTop(): number {
  const height = hueBarRef.value?.clientHeight ?? SV_PANEL_SIZE.height;
  if (hsva.h === 0) return height;
  if (hsva.h === 360) return 0;
  return (hsva.h / 360) * height - THUMB_SIZE.height / 2;
}

/**
 * 计算透明度滑块横向位置
 */
function getAlphaThumbLeft(): number {
  const width = alphaBarRef.value?.clientWidth ?? SV_PANEL_SIZE.width;
  if (hsva.a === 0) return 0;
  if (hsva.a === 1) return width;
  return hsva.a * width - THUMB_SIZE.width / 2;
}

/**
 * 同步所有指示器位置
 */
function syncIndicatorPositions(): void {
  cursorStyle.top = `${getCursorTop()}px`;
  cursorStyle.left = `${getCursorLeft()}px`;
  hueThumbStyle.top = `${getHueThumbTop()}px`;
  alphaThumbStyle.left = `${getAlphaThumbLeft()}px`;
}

/**
 * 从当前颜色更新 HSVA 状态和指示器位置
 */
function updatePositionFromColor(): void {
  const { h, s, v, a } = tinycolor(currentColor.value || '#ffffff').toHsv();
  hsva.h = h;
  hsva.s = s;
  hsva.v = v;
  hsva.a = a;
  syncIndicatorPositions();
}

/**
 * 同步输入框显示值为当前颜色
 */
function syncInputValue(): void {
  inputValue.value = formatColor(currentColor.value);
}

/**
 * 处理输入框内容更新，合法颜色立即同步到外部 v-model。
 * @param value - 输入框最新值
 */
function handleInputUpdate(value: string): void {
  const color = tinycolor(value.trim());

  if (!color.isValid()) {
    return;
  }

  updateColor(color.toHex8());
  updatePositionFromColor();
}

/**
 * 处理输入框失焦或回车，校验并应用颜色
 */
function handleInputBlur(): void {
  const raw = inputValue.value.trim();

  if (!raw) {
    if (props.allowClear) {
      updateColor('');
    }
    syncInputValue();
    updatePositionFromColor();
    return;
  }

  const color = tinycolor(raw);
  if (color.isValid()) {
    updateColor(color.toHex8());
  }
  syncInputValue();
  updatePositionFromColor();
}

/**
 * 点击预设色块
 * @param color - 预设颜色值
 */
function onPresetClick(color: string): void {
  updateColor(color);
  syncInputValue();
  updatePositionFromColor();
}

/** 组件卸载前清理拖拽事件监听 */
onBeforeUnmount(() => {
  cleanupDragListeners?.();
});

/** 弹出层打开时同步位置 */
watch(
  () => visible.value,
  (val) => val && nextTick(updatePositionFromColor)
);

/** 外部 value 变化时同步内部状态 */
watch(
  () => props.value,
  () => {
    const color = props.value || props.defaultValue;
    const value = tinycolor(color).isValid() ? tinycolor(color).toRgbString() : '';
    currentColor.value = value;
    syncInputValue();
    updatePositionFromColor();
  },
  { immediate: true }
);
</script>

<style lang="less">
.b-color-picker__trigger {
  width: 100%;
}

.b-color-picker__presets {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 10px;
}

.b-color-picker__preset-item {
  width: 16px;
  height: 16px;
  cursor: pointer;
  border: var(--control-border-width) solid var(--border-primary, #d9d9d9);
  border-radius: var(--control-radius);
  transition: transform var(--motion-duration-fast) var(--motion-easing-standard);
}

.b-color-picker__preset-item:hover {
  transform: scale(1.2);
}

.b-color-picker__panel {
  padding: 10px;
  background: var(--dropdown-bg);
  border: var(--overlay-border-width) solid var(--border-primary);
  border-radius: var(--overlay-radius);
  box-shadow: var(--shadow-md);
}

.b-color-picker__main {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
}

.b-color-picker__sv-panel {
  position: relative;
  width: 100%;
  height: 140px;
  touch-action: none;
  cursor: crosshair;
  user-select: none;
}

.b-color-picker__sv-white {
  position: absolute;
  inset: 0;
  background: linear-gradient(to right, #fff, rgb(255 255 255 / 0%));
}

.b-color-picker__sv-black {
  position: absolute;
  inset: 0;
  background: linear-gradient(to top, #000, transparent);
}

.b-color-picker__sv-cursor {
  position: absolute;
}

.b-color-picker__sv-cursor div {
  width: 4px;
  height: 4px;
  border-radius: var(--radius-full);
  box-shadow: 0 0 0 1.5px #fff, inset 0 0 1px 1px #0000004d, 0 0 1px 2px #0006;
  transform: translate(-2px, -2px);
}

.b-color-picker__hue-bar {
  position: relative;
  width: 12px;
  height: 140px;
  touch-action: none;
  cursor: pointer;
  user-select: none;
  background: linear-gradient(to bottom, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%);
}

.b-color-picker__hue-thumb {
  position: absolute;
  width: 100%;
  height: 4px;
  cursor: pointer;
  background: #fff;
  border: var(--control-border-width) solid var(--border-primary);
  box-shadow: 0 0 2px #0009;
  transform: translateY(-50%);
}

.b-color-picker__alpha-bar {
  position: relative;
  width: 100%;
  height: 12px;
  touch-action: none;
  cursor: pointer;
  user-select: none;
  background: linear-gradient(45deg, #eee 25%, transparent 0, transparent 75%, #eee 0, #eee), linear-gradient(45deg, #eee 25%, #fff 0, #fff 75%, #eee 0, #eee);
  background-position: 0 0, 6px 6px;
  background-size: 12px 12px;
}

.b-color-picker__alpha-thumb {
  position: absolute;
  width: 4px;
  height: 100%;
  cursor: pointer;
  background: #fff;
  border: var(--control-border-width) solid var(--border-primary);
  box-shadow: 0 0 2px #0009;
  transform: translateX(-50%);
}

.b-color-picker__input {
  cursor: pointer;
}

.b-color-picker__color-trigger {
  width: 14px;
  height: 14px;
  border: var(--control-border-width) solid var(--border-primary);
  border-radius: var(--control-radius);
}
</style>
