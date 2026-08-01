<!--
 * @file index.vue
 * @description 分段控制组件，支持选项切换、自定义标签和按需渲染内容插槽。
-->
<template>
  <div :class="bem({ block })">
    <div ref="trackRef" :class="bem('track')" role="tablist">
      <button
        v-for="item in options"
        :key="item.value"
        type="button"
        :class="[bem('tab'), { 'is-active': isOptionActive(item), 'is-disabled': item.disabled }, item.className]"
        :disabled="item.disabled"
        :aria-selected="isOptionActive(item)"
        role="tab"
        @click="handleOptionClick(item)"
      >
        <span :class="bem('label')">
          <slot name="label" :record="item" :active="isOptionActive(item)">
            {{ item.label }}
          </slot>
        </span>
      </button>

      <div v-if="indicatorVisible" :class="bem('nav-bar')" :style="navBarStyle"></div>
    </div>

    <div v-if="hasContentSlots" :class="bem('main')">
      <div v-for="item in options" v-show="isOptionActive(item)" :key="item.value" :class="bem('content')" role="tabpanel">
        <template v-if="isContentVisible(item.value)">
          <slot :name="getSlotName(item.value)"></slot>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts" generic="T extends BSegmentedOption">
import type { BSegmentedOption, BSegmentedProps as Props, BSegmentedValue } from './types';
import type { Ref } from 'vue';
import { computed, nextTick, onMounted, ref, useSlots, watch } from 'vue';
import { useResizeObserver, useVModel } from '@vueuse/core';
import { createNamespace } from '@/utils/namespace';

defineOptions({ name: 'BSegmented' });

const [, bem] = createNamespace('segmented');

const props = withDefaults(defineProps<Props<T>>(), {
  value: undefined,
  block: false
});

const emit = defineEmits<{
  /** 选中值更新时触发。 */
  'update:value': [value: BSegmentedValue];
  /** 用户点击切换选项时触发。 */
  change: [value: BSegmentedValue, option: T];
}>();

const slots = useSlots();
const active = useVModel(props, 'value', emit, { passive: true }) as Ref<BSegmentedValue | undefined>;
const trackRef = ref<HTMLElement>();
const trackWidth = ref(0);
const visibleValues = ref<Set<BSegmentedValue>>(new Set());

/**
 * 将选项值转换为插槽名。
 * @param value - 选项值
 * @returns 插槽名
 */
function getSlotName(value: BSegmentedValue): string {
  return String(value);
}

/** 当前激活选项在完整选项列表中的索引。 */
const activeIndex = computed<number>(() => {
  return props.options.findIndex((item: BSegmentedOption): boolean => item.value === active.value);
});

/** 当前激活选项。 */
const activeOption = computed<BSegmentedOption | undefined>(() => {
  return props.options.find((item: BSegmentedOption): boolean => item.value === active.value);
});

/** 第一个可用选项，用于默认值和兜底同步。 */
const firstEnabledOption = computed<BSegmentedOption | undefined>(() => {
  return props.options.find((item: BSegmentedOption): boolean => !item.disabled);
});

/** 单个分段项的宽度。 */
const tabWidth = computed<number>(() => {
  if (props.options.length === 0) {
    return 0;
  }

  return trackWidth.value / props.options.length;
});

/** 是否展示激活滑块。 */
const indicatorVisible = computed<boolean>(() => {
  return activeIndex.value >= 0 && tabWidth.value > 0;
});

/** 激活滑块样式。 */
const navBarStyle = computed<Record<string, string>>(() => {
  return {
    width: `${Math.max(0, tabWidth.value)}px`,
    transform: `translateX(${tabWidth.value * activeIndex.value}px)`
  };
});

/** 是否存在任意内容插槽。 */
const hasContentSlots = computed<boolean>(() => {
  return props.options.some((item: BSegmentedOption): boolean => Boolean(slots[getSlotName(item.value)]));
});

/**
 * 判断选项是否处于激活状态。
 * @param option - 待判断选项
 * @returns 是否激活
 */
function isOptionActive(option: BSegmentedOption): boolean {
  return option.value === active.value;
}

/**
 * 标记内容插槽已经可见，确保访问过的面板保持渲染。
 * @param value - 已访问的选项值
 */
function markContentVisible(value: BSegmentedValue): void {
  if (visibleValues.value.has(value)) {
    return;
  }

  visibleValues.value = new Set([...visibleValues.value, value]);
}

/**
 * 判断内容插槽是否应该渲染。
 * @param value - 选项值
 * @returns 是否渲染
 */
function isContentVisible(value: BSegmentedValue): boolean {
  return visibleValues.value.has(value) && Boolean(slots[getSlotName(value)]);
}

/**
 * 从 ResizeObserver 条目或 DOM 节点读取轨道宽度。
 * @param entry - ResizeObserver 条目
 * @returns 轨道宽度
 */
function readTrackWidth(entry?: ResizeObserverEntry): number {
  const observedWidth = entry?.contentRect.width;

  if (observedWidth && observedWidth > 0) return observedWidth;

  return trackRef.value?.getBoundingClientRect().width ?? trackRef.value?.offsetWidth ?? 0;
}

/**
 * 同步轨道宽度，用于计算激活滑块位置。
 * @param entry - ResizeObserver 条目
 */
function syncTrackWidth(entry?: ResizeObserverEntry): void {
  trackWidth.value = Math.max(0, readTrackWidth(entry));
}

/**
 * 确保当前值始终落在可用选项上，并记录内容可见状态。
 */
function syncActiveValue(): void {
  if (activeOption.value && !activeOption.value.disabled) {
    markContentVisible(activeOption.value.value);
    return;
  }

  if (firstEnabledOption.value) {
    active.value = firstEnabledOption.value.value;
    markContentVisible(firstEnabledOption.value.value);
  }
}

/**
 * 处理选项点击。
 * @param option - 被点击选项
 */
function handleOptionClick(option: T): void {
  if (option.disabled || option.value === active.value) {
    return;
  }

  active.value = option.value;
  markContentVisible(option.value);
  emit('change', option.value, option);
}

watch(
  (): { value: BSegmentedValue | undefined; options: BSegmentedOption[] } => ({
    value: active.value,
    options: props.options
  }),
  (): void => {
    syncActiveValue();
  },
  { deep: true, immediate: true }
);

onMounted((): void => {
  nextTick((): void => {
    syncTrackWidth();
  });
});

useResizeObserver(trackRef, (entries: ResizeObserverEntry[]): void => {
  syncTrackWidth(entries[0]);
});
</script>

<style scoped lang="less">
.b-segmented {
  display: inline-flex;
  flex-direction: column;
  max-width: 100%;
  min-height: 32px;
}

.b-segmented--block {
  width: 100%;
}

.b-segmented__track {
  position: relative;
  box-sizing: border-box;
  display: flex;
  width: 100%;
  height: 32px;
  padding: 2px;
  overflow: hidden;
  border: var(--control-border-width) solid var(--border-primary);
  border-radius: var(--control-radius);
}

.b-segmented__tab {
  position: relative;
  z-index: 1;
  display: inline-flex;
  flex: 1 1 0;
  align-items: center;
  justify-content: center;
  min-width: 0;
  padding: 0 10px;
  font-size: 13px;
  line-height: 1;
  color: var(--text-secondary);
  white-space: nowrap;
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: var(--control-radius);
  transition: color var(--motion-duration-base) var(--motion-easing-standard);

  &:hover:not(.is-disabled, .is-active) {
    color: var(--text-primary);
  }

  &.is-active {
    color: var(--color-primary);
  }

  &.is-disabled {
    color: var(--text-disabled);
    cursor: not-allowed;
  }
}

.b-segmented__label {
  display: block;
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: center;
}

.b-segmented__nav-bar {
  position: absolute;
  top: 2px;
  left: 2px;
  height: 26px;
  pointer-events: none;
  background: var(--bg-secondary);
  border-radius: var(--control-radius);
  transition: width var(--motion-duration-base) var(--motion-easing-standard), transform var(--motion-duration-base) var(--motion-easing-standard);
}

.b-segmented__main {
  min-height: 0;
}

.b-segmented__content {
  min-height: 0;
}
</style>
